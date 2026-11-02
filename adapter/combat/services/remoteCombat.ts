import LZString from "lz-string"
import { getRuntimeCombatGameData, getRuntimeCombatGameDataVersion } from "../shared/runtimeGameData.js"

export type CombatJobStatus = "queued" | "leased" | "running" | "paused" | "completed" | "failed" | "cancelled"

export interface RemoteCombatJob {
  jobId: string
  taskType: "auto_equipment" | "single" | "batch" | "advisor"
  status: CombatJobStatus
  progress: number
  stage: string
  error: string
  queuePosition: number
  createdAt: string
  leasedAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  timing?: {
    queueSeconds?: number | null
    claimToStartSeconds?: number | null
    computeSeconds?: number | null
    resultUploadSeconds?: number | null
    totalSeconds?: number | null
  }
  cancelRequested: boolean
  result?: Record<string, any>
}

export interface RemoteCombatStatus {
  ok: boolean
  node: {
    available: boolean
    state: string
    nodeId?: string
    activeWorkers?: number
    targetWorkers?: number
    cpuIdle?: number
    lastHeartbeatAt?: string | null
  }
  permissions?: { canReadAllSnapshots: boolean, canViewQueue: boolean }
  queuedCharacters: number
  activeJob: RemoteCombatJob | null
  recentJobs: RemoteCombatJob[]
}

export interface RemoteCombatQueueJob extends RemoteCombatJob {
  ownerId: number
  ownerName: string
  attemptCount: number
  leaseNodeId: string
}

export interface RemoteCombatQueueOverview {
  ok: boolean
  node: RemoteCombatStatus["node"]
  counts: Record<"queued" | "leased" | "running" | "paused", number>
  activeJobs: RemoteCombatQueueJob[]
  recentJobs: RemoteCombatQueueJob[]
  refreshedAt: string
}

async function combatJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(init.headers || {}) }
  })
  const contentType = response.headers.get("content-type") || ""
  const body = contentType.includes("application/json") ? await response.json() : null
  if (!response.ok) throw new Error(body?.detail || `服务器模拟服务请求失败 (${response.status})`)
  return body as T
}

async function combatResourceExists(path: string) {
  const response = await fetch(path, { method: "HEAD", credentials: "same-origin", cache: "no-store" })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`服务器模拟资源检查失败 (${response.status})`)
  return true
}

export function getRemoteCombatStatus() {
  return combatJson<RemoteCombatStatus>("/api/v1/combat/status")
}

export function getRemoteCombatQueueOverview() {
  return combatJson<RemoteCombatQueueOverview>("/api/v1/combat/queue-overview")
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("")
}

export async function submitRemoteCombatJob(
  taskType: RemoteCombatJob["taskType"],
  payload: Record<string, any>,
  options: { profileOwnerId?: number } = {}
) {
  const envelope = getRuntimeCombatGameData()
  const catalogBlob = LZString.compressToBase64(JSON.stringify(envelope))
  const gameDataHash = await sha256(catalogBlob)
  const catalogPath = `/api/v1/combat/catalogs/${gameDataHash}`
  if (!await combatResourceExists(catalogPath)) {
    await combatJson(catalogPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameVersion: getRuntimeCombatGameDataVersion(),
        catalogBlob
      })
    })
  }

  const payloadBlob = LZString.compressToBase64(JSON.stringify(payload))
  const payloadHash = await sha256(payloadBlob)
  const payloadPath = `/api/v1/combat/payloads/${payloadHash}`
  if (!await combatResourceExists(payloadPath)) {
    await combatJson(payloadPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payloadBlob })
    })
  }

  return combatJson<{ ok: true, job: RemoteCombatJob }>("/api/v1/combat/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 2,
      taskType,
      engineVersion: __APP_VERSION__,
      gameDataVersion: getRuntimeCombatGameDataVersion(),
      gameDataHash,
      payloadHash,
      profileOwnerId: options.profileOwnerId
    })
  })
}

export interface RemoteCombatProfileSnapshot {
  ownerId: number
  ownerName: string
  characterNames: string[]
  guildId?: number
  schemaVersion: number
  contentHash: string
  snapshotBlob?: string
  capturedAt: string
  gameDataVersion: string
  pluginVersion: string
  updatedAt: string
}

export async function saveRemoteCombatProfileSnapshot(
  snapshot: Record<string, any>,
  metadata: { capturedAt?: string, gameDataVersion: string, pluginVersion?: string }
) {
  const snapshotBlob = LZString.compressToBase64(JSON.stringify(snapshot))
  const contentHash = await sha256(snapshotBlob)
  return combatJson<{ ok: true, snapshot: RemoteCombatProfileSnapshot }>("/api/v1/combat/profile-snapshot", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      contentHash,
      snapshotBlob,
      capturedAt: metadata.capturedAt || new Date().toISOString(),
      gameDataVersion: metadata.gameDataVersion,
      pluginVersion: metadata.pluginVersion || "unknown"
    })
  })
}

export function getRemoteCombatProfileSnapshot(ownerId?: number) {
  const path = ownerId
    ? `/api/v1/combat/profile-snapshots/${encodeURIComponent(ownerId)}`
    : "/api/v1/combat/profile-snapshot"
  return combatJson<{ ok: true, snapshot: RemoteCombatProfileSnapshot | null }>(path)
}

export function listRemoteCombatProfileSnapshots(query = "") {
  const search = new URLSearchParams()
  if (query.trim()) search.set("q", query.trim())
  const suffix = search.size ? `?${search}` : ""
  return combatJson<{ ok: true, snapshots: RemoteCombatProfileSnapshot[] }>(`/api/v1/combat/profile-snapshots${suffix}`)
}

export function deleteRemoteCombatProfileSnapshot() {
  return combatJson<{ ok: true, deleted: boolean }>("/api/v1/combat/profile-snapshot", { method: "DELETE" })
}

export function decodeRemoteCombatProfileSnapshot(snapshot: RemoteCombatProfileSnapshot | null) {
  if (!snapshot?.snapshotBlob) return null
  const decoded = LZString.decompressFromBase64(snapshot.snapshotBlob)
  if (!decoded) throw new Error("服务器角色快照无法解压")
  return JSON.parse(decoded)
}

export function getRemoteCombatJob(jobId: string) {
  return combatJson<{ ok: true, job: RemoteCombatJob }>(`/api/v1/combat/jobs/${encodeURIComponent(jobId)}`)
}

export async function getRemoteCombatJobBaseline(jobId: string) {
  const response = await combatJson<{
    ok: true
    baseline: {
      job: RemoteCombatJob
      payloadBlob: string
      gameDataVersion: string
      profileOwnerId: number
    }
  }>(`/api/v1/combat/jobs/${encodeURIComponent(jobId)}/baseline`)
  const decoded = LZString.decompressFromBase64(response.baseline.payloadBlob)
  if (!decoded) throw new Error("服务器任务基线无法解压")
  return {
    ...response.baseline,
    payload: JSON.parse(decoded) as Record<string, any>
  }
}

export function cancelRemoteCombatJob(jobId: string) {
  return combatJson<{ ok: true, job: RemoteCombatJob }>(`/api/v1/combat/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE"
  })
}
