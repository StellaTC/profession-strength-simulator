import { getIndexedDbValue, setIndexedDbValue } from "@/common/utils/cache/indexed-db"
import { listCloudHistory, saveCloudHistory } from "@/services/cloudHistory"

const STORAGE_KEY = "combat-equipment-upgrade-history-v1"
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const LIMIT_PER_ACCOUNT = 20
export const EQUIPMENT_UPGRADE_HISTORY_CHANGED_EVENT = "milkonomy-equipment-upgrade-history-changed"

export interface EquipmentUpgradeTaskArtifact {
  schemaVersion: 1
  id: string
  accountKey: string
  createdAt: number
  updatedAt: number
  status: "authorized" | "running" | "completed" | "failed" | "cancelled"
  authorizationId?: string
  manifestHash?: string
  gameDataVersion: string
  playerId: string
  playerName: string
  target: { kind: "planet" | "dungeon", targetHrid: string, difficultyTier: number }
  baselineLabel: string
  progress: number
  stage: string
  error: string
  result?: Record<string, any> | null
  timing?: { startedAt: number, finishedAt?: number, totalSeconds?: number }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function isArtifact(value: any): value is EquipmentUpgradeTaskArtifact {
  return Boolean(value?.schemaVersion === 1 && value?.id && value?.accountKey && value?.target)
}

export function normalizeLocalEquipmentUpgradeHistory(values: unknown) {
  return (Array.isArray(values) ? values : [])
    .filter(isArtifact)
    .sort((left, right) => right.createdAt - left.createdAt)
}

export function cleanCloudEquipmentUpgradeHistory(values: unknown, now = Date.now()) {
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
  const values = await getIndexedDbValue<EquipmentUpgradeTaskArtifact[]>(STORAGE_KEY)
  const cleaned = normalizeLocalEquipmentUpgradeHistory(values)
  if (JSON.stringify(values || []) !== JSON.stringify(cleaned)) {
    await setIndexedDbValue(STORAGE_KEY, cleaned)
  }
  return cleaned
}

function notify() {
  window.dispatchEvent(new CustomEvent(EQUIPMENT_UPGRADE_HISTORY_CHANGED_EVENT))
}

export async function saveEquipmentUpgradeTask(
  artifact: Omit<EquipmentUpgradeTaskArtifact, "schemaVersion" | "updatedAt"> & Partial<Pick<EquipmentUpgradeTaskArtifact, "updatedAt">>
) {
  const nextArtifact: EquipmentUpgradeTaskArtifact = {
    ...clone(artifact),
    schemaVersion: 1,
    updatedAt: artifact.updatedAt || Date.now()
  }
  const history = await readAll()
  await setIndexedDbValue(STORAGE_KEY, normalizeLocalEquipmentUpgradeHistory([
    nextArtifact,
    ...history.filter(item => item.id !== nextArtifact.id)
  ]))
  void saveCloudHistory("equipment-upgrade", nextArtifact)
  notify()
  return clone(nextArtifact)
}

function matchesLocalAccount(item: EquipmentUpgradeTaskArtifact, accountKey: string, activePlayerName = "") {
  const normalizedName = activePlayerName.trim().toLocaleLowerCase()
  return item.accountKey === accountKey
    || Boolean(normalizedName && String(item.playerName || "").trim().toLocaleLowerCase() === normalizedName)
}

export async function listLocalEquipmentUpgradeTasks(accountKey: string, activePlayerName = "") {
  return (await readAll())
    .filter(item => matchesLocalAccount(item, accountKey, activePlayerName))
    .map(clone)
}

export async function listCloudEquipmentUpgradeTasks(accountKey: string) {
  const cloud = cleanCloudEquipmentUpgradeHistory(await listCloudHistory<EquipmentUpgradeTaskArtifact>("equipment-upgrade"))
  return cloud.filter(item => item.accountKey === accountKey).map(clone)
}

export async function listEquipmentUpgradeTasks(accountKey: string) {
  const local = await readAll()
  const cloud = cleanCloudEquipmentUpgradeHistory(await listCloudHistory<EquipmentUpgradeTaskArtifact>("equipment-upgrade"))
  const merged = normalizeLocalEquipmentUpgradeHistory([...cloud, ...local.filter(item => !cloud.some(remote => remote.id === item.id))])
  return merged.filter(item => item.accountKey === accountKey).map(clone)
}
