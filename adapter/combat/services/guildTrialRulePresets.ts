import type { GuildTrialAllocationRules } from "./guildTrialNative"

export interface GuildTrialRulePresetPayload {
  schemaVersion: 1
  encounterHrid: string
  rules: GuildTrialAllocationRules
}

export interface GuildTrialRulePreset {
  bossSlot: 0 | 1
  presetSlot: 0 | 1
  payload: GuildTrialRulePresetPayload
  updatedAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.detail || `HTTP ${response.status}`)
  return body as T
}

export async function listGuildTrialRulePresets() {
  const response = await request<{ presets: GuildTrialRulePreset[] }>("/api/v1/guild-trial/rule-presets")
  return response.presets
}

export async function saveGuildTrialRulePreset(
  bossSlot: 0 | 1,
  presetSlot: 0 | 1,
  payload: GuildTrialRulePresetPayload
) {
  const response = await request<{ preset: GuildTrialRulePreset }>(
    `/api/v1/guild-trial/rule-presets/${bossSlot}/${presetSlot}`,
    { method: "PUT", body: JSON.stringify({ payload }) }
  )
  return response.preset
}
