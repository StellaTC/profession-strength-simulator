import abilitySlotsLevelRequirementList from "../combatsimulator/data/abilitySlotsLevelRequirementList.json"
import actionDetailMap from "../combatsimulator/data/actionDetailMap.json"
import itemDetailMap from "../combatsimulator/data/itemDetailMap.json"
import Monster from "../combatsimulator/monster.js"
import { abilityDetailIndex } from "../shared/gameDataIndex.js"

export type SkillOptimizerClass = "water" | "fire" | "nature" | "sword" | "mace" | "spear" | "bow" | "crossbow" | "shield"
export type SkillOptimizerObjective = "profit" | "experience"
export type TriggerValueMode = "fixed" | "search"
export type TriggerSearchKind = "absolute" | "percentage"

export interface OptimizerTriggerCondition {
  dependencyHrid: string
  conditionHrid: string
  comparatorHrid: string
  value: number
  valueMode?: TriggerValueMode
  searchKind?: TriggerSearchKind
  insensitiveValues?: number[]
}

export interface TriggerPreset {
  id: string
  label: string
  checked: boolean
  conditions: OptimizerTriggerCondition[]
}

export interface SkillPoolEntry {
  abilityHrid: string
  selected: boolean
  level: number
  levelConfirmed: boolean
  presets: TriggerPreset[]
}

export interface GeneratedSkillGroup {
  id: string
  abilityHrids: string[]
  enabled: boolean
}

export interface GeneratedSkillVariant extends GeneratedSkillGroup {
  variantId: string
  triggerPresetByAbility: Record<string, TriggerPreset>
}

export interface PlayerAbilityCatalogOption {
  hrid: string
  name: string
  sortIndex: number
  special: boolean
}

export function buildPlayerAbilityCatalog(
  abilityDetails: Record<string, any>,
  abilityBooks: Record<string, any>
): PlayerAbilityCatalogOption[] {
  return Object.values(abilityDetails)
    .filter((ability: any) => ability?.hrid && Object.prototype.hasOwnProperty.call(abilityBooks, ability.hrid))
    .map((ability: any) => ({
      hrid: String(ability.hrid),
      name: String(ability.name || ability.hrid),
      sortIndex: Number(ability.sortIndex || 0),
      special: Boolean(ability.isSpecialAbility)
    }))
    .sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name))
}

export const SKILL_OPTIMIZER_CLASS_LABELS: Record<SkillOptimizerClass, string> = {
  water: "水", fire: "火", nature: "自然", sword: "剑", mace: "锤",
  spear: "枪", bow: "弓", crossbow: "弩", shield: "盾"
}

const A = (slug: string) => `/abilities/${slug}`
const D = (slug: string) => `/combat_trigger_dependencies/${slug}`
const C = (slug: string) => `/combat_trigger_conditions/${slug}`
const P = (slug: string) => `/combat_trigger_comparators/${slug}`
const ELEMENTAL_AFFINITY_HRID = A("elemental_affinity")
const HEALING_ABILITY_HRIDS = new Set([
  A("minor_heal"),
  A("heal"),
  A("quick_aid"),
  A("rejuvenate")
])

export const CLASS_SKILL_POOLS: Record<SkillOptimizerClass, string[]> = {
  water: [A("elemental_affinity"), A("frost_surge"), A("mana_spring"), A("water_strike"), A("precision"), A("ice_spear")],
  fire: [A("elemental_affinity"), A("smoke_burst"), A("firestorm"), A("flame_blast"), A("fireball"), A("precision")],
  nature: [A("elemental_affinity"), A("toxic_pollen"), A("natures_veil"), A("life_drain"), A("entangle"), A("quick_aid"), A("rejuvenate"), A("precision")],
  sword: [A("frenzy"), A("berserk"), A("precision"), A("maim"), A("crippling_slash"), A("cleave"), A("vampirism")],
  mace: [A("frenzy"), A("berserk"), A("precision"), A("fracturing_impact"), A("stunning_blow"), A("sweep"), A("vampirism")],
  spear: [A("frenzy"), A("berserk"), A("precision"), A("puncture"), A("penetrating_strike"), A("vampirism")],
  bow: [A("frenzy"), A("berserk"), A("precision"), A("rain_of_arrows"), A("steady_shot"), A("pestilent_shot"), A("penetrating_shot"), A("vampirism")],
  crossbow: [A("frenzy"), A("berserk"), A("precision"), A("rain_of_arrows"), A("steady_shot"), A("pestilent_shot"), A("penetrating_shot"), A("vampirism")],
  shield: [A("provoke"), A("elusiveness"), A("toughness"), A("spike_shell"), A("retribution"), A("fracturing_impact"), A("shield_bash")]
}

export const CLASS_FINISHERS: Partial<Record<SkillOptimizerClass, string>> = {
  water: A("water_strike"), fire: A("fireball"), nature: A("entangle")
}

export const CLASS_DEFAULT_ORDER: Record<SkillOptimizerClass, string[]> = {
  water: [A("elemental_affinity"), A("precision"), A("frost_surge"), A("mana_spring"), A("ice_spear"), A("water_strike")],
  fire: [A("elemental_affinity"), A("precision"), A("smoke_burst"), A("firestorm"), A("flame_blast"), A("fireball")],
  nature: [A("rejuvenate"), A("quick_aid"), A("elemental_affinity"), A("precision"), A("toxic_pollen"), A("natures_veil"), A("life_drain"), A("entangle")],
  sword: [A("frenzy"), A("berserk"), A("precision"), A("vampirism"), A("maim"), A("crippling_slash"), A("cleave")],
  mace: [A("frenzy"), A("berserk"), A("precision"), A("vampirism"), A("fracturing_impact"), A("stunning_blow"), A("sweep")],
  spear: [A("frenzy"), A("berserk"), A("precision"), A("vampirism"), A("puncture"), A("penetrating_strike")],
  bow: [A("frenzy"), A("berserk"), A("precision"), A("vampirism"), A("penetrating_shot"), A("rain_of_arrows"), A("pestilent_shot"), A("steady_shot")],
  crossbow: [A("frenzy"), A("berserk"), A("precision"), A("vampirism"), A("penetrating_shot"), A("rain_of_arrows"), A("pestilent_shot"), A("steady_shot")],
  shield: [A("provoke"), A("elusiveness"), A("toughness"), A("spike_shell"), A("retribution"), A("fracturing_impact"), A("shield_bash")]
}

function condition(dependency: string, status: string, comparator: string, value = 0, valueMode: TriggerValueMode = "fixed", searchKind?: TriggerSearchKind): OptimizerTriggerCondition {
  return { dependencyHrid: D(dependency), conditionHrid: C(status), comparatorHrid: P(comparator), value, valueMode, searchKind }
}

function preset(id: string, label: string, checked: boolean, conditions: OptimizerTriggerCondition[]): TriggerPreset {
  return { id, label, checked, conditions }
}

const enemyTotal = (value: number, mode: TriggerValueMode = "fixed") => condition("all_enemies", "current_hp", "greater_than_equal", value, mode, "absolute")
const targetHp = (value = 2000) => condition("targeted_enemy", "current_hp", "greater_than_equal", value, "search", "absolute")
const activeEnemies = () => condition("all_enemies", "number_of_active_units", "greater_than_equal", 2)
const lowestAllyHp = () => condition("all_allies", "lowest_hp_percentage", "less_than_equal", 75, "search", "percentage")
const missingAllyHp = () => condition("all_allies", "missing_hp", "greater_than_equal", 1000, "search", "absolute")
const buffInactive = (slug: string) => condition("self", slug, "is_inactive")
const currentMp200 = () => condition("self", "current_mp", "greater_than_equal", 200)

export function createDefaultTriggerPresets(abilityHrid: string): TriggerPreset[] {
  const slug = abilityHrid.split("/").at(-1) || ""
  if (["elemental_affinity", "frenzy", "vampirism"].includes(slug)) {
    return [
      preset("default-inactive", "效果未生效", true, [buffInactive(slug)]),
      preset("mp-safe", "效果未生效 AND MP≥200", false, [buffInactive(slug), currentMp200()])
    ]
  }
  if (["precision", "berserk"].includes(slug)) return [preset("default-inactive", "效果未生效", true, [buffInactive(slug)])]
  if (["frost_surge", "smoke_burst"].includes(slug)) {
    return [preset("always", "敌方总 HP≥1", true, [enemyTotal(1)]), preset("hp-search", "敌方总 HP≥阈值", false, [enemyTotal(2000, "search")])]
  }
  if (["mana_spring", "ice_spear", "life_drain", "entangle", "fireball"].includes(slug)) return [preset("always", "敌方总 HP≥1", true, [enemyTotal(1)])]
  if (slug === "water_strike") return [preset("empty", "空 Trigger", true, [])]
  if (["firestorm", "flame_blast"].includes(slug)) {
    return [
      preset("always", "敌方总 HP≥1", true, [enemyTotal(1)]),
      preset("hp-search", "敌方总 HP≥阈值", false, [enemyTotal(2000, "search")]),
      preset("multi-hp-search", "存活数≥2 AND 敌方总 HP≥阈值", false, [activeEnemies(), enemyTotal(2000, "search")])
    ]
  }
  if (["toxic_pollen", "natures_veil"].includes(slug)) {
    return [preset("hp-search", "敌方总 HP≥阈值", true, [enemyTotal(2000, "search")]), preset("multi", "敌方存活数≥2", true, [activeEnemies()])]
  }
  if (slug === "quick_aid") return [preset("lowest-hp", "队伍最低 HP≤阈值", true, [lowestAllyHp()]), preset("missing-hp", "队友已损失总 HP≥阈值", false, [missingAllyHp()])]
  if (slug === "rejuvenate") return [preset("missing-hp", "队友已损失总 HP≥阈值", true, [missingAllyHp()]), preset("lowest-hp", "队伍最低 HP≤阈值", true, [lowestAllyHp()])]
  if (["maim", "fracturing_impact", "puncture", "pestilent_shot", "steady_shot"].includes(slug)) return [preset("target-hp", "目标敌人当前 HP≥阈值", true, [targetHp()])]
  if (["crippling_slash", "cleave", "stunning_blow", "sweep", "penetrating_strike", "penetrating_shot", "rain_of_arrows", "shield_bash"].includes(slug)) return [preset("hp-search", "敌方总 HP≥阈值", true, [enemyTotal(2000, "search")])]
  if (["provoke", "spike_shell", "retribution"].includes(slug)) return [preset("empty", "空 Trigger", true, [])]
  if (slug === "elusiveness") return [preset("empty", "空 Trigger", true, []), preset("other-inactive", "坚韧未生效", false, [buffInactive("toughness")])]
  if (slug === "toughness") return [preset("empty", "空 Trigger", true, []), preset("other-inactive", "闪避未生效", false, [buffInactive("elusiveness")])]
  return [preset("game-default", "游戏默认 Trigger", true, clone((abilityDetailIndex as Record<string, any>)[abilityHrid]?.defaultCombatTriggers || []))]
}

export function classifyWeapon(itemHrid: string, detail = (itemDetailMap as Record<string, any>)[itemHrid]): SkillOptimizerClass | null {
  const equipment = detail?.equipmentDetail
  const type = String(equipment?.type || "")
  if (!["/equipment_types/main_hand", "/equipment_types/two_hand"].includes(type)) return null
  const stats = equipment?.combatStats || {}
  const style = String(stats.combatStyleHrids?.[0] || "")
  if (style === "/combat_styles/magic") {
    if (stats.damageType === "/damage_types/water") return "water"
    if (stats.damageType === "/damage_types/fire") return "fire"
    if (stats.damageType === "/damage_types/nature") return "nature"
  }
  if (style === "/combat_styles/slash") return "sword"
  if (style === "/combat_styles/stab") return "spear"
  if (style === "/combat_styles/ranged") return type === "/equipment_types/two_hand" ? "bow" : "crossbow"
  if (style === "/combat_styles/smash") return stats.primaryTraining === "/skills/defense" ? "shield" : "mace"
  return null
}

export function getUnlockedNormalAbilitySlotCount(intelligenceLevel: number) {
  const level = Math.max(1, Math.floor(Number(intelligenceLevel || 1)))
  return [1, 2, 3, 4].filter(index => level >= Number((abilitySlotsLevelRequirementList as number[])[index + 1] || Infinity)).length
}

export function createDefaultSkillPool(classId: SkillOptimizerClass, player: Record<string, any>): SkillPoolEntry[] {
  const equippedLevels = new Map((player?.abilities || []).map((entry: any) => [String(entry?.abilityHrid || ""), Math.max(1, Number(entry?.level || 1))]))
  const levelMap = player?.abilityLevelMap && typeof player.abilityLevelMap === "object" ? player.abilityLevelMap : {}
  return CLASS_SKILL_POOLS[classId].map(abilityHrid => {
    const imported = Number(equippedLevels.get(abilityHrid) || levelMap[abilityHrid] || 0)
    return {
      abilityHrid,
      selected: true,
      level: imported > 0 ? Math.floor(imported) : 1,
      levelConfirmed: imported > 0,
      presets: createDefaultTriggerPresets(abilityHrid)
    }
  })
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]]
  if (count < 0 || items.length < count) return []
  const result: T[][] = []
  for (let index = 0; index <= items.length - count; index += 1) {
    for (const suffix of combinations(items.slice(index + 1), count - 1)) result.push([items[index], ...suffix])
  }
  return result
}

function groupKey(hrids: string[]) {
  return [...hrids].sort().join("|")
}

export function orderSkillGroup(hrids: string[], classId: SkillOptimizerClass, globalOrder: string[] = [], override: string[] = [], lockFinisher = true) {
  const allowed = new Set(hrids)
  let ordered: string[]
  if (override.length === hrids.length && override.every(item => allowed.has(item))) {
    ordered = [...override]
  } else {
    const authored = [...globalOrder, ...CLASS_DEFAULT_ORDER[classId], ...hrids]
    const rank = new Map<string, number>()
    authored.forEach((hrid, index) => { if (!rank.has(hrid)) rank.set(hrid, index) })
    ordered = [...hrids].sort((left, right) => Number(rank.get(left) ?? 1e9) - Number(rank.get(right) ?? 1e9) || left.localeCompare(right))
  }
  if (allowed.has(ELEMENTAL_AFFINITY_HRID)) {
    const withoutAffinity = ordered.filter(item => item !== ELEMENTAL_AFFINITY_HRID)
    const healingAbilities = withoutAffinity.filter(item => HEALING_ABILITY_HRIDS.has(item))
    const remainingAbilities = withoutAffinity.filter(item => !HEALING_ABILITY_HRIDS.has(item))
    ordered = [...healingAbilities, ELEMENTAL_AFFINITY_HRID, ...remainingAbilities]
  }
  const finisher = CLASS_FINISHERS[classId]
  if (lockFinisher && finisher && allowed.has(finisher)) return [...ordered.filter(item => item !== finisher), finisher]
  return ordered
}

export function generateSkillGroups(options: {
  classId: SkillOptimizerClass
  pool: SkillPoolEntry[]
  slotCount: number
  lockFinisher?: boolean
  globalOrder?: string[]
  orderOverrides?: Record<string, string[]>
  disabledGroupIds?: Set<string>
}): GeneratedSkillGroup[] {
  const selected = options.pool.filter(item => item.selected).map(item => item.abilityHrid)
  const slotCount = Math.max(0, Math.min(4, Math.floor(options.slotCount)))
  const lockFinisher = options.lockFinisher !== false
  const finisher = CLASS_FINISHERS[options.classId]
  let rawGroups: string[][]
  if (lockFinisher && finisher && selected.includes(finisher) && slotCount > 0) {
    rawGroups = combinations(selected.filter(item => item !== finisher), slotCount - 1).map(items => [...items, finisher])
  } else {
    rawGroups = combinations(selected, slotCount)
  }
  return rawGroups.map(hrids => {
    const id = groupKey(hrids)
    return {
      id,
      abilityHrids: orderSkillGroup(hrids, options.classId, options.globalOrder, options.orderOverrides?.[id], lockFinisher),
      enabled: !options.disabledGroupIds?.has(id)
    }
  })
}

export function expandSkillGroupTriggerVariants(group: GeneratedSkillGroup, pool: SkillPoolEntry[]): GeneratedSkillVariant[] {
  const byAbility = new Map(pool.map(entry => [entry.abilityHrid, entry]))
  let rows: Array<Record<string, TriggerPreset>> = [{}]
  for (const abilityHrid of group.abilityHrids) {
    const presets = byAbility.get(abilityHrid)?.presets.filter(item => item.checked) || []
    const choices = presets.length ? presets : [preset("empty", "空 Trigger", true, [])]
    rows = rows.flatMap(row => choices.map(choice => ({ ...row, [abilityHrid]: clone(choice) })))
  }
  return rows.map((triggerPresetByAbility, index) => ({ ...group, variantId: `${group.id}::${index + 1}`, triggerPresetByAbility }))
}

export function materializeTriggerConditions(conditions: OptimizerTriggerCondition[]) {
  return conditions.slice(0, 4).map(({ dependencyHrid, conditionHrid, comparatorHrid, value }) => ({ dependencyHrid, conditionHrid, comparatorHrid, value: Number(value || 0) }))
}

export function absoluteThresholdGrid(maxValue: number, step = 1000) {
  const safeStep = Math.max(1, Math.floor(step))
  const max = Math.max(safeStep, Math.ceil(Math.max(0, maxValue) / safeStep) * safeStep)
  return [...new Set([1, ...Array.from({ length: max / safeStep }, (_, index) => (index + 1) * safeStep), max + safeStep])]
}

export function fineAbsoluteThresholdGrid(bestValue: number, maxValue: number, radius = 1000, step = 200) {
  const upper = Math.max(step, Math.ceil(Math.max(0, maxValue) / step) * step + step)
  const start = Math.max(1, Math.floor((bestValue - radius) / step) * step)
  const end = Math.min(upper, Math.ceil((bestValue + radius) / step) * step)
  const values: number[] = []
  for (let value = start; value <= end; value += step) values.push(value <= 0 ? 1 : value)
  values.push(Math.max(1, Math.floor(bestValue)))
  return [...new Set(values)].sort((left, right) => left - right)
}

export function percentageThresholdGrid(step = 10) {
  return Array.from({ length: Math.floor(100 / step) + 1 }, (_, index) => index * step)
}

function monsterMaxHp(monsterHrid: string, difficultyTier: number) {
  try {
    const monster = new Monster(monsterHrid, difficultyTier)
    monster.updateCombatDetails()
    return Math.max(1, Number(monster.combatDetails?.maxHitpoints || 1))
  } catch {
    return 1
  }
}

function randomEncounterBounds(info: any, selectedDifficulty: number) {
  if (!info || !Array.isArray(info.spawns) || !info.spawns.length) return { total: 1, single: 1 }
  const maxCount = Math.max(1, Math.floor(Number(info.maxSpawnCount || 1)))
  const maxStrength = Math.max(0, Number(info.maxTotalStrength || Infinity))
  let maxTotal = 1
  let maxSingle = 1
  const visit = (count: number, strength: number, totalHp: number) => {
    maxTotal = Math.max(maxTotal, totalHp)
    if (count >= maxCount) return
    for (const spawn of info.spawns) {
      const nextStrength = strength + Math.max(0, Number(spawn.strength || 0))
      if (nextStrength > maxStrength) continue
      const hp = monsterMaxHp(String(spawn.combatMonsterHrid || ""), selectedDifficulty + Number(spawn.difficultyTier || 0))
      maxSingle = Math.max(maxSingle, hp)
      visit(count + 1, nextStrength, totalHp + hp)
    }
  }
  visit(0, 0, 0)
  return { total: maxTotal, single: maxSingle }
}

export function estimateEnemyHpBounds(targetHrid: string, difficultyTier: number) {
  const action = (actionDetailMap as Record<string, any>)[targetHrid]
  const zone = action?.combatZoneInfo
  if (!zone) return { enemyTotalHp: 10_000, targetHp: 10_000 }
  const bounds: Array<{ total: number, single: number }> = []
  const fightInfo = zone.fightInfo || {}
  bounds.push(randomEncounterBounds(fightInfo.randomSpawnInfo, difficultyTier))
  for (const boss of fightInfo.bossSpawns || []) {
    const hp = monsterMaxHp(String(boss.combatMonsterHrid || boss.hrid || ""), difficultyTier + Number(boss.difficultyTier || 0))
    bounds.push({ total: hp, single: hp })
  }
  const dungeon = zone.dungeonInfo || {}
  for (const info of Object.values(dungeon.randomSpawnInfoMap || {})) bounds.push(randomEncounterBounds(info, difficultyTier))
  for (const monsters of Object.values(dungeon.fixedSpawnsMap || {}) as any[]) {
    const values = (Array.isArray(monsters) ? monsters : []).map(monster => monsterMaxHp(
      String(monster.combatMonsterHrid || monster.hrid || ""), difficultyTier + Number(monster.difficultyTier || 0)
    ))
    if (values.length) bounds.push({ total: values.reduce((sum, value) => sum + value, 0), single: Math.max(...values) })
  }
  return {
    enemyTotalHp: Math.max(1, ...bounds.map(item => item.total)),
    targetHp: Math.max(1, ...bounds.map(item => item.single))
  }
}

export function finePercentageThresholdGrid(bestValue: number, radius = 10, step = 5) {
  const start = Math.max(0, Math.floor(bestValue - radius))
  const end = Math.min(100, Math.ceil(bestValue + radius))
  const values: number[] = []
  for (let value = start; value <= end; value += step) values.push(value)
  return values
}

export function initialPartyMissingHpThreshold(totalMaxHp: number, fallback = 1000) {
  return totalMaxHp > 0 ? Math.max(1, Math.round(totalMaxHp * 0.25)) : fallback
}

function triggerConditionSearchSignature(condition: OptimizerTriggerCondition) {
  const valueMode = condition.valueMode === "search" ? "search" : "fixed"
  const comparator = String(condition.comparatorHrid || "")
  const valueKey = valueMode === "search"
    ? String(condition.searchKind || "absolute")
    : (["/combat_trigger_comparators/greater_than_equal", "/combat_trigger_comparators/less_than_equal"].includes(comparator)
        ? String(Number(condition.value || 0))
        : "no-value")
  return JSON.stringify([
    String(condition.dependencyHrid || ""),
    String(condition.conditionHrid || ""),
    comparator,
    valueMode,
    valueKey
  ])
}

export function triggerPresetSearchSignature(preset: TriggerPreset) {
  if (!preset.conditions.some(condition => condition.valueMode === "search")) return ""
  return JSON.stringify(preset.conditions.map(triggerConditionSearchSignature).sort())
}

export function wouldDuplicateTriggerSearch(
  presets: TriggerPreset[],
  preset: TriggerPreset,
  conditionIndex: number
) {
  const candidate = clone(preset)
  const condition = candidate.conditions[conditionIndex]
  if (!condition) return false
  condition.valueMode = "search"
  const signature = triggerPresetSearchSignature(candidate)
  return Boolean(signature && presets.some(other => (
    other !== preset && triggerPresetSearchSignature(other) === signature
  )))
}

export function copyTriggerPresetForTesting(source: TriggerPreset, id: string): TriggerPreset {
  const copied = clone(source)
  return {
    ...copied,
    id,
    label: `${source.label || "Trigger 方案"} 副本`,
    checked: true,
    conditions: copied.conditions.map(condition => {
      const { insensitiveValues: _insensitiveValues, ...cleanCondition } = condition
      return {
        ...cleanCondition,
        valueMode: condition.valueMode === "search" ? "fixed" : condition.valueMode
      }
    })
  }
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
