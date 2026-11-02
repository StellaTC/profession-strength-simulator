import { getIndexedDbValue, setIndexedDbValue } from "@/common/utils/cache/indexed-db"
import { listCloudHistory, saveCloudHistory } from "@/services/cloudHistory"

const COMBAT_RUN_HISTORY_KEY = "combat-run-history-v2"
const COMBAT_RUN_HISTORY_VERSION = 2
const COMBAT_RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const COMBAT_RUN_LIMIT_PER_ACCOUNT = 20
export const COMBAT_RUN_HISTORY_CHANGED_EVENT = "milkonomy-combat-run-history-changed"

export interface CombatRunTarget {
  kind: "planet" | "dungeon"
  targetHrid: string
  difficultyTier: number
}

export interface CombatRunArtifactV2 {
  schemaVersion: 2
  id: string
  accountKey: string
  createdAt: number
  gameDataVersion: string
  source: "advisor" | "server"
  partial: boolean
  activePlayerId: string
  players: Array<Record<string, any>>
  simulationSettings: Record<string, any>
  targets: CombatRunTarget[]
  rows: Array<Record<string, any>>
  marketCapturedAt: number
}

export function cloneCombatRunValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `combat-run-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function notifyHistoryChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(COMBAT_RUN_HISTORY_CHANGED_EVENT))
  }
}

function isArtifact(value: unknown): value is CombatRunArtifactV2 {
  const artifact = value as CombatRunArtifactV2
  return Boolean(
    artifact
    && artifact.schemaVersion === COMBAT_RUN_HISTORY_VERSION
    && artifact.id
    && artifact.accountKey
    && Array.isArray(artifact.players)
    && Array.isArray(artifact.targets)
    && Array.isArray(artifact.rows)
  )
}

export function normalizeLocalCombatRunHistory(values: unknown) {
  return (Array.isArray(values) ? values : [])
    .filter(isArtifact)
    .sort((left, right) => right.createdAt - left.createdAt)
}

export function cleanCloudCombatRunHistory(values: unknown, now = Date.now()) {
  const cutoff = now - COMBAT_RUN_RETENTION_MS
  const valid = (Array.isArray(values) ? values : [])
    .filter(isArtifact)
    .filter(item => Number(item.createdAt || 0) >= cutoff)
    .sort((left, right) => right.createdAt - left.createdAt)

  const counts = new Map<string, number>()
  return valid.filter((item) => {
    const count = counts.get(item.accountKey) || 0
    if (count >= COMBAT_RUN_LIMIT_PER_ACCOUNT) return false
    counts.set(item.accountKey, count + 1)
    return true
  })
}

async function readAllHistory() {
  const values = await getIndexedDbValue<CombatRunArtifactV2[]>(COMBAT_RUN_HISTORY_KEY)
  const cleaned = normalizeLocalCombatRunHistory(values)
  if (JSON.stringify(values || []) !== JSON.stringify(cleaned)) {
    await setIndexedDbValue(COMBAT_RUN_HISTORY_KEY, cleaned)
  }
  return cleaned
}

export function resolveCombatAccountKey(profileOwnerId: unknown, activePlayerName = "") {
  const ownerId = Number(profileOwnerId || 0)
  if (Number.isInteger(ownerId) && ownerId > 0) return `account:${ownerId}`
  const name = activePlayerName.trim().toLocaleLowerCase()
  return name ? `local:${name}` : "local:anonymous"
}

export function resolveCombatAccountKeyCandidates(profileOwnerIds: unknown[], activePlayerName = "") {
  const keys = new Set<string>()
  for (const value of profileOwnerIds) {
    const ownerId = Number(value || 0)
    if (Number.isInteger(ownerId) && ownerId > 0) keys.add(`account:${ownerId}`)
  }
  const name = activePlayerName.trim().toLocaleLowerCase()
  if (name) keys.add(`local:${name}`)
  return Array.from(keys)
}

export async function listCombatRunArtifacts(accountKey: string) {
  return (await readAllHistory()).filter(item => item.accountKey === accountKey).map(cloneCombatRunValue)
}

export async function listCombatRunArtifactsForAccount(options: {
  canonicalAccountKey: string
  profileOwnerIds?: unknown[]
  activePlayerName?: string
}) {
  const canonicalAccountKey = String(options.canonicalAccountKey || "")
  const candidateKeys = new Set(resolveCombatAccountKeyCandidates(
    options.profileOwnerIds || [],
    options.activePlayerName || ""
  ))
  if (canonicalAccountKey) candidateKeys.add(canonicalAccountKey)

  const localHistory = await readAllHistory()
  const cloudHistory = cleanCloudCombatRunHistory(await listCloudHistory<CombatRunArtifactV2>("combat-run"))
  const history = normalizeLocalCombatRunHistory([
    ...cloudHistory,
    ...localHistory.filter(local => !cloudHistory.some(cloud => cloud.id === local.id))
  ])
  const matched = history.filter(item => candidateKeys.has(item.accountKey))
  if (canonicalAccountKey && matched.some(item => item.accountKey !== canonicalAccountKey)) {
    const matchedIds = new Set(matched.map(item => item.id))
    const migrated = normalizeLocalCombatRunHistory(localHistory.map(item => (
      matchedIds.has(item.id) ? { ...item, accountKey: canonicalAccountKey } : item
    )))
    await setIndexedDbValue(COMBAT_RUN_HISTORY_KEY, migrated)
    notifyHistoryChanged()
    const migratedLocal = migrated.filter(item => item.accountKey === canonicalAccountKey)
    return normalizeLocalCombatRunHistory([
      ...cloudHistory.filter(item => candidateKeys.has(item.accountKey)),
      ...migratedLocal.filter(local => !cloudHistory.some(cloud => cloud.id === local.id))
    ]).map(cloneCombatRunValue)
  }
  return matched.map(cloneCombatRunValue)
}

export async function saveCombatRunArtifact(
  input: Omit<CombatRunArtifactV2, "schemaVersion" | "id" | "createdAt"> & Partial<Pick<CombatRunArtifactV2, "id" | "createdAt">>
) {
  const artifact: CombatRunArtifactV2 = {
    ...cloneCombatRunValue(input),
    schemaVersion: COMBAT_RUN_HISTORY_VERSION,
    id: String(input.id || createId()),
    createdAt: Number(input.createdAt || Date.now())
  }
  const history = await readAllHistory()
  const next = normalizeLocalCombatRunHistory([artifact, ...history.filter(item => item.id !== artifact.id)])
  await setIndexedDbValue(COMBAT_RUN_HISTORY_KEY, next)
  void saveCloudHistory("combat-run", artifact)
  notifyHistoryChanged()
  return cloneCombatRunValue(artifact)
}

export async function getCombatRunArtifact(accountKey: string, id: string) {
  const history = await listCombatRunArtifacts(accountKey)
  return history.find(item => item.id === id) || null
}
