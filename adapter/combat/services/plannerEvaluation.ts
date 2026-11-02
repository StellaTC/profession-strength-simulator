import { RUST_IMPLEMENTATION_VERSION } from "./rustEngine.js"
import { getIndexedDbValue, setBoundedIndexedDbCache } from "@/common/utils/cache/indexed-db"
import { buildPlayersForSimulation } from "./playerMapper.js"
import { summarizeUpgradeSimulation } from "./autoEquipmentUpgrade.js"
import { resolveCompletedSimulationTime } from "./simulationMetrics.js"
import { enginePreference } from "./enginePreference"
import { getRuntimeCombatGameData, getRuntimeCombatGameDataVersion } from "../shared/runtimeGameData.js"
import { SIMULATION_ENGINE_VERSION } from "../shared/simulationVersion.js"
import { resolveCombatDropBuffLevel, resolveCombatExperienceBuffLevel } from "../shared/combatDropCommunityBuff.js"
import { mean, pairedSamples } from "../shared/simulationStatistics"
import { combatComputePool, computeAbort } from "./combatComputePool"
import { baselineIsCurrent, copyCombatValue, type SharedCombatBaseline, type CombatConfig } from "./combatWorkspaceState"
import type { CombatRunArtifactV2 } from "./combatRunHistory"
export interface PlannerTarget { kind: "zone" | "labyrinth" | "task"; hrid: string; difficulty: number; crates?: string[] }
export type PlannerObjective = "profitMidpointPerHour" | "profitPerHour" | "xpPerHour"
export interface PricingSnapshot { priceTable: Record<string, any>; enhancementQuotesByItem: Record<string, any>; sourceUpdatedAt: number }
export interface EvaluatedRun { implementationVersion?:string; players: any[]; profitMidpointPerHour: number; profitPerHour: number; xpPerHour: number; deathsPerHour: number; encountersPerHour: number; hours: number }
export interface Evaluation { implementationVersions?:string[]; runs: EvaluatedRun[]; players: any[]; profitMidpointPerHour: number; profitPerHour: number; xpPerHour: number; deathsPerHour: number; encountersPerHour: number; hours: number }
export const plannerSeeds = (base: number, count: number) => Array.from({ length: count }, (_, i) => (base + Math.imul(i + 1, 0x9e3779b9)) >>> 0)
export const SCREEN_SEEDS = plannerSeeds(260923, 2)
export const REVIEW_SEEDS = plannerSeeds(901733, 8)
export const objectiveValue = (r: Evaluation | EvaluatedRun, objective: PlannerObjective) => r[objective]
export const compareEvaluations = (a: Evaluation, b: Evaluation, objective: PlannerObjective) => pairedSamples(a.runs.map(r => r[objective]), b.runs.map(r => r[objective]))
export async function combatFingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}
export function validateTarget(target: PlannerTarget) {
  const maps = getRuntimeCombatGameData().maps
  if (!target || !['zone','labyrinth','task'].includes(target.kind) || !Number.isInteger(target.difficulty) || target.difficulty < 0) throw new Error("目标难度无效")
  if (target.kind === "labyrinth") {
    if (!maps.combatMonsterDetailMap[target.hrid] || target.difficulty < 1 || target.difficulty > 100000) throw new Error("迷宫目标无效")
  } else if (!maps.actionDetailMap[target.hrid]?.combatZoneInfo || target.difficulty > 5) throw new Error("请选择有效的战斗区域与难度")
}
function summarize(result: any, players: CombatConfig[], prices: PricingSnapshot): EvaluatedRun {
  const hours = Number(result.simulatedTime) / 3600e9
  const completedHours = resolveCompletedSimulationTime(result) / 3600e9
  const rows: any[] = players.filter(p => p.selected).map(p => ({ id: String(p.id), name: p.name,
    ...summarizeUpgradeSimulation(result, p.id, prices.priceTable),
    xpBySkill: Object.fromEntries(Object.entries(result.experienceGained?.[`player${p.id}`] || {}).map(([k,v]) => [k.split("/").at(-1), completedHours > 0 ? Number(v) / completedHours : 0]))
  }))
  const sum = (key: string) => rows.reduce((v,p) => v + Number(p[key] || 0), 0)
  return { implementationVersion:result.implementationVersion||"javascript",players: rows, profitMidpointPerHour: sum("profitMidpointPerHour"), profitPerHour: sum("profitPerHour"), xpPerHour: sum("xpPerHour"), deathsPerHour: sum("deathsPerHour"), encountersPerHour: rows[0]?.encountersPerHour || 0, hours }
}
function average(runs: EvaluatedRun[]): Evaluation {
  const fields = ["profitMidpointPerHour", "profitPerHour", "xpPerHour", "deathsPerHour", "encountersPerHour", "hours"] as const
  const players = runs[0].players.map((p,i) => ({ id:p.id, name:p.name,
    ...Object.fromEntries(Object.keys(p).filter(k => typeof p[k] === "number").map(k => [k, mean(runs.map(r => r.players[i][k]))])),
    xpBySkill: Object.fromEntries(Object.keys(p.xpBySkill).map(k => [k,mean(runs.map(r => r.players[i].xpBySkill[k] || 0))]))
  }))
  return { implementationVersions:[...new Set(runs.map(r=>r.implementationVersion||"javascript"))],runs, players, ...Object.fromEntries(fields.map(k => [k, mean(runs.map(r => r[k]))])) } as Evaluation
}
export class PlannerEvaluator {
  readonly baseline: SharedCombatBaseline
  readonly pricing: PricingSnapshot
  private catalog = copyCombatValue(getRuntimeCombatGameData())
  private catalogKey = combatFingerprint(this.catalog.maps)
  private memo = new Map<string, Promise<EvaluatedRun>>()
  simulations = 0
  constructor(baseline: SharedCombatBaseline, pricing: PricingSnapshot, readonly signal?: AbortSignal,
    private progress?: (stage: string) => void, private cacheWarning?: (message:string)=>void) {
    if (!baselineIsCurrent(baseline)) throw new Error("基准数据版本已过期，请在数据与基准页重新建立基准")
    this.baseline = copyCombatValue(baseline); this.pricing = copyCombatValue(pricing)
  }
  check() { if (this.signal?.aborted) throw computeAbort(); if (this.baseline.gameDataVersion !== getRuntimeCombatGameDataVersion()) throw new Error("游戏数据已更新，请更新基准后重新计算") }
  async evaluate(players: CombatConfig[], target: PlannerTarget, hours = 4, seeds = SCREEN_SEEDS, runSettings = this.baseline.settings): Promise<Evaluation> {
    this.check(); validateTarget(target)
    if (!seeds.length || !Number.isFinite(hours) || hours <= 0 || hours > 720) throw new Error("模拟时长或种子无效")
    const settings = copyCombatValue(runSettings)
    const party = copyCombatValue(players)
    const runs = await Promise.all(seeds.map(async seed => {
      const key = await combatFingerprint({schema:3,players:party,target,hours,seed,settings,data:await this.catalogKey,engine:SIMULATION_ENGINE_VERSION,implementation:RUST_IMPLEMENTATION_VERSION,preference:enginePreference.value,pricing:this.pricing})
      if (!this.memo.has(key)) {
        const promise = (async () => {
          const prefix = `planner-simulation-v2:${this.baseline.accountKey}:`
          const saved = await getIndexedDbValue<{value:EvaluatedRun}>(prefix+key).catch(error=>{this.cacheWarning?.(`模拟缓存读取失败：${error.message}`);return null})
          this.check()
          if (saved) return saved.value
          const payload = { type:"start_simulation", players:buildPlayersForSimulation(party), seed,
            gameDataEnvelope:this.catalog, engineImplementation:settings.engineImplementation || "auto",
            combatMode:target.kind === "zone" ? "normal" : target.kind,
            zone:target.kind === "labyrinth" ? null : {zoneHrid:target.hrid,difficultyTier:target.difficulty},
            labyrinth:target.kind === "labyrinth" ? {labyrinthHrid:target.hrid,roomLevel:target.difficulty,crates:target.crates || []} : null,
            ...(target.kind === "task" ? {taskContext:{zoneHrid:target.hrid}} : {}),
            simulationTimeLimit:hours * 3600e9,
            extra:{mooPass:Boolean(settings.mooPass),comExp:resolveCombatExperienceBuffLevel(settings),comDrop:resolveCombatDropBuffLevel(settings),enableHpMpVisualization:false,omitWipeDetails:true}
          }
          const result = await combatComputePool.run(payload, this.signal)
          this.check(); const summary = summarize(result, party, this.pricing)
          await setBoundedIndexedDbCache(prefix,key,summary).catch(error=>this.cacheWarning?.(`模拟缓存保存失败：${error.message}；刷新后可能需要重算。`))
          this.simulations++; this.progress?.(`已完成 ${this.simulations} 次模拟`)
          return summary
        })().catch(error => {this.memo.delete(key);throw error})
        this.memo.set(key,promise)
        if(this.memo.size>512)this.memo.delete(this.memo.keys().next().value!)
      }
      return this.memo.get(key)!
    }))
    return average(runs)
  }
}
export async function sharedBaselineArtifact(baseline: SharedCombatBaseline, pricing: PricingSnapshot, target: PlannerTarget): Promise<CombatRunArtifactV2> {
  if (target.kind !== "zone") throw new Error("当前装备和技能页面需要区域或地下城目标")
  const result = await new PlannerEvaluator(baseline, pricing).evaluate(baseline.players, target, 24, REVIEW_SEEDS)
  return { schemaVersion:2,id:baseline.id,accountKey:baseline.accountKey,createdAt:baseline.createdAt,
    gameDataVersion:baseline.gameDataVersion.split("|")[0],source:"advisor",partial:false,activePlayerId:baseline.activePlayerId,
    players:copyCombatValue(baseline.players),simulationSettings:copyCombatValue(baseline.settings),
    targets:[{kind:getRuntimeCombatGameData().maps.actionDetailMap[target.hrid]?.combatZoneInfo?.isDungeon ? "dungeon":"planet",targetHrid:target.hrid,difficultyTier:target.difficulty}],
    rows:result.players.map(p=>({...p,playerHrid:`player${p.id}`,targetHrid:target.hrid,zoneName:target.hrid,difficulty:target.difficulty})),marketCapturedAt:pricing.sourceUpdatedAt }
}
