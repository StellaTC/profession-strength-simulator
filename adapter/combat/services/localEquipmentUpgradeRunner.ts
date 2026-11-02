import { createPooledCombatWorker } from "./combatComputePool"
import { reviewSeedSchedule, summarizePairedMetrics } from "../shared/simulationStatistics"
import { SIMULATION_ENGINE_VERSION } from "../shared/simulationVersion"
import { getRuntimeCombatGameData } from "../shared/runtimeGameData.js"
import {
  aggregateUpgradeResults,
  isFollowUpUpgradeVariant,
  isScreeningUpgradeVariant,
  selectPromotedFollowUpVariants,
  summarizeUpgradeSimulation
} from "./autoEquipmentUpgrade.js"

const HOUR_NANOSECONDS = 60 * 60 * 1e9
export const LOCAL_UPGRADE_SCREENING_HOURS = 24
export const LOCAL_UPGRADE_FINAL_HOURS = 72

export interface LocalUpgradeProgress {
  phase: string
  completed: number
  total: number
  progress: number
  activeWorkers: number
  workerLimit: number
  averageSimulationSeconds: number | null
  stage: string
}

interface UpgradeVariant {
  id: string
  simulationPayload: Record<string, any>
  [key: string]: any
}

interface RunnerOptions {
  baselinePayload: Record<string, any>
  variants: UpgradeVariant[]
  activePlayerId: string
  priceTable: Record<string, any>
  seedBase?: number
  keepCount?: number
  workerMode?: "auto" | "manual"
  manualWorkerCount?: number
  signal?: AbortSignal
  onProgress?: (progress: LocalUpgradeProgress) => void
}

interface Scenario {
  id: string
  payload: Record<string, any>
  [key: string]: any
}

interface SimulationTask {
  id: string
  scenario: Scenario
  seed: number
  sampleIndex?: number
}

export function buildEquipmentReviewTasks(scenarios: Scenario[], seedBase: number): SimulationTask[] {
  return reviewSeedSchedule(Number(seedBase) + 1, LOCAL_UPGRADE_FINAL_HOURS).flatMap(({ seed, hours }, sampleIndex) => scenarios.map(scenario => ({
    id: `review:${scenario.id}:${sampleIndex}`, sampleIndex,
    scenario: { ...scenario, payload: withLocalUpgradeSimulationHours(scenario.payload, hours) }, seed,
  })))
}

function cancellationError() {
  const error = new Error("本地装备升级计算已取消")
  error.name = "AbortError"
  return error
}

export function getLocalUpgradeWorkerLimit(
  taskCount: number,
  options: { workerMode?: "auto" | "manual", manualWorkerCount?: number } = {}
) {
  if (options.workerMode === "manual") {
    return Math.max(1, Math.min(16, Math.floor(Number(options.manualWorkerCount || 1)), Math.max(1, taskCount)))
  }
  const logicalCores = Math.max(2, Number(globalThis.navigator?.hardwareConcurrency || 4))
  return Math.max(1, Math.min(6, logicalCores - 1, Math.max(1, taskCount)))
}

export function withLocalUpgradeSimulationHours<T extends Record<string, any>>(payload: T, hours: number): T & { simulationTimeLimit: number } {
  return {
    ...payload,
    simulationTimeLimit: Math.max(1, Number(hours || 0)) * HOUR_NANOSECONDS
  }
}

function formatRemaining(completed: number, total: number, startedAt: number) {
  if (completed <= 0) return "估算中"
  const seconds = ((Date.now() - startedAt) / 1000) * (total - completed) / completed
  if (seconds >= 3600) return `约 ${(seconds / 3600).toFixed(1)} 小时`
  if (seconds >= 60) return `约 ${Math.ceil(seconds / 60)} 分钟`
  return `约 ${Math.max(0, Math.ceil(seconds))} 秒`
}

async function executeTaskBatch(
  tasks: SimulationTask[],
  phase: string,
  options: RunnerOptions,
  runs: Map<string, any[]>,
  timing: { milliseconds: number, samples: number }
) {
  if (!tasks.length) return
  const queue = [...tasks]
  const total = queue.length
  const workerLimit = getLocalUpgradeWorkerLimit(total, options)
  const workers = new Set<Worker>()
  const activeFractions = new Map<Worker, number>()
  const startedAt = Date.now()
  let completed = 0

  const report = () => {
    const partial = Array.from(activeFractions.values()).reduce((sum, value) => sum + value, 0)
    const progress = Math.min(1, (completed + partial) / Math.max(1, total))
    const averageSimulationSeconds = timing.samples
      ? timing.milliseconds / timing.samples / 1000
      : null
    options.onProgress?.({
      phase,
      completed,
      total,
      progress,
      activeWorkers: activeFractions.size,
      workerLimit,
      averageSimulationSeconds,
      stage: `${phase} · 已完成 ${completed}/${total} · 预计剩余 ${formatRemaining(completed, total, startedAt)}`
    })
  }

  const abort = () => {
    for (const worker of workers) worker.terminate()
  }
  options.signal?.addEventListener("abort", abort, { once: true })

  const runOne = (worker: Worker, task: SimulationTask, includeCatalog: boolean) => new Promise<any>((resolve, reject) => {
    if (options.signal?.aborted) return reject(cancellationError())
    let settled = false
    const finish = (callback: (value?: any) => void, value?: any) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener("abort", handleAbort)
      callback(value)
    }
    const handleAbort = () => finish(reject, cancellationError())
    options.signal?.addEventListener("abort", handleAbort, { once: true })
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data || {}
      if (data.type === "simulation_progress") {
        activeFractions.set(worker, Math.max(0, Math.min(1, Number(data.progress || 0))))
        report()
      } else if (data.type === "simulation_result") {
        finish(resolve, data.simResult)
      } else if (data.type === "simulation_error") {
        finish(reject, new Error(data.error?.message || data.error || "浏览器 Worker 模拟失败"))
      }
    }
    worker.onerror = error => finish(reject, new Error(error.message || "浏览器 Worker 启动失败"))
    worker.postMessage({
      ...task.scenario.payload,
      seed: task.seed,
      engineVersion: SIMULATION_ENGINE_VERSION,
      combatMode: task.scenario.payload.combatMode || "normal",
      ...(includeCatalog ? { gameDataEnvelope: getRuntimeCombatGameData() } : {})
    })
  })

  report()
  try {
    await Promise.all(Array.from({ length: workerLimit }, async () => {
      const worker = createPooledCombatWorker()
      workers.add(worker)
      let initialized = false
      try {
        for (;;) {
          if (options.signal?.aborted) throw cancellationError()
          const task = queue.shift()
          if (!task) break
          activeFractions.set(worker, 0)
          const taskStartedAt = Date.now()
          const simResult = await runOne(worker, task, !initialized)
          initialized = true
          timing.milliseconds += Date.now() - taskStartedAt
          timing.samples += 1
          const values = runs.get(task.scenario.id) || []
          values[task.sampleIndex || 0] = summarizeUpgradeSimulation(simResult, options.activePlayerId, options.priceTable)
          runs.set(task.scenario.id, values)
          completed += 1
          activeFractions.delete(worker)
          report()
        }
      } finally {
        activeFractions.delete(worker)
        workers.delete(worker)
        worker.terminate()
      }
    }))
  } finally {
    options.signal?.removeEventListener("abort", abort)
    abort()
  }
}

export async function runLocalStagedEquipmentUpgrade(options: RunnerOptions) {
  const seedBase = Number(options.seedBase || 20260727)
  const keepCount = Math.max(1, Math.floor(Number(options.keepCount || 10)))
  const eligible = options.variants.filter(variant => variant.eligible !== false)
  const screeningVariants = eligible.filter(isScreeningUpgradeVariant)
  const followUpVariants = eligible.filter(isFollowUpUpgradeVariant)
  const baseline: Scenario = { id: "baseline", payload: options.baselinePayload }
  const screeningScenarios: Scenario[] = [
    baseline,
    ...screeningVariants.map(variant => ({ ...variant, payload: variant.simulationPayload }))
  ].map(scenario => ({
    ...scenario,
    payload: withLocalUpgradeSimulationHours(scenario.payload, LOCAL_UPGRADE_SCREENING_HOURS)
  }))
  const runs = new Map<string, any[]>()
  const finalRuns = new Map<string, any[]>()
  const timing = { milliseconds: 0, samples: 0 }

  await executeTaskBatch(
    screeningScenarios.map(scenario => ({ id: `screening:${scenario.id}`, scenario, seed: seedBase })),
    "第一阶段初筛",
    options,
    runs,
    timing
  )

  const preliminary = (aggregateUpgradeResults as any)({
    baselineRuns: runs.get("baseline") || [],
    variants: screeningVariants.map(variant => ({ ...variant, runs: runs.get(variant.id) || [] }))
  })
  const selection = (selectPromotedFollowUpVariants as any)({
    preliminaryRows: preliminary.rows,
    variants: followUpVariants,
    keepCount
  })
  const promoted = selection.promoted as UpgradeVariant[]
  const secondScenarios: Scenario[] = [
    baseline,
    ...screeningVariants.map(variant => ({ ...variant, payload: variant.simulationPayload })),
    ...promoted.map(variant => ({ ...variant, payload: variant.simulationPayload }))
  ].map(scenario => ({
    ...scenario,
    payload: withLocalUpgradeSimulationHours(scenario.payload, LOCAL_UPGRADE_FINAL_HOURS)
  }))

  await executeTaskBatch(
    buildEquipmentReviewTasks(secondScenarios, seedBase),
    `第二阶段 72 小时复核（前 ${selection.cutoff} 名扩大范围）`,
    options,
    finalRuns,
    timing
  )

  const aggregate = (aggregateUpgradeResults as any)({
    baselineRuns: finalRuns.get("baseline") || [],
    variants: [...screeningVariants, ...promoted].map(variant => ({ ...variant, simulationPayload: undefined, runs: finalRuns.get(variant.id) || [] }))
  })
  const fields = ["xpPerHour", "encountersPerHour", "profitPerHour", "profitMidpointPerHour", "deathsPerHour"]
  return {
    ...aggregate,
    engineVersion: SIMULATION_ENGINE_VERSION,
    validationStatus: "paired_review", repetitions: 8,
    reviewSeeds: reviewSeedSchedule(seedBase + 1, LOCAL_UPGRADE_FINAL_HOURS).map(s => s.seed),
    rows: aggregate.rows.map((row: any) => ({ ...row,
      statistics: summarizePairedMetrics(finalRuns.get(row.id) || [], finalRuns.get("baseline") || [], fields) })),
    screening: {
      strategy: "staged_top_n_paired8_v2",
      keepCount,
      cutoff: selection.cutoff,
      totalScreened: selection.totalScreened,
      promotedCount: promoted.length,
      averageSimulationSeconds: timing.samples ? timing.milliseconds / timing.samples / 1000 : null,
      screeningSimulationHours: LOCAL_UPGRADE_SCREENING_HOURS,
      finalSimulationHours: LOCAL_UPGRADE_FINAL_HOURS,
      skipped: selection.skipped
    }
  }
}
