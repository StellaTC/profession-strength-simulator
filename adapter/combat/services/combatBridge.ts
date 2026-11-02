import { getIndexedDbValue, setIndexedDbValue } from "@/common/utils/cache/indexed-db"
import LZString from "lz-string"
import { OPTIONAL_COMBAT_GAME_DATA_KEYS, REQUIRED_COMBAT_GAME_DATA_KEYS } from "../shared/gameDataIndex.js"
import { getRuntimeCombatGameData, setRuntimeCombatGameData } from "../shared/runtimeGameData.js"

export const COMBAT_PROFILE_STORAGE_KEY = "new_combat_profile_v1"
export const COMBAT_GAME_DATA_STORAGE_KEY = "new_combat_game_data_v1"
const COMBAT_GAME_DATA_CACHE_KEY = "new-combat-game-data-envelope-v1"

export interface CombatBridgeEnvelope {
  schemaVersion: 1
  capturedAt: number
  gameVersion: string
  versionTimestamp: string
  source?: string
  maps?: Record<string, unknown>
  [key: string]: unknown
}

function parseEnvelope(value: unknown): CombatBridgeEnvelope | null {
  if (!value) return null
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    return parsed && typeof parsed === "object" ? parsed as CombatBridgeEnvelope : null
  } catch {
    return null
  }
}

function resolveGameDataEnvelope(value: unknown): CombatBridgeEnvelope | null {
  const envelope = parseEnvelope(value)
  if (!envelope) return null
  if (envelope.maps && typeof envelope.maps === "object") return envelope
  const compressed = typeof envelope.compressedInitClientData === "string"
    ? envelope.compressedInitClientData
    : ""
  if (!compressed) return envelope
  try {
    const decodedText = LZString.decompressFromUTF16(compressed)
    const decoded = decodedText ? JSON.parse(decodedText) : null
    const source = decoded?.clientData || decoded?.data || decoded
    if (!source || typeof source !== "object") return null
    const maps = Object.fromEntries(
      [...REQUIRED_COMBAT_GAME_DATA_KEYS, ...OPTIONAL_COMBAT_GAME_DATA_KEYS]
        .filter(key => source[key] && typeof source[key] === "object")
        .map(key => [key, source[key]])
    )
    return {
      ...envelope,
      gameVersion: String(envelope.gameVersion || source.gameVersion || "unknown"),
      versionTimestamp: String(envelope.versionTimestamp || source.versionTimestamp || ""),
      maps
    }
  } catch {
    return null
  }
}

export async function initializeCombatGameData() {
  const localEnvelope = resolveGameDataEnvelope(localStorage.getItem(COMBAT_GAME_DATA_STORAGE_KEY))
  if (localEnvelope) {
    try {
      const applied = setRuntimeCombatGameData(localEnvelope)
      await setIndexedDbValue(COMBAT_GAME_DATA_CACHE_KEY, localEnvelope)
      return { source: "plugin", envelope: applied }
    } catch {
      // Ignore invalid plugin payload and continue to the last known valid cache.
    }
  }

  const cachedEnvelope = await getIndexedDbValue<CombatBridgeEnvelope>(COMBAT_GAME_DATA_CACHE_KEY)
  if (cachedEnvelope) {
    try {
      return { source: "cache", envelope: setRuntimeCombatGameData(cachedEnvelope) }
    } catch {
      // Bundled data remains active.
    }
  }
  return { source: "bundled", envelope: getRuntimeCombatGameData() }
}

export function readCombatProfileEnvelope() {
  return parseEnvelope(localStorage.getItem(COMBAT_PROFILE_STORAGE_KEY))
}

export function installCombatBridgeListeners(
  onProfile?: (payload: CombatBridgeEnvelope) => void,
  onGameData?: (payload: CombatBridgeEnvelope) => void
) {
  const onGameDataReady = async (event: Event) => {
    const detail = (event as CustomEvent).detail
    const envelope = resolveGameDataEnvelope(detail) || resolveGameDataEnvelope(localStorage.getItem(COMBAT_GAME_DATA_STORAGE_KEY))
    if (!envelope) return
    try {
      const before = getRuntimeCombatGameData()
      const beforeVersion = `${before.gameVersion}|${before.versionTimestamp}`
      const incomingVersion = `${envelope.gameVersion}|${envelope.versionTimestamp}`
      if (beforeVersion === incomingVersion) return
      const after = setRuntimeCombatGameData(envelope)
      await setIndexedDbValue(COMBAT_GAME_DATA_CACHE_KEY, envelope)
      onGameData?.(envelope)
      if (beforeVersion !== `${after.gameVersion}|${after.versionTimestamp}`) {
        sessionStorage.setItem("new_combat_data_updated", "1")
      }
    } catch {
      // Keep the last valid catalog.
    }
  }
  const onProfileData = (event: Event) => {
    const envelope = parseEnvelope((event as CustomEvent).detail)
      || parseEnvelope(localStorage.getItem(COMBAT_PROFILE_STORAGE_KEY))
    if (envelope) onProfile?.(envelope)
  }
  window.addEventListener("new-combat-game-data-ready", onGameDataReady)
  window.addEventListener("new-combat-profile-ready", onProfileData)
  return () => {
    window.removeEventListener("new-combat-game-data-ready", onGameDataReady)
    window.removeEventListener("new-combat-profile-ready", onProfileData)
  }
}
