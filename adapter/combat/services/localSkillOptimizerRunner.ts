import { createPooledCombatWorker } from "./combatComputePool"
import { reviewSeedSchedule, summarizePairedMetrics, mean } from "../shared/simulationStatistics"
import { SIMULATION_ENGINE_VERSION } from "../shared/simulationVersion"
import { simulationFingerprint } from "./trialOptimizationStorage"
import { getRuntimeCombatGameData } from "../shared/runtimeGameData.js"
import { summarizeUpgradeSimulation } from "./autoEquipmentUpgrade.js"
import {
  absoluteThresholdGrid,
  clone,
  fineAbsoluteThresholdGrid,
  finePercentageThresholdGrid,
  materializeTriggerConditions,
  percentageThresholdGrid,
  type GeneratedSkillVariant,
  type SkillOptimizerObjective,
  type TriggerPreset
} from "./skillOptimizer"

const HOUR_NANOSECONDS = 60 * 60 * 1e9
const CALIBRATION_CACHE_KEY = `combat-skill-optimizer-worker-calibration-${SIMULATION_ENGINE_VERSION}`
const CALIBRATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function isWorkerCalibrationFresh(createdAt: number, now = Date.now(), ttlMs = CALIBRATION_TTL_MS) {
  return Number.isFinite(createdAt) && createdAt > 0 && now - createdAt < ttlMs
}

export function isWorkerThroughputHealthy(cachedThroughput: number, currentThroughput: number, minimumRatio = 0.8) {
  return cachedThroughput > 0 && currentThroughput >= cachedThroughput * minimumRatio
}

export interface SkillOptimizerCandidate extends GeneratedSkillVariant {
  snapshot: Record<string, any>
  specialAbilityHrid?: string
}

export interface SkillOptimizerBounds {
  enemyTotalHp: number
  targetHp: number
  partyMissingHp: number
}

export interface SkillOptimizerProgress {
  phase: string
  completed: number
  total: number
  progress: number
  activeWorkers: number
  workerLimit: number
  averageSimulationSeconds: number | null
  stage: string
}

export interface SkillOptimizerRunnerCheckpoint {
  engineVersion?: string
  fingerprint?: string
  completedPhase: "initial" | "coarse" | "fine"
  candidates: SkillOptimizerCandidate[]
  screening: { initial: number, coarse: number, fine: number }
  stageBaselines: Record<string, Record<string, number>>
  runtime?: Record<string, any>
}

interface RunnerOptions {
  baselineSnapshot: Record<string, any>
  candidates: SkillOptimizerCandidate[]
  activePlayerId: string
  priceTable: Record<string, any>
  objective: SkillOptimizerObjective
  bounds: SkillOptimizerBounds
  gameDataVersion: string
  buildPayload: (snapshot: Record<string, any>, hours: number) => Record<string, any>
  seedBase?: number
  workerMode?: "auto" | "manual"
  manualWorkerCount?: number
  stableMode?: boolean
  signal?: AbortSignal
  onProgress?: (progress: SkillOptimizerProgress) => void
  onCheckpoint?: (checkpoint: SkillOptimizerRunnerCheckpoint) => void
  resumeCheckpoint?: Partial<SkillOptimizerRunnerCheckpoint> | Record<string, any> | null
  runtimeWorkerLimit?: number
}

export const SKILL_OPTIMIZER_FINAL_HOURS = 72
export const SKILL_OPTIMIZER_STABLE_FINAL_HOURS = 120

export function resolveSkillOptimizerFinalHours(stableMode = false) {
  return stableMode ? SKILL_OPTIMIZER_STABLE_FINAL_HOURS : SKILL_OPTIMIZER_FINAL_HOURS
}

export function buildSkillOptimizerReviewTasks(input: {
  baselineSnapshot: Record<string, any>
  candidates: SkillOptimizerCandidate[]
  hours: number
  seed: number
  buildPayload: (snapshot: Record<string, any>, hours: number) => Record<string, any>
}): ScenarioTask[] {
  return reviewSeedSchedule(input.seed, input.hours).flatMap(({ seed, hours }) => [
    { id: "baseline", payload: input.buildPayload(input.baselineSnapshot, hours), seed },
    ...input.candidates.map(candidate => ({ id: candidate.variantId, candidate,
      payload: input.buildPayload(materializeCandidateSnapshot(candidate), hours), seed }))
  ])
}

interface ScenarioTask {
  id: string
  payload: Record<string, any>
  candidate?: SkillOptimizerCandidate
  seed: number
}

interface ScenarioResult {
  id: string
  seed: number
  candidate?: SkillOptimizerCandidate
  metrics: Record<string, number>
}

interface SearchParameter {
  abilityHrid: string
  conditionIndex: number
  kind: "absolute" | "percentage"
  maxValue: number
}

function abortError() {
  const error = new Error("最优技能组计算已取消")
  error.name = "AbortError"
  return error
}

function metricKey(objective: SkillOptimizerObjective) {
  return objective === "experience" ? "xpPerHour" : "profitPerHour"
}

function conditionCount(candidate?: SkillOptimizerCandidate) {
  return Object.values(candidate?.triggerPresetByAbility || {}).reduce((sum, item) => sum + Number((item as TriggerPreset).conditions?.length || 0), 0)
}

export function rankSkillOptimizerRows<T extends { id: string, metrics: Record<string, number>, candidate?: SkillOptimizerCandidate }>(rows: T[], objective: SkillOptimizerObjective) {
  const primary = metricKey(objective)
  return [...rows].sort((left, right) => {
    const leftValue = Number(left.metrics?.[primary] || 0)
    const rightValue = Number(right.metrics?.[primary] || 0)
    const scale = Math.max(Math.abs(leftValue), Math.abs(rightValue), 1)
    if (Math.abs(leftValue - rightValue) / scale > 0.001) return rightValue - leftValue
    return Number(left.metrics?.deathsPerHour || 0) - Number(right.metrics?.deathsPerHour || 0)
      || Number(right.metrics?.encountersPerHour || 0) - Number(left.metrics?.encountersPerHour || 0)
      || conditionCount(left.candidate) - conditionCount(right.candidate)
      || left.id.localeCompare(right.id)
  })
}

export function collectExperienceEquivalentThresholdValues(
  rows: Array<{ metrics?: Record<string, number>, candidate?: SkillOptimizerCandidate }>,
  bestRow: { metrics?: Record<string, number> },
  abilityHrid: string,
  conditionIndex: number,
  tolerance = 0.005
) {
  const referenceXp = Number(bestRow.metrics?.xpPerHour || 0)
  const scale = Math.abs(referenceXp)
  return [...new Set(rows
    .filter(row => {
      const xp = Number(row.metrics?.xpPerHour || 0)
      return scale > 1e-9
        ? Math.abs(xp - referenceXp) / scale <= tolerance
        : Math.abs(xp - referenceXp) <= 1e-9
    })
    .map(row => Number(row.candidate?.triggerPresetByAbility?.[abilityHrid]?.conditions?.[conditionIndex]?.value))
    .filter(Number.isFinite))]
    .sort((left, right) => left - right)
}

export function normalizeEquivalentThresholdValues(value: unknown, insensitiveValues: unknown) {
  if (!Array.isArray(insensitiveValues)) return []
  return [...new Set([value, ...insensitiveValues]
    .map(item => Number(item))
    .filter(Number.isFinite))]
    .sort((left, right) => left - right)
}

export function chooseWorkerCountFromSamples(samples: Array<{ workers: number, throughput: number }>, minimumImprovement = 0.08) {
  if (!samples.length) return 1
  let best = samples[0]
  for (const sample of samples.slice(1)) {
    const improvement = best.throughput > 0 ? sample.throughput / best.throughput - 1 : 1
    if (sample.throughput > best.throughput && improvement >= minimumImprovement) best = sample
    else if (improvement < minimumImprovement) break
  }
  return Math.max(1, Math.floor(best.workers))
}

function workerCandidates(taskCount: number) {
  const cores = Math.max(2, Number(globalThis.navigator?.hardwareConcurrency || 4))
  const upper = Math.max(1, Math.min(16, cores - 1, Math.max(1, taskCount)))
  return [1, 2, 4, 8, 12, 16].filter(value => value <= upper)
}

function calibrationKey(gameDataVersion: string) {
  return `${gameDataVersion}|${globalThis.navigator?.hardwareConcurrency || 0}|${globalThis.navigator?.userAgent || "unknown"}`
}

function readCachedWorkerCalibration(gameDataVersion: string): { workers: number, throughput: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(CALIBRATION_CACHE_KEY) || "null")
    if (value?.key === calibrationKey(gameDataVersion) && isWorkerCalibrationFresh(Number(value.createdAt || 0))) {
      return { workers: Math.max(1, Number(value.workers || 1)), throughput: Math.max(0, Number(value.throughput || 0)) }
    }
  } catch {}
  return null
}

function saveCachedWorkerCount(gameDataVersion: string, workers: number, throughput: number) {
  try {
    localStorage.setItem(CALIBRATION_CACHE_KEY, JSON.stringify({ key: calibrationKey(gameDataVersion), workers, throughput, createdAt: Date.now() }))
  } catch {}
}

function runWorkerTask(worker: Worker, task: ScenarioTask, includeCatalog: boolean, signal?: AbortSignal, onFraction?: (value: number) => void) {
  return new Promise<any>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    let settled = false
    const finish = (callback: (value?: any) => void, value?: any) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", handleAbort)
      callback(value)
    }
    const handleAbort = () => finish(reject, abortError())
    signal?.addEventListener("abort", handleAbort, { once: true })
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data || {}
      if (data.type === "simulation_progress") onFraction?.(Math.max(0, Math.min(1, Number(data.progress || 0))))
      else if (data.type === "simulation_result") finish(resolve, data.simResult)
      else if (data.type === "simulation_error") finish(reject, new Error(data.error?.message || data.error || "浏览器 Worker 模拟失败"))
    }
    worker.onerror = event => finish(reject, new Error(event.message || "浏览器 Worker 启动失败"))
    worker.postMessage({ ...task.payload, seed: task.seed, engineVersion: SIMULATION_ENGINE_VERSION, combatMode: task.payload.combatMode || "normal", ...(includeCatalog ? { gameDataEnvelope: getRuntimeCombatGameData() } : {}) })
  })
}

async function executeScenarios(tasks: ScenarioTask[], phase: string, workerLimit: number, options: RunnerOptions, allowRetry = true): Promise<ScenarioResult[]> {
  if (!tasks.length) return []
  workerLimit = Math.max(1, Math.min(workerLimit, options.runtimeWorkerLimit || workerLimit, tasks.length))
  const queue = [...tasks]
  const results: ScenarioResult[] = []
  const workers = new Set<Worker>()
  const fractions = new Map<Worker, number>()
  const startedAt = Date.now()
  let elapsedMs = 0
  let completed = 0
  const report = () => {
    const partial = Array.from(fractions.values()).reduce((sum, value) => sum + value, 0)
    const progress = Math.min(1, (completed + partial) / tasks.length)
    const remainingSeconds = completed > 0 ? ((Date.now() - startedAt) / 1000) * (tasks.length - completed) / completed : null
    const remaining = remainingSeconds == null ? "估算中" : remainingSeconds >= 60 ? `约 ${Math.ceil(remainingSeconds / 60)} 分钟` : `约 ${Math.ceil(remainingSeconds)} 秒`
    options.onProgress?.({
      phase, completed, total: tasks.length, progress, activeWorkers: fractions.size, workerLimit,
      averageSimulationSeconds: completed ? elapsedMs / completed / 1000 : null,
      stage: `${phase} · ${completed}/${tasks.length} · ${remaining}`
    })
  }
  const abort = () => workers.forEach(worker => worker.terminate())
  options.signal?.addEventListener("abort", abort, { once: true })
  report()
  try {
    await Promise.all(Array.from({ length: Math.min(workerLimit, tasks.length) }, async () => {
      const worker = createPooledCombatWorker()
      workers.add(worker)
      let initialized = false
      try {
        for (;;) {
          if (options.signal?.aborted) throw abortError()
          const task = queue.shift()
          if (!task) break
          fractions.set(worker, 0)
          const taskStartedAt = Date.now()
          const simResult = await runWorkerTask(worker, task, !initialized, options.signal, value => { fractions.set(worker, value); report() })
          initialized = true
          elapsedMs += Date.now() - taskStartedAt
          results.push({ id: task.id, seed: task.seed, candidate: task.candidate, metrics: summarizeUpgradeSimulation(simResult, options.activePlayerId, options.priceTable) })
          completed += 1
          fractions.delete(worker)
          report()
        }
      } finally {
        fractions.delete(worker)
        workers.delete(worker)
        worker.terminate()
      }
    }))
    return results.sort((a, b) => tasks.findIndex(t => t.id === a.id && t.seed === a.seed) - tasks.findIndex(t => t.id === b.id && t.seed === b.seed))
  } catch (error) {
    if (allowRetry && (error as Error)?.name !== "AbortError" && workerLimit > 1) {
      const degradedLimit = Math.max(1, Math.floor(workerLimit / 2))
      options.runtimeWorkerLimit = degradedLimit
      return executeScenarios(tasks, `${phase} · 自动降级`, degradedLimit, options, false)
    }
    throw error
  } finally {
    options.signal?.removeEventListener("abort", abort)
    abort()
  }
}

async function calibrateWorkerCount(options: RunnerOptions, force = false) {
  const cached = force ? null : readCachedWorkerCalibration(options.gameDataVersion)
  if (cached) return cached.workers
  const candidates = workerCandidates(options.candidates.length + 1)
  const samples: Array<{ workers: number, throughput: number }> = []
  const startedAt = Date.now()
  for (const workers of candidates) {
    if (Date.now() - startedAt >= 20_000) break
    const tasks = Array.from({ length: workers }, (_, index) => ({
      id: `calibration-${workers}-${index}`,
      payload: options.buildPayload(options.baselineSnapshot, 1),
      seed: Number(options.seedBase || 20260729)
    }))
    const sampleStartedAt = performance.now()
    await executeScenarios(tasks, `Worker 校准 ${workers}`, workers, { ...options, onProgress: options.onProgress }, false)
    const seconds = Math.max(0.001, (performance.now() - sampleStartedAt) / 1000)
    samples.push({ workers, throughput: tasks.length / seconds })
    if (samples.length > 1) {
      const previous = samples[samples.length - 2]
      if (samples.at(-1)!.throughput / Math.max(previous.throughput, 1e-9) - 1 < 0.08) break
    }
  }
  const workers = chooseWorkerCountFromSamples(samples)
  saveCachedWorkerCount(options.gameDataVersion, workers, samples.find(item => item.workers === workers)?.throughput || 0)
  return workers
}

async function resolveWorkerCount(options: RunnerOptions) {
  const cached = readCachedWorkerCalibration(options.gameDataVersion)
  if (!cached || cached.throughput <= 0) return calibrateWorkerCount(options, Boolean(cached))
  const probeTasks = Array.from({ length: cached.workers }, (_, index) => ({
    id: `cache-probe-${index}`,
    payload: options.buildPayload(options.baselineSnapshot, 1),
    seed: Number(options.seedBase || 20260729)
  }))
  const startedAt = performance.now()
  try {
    await executeScenarios(probeTasks, "Worker 缓存验证", cached.workers, options, false)
    const throughput = probeTasks.length / Math.max(0.001, (performance.now() - startedAt) / 1000)
    if (isWorkerThroughputHealthy(cached.throughput, throughput)) return cached.workers
  } catch {
    options.runtimeWorkerLimit = undefined
  }
  return calibrateWorkerCount(options, true)
}

function materializeCandidateSnapshot(candidate: SkillOptimizerCandidate) {
  const snapshot = clone(candidate.snapshot)
  snapshot.triggerMap = snapshot.triggerMap && typeof snapshot.triggerMap === "object" ? snapshot.triggerMap : {}
  for (const [abilityHrid, triggerPreset] of Object.entries(candidate.triggerPresetByAbility)) {
    snapshot.triggerMap[abilityHrid] = materializeTriggerConditions(triggerPreset.conditions)
  }
  return snapshot
}

function collectSearchParameters(candidate: SkillOptimizerCandidate, bounds: SkillOptimizerBounds): SearchParameter[] {
  const result: SearchParameter[] = []
  for (const [abilityHrid, triggerPreset] of Object.entries(candidate.triggerPresetByAbility)) {
    triggerPreset.conditions.forEach((condition, conditionIndex) => {
      if (condition.valueMode !== "search") return
      let maxValue = bounds.enemyTotalHp
      if (condition.dependencyHrid.endsWith("/targeted_enemy")) maxValue = bounds.targetHp
      if (condition.dependencyHrid.endsWith("/all_allies")) maxValue = condition.searchKind === "percentage" ? 100 : bounds.partyMissingHp
      result.push({ abilityHrid, conditionIndex, kind: condition.searchKind === "percentage" ? "percentage" : "absolute", maxValue })
    })
  }
  return result
}

function setParameter(candidate: SkillOptimizerCandidate, parameter: SearchParameter, value: number) {
  const next = clone(candidate)
  next.triggerPresetByAbility[parameter.abilityHrid].conditions[parameter.conditionIndex].value = value
  return next
}

async function simulateCandidateRows(candidates: SkillOptimizerCandidate[], hours: number, seed: number, phase: string, workerLimit: number, options: RunnerOptions) {
  return executeScenarios(candidates.map(candidate => ({
    id: candidate.variantId,
    candidate,
    payload: options.buildPayload(materializeCandidateSnapshot(candidate), hours),
    seed
  })), phase, workerLimit, options)
}

async function simulateStageBaseline(hours: number, seed: number, phase: string, workerLimit: number, options: RunnerOptions) {
  const rows = await executeScenarios([{
    id: `baseline-${hours}h`,
    payload: options.buildPayload(options.baselineSnapshot, hours),
    seed
  }], `${phase} · 基准`, workerLimit, options)
  return rows[0]?.metrics || {}
}

async function coordinateSearch(candidates: SkillOptimizerCandidate[], hours: number, seed: number, phase: string, workerLimit: number, options: RunnerOptions, fine: boolean) {
  const output: ScenarioResult[] = []
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    let current = clone(candidates[candidateIndex])
    const parameters = collectSearchParameters(current, options.bounds)
    let latest: ScenarioResult | null = null
    const rounds = fine ? 1 : 2
    if (!parameters.length) latest = (await simulateCandidateRows([current], hours, seed, `${phase} ${candidateIndex + 1}/${candidates.length}`, workerLimit, options))[0]
    for (let round = 0; round < rounds; round += 1) {
      let changed = false
      for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
        const parameter = parameters[parameterIndex]
        const currentValue = current.triggerPresetByAbility[parameter.abilityHrid].conditions[parameter.conditionIndex].value
        const values = parameter.kind === "percentage"
          ? (fine ? finePercentageThresholdGrid(currentValue) : percentageThresholdGrid())
          : (fine ? fineAbsoluteThresholdGrid(currentValue, parameter.maxValue) : absoluteThresholdGrid(parameter.maxValue))
        const trials = values.map((value, index) => {
          const trial = setParameter(current, parameter, value)
          trial.variantId = `${candidates[candidateIndex].variantId}::${fine ? "fine" : "coarse"}-${round}-${parameterIndex}-${index}`
          return trial
        })
        const rows = await simulateCandidateRows(trials, hours, seed, `${phase} ${candidateIndex + 1}/${candidates.length} · 参数 ${parameterIndex + 1}/${parameters.length}`, workerLimit, options)
        const best = rankSkillOptimizerRows(rows, options.objective)[0]
        const equivalentValues = collectExperienceEquivalentThresholdValues(
          rows,
          best,
          parameter.abilityHrid,
          parameter.conditionIndex
        )
        current = clone(best.candidate!)
        const selectedCondition = current.triggerPresetByAbility[parameter.abilityHrid].conditions[parameter.conditionIndex]
        selectedCondition.insensitiveValues = equivalentValues
        latest = { ...best, id: candidates[candidateIndex].variantId, candidate: current }
        changed ||= current.triggerPresetByAbility[parameter.abilityHrid].conditions[parameter.conditionIndex].value !== currentValue
      }
      if (!changed) break
    }
    if (latest) output.push(latest)
  }
  return rankSkillOptimizerRows(output, options.objective)
}

function delta(current: number, baseline: number) {
  const value = current - baseline
  return { value, pct: Math.abs(baseline) > 1e-9 ? value / Math.abs(baseline) : null }
}

export async function runLocalStagedSkillOptimizer(options: RunnerOptions) {
  const seedBase = Number(options.seedBase || 20260729)
  const selectedWorkerLimit = options.workerMode === "manual"
    ? Math.max(1, Math.min(16, Math.floor(Number(options.manualWorkerCount || 1))))
    : await resolveWorkerCount(options)
  const fingerprintPayload = { ...options.buildPayload(options.baselineSnapshot, 1), workerId: undefined }
  const fingerprint = await simulationFingerprint({ engine: SIMULATION_ENGINE_VERSION, algorithm: "skill-paired8-v2",
    baseline: fingerprintPayload, candidates: options.candidates, objective: options.objective,
    bounds: options.bounds, gameDataVersion: options.gameDataVersion, stableMode: Boolean(options.stableMode), seedBase,
    prices: options.priceTable, activePlayerId: options.activePlayerId })
  if (options.resumeCheckpoint && (options.resumeCheckpoint.engineVersion !== SIMULATION_ENGINE_VERSION || options.resumeCheckpoint.fingerprint !== fingerprint)) {
    throw new Error("检查点的引擎、数据、规则、价格或成员配置已改变；旧结果可以查看，请重新开始计算")
  }
  const checkpoint = options.resumeCheckpoint?.completedPhase && Array.isArray(options.resumeCheckpoint?.candidates)
    ? options.resumeCheckpoint as SkillOptimizerRunnerCheckpoint
    : null
  const completedRank = checkpoint?.completedPhase === "fine" ? 3 : checkpoint?.completedPhase === "coarse" ? 2 : checkpoint?.completedPhase === "initial" ? 1 : 0
  const stageBaselines: Record<string, Record<string, number>> = clone(checkpoint?.stageBaselines || {})
  const screening = { initial: Number(checkpoint?.screening?.initial || 0), coarse: Number(checkpoint?.screening?.coarse || 0), fine: Number(checkpoint?.screening?.fine || 0) }

  let top20: SkillOptimizerCandidate[]
  if (completedRank >= 1) {
    top20 = clone(checkpoint!.candidates)
  } else {
    stageBaselines.initial = await simulateStageBaseline(6, seedBase, "第一阶段 6 小时初筛", selectedWorkerLimit, options)
    const initialRows = rankSkillOptimizerRows(
      await simulateCandidateRows(options.candidates, 6, seedBase, "第一阶段 6 小时初筛", selectedWorkerLimit, options),
      options.objective
    )
    screening.initial = initialRows.length
    top20 = initialRows.slice(0, 20).map(row => row.candidate!)
    options.onCheckpoint?.({ engineVersion: SIMULATION_ENGINE_VERSION, fingerprint, completedPhase: "initial", candidates: clone(top20), screening: clone(screening), stageBaselines: clone(stageBaselines) })
  }

  let top8: SkillOptimizerCandidate[]
  if (completedRank >= 2) {
    top8 = clone(checkpoint!.candidates)
  } else {
    stageBaselines.coarse = await simulateStageBaseline(12, seedBase + 1, "第二阶段 12 小时粗搜", selectedWorkerLimit, options)
    const coarseRows = await coordinateSearch(top20, 12, seedBase + 1, "第二阶段 12 小时粗搜", selectedWorkerLimit, options, false)
    screening.coarse = coarseRows.length
    top8 = coarseRows.slice(0, 8).map(row => row.candidate!)
    options.onCheckpoint?.({ engineVersion: SIMULATION_ENGINE_VERSION, fingerprint, completedPhase: "coarse", candidates: clone(top8), screening: clone(screening), stageBaselines: clone(stageBaselines) })
  }

  let top5: SkillOptimizerCandidate[]
  if (completedRank >= 3) {
    top5 = clone(checkpoint!.candidates)
  } else {
    stageBaselines.fine = await simulateStageBaseline(24, seedBase + 2, "第三阶段 24 小时精搜", selectedWorkerLimit, options)
    const fineRows = await coordinateSearch(top8, 24, seedBase + 2, "第三阶段 24 小时精搜", selectedWorkerLimit, options, true)
    screening.fine = fineRows.length
    top5 = fineRows.slice(0, 5).map(row => row.candidate!)
    options.onCheckpoint?.({ engineVersion: SIMULATION_ENGINE_VERSION, fingerprint, completedPhase: "fine", candidates: clone(top5), screening: clone(screening), stageBaselines: clone(stageBaselines) })
  }

  const finalHours = resolveSkillOptimizerFinalHours(options.stableMode)
  const reviewSeed = seedBase + 3
  const finalTasks = buildSkillOptimizerReviewTasks({
    baselineSnapshot: options.baselineSnapshot,
    candidates: top5,
    hours: finalHours,
    seed: reviewSeed,
    buildPayload: options.buildPayload
  })
  const finalResults = await executeScenarios(finalTasks, `第二阶段 ${finalHours} 小时复核 · 8 个独立种子`, selectedWorkerLimit, options)
  const baselineRuns = finalResults.filter(row => row.id === "baseline").map(row => row.metrics)
  const metricNames = ["xpPerHour", "encountersPerHour", "revenuePerHour", "profitPerHour", "deathsPerHour"]
  const average = (runs: Array<Record<string, number>>) => Object.fromEntries([...new Set(runs.flatMap(run => Object.keys(run)))].map(name => [name, mean(runs.map(run => Number(run[name]) || 0))]))
  const baseline = average(baselineRuns)
  const ranked = rankSkillOptimizerRows(top5.map(candidate => {
    const runs = finalResults.filter(row => row.id === candidate.variantId).map(row => row.metrics)
    return { id: candidate.variantId, candidate, metrics: average(runs), statistics: summarizePairedMetrics(runs, baselineRuns, metricNames) }
  }), options.objective)
  return {
    engineVersion: SIMULATION_ENGINE_VERSION, fingerprint, repetitions: 8, validationStatus: "paired_review",
    reviewSeeds: reviewSeedSchedule(reviewSeed, finalHours).map(s => s.seed),
    objective: options.objective,
    workerLimit: options.runtimeWorkerLimit || selectedWorkerLimit,
    baseline,
    rows: ranked.map((row, index) => ({
      rank: index + 1,
      id: row.id,
      abilityHrids: row.candidate?.abilityHrids || [],
      specialAbilityHrid: row.candidate?.specialAbilityHrid || row.candidate?.snapshot?.abilities?.[0]?.abilityHrid || "",
      triggerPresetByAbility: row.candidate?.triggerPresetByAbility || {},
      ...row.metrics,
      statistics: row.statistics,
      deltas: Object.fromEntries(metricNames.map(name => [name, delta(Number(row.metrics[name] || 0), Number(baseline[name] || 0))]))
    })),
    screening: { ...screening, final: ranked.length },
    stageBaselines,
    stableMode: Boolean(options.stableMode),
    finalSimulationHours: finalHours,
    completedAt: Date.now()
  }
}
