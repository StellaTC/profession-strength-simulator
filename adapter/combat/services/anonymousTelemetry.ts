import { getIndexedDbValue, setIndexedDbValue } from "@/common/utils/cache/indexed-db"
import type { CombatRunArtifactV2 } from "./combatRunHistory"
import type { SkillOptimizationTaskArtifactV1 } from "./skillOptimizationHistory"
import { classifyWeapon } from "./skillOptimizer"
import { LEVEL_KEYS } from "../shared/playerConfig.js"
import {
  resolveCombatDropBuffLevel,
  resolveCombatExperienceBuffLevel
} from "../shared/combatDropCommunityBuff.js"

const OUTBOX_KEY = "anonymous-combat-telemetry-outbox-v1"
const INGEST_PATH = "/api/v1/anonymous-simulations"
const METRIC_KEYS = [
  "encountersPerHour", "deathsPerHour", "totalXpPerHour", "xpPerHour",
  "staminaXpPerHour", "intelligenceXpPerHour", "attackXpPerHour",
  "magicXpPerHour", "rangedXpPerHour", "meleeXpPerHour", "defenseXpPerHour",
  "profitPerHour", "profitLowerPerHour", "profitUpperPerHour", "profitMidpointPerHour",
  "revenuePerHour", "expensesPerHour", "revenueUpperPerHour", "expensesLowerPerHour"
] as const

type TelemetryKind = "recommendation_run" | "skill_optimizer_top3"

export interface AnonymousPartyMemberV1 {
  slot: number
  classId: string
  levels: Record<string, number>
  equipment: Record<string, { itemHrid: string, enhancementLevel: number }>
  food: string[]
  drinks: string[]
  abilities: Array<{ abilityHrid: string, level: number }>
  triggerMap: Record<string, Array<Record<string, unknown>>>
  houseRooms: Record<string, unknown>
  achievements: Record<string, unknown>
  guildBuffs: Record<string, unknown>
}

interface AnonymousTelemetryBaseV1 {
  schemaVersion: 1
  eventId: string
  kind: TelemetryKind
  completedAt: number
  appVersion: string
  gameDataVersion: string
  party: AnonymousPartyMemberV1[]
  settings: {
    simulationTimeHours: number
    mooPass: boolean
    combatExperienceBuffLevel: number
    combatDropBuffLevel: number
  }
}

export interface AnonymousRecommendationEventV1 extends AnonymousTelemetryBaseV1 {
  kind: "recommendation_run"
  targets: Array<{ kind: "planet" | "dungeon", targetHrid: string, difficultyTier: number }>
  results: Array<{
    targetHrid: string
    difficultyTier: number
    memberSlot: number
    outOfMana: boolean
    metrics: Record<string, number>
  }>
}

export interface AnonymousSkillOptimizerEventV1 extends AnonymousTelemetryBaseV1 {
  kind: "skill_optimizer_top3"
  target: { kind: "planet" | "dungeon", targetHrid: string, difficultyTier: number }
  optimizedMemberSlot: number
  classId: string
  objective: "profit" | "experience"
  stableMode: boolean
  finalSimulationHours: number
  baselineMetrics: Record<string, number>
  topCandidates: Array<{
    rank: number
    abilities: Array<{ abilityHrid: string, level: number }>
    triggerPresetByAbility: Record<string, { presetId: string, conditions: Array<Record<string, unknown>> }>
    metrics: Record<string, number>
    deltas: Record<string, { value: number, pct: number | null }>
  }>
}

export type AnonymousTelemetryEventV1 = AnonymousRecommendationEventV1 | AnonymousSkillOptimizerEventV1

function cloneJson<T>(value: T, fallback: T): T {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return fallback
  }
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function nonNegativeInteger(value: unknown, fallback = 0) {
  return Math.max(0, Math.floor(finite(value, fallback)))
}

function createEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `anonymous-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function metricRecord(row: Record<string, any> | null | undefined) {
  const metrics: Record<string, number> = {}
  for (const key of METRIC_KEYS) {
    if (row?.[key] != null && Number.isFinite(Number(row[key]))) metrics[key] = Number(row[key])
  }
  return metrics
}

function sanitizeEquipment(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, any> : {}
  return Object.fromEntries(Object.entries(source).map(([slot, item]) => [slot, {
    itemHrid: String(item?.itemHrid || ""),
    enhancementLevel: nonNegativeInteger(item?.enhancementLevel)
  }]))
}

function sanitizeAbilities(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 5).map(entry => ({
    abilityHrid: String(entry?.abilityHrid || ""),
    level: Math.max(1, nonNegativeInteger(entry?.level, 1))
  }))
}

function sanitizeParty(players: Array<Record<string, any>>) {
  return players.filter(player => player?.selected !== false).map((player, index) => {
    const levels = Object.fromEntries(LEVEL_KEYS.map(key => [key, Math.max(1, nonNegativeInteger(player?.levels?.[key], 1))]))
    return {
      slot: index + 1,
      classId: classifyWeapon(String(player?.equipment?.weapon?.itemHrid || "")) || "unknown",
      levels,
      equipment: sanitizeEquipment(player?.equipment),
      food: (Array.isArray(player?.food) ? player.food : []).slice(0, 3).map(String),
      drinks: (Array.isArray(player?.drinks) ? player.drinks : []).slice(0, 3).map(String),
      abilities: sanitizeAbilities(player?.abilities),
      triggerMap: cloneJson(player?.triggerMap, {}),
      houseRooms: cloneJson(player?.houseRooms, {}),
      achievements: cloneJson(player?.achievements, {}),
      guildBuffs: cloneJson(player?.guildBuffs, {})
    } satisfies AnonymousPartyMemberV1
  })
}

function telemetrySettings(settings: Record<string, any>, simulationTimeHours?: unknown) {
  return {
    simulationTimeHours: Math.max(1, finite(simulationTimeHours ?? settings?.simulationTimeHours, 24)),
    mooPass: Boolean(settings?.mooPass),
    combatExperienceBuffLevel: resolveCombatExperienceBuffLevel(settings),
    combatDropBuffLevel: resolveCombatDropBuffLevel(settings)
  }
}

function memberSlotMap(players: Array<Record<string, any>>) {
  return new Map(players.filter(player => player?.selected !== false).map((player, index) => [
    `player${String(player?.id || index + 1).replace(/^player/, "")}`,
    index + 1
  ]))
}

export function buildRecommendationTelemetryEvent(artifact: CombatRunArtifactV2): AnonymousRecommendationEventV1 | null {
  if (artifact.partial || artifact.source !== "advisor") return null
  const targets = artifact.targets.filter(target => target.kind === "planet" || target.kind === "dungeon")
  if (!targets.length || !artifact.rows.length) return null
  const slots = memberSlotMap(artifact.players)
  const results = artifact.rows.flatMap(row => {
    const memberSlot = slots.get(String(row?.playerHrid || ""))
    const targetHrid = String(row?.targetHrid || row?.zoneName || "")
    if (!memberSlot || !targetHrid) return []
    return [{
      targetHrid,
      difficultyTier: nonNegativeInteger(row?.difficulty ?? row?.difficultyTier),
      memberSlot,
      outOfMana: Boolean(row?.outOfMana),
      metrics: metricRecord(row)
    }]
  })
  if (!results.length) return null
  return {
    schemaVersion: 1,
    eventId: createEventId(),
    kind: "recommendation_run",
    completedAt: Number(artifact.createdAt || Date.now()),
    appVersion: __APP_VERSION__,
    gameDataVersion: String(artifact.gameDataVersion || ""),
    party: sanitizeParty(artifact.players),
    settings: telemetrySettings(artifact.simulationSettings),
    targets: targets.map(target => ({
      kind: target.kind,
      targetHrid: String(target.targetHrid || ""),
      difficultyTier: nonNegativeInteger(target.difficultyTier)
    })),
    results
  }
}

function abilityLevelMap(task: SkillOptimizationTaskArtifactV1, optimizedPlayer: Record<string, any>) {
  const levels = new Map<string, number>()
  for (const entry of optimizedPlayer?.abilities || []) {
    const hrid = String(entry?.abilityHrid || "")
    if (hrid) levels.set(hrid, Math.max(1, nonNegativeInteger(entry?.level, 1)))
  }
  for (const [hrid, level] of Object.entries(optimizedPlayer?.abilityLevelMap || {})) {
    if (hrid) levels.set(hrid, Math.max(1, nonNegativeInteger(level, 1)))
  }
  for (const entry of task.config?.pool || []) {
    const hrid = String(entry?.abilityHrid || "")
    if (hrid) levels.set(hrid, Math.max(1, nonNegativeInteger(entry?.level, 1)))
  }
  for (const [hrid, level] of Object.entries(task.config?.specialLevels || {})) {
    if (hrid) levels.set(hrid, Math.max(1, nonNegativeInteger(level, 1)))
  }
  return levels
}

function sanitizeDeltas(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, any> : {}
  return Object.fromEntries(Object.entries(source).flatMap(([key, entry]) => {
    if (!entry || !Number.isFinite(Number(entry.value))) return []
    const pct = entry.pct == null || !Number.isFinite(Number(entry.pct)) ? null : Number(entry.pct)
    return [[key, { value: Number(entry.value), pct }]]
  }))
}

function sanitizeTriggerPresets(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, any> : {}
  return Object.fromEntries(Object.entries(source).map(([abilityHrid, preset]) => [abilityHrid, {
    presetId: String(preset?.id || ""),
    conditions: cloneJson(Array.isArray(preset?.conditions) ? preset.conditions : [], [])
  }]))
}

export function buildSkillOptimizerTelemetryEvent(input: {
  task: SkillOptimizationTaskArtifactV1
  partyPlayers: Array<Record<string, any>>
  optimizedPlayer: Record<string, any>
  simulationSettings: Record<string, any>
}): AnonymousSkillOptimizerEventV1 | null {
  const { task, partyPlayers, optimizedPlayer, simulationSettings } = input
  if (task.status !== "completed" || !task.result || !Array.isArray(task.result.rows)) return null
  if (!task.target || !["planet", "dungeon"].includes(task.target.kind)) return null
  const topRows = task.result.rows.slice(0, 3)
  if (!topRows.length) return null
  const selected = partyPlayers.filter(player => player?.selected !== false)
  const optimizedIndex = selected.findIndex(player => String(player?.id) === String(task.playerId))
  if (optimizedIndex < 0) return null
  const levels = abilityLevelMap(task, optimizedPlayer)
  const topCandidates = topRows.map((row: Record<string, any>, index: number) => {
    const orderedHrids = [String(row.specialAbilityHrid || ""), ...(Array.isArray(row.abilityHrids) ? row.abilityHrids.map(String) : [])].filter(Boolean)
    return {
      rank: Math.max(1, nonNegativeInteger(row.rank, index + 1)),
      abilities: orderedHrids.map(abilityHrid => ({ abilityHrid, level: levels.get(abilityHrid) || 1 })),
      triggerPresetByAbility: sanitizeTriggerPresets(row.triggerPresetByAbility),
      metrics: metricRecord(row),
      deltas: sanitizeDeltas(row.deltas)
    }
  })
  return {
    schemaVersion: 1,
    eventId: createEventId(),
    kind: "skill_optimizer_top3",
    completedAt: Number(task.result.completedAt || task.updatedAt || Date.now()),
    appVersion: __APP_VERSION__,
    gameDataVersion: String(task.gameDataVersion || ""),
    party: sanitizeParty(partyPlayers),
    settings: telemetrySettings(simulationSettings, task.result.finalSimulationHours),
    target: {
      kind: task.target.kind,
      targetHrid: String(task.target.targetHrid || ""),
      difficultyTier: nonNegativeInteger(task.target.difficultyTier)
    },
    optimizedMemberSlot: optimizedIndex + 1,
    classId: String(task.classId || "unknown"),
    objective: task.objective,
    stableMode: Boolean(task.result.stableMode),
    finalSimulationHours: Math.max(1, finite(task.result.finalSimulationHours, 72)),
    baselineMetrics: metricRecord(task.result.baseline),
    topCandidates
  }
}

async function readOutbox() {
  const stored = await getIndexedDbValue<AnonymousTelemetryEventV1[]>(OUTBOX_KEY)
  return Array.isArray(stored) ? stored : []
}

let flushPromise: Promise<void> | null = null

export async function enqueueAnonymousTelemetry(event: AnonymousTelemetryEventV1 | null) {
  if (!event) return false
  const outbox = await readOutbox()
  if (!outbox.some(item => item.eventId === event.eventId)) {
    outbox.push(cloneJson(event, event))
    await setIndexedDbValue(OUTBOX_KEY, outbox)
  }
  void flushAnonymousTelemetryOutbox()
  return true
}

export function flushAnonymousTelemetryOutbox() {
  if (flushPromise) return flushPromise
  flushPromise = (async () => {
    let outbox = await readOutbox()
    while (outbox.length) {
      const event = outbox[0]
      let response: Response
      try {
        response = await fetch(INGEST_PATH, {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ event })
        })
      } catch {
        break
      }
      if (!response.ok && response.status >= 500) break
      if (!response.ok && ![400, 409, 413, 422].includes(response.status)) break
      outbox = outbox.filter(item => item.eventId !== event.eventId)
      await setIndexedDbValue(OUTBOX_KEY, outbox)
    }
  })().catch(() => {}).finally(() => { flushPromise = null })
  return flushPromise
}

export function startAnonymousTelemetryOutbox() {
  const flush = () => { void flushAnonymousTelemetryOutbox() }
  window.addEventListener("online", flush)
  const timer = window.setInterval(flush, 5 * 60_000)
  flush()
  return () => {
    window.removeEventListener("online", flush)
    window.clearInterval(timer)
  }
}
