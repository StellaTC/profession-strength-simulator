import { getIndexedDbValue, setIndexedDbValue } from "@/common/utils/cache/indexed-db"
import { listCloudHistory, saveCloudHistory } from "@/services/cloudHistory"
import type { CombatRunTarget } from "./combatRunHistory"
import type { SkillOptimizerClass, SkillOptimizerObjective } from "./skillOptimizer"

const STORAGE_KEY = "combat-skill-optimization-history-v1"
const CLASS_OVERRIDE_KEY = "combat-skill-optimizer-class-overrides-v1"
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const LIMIT_PER_ACCOUNT = 20
export const SKILL_OPTIMIZATION_HISTORY_CHANGED_EVENT = "milkonomy-skill-optimization-history-changed"

export interface SkillOptimizationTaskArtifactV1 {
  schemaVersion: 1
  id: string
  accountKey: string
  createdAt: number
  updatedAt: number
  status: "running" | "completed" | "failed" | "cancelled"
  gameDataVersion: string
  baselineId: string
  baselineLabel: string
  playerId: string
  playerName: string
  target: CombatRunTarget
  classId: SkillOptimizerClass
  objective: SkillOptimizerObjective
  config: Record<string, any>
  checkpoint?: Record<string, any> | null
  seedBase?: number
  workerCalibration?: { mode: "auto" | "manual", selectedWorkers: number }
  progress: number
  stage: string
  error: string
  result?: Record<string, any> | null
  timing?: { startedAt: number, finishedAt?: number, totalSeconds?: number }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function isArtifact(value: any): value is SkillOptimizationTaskArtifactV1 {
  return Boolean(value?.schemaVersion === 1 && value?.id && value?.accountKey && value?.target && value?.playerId)
}

export function normalizeLocalSkillOptimizationHistory(values: unknown) {
  return (Array.isArray(values) ? values : [])
    .filter(isArtifact)
    .sort((left, right) => right.createdAt - left.createdAt)
}

export function cleanCloudSkillOptimizationHistory(values: unknown, now = Date.now()) {
  const cutoff = now - RETENTION_MS
  const counts = new Map<string, number>()
  return (Array.isArray(values) ? values : [])
    .filter(isArtifact)
    .filter(item => item.createdAt >= cutoff)
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((item) => {
      const count = counts.get(item.accountKey) || 0
      if (count >= LIMIT_PER_ACCOUNT) return false
      counts.set(item.accountKey, count + 1)
      return true
    })
}

async function readAll() {
  const values = await getIndexedDbValue<SkillOptimizationTaskArtifactV1[]>(STORAGE_KEY)
  const cleaned = normalizeLocalSkillOptimizationHistory(values)
  if (JSON.stringify(values || []) !== JSON.stringify(cleaned)) await setIndexedDbValue(STORAGE_KEY, cleaned)
  return cleaned
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SKILL_OPTIMIZATION_HISTORY_CHANGED_EVENT))
}

export async function saveSkillOptimizationTask(
  artifact: Omit<SkillOptimizationTaskArtifactV1, "schemaVersion" | "updatedAt"> & Partial<Pick<SkillOptimizationTaskArtifactV1, "updatedAt">>
) {
  const nextArtifact: SkillOptimizationTaskArtifactV1 = {
    ...clone(artifact), schemaVersion: 1, updatedAt: artifact.updatedAt || Date.now()
  }
  const history = await readAll()
  await setIndexedDbValue(STORAGE_KEY, normalizeLocalSkillOptimizationHistory([nextArtifact, ...history.filter(item => item.id !== nextArtifact.id)]))
  void saveCloudHistory("skill-optimization", nextArtifact)
  notify()
  return clone(nextArtifact)
}

function matchesLocalAccount(item: SkillOptimizationTaskArtifactV1, accountKey: string, activePlayerName = "") {
  const normalizedName = activePlayerName.trim().toLocaleLowerCase()
  return item.accountKey === accountKey
    || Boolean(normalizedName && String(item.playerName || "").trim().toLocaleLowerCase() === normalizedName)
}

export async function listLocalSkillOptimizationTasks(accountKey: string, activePlayerName = "") {
  return (await readAll())
    .filter(item => matchesLocalAccount(item, accountKey, activePlayerName))
    .map(clone)
}

export async function listCloudSkillOptimizationTasks(accountKey: string) {
  const cloud = cleanCloudSkillOptimizationHistory(await listCloudHistory<SkillOptimizationTaskArtifactV1>("skill-optimization"))
  return cloud.filter(item => item.accountKey === accountKey).map(clone)
}

export async function listSkillOptimizationTasks(accountKey: string) {
  const local = await readAll()
  const cloud = cleanCloudSkillOptimizationHistory(await listCloudHistory<SkillOptimizationTaskArtifactV1>("skill-optimization"))
  const merged = normalizeLocalSkillOptimizationHistory([...cloud, ...local.filter(item => !cloud.some(remote => remote.id === item.id))])
  return merged.filter(item => item.accountKey === accountKey).map(clone)
}

function readClassOverrides(): Record<string, SkillOptimizerClass> {
  if (typeof localStorage === "undefined") return {}
  try {
    const value = JSON.parse(localStorage.getItem(CLASS_OVERRIDE_KEY) || "{}")
    return value && typeof value === "object" ? value : {}
  } catch {
    return {}
  }
}

function overrideKey(accountKey: string, playerId: string, weaponHrid: string) {
  return `${accountKey}|${playerId}|${weaponHrid}`
}

export function getSkillClassOverride(accountKey: string, playerId: string, weaponHrid: string) {
  return readClassOverrides()[overrideKey(accountKey, playerId, weaponHrid)] || null
}

export function saveSkillClassOverride(accountKey: string, playerId: string, weaponHrid: string, classId: SkillOptimizerClass) {
  if (typeof localStorage === "undefined") return
  const overrides = readClassOverrides()
  overrides[overrideKey(accountKey, playerId, weaponHrid)] = classId
  localStorage.setItem(CLASS_OVERRIDE_KEY, JSON.stringify(overrides))
}
