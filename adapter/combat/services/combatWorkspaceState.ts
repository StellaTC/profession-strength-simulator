import { reactive } from "vue"
import { getIndexedDbValue, setIndexedDbValue } from "@/common/utils/cache/indexed-db"
import { getRuntimeCombatGameDataVersion } from "../shared/runtimeGameData.js"
import type { CombatRunArtifactV2 } from "./combatRunHistory"

export type CombatConfig = Record<string, any>
export interface SharedCombatBaseline {
  schemaVersion: 1
  id: string
  revision: number
  accountKey: string
  name: string
  source: string
  createdAt: number
  gameDataVersion: string
  players: CombatConfig[]
  settings: CombatConfig
  activePlayerId: string
  artifact?: CombatRunArtifactV2
}
export interface PartyBuild {
  id: string
  name: string
  savedAt: number
  gameDataVersion: string
  players: CombatConfig[]
  settings: CombatConfig
}
export interface WorkspaceState {
  ready: boolean
  baseline: SharedCombatBaseline | null
  builds: PartyBuild[]
}
export const copyCombatValue = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const states = new Map<string, WorkspaceState>()
const pending = new Map<string, Promise<void>>()
const writes = new Map<string, Promise<unknown>>()
const storageKey = (owner: string) => `combat-workspace-v1:${owner}`
export const combatWorkspaceOwner = (userId?: number | null) => userId ? `account:${userId}` : "guest"

export function combatWorkspaceState(owner: string) {
  if (!states.has(owner)) states.set(owner, reactive<WorkspaceState>({ ready: false, baseline: null, builds: [] }))
  return states.get(owner)!
}

export async function loadCombatWorkspace(owner: string) {
  const state = combatWorkspaceState(owner)
  if (state.ready) return
  if (!pending.has(owner)) pending.set(owner, (async () => {
    const saved = await getIndexedDbValue<WorkspaceState>(storageKey(owner))
    if (saved?.baseline?.accountKey === owner && saved.baseline.schemaVersion === 1) state.baseline = saved.baseline
    state.builds = Array.isArray(saved?.builds) ? saved.builds.filter(b => b.id && Array.isArray(b.players)) : []
    state.ready = true
  })().finally(() => pending.delete(owner)))
  return pending.get(owner)
}

async function persist(owner: string) {
  const snapshot = copyCombatValue(combatWorkspaceState(owner))
  const write = (writes.get(owner) || Promise.resolve()).catch(() => {}).then(() => setIndexedDbValue(storageKey(owner), snapshot))
  writes.set(owner, write)
  await write
}

export function validateParty(players: unknown): asserts players is CombatConfig[] {
  if (!Array.isArray(players) || !players.length || players.length > 5) throw new Error("队伍需要 1～5 名角色")
  const ids = new Set<string>()
  for (const player of players) {
    if (!player || !player.id || !player.levels || !player.equipment || !Array.isArray(player.abilities)) throw new Error("角色配置不完整")
    if (ids.has(String(player.id))) throw new Error("角色 ID 重复")
    ids.add(String(player.id))
    for (const value of Object.values(player.levels)) if (!Number.isFinite(Number(value)) || Number(value) < 1) throw new Error("角色等级无效")
  }
  if (!players.some(p => p.selected)) throw new Error("请至少选择一名出战角色")
}

export async function setSharedBaseline(owner: string, input: {
  players: CombatConfig[], settings: CombatConfig, activePlayerId?: string, name?: string, source?: string,
  gameDataVersion?: string, artifact?: CombatRunArtifactV2
}) {
  validateParty(input.players)
  await loadCombatWorkspace(owner)
  const state = combatWorkspaceState(owner)
  state.baseline = copyCombatValue({
    schemaVersion: 1, id: crypto.randomUUID(), revision: (state.baseline?.revision || 0) + 1,
    accountKey: owner, name: input.name || "当前队伍", source: input.source || "当前配置", createdAt: Date.now(),
    gameDataVersion: input.gameDataVersion || getRuntimeCombatGameDataVersion(), players: input.players,
    settings: input.settings, activePlayerId: input.activePlayerId || String(input.players.find(p => p.selected)!.id),
    ...(input.artifact ? { artifact: input.artifact } : {})
  }) as SharedCombatBaseline
  await persist(owner)
  return copyCombatValue(state.baseline)
}

export function baselineIsCurrent(baseline: SharedCombatBaseline | null) {
  return Boolean(baseline && baseline.gameDataVersion === getRuntimeCombatGameDataVersion())
}

export async function setBaselineFromArtifact(owner: string, artifact: CombatRunArtifactV2) {
  if (artifact.partial || !artifact.rows?.length || !artifact.targets?.length) throw new Error("请选择完整的模拟结果")
  // Historical artifacts stored only the short game version. Their results are not reused as cache entries.
  const current = getRuntimeCombatGameDataVersion()
  const compatible = artifact.gameDataVersion === current || artifact.gameDataVersion === current.split("|")[0]
  return setSharedBaseline(owner, {
    players: artifact.players, settings: artifact.simulationSettings, activePlayerId: artifact.activePlayerId,
    name: `模拟记录 ${new Date(artifact.createdAt).toLocaleString()}`, source: "模拟历史",
    gameDataVersion: compatible ? current : artifact.gameDataVersion, artifact
  })
}

export async function savePartyBuild(owner: string, name: string, players: CombatConfig[], settings: CombatConfig, gameDataVersion = getRuntimeCombatGameDataVersion()) {
  validateParty(players)
  if (!name.trim()) throw new Error("请输入方案名称")
  await loadCombatWorkspace(owner)
  const build: PartyBuild = copyCombatValue({ id: crypto.randomUUID(), name: name.trim(), players, settings, gameDataVersion, savedAt: Date.now() })
  combatWorkspaceState(owner).builds.unshift(build)
  await persist(owner)
  return build
}

export async function deletePartyBuild(owner: string, id: string) {
  await loadCombatWorkspace(owner)
  const state = combatWorkspaceState(owner)
  state.builds = state.builds.filter(b => b.id !== id)
  await persist(owner)
}

export async function importPartyBuilds(owner: string, text: string) {
  const input = JSON.parse(text)
  if (input.schemaVersion !== 1 || input.kind !== "combat-party-builds" || !Array.isArray(input.builds) || input.builds.length > 100) throw new Error("整队方案文件格式无效")
  for (const build of input.builds) {
    validateParty(build.players)
    if (typeof build.name !== "string" || !build.name.trim() || !build.settings || !build.gameDataVersion) throw new Error("方案字段不完整")
  }
  await loadCombatWorkspace(owner)
  const builds = input.builds.map((b: PartyBuild) => copyCombatValue({ ...b, id: crypto.randomUUID(), savedAt: Date.now() }))
  combatWorkspaceState(owner).builds.unshift(...builds)
  await persist(owner)
}

export function exportPartyBuilds(owner: string) {
  return JSON.stringify({ schemaVersion: 1, kind: "combat-party-builds", builds: combatWorkspaceState(owner).builds }, null, 2)
}
