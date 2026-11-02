import { computed, onMounted, onUnmounted, ref } from "vue"
import { ElMessage } from "element-plus"
import { initializeCombatGameData, installCombatBridgeListeners, readCombatProfileEnvelope } from "../services/combatBridge"
import {
  decodeRemoteCombatProfileSnapshot,
  deleteRemoteCombatProfileSnapshot,
  getRemoteCombatProfileSnapshot,
  saveRemoteCombatProfileSnapshot,
  type RemoteCombatProfileSnapshot
} from "../services/remoteCombat"
import { getRuntimeCombatGameData } from "../shared/runtimeGameData.js"
import { useSimulatorStore } from "../stores/simulatorStore.js"
import { useAuthStore } from "@/stores/auth"

import { combatWorkspaceOwner, combatWorkspaceState, loadCombatWorkspace, setSharedBaseline } from "../services/combatWorkspaceState"

const BUILD_STORAGE_KEY = "milkonomy-combat-builds-v1"

export interface SavedCombatBuild {
  name: string
  savedAt: number
  player: Record<string, unknown>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function normalizeCapturedAt(value: unknown) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString()
  const parsed = new Date(String(value || ""))
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function loadBuilds(): SavedCombatBuild[] {
  try {
    const value = JSON.parse(localStorage.getItem(BUILD_STORAGE_KEY) || "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function useCombatWorkspace(options: { listen?: boolean } = {}) {
  const simulator = useSimulatorStore()
  const auth = useAuthStore()
  const dataSource = ref("bundled")
  const dataVersion = ref("")
  const importStatus = ref("")
  const savedBuilds = ref<SavedCombatBuild[]>(loadBuilds())
  const serverSnapshot = ref<RemoteCombatProfileSnapshot | null>(null)
  const snapshotStatus = ref("")
  let uninstall: (() => void) | null = null

  function updateDataStatus(source: string) {
    const envelope = getRuntimeCombatGameData()
    dataSource.value = source
    dataVersion.value = String(envelope.gameVersion || envelope.versionTimestamp || "fallback")
  }

  function buildProfileSnapshot() {
    return {
      schemaVersion: 1,
      players: clone(simulator.players),
      activePlayerId: String(simulator.activePlayerId),
      simulationSettings: clone(simulator.simulationSettings),
      importedProfileByPlayer: clone(simulator.queue.importedProfileByPlayer || {}),
      profileCompletenessByPlayer: clone((simulator.queue as any).profileCompletenessByPlayer || {}),
      capturedAt: normalizeCapturedAt(simulator.simulationSettings.profileSnapshotCapturedAt),
      gameDataVersion: dataVersion.value
    }
  }

  async function persistServerSnapshot(envelope: any = {}) {
    const response = await saveRemoteCombatProfileSnapshot(buildProfileSnapshot(), {
      capturedAt: normalizeCapturedAt(envelope?.capturedAt),
      gameDataVersion: dataVersion.value || "fallback",
      pluginVersion: String(envelope?.scriptVersion || envelope?.pluginVersion || "unknown")
    })
    serverSnapshot.value = response.snapshot
    simulator.simulationSettings.profileSnapshotOwnerId = response.snapshot.ownerId
    simulator.simulationSettings.profileSnapshotCapturedAt = response.snapshot.capturedAt
    snapshotStatus.value = `服务器快照已更新：${new Date(response.snapshot.updatedAt).toLocaleString()}`
    return response.snapshot
  }

  function applyProfileSnapshot(snapshot: any, ownerId?: number) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.players)) {
      throw new Error("服务器角色快照格式无效")
    }
    simulator.players = clone(snapshot.players)
    simulator.activePlayerId = String(snapshot.activePlayerId || simulator.players[0]?.id || "1")
    simulator.simulationSettings = { ...simulator.simulationSettings, ...clone(snapshot.simulationSettings || {}) }
    if (ownerId) simulator.simulationSettings.profileSnapshotOwnerId = ownerId
    simulator.queue.importedProfileByPlayer = clone(snapshot.importedProfileByPlayer || {})
    ;(simulator.queue as any).profileCompletenessByPlayer = clone(snapshot.profileCompletenessByPlayer || {})
    simulator.refreshRuntimeGameDataOptions()
    simulator.normalizeRunScope()
    return simulator.players.length
  }

  async function loadServerSnapshot(ownerId?: number) {
    const response = await getRemoteCombatProfileSnapshot(ownerId)
    serverSnapshot.value = response.snapshot
    if (!response.snapshot) {
      snapshotStatus.value = "服务器上暂无初始化快照"
      return 0
    }
    const decoded = decodeRemoteCombatProfileSnapshot(response.snapshot)
    const count = applyProfileSnapshot(decoded, response.snapshot.ownerId)
    simulator.simulationSettings.profileSnapshotCapturedAt = response.snapshot.capturedAt
    snapshotStatus.value = `已恢复 ${response.snapshot.ownerName} 的服务器快照（${count} 人）`
    return count
  }

  async function deleteServerSnapshot() {
    const response = await deleteRemoteCombatProfileSnapshot()
    serverSnapshot.value = null
    snapshotStatus.value = response.deleted ? "服务器初始化快照已删除" : "服务器上没有可删除的快照"
    return response.deleted
  }

  async function importProfileEnvelope(envelope: any) {
    const sourceMembers = Array.isArray(envelope?.members) && envelope.members.length
      ? envelope.members
      : (envelope?.currentCharacter ? [{ payload: envelope.currentCharacter, format: "main-site-current-character", characterName: "" }] : [])
    if (!sourceMembers.length) {
      importStatus.value = "插件中没有可导入的战斗角色数据"
      ElMessage.warning(importStatus.value)
      return 0
    }
    simulator.simulationSettings.profileSnapshotCapturedAt = normalizeCapturedAt(envelope?.capturedAt)
    simulator.players.forEach((player: any) => { player.selected = false })
    ;(simulator.queue as any).profileCompletenessByPlayer = {}
    let imported = 0
    for (const member of sourceMembers.slice(0, 5)) {
      const playerId = String(imported + 1)
      try {
        simulator.importSoloConfig(JSON.stringify(member.payload || {}), playerId)
        const player = simulator.players.find((entry: any) => String(entry.id) === playerId)
        if (player) {
          player.selected = true
          if (member.characterName) player.name = member.characterName
        }
        simulator.setImportedProfileState(playerId, true)
        const equipmentCount = Object.values(player?.equipment || {}).filter((entry: any) => entry?.itemHrid).length
        const abilityCount = (player?.abilities || []).filter((entry: any) => entry?.abilityHrid).length
        const triggerTargetCount = Object.keys(player?.triggerMap || {}).length
        ;(simulator.queue as any).profileCompletenessByPlayer[playerId] = {
          equipmentCount,
          abilityCount,
          triggerTargetCount,
          hasTriggerPayload: member?.completeness?.hasTriggerPayload === true || triggerTargetCount > 0,
          source: member?.isCurrent ? "current" : "profile_shared"
        }
        imported += 1
      } catch (error: any) {
        console.warn("[Combat] profile import failed", error)
      }
    }
    if (imported > 0) simulator.setActivePlayer("1")
    const missing = Array.isArray(envelope?.missingMembers) ? envelope.missingMembers : []
    importStatus.value = missing.length
      ? `已导入 ${imported} 人；以下玩家数据未获取：${missing.join("、")}`
      : `已导入 ${imported} 人`
    if (imported > 0) {
      const owner = combatWorkspaceOwner(auth.user?.id)
      await loadCombatWorkspace(owner)
      if (!combatWorkspaceState(owner).baseline) await setSharedBaseline(owner, {
        players: simulator.players, settings: simulator.simulationSettings,
        activePlayerId: simulator.activePlayerId, source: "插件导入", name: "导入队伍"
      })
      ElMessage.success(importStatus.value)
      if (auth.user) {
        try {
          await persistServerSnapshot(envelope)
        } catch (error: any) {
          snapshotStatus.value = error?.message || "服务器快照保存失败"
          ElMessage.warning(`角色已导入，但${snapshotStatus.value}`)
        }
      }
    } else {
      ElMessage.warning(importStatus.value)
    }
    return imported
  }

  async function importFromPlugin() {
    const envelope = readCombatProfileEnvelope()
    if (!envelope) {
      importStatus.value = "未找到插件战斗数据，请先打开游戏并刷新一次"
      ElMessage.warning(importStatus.value)
      return 0
    }
    return importProfileEnvelope(envelope)
  }

  function persistBuilds() {
    localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(savedBuilds.value))
  }

  function saveBuild(name: string) {
    const normalized = name.trim()
    if (!normalized) throw new Error("请输入配装名称")
    const entry = { name: normalized, savedAt: Date.now(), player: clone(simulator.activePlayer) }
    const index = savedBuilds.value.findIndex(item => item.name === normalized)
    if (index >= 0) savedBuilds.value[index] = entry
    else savedBuilds.value.unshift(entry)
    persistBuilds()
  }

  function duplicateBuild(name: string) {
    const source = savedBuilds.value.find(item => item.name === name)
    if (!source) return
    const copyName = `${source.name} - 副本`
    savedBuilds.value.unshift({ name: copyName, savedAt: Date.now(), player: clone(source.player) })
    persistBuilds()
  }

  function loadBuild(name: string) {
    const source = savedBuilds.value.find(item => item.name === name)
    if (!source) return false
    const playerId = String(simulator.activePlayerId)
    const selected = simulator.activePlayer.selected
    simulator.players = simulator.players.map((player: any) => String(player.id) === playerId
      ? { ...clone(source.player), id: playerId, selected }
      : player)
    return true
  }

  function deleteBuild(name: string) {
    savedBuilds.value = savedBuilds.value.filter(item => item.name !== name)
    persistBuilds()
  }

  function exportBuilds() {
    return JSON.stringify({ schemaVersion: 1, builds: savedBuilds.value }, null, 2)
  }

  function importBuilds(text: string) {
    const parsed = JSON.parse(text)
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.builds)) throw new Error("配装文件格式无效")
    savedBuilds.value = parsed.builds
    persistBuilds()
  }

  onMounted(async () => {
    const initialized = await initializeCombatGameData()
    updateDataStatus(initialized.source)
    simulator.refreshRuntimeGameDataOptions()
    if (options.listen !== false) {
      uninstall = installCombatBridgeListeners(
        () => {
          importStatus.value = "检测到新的插件角色数据，点击“从插件导入”后应用"
        },
        () => {
          simulator.refreshRuntimeGameDataOptions()
          updateDataStatus("plugin")
        }
      )
    }
  })
  onUnmounted(() => uninstall?.())

  return {
    simulator,
    dataSource,
    dataVersion,
    importStatus,
    serverSnapshot,
    snapshotStatus,
    savedBuilds: computed(() => savedBuilds.value),
    importFromPlugin,
    importProfileEnvelope,
    buildProfileSnapshot,
    persistServerSnapshot,
    loadServerSnapshot,
    deleteServerSnapshot,
    saveBuild,
    duplicateBuild,
    loadBuild,
    deleteBuild,
    exportBuilds,
    importBuilds
  }
}
