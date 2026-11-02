import { combatComputePool } from "./combatComputePool"
import { TRIAL_ENGINE_VERSION, TRIAL_REFERENCE_COMMIT } from "../shared/simulationVersion"
import {
  GUILD_TRIAL_MAX_LEVEL,
  GUILD_TRIAL_START_LEVEL,
  GUILD_TRIAL_TIME_LIMIT_MINUTES,
  guildTrialBuildForMember,
  type NativeGuildTrialMember
} from "./guildTrialNative"

export interface GuildTrialProgress {
  progress: number
  currentLevel: number
  layersCompleted: number
}

export interface GuildTrialTemplateStats {
  count: number
  alive: number
  damage: number
  healing: number
  healthRestored: number
  outOfManaPercent: number
  deaths: number
}

export interface GuildTrialSimulationResult {
  seed?: number
  engineVersion?: string
  implementationVersion?: string
  implementationVersions?: string[]
  fallbackReason?: string
  completedFloorPoints?: number
  partialFloorPoints?: number
  currentFloorProgress?: number
  runs?: number
  validationStatus?: string
  failed?: boolean
  memberStats?: Array<{ characterId: number, dps?: number, damage: number, damageTaken: number, deaths: number, healing: number }>
  points: number
  layersCompleted: number
  currentLevel: number
  participantCount: number
  totalDamage: number
  simulatedSeconds: number
  endedReason: string
  templateStats: Record<string, GuildTrialTemplateStats>
  remainingEnemies?: Array<{ hrid: string, currentHitpoints: number, maxHitpoints: number }>
}

export function guildTrialCurrentLayerCompletion(result: GuildTrialSimulationResult) {
  if (Number.isFinite(result.currentFloorProgress)) return Math.max(0, Math.min(1, Number(result.currentFloorProgress)))
  const enemies = result.remainingEnemies || []
  if (!enemies.length) return result.endedReason === "max_level_completed" ? 1 : 0
  const maximumHitpoints = enemies.reduce((total, enemy) => total + Math.max(0, Number(enemy.maxHitpoints) || 0), 0)
  if (maximumHitpoints <= 0) return 0
  const remainingHitpoints = enemies.reduce((total, enemy) => total + Math.max(0, Number(enemy.currentHitpoints) || 0), 0)
  return Math.max(0, Math.min(1, 1 - remainingHitpoints / maximumHitpoints))
}

export function createGuildTrialWorkerPayload(
  encounterHrid: string,
  members: NativeGuildTrialMember[],
  seed = 1
) {
  const payload = {
    type: "start_guild_trial",
    seed,
    combatMode: "guild_trial",
    engineVersion: TRIAL_ENGINE_VERSION,
    dataVersion: TRIAL_REFERENCE_COMMIT,
    encounterHrid,
    startLevel: GUILD_TRIAL_START_LEVEL,
    maxLevel: GUILD_TRIAL_MAX_LEVEL,
    timeLimitSeconds: GUILD_TRIAL_TIME_LIMIT_MINUTES * 60,
    templates: members.map(member => ({
      name: member.characterName,
      characterId: member.characterId,
      count: 1,
      build: guildTrialBuildForMember(member)
    }))
  }

  // Members passed from the Vue page are reactive Proxies. Worker.postMessage
  // uses structured clone, which rejects Proxy objects even when their values
  // are otherwise serializable. The worker payload is JSON-only, so a JSON
  // round trip safely unwraps every nested reactive value before posting.
  return JSON.parse(JSON.stringify(payload))
}

export function runNativeGuildTrial(
  encounterHrid: string,
  members: NativeGuildTrialMember[],
  onProgress?: (progress: GuildTrialProgress) => void,
  signal?: AbortSignal
) {
  if (!members.length) return Promise.reject(new Error("当前 Boss 没有已分配成员"))
  return combatComputePool.run(createGuildTrialWorkerPayload(encounterHrid,members),signal,detail=>onProgress?.({
    progress:Math.max(0,Math.min(1,Number(detail.progress)||0)),
    currentLevel:Number(detail.currentLevel)||GUILD_TRIAL_START_LEVEL,
    layersCompleted:Number(detail.layersCompleted)||0
  })) as Promise<GuildTrialSimulationResult>
}

export function guildTrialMemberStats(result: GuildTrialSimulationResult | null, characterId: number, name: string): GuildTrialTemplateStats {
  const member = result?.memberStats?.find(m=>m.characterId===characterId) as any
  if (member) return { count:1,alive:Number(member.alive)||0,damage:member.damage||0,healing:member.healing||0,
    healthRestored:member.healthRestored||0,outOfManaPercent:(member.outOfManaRatio||0)*100,deaths:member.deaths||0 }
  return result?.templateStats?.[name] || { count:1,alive:0,damage:0,healing:0,healthRestored:0,outOfManaPercent:0,deaths:0 }
}

export function guildTrialEngineLabel(result: GuildTrialSimulationResult | null | undefined) {
  if (!result?.implementationVersion) return "历史结果（未记录实现）"
  if (result.implementationVersion === "mixed") return "Rust / JS（部分回退）"
  if (result.implementationVersion.startsWith("rust-trial")) return "Rust / WASM"
  return result.fallbackReason ? "JS（WASM 失败后重算）" : "JS"
}
