import abilityDetailMap from "@/combat/combatsimulator/data/abilityDetailMap.json"
import itemDetailMap from "@/combat/combatsimulator/data/itemDetailMap.json"
import { copyTrialBuildings, copyCharacterGuildBuffs, effectiveTrialSkillLevel, type GuildTrialBuildingProfile } from "../shared/guildTrialProfile"

export const GUILD_TRIAL_START_LEVEL = 100
export const GUILD_TRIAL_MAX_LEVEL = 300
export const GUILD_TRIAL_TIME_LIMIT_MINUTES = 60

export const GUILD_TRIAL_ENCOUNTERS = [
  { hrid: "/guild_trial_encounters/badger", name: "试炼獾" },
  { hrid: "/guild_trial_encounters/chameleon", name: "试炼变色龙" },
  { hrid: "/guild_trial_encounters/jellyfish", name: "试炼水母" },
  { hrid: "/guild_trial_encounters/hedgehog", name: "试炼刺猬" },
  { hrid: "/guild_trial_encounters/swarm", name: "试炼虫群" }
] as const

export const GUILD_TRIAL_ROLE_OPTIONS = [
  "烟灭火", "精准火", "纯精准火", "AOE火",
  "常规水", "精准水", "疯狂水",
  "群奶自然", "三攻自然",
  "精准弓", "疫病弓", "AOE弩", "疫病弩",
  "坚韧盾", "碎裂盾", "精准盾",
  "精准枪", "常规枪", "精准剑", "常规剑", "精准锤", "重扫锤"
] as const

export const GUILD_TRIAL_PROFESSIONS = [
  { key: "fire", name: "火", mainSkill: "magic", roleTag: "精准火", weapon: "blazing_trident", offhand: "bishops_codex", abilities: ["revive", "elemental_affinity", "precision", "firestorm", "fireball"] },
  { key: "water", name: "水", mainSkill: "magic", roleTag: "精准水", weapon: "rippling_trident", offhand: "bishops_codex", abilities: ["insanity", "precision", "mana_spring", "frost_surge", "water_strike"] },
  { key: "nature", name: "自然", mainSkill: "magic", roleTag: "群奶自然", weapon: "blooming_trident", offhand: "bishops_codex", abilities: ["revive", "rejuvenate", "precision", "toxic_pollen", "entangle"] },
  { key: "bow", name: "弓", mainSkill: "ranged", roleTag: "疫病弓", weapon: "cursed_bow", abilities: ["revive", "frenzy", "berserk", "precision", "pestilent_shot"] },
  { key: "crossbow", name: "弩", mainSkill: "ranged", roleTag: "疫病弩", weapon: "sundering_crossbow", offhand: "manticore_shield", abilities: ["revive", "frenzy", "berserk", "precision", "penetrating_shot"] },
  { key: "shield", name: "盾", mainSkill: "defense", roleTag: "坚韧盾", weapon: "griffin_bulwark", abilities: ["invincible", "provoke", "toughness", "elusiveness", "fracturing_impact"] },
  { key: "spear", name: "枪", mainSkill: "melee", roleTag: "精准枪", weapon: "furious_spear", offhand: "knights_aegis", abilities: ["revive", "frenzy", "berserk", "precision", "puncture"] },
  { key: "sword", name: "剑", mainSkill: "melee", roleTag: "常规剑", weapon: "regal_sword", offhand: "knights_aegis", abilities: ["revive", "berserk", "precision", "maim", "crippling_slash"] },
  { key: "mace", name: "锤", mainSkill: "melee", roleTag: "重扫锤", weapon: "chaotic_flail", offhand: "knights_aegis", abilities: ["revive", "frenzy", "berserk", "precision", "fracturing_impact"] }
] as const

export interface GuildTrialEquipment {
  itemLocationHrid: string
  itemHrid: string
  enhancementLevel: number
}

export interface GuildTrialAbility {
  abilityHrid: string
  level: number
}

export interface GuildTrialTrigger {
  dependencyHrid: string
  conditionHrid: string
  comparatorHrid: string
  value: number
}

export interface GuildTrialCombatBuild {
  equipment: GuildTrialEquipment[]
  abilityHrids: string[]
  abilityCombatTriggersMap?: Record<string, GuildTrialTrigger[]>
}

export interface GuildTrialLoadoutEquipmentReference {
  itemLocationHrid: string
  itemHrid: string
}

export interface GuildTrialCombatLoadout {
  id: string
  name: string
  ordinal: number
  isDefault?: boolean
  equipment: GuildTrialLoadoutEquipmentReference[]
  abilityHrids: string[]
  abilityCombatTriggersMap?: Record<string, GuildTrialTrigger[]>
}

export interface GuildTrialLoadoutItem {
  itemHrid: string
  enhancementLevel: number
}

export interface GuildTrialProfile extends GuildTrialBuildingProfile {
  characterId: number
  characterName: string
  guildId?: number
  capturedAt?: string | null
  updatedAt?: string | null
  skills?: Record<string, number>
  equipment?: GuildTrialEquipment[]
  abilities?: GuildTrialAbility[]
  learnedAbilities?: GuildTrialAbility[]
  auras?: Record<string, number>
  guildBuffs?: Record<string, number>
  houseRooms?: Record<string, number>
  achievements?: Record<string, boolean>
  communityBuffs?: Record<string, number>
  selfUploaded?: boolean
  currentCombatBuild?: GuildTrialCombatBuild | null
  combatLoadouts?: GuildTrialCombatLoadout[]
  loadoutItems?: GuildTrialLoadoutItem[]
}

export interface GuildTrialRosterEntry {
  characterId: number
  characterName: string
  collected: boolean
  capturedAt?: string | null
  updatedAt?: string | null
  selfUploaded?: boolean
  learnedAbilities?: GuildTrialAbility[]
  currentCombatBuild?: GuildTrialCombatBuild | null
  combatLoadouts?: GuildTrialCombatLoadout[]
  loadoutItems?: GuildTrialLoadoutItem[]
  selectedLoadoutId?: string
  abilityCombatTriggersMap?: Record<string, GuildTrialTrigger[]>
}

export interface GuildTrialFeed {
  viewer: { characterId: number, characterName: string, guildId: number, guildName: string }
  guildId: number
  generatedAt: string
  guildMemberProfiles?: GuildTrialProfile[]
  memberProfiles?: GuildTrialProfile[]
  guildRoster?: GuildTrialRosterEntry[]
  sessionExpiresAt?: string
}

export interface NativeGuildTrialMember extends GuildTrialBuildingProfile {
  characterId: number
  characterName: string
  capturedAt: string | null
  equipment: GuildTrialEquipment[]
  abilities: GuildTrialAbility[]
  skills: Record<string, number>
  auras?: Record<string, number>
  guildBuffs: Record<string, number>
  houseRooms: Record<string, number>
  achievements: Record<string, boolean>
  communityBuffs: Record<string, number>
  assignedAuraHrid?: string
  assignedAuraLevelOverride?: number
  selected: boolean
  roleTag: string
  powerScore: number
  selfUploaded?: boolean
  learnedAbilities?: GuildTrialAbility[]
  currentCombatBuild?: GuildTrialCombatBuild | null
  combatLoadouts?: GuildTrialCombatLoadout[]
  loadoutItems?: GuildTrialLoadoutItem[]
  selectedLoadoutId?: string
  abilityCombatTriggersMap?: Record<string, GuildTrialTrigger[]>
}

export interface GuildTrialTeam {
  id: "boss-1" | "boss-2"
  encounterHrid: string
  memberIds: number[]
  powerScore: number
}

export interface GuildTrialLineupCandidateSet {
  assignmentCount: bigint
  eligibleCount: number
  movableCount: number
  candidateAt: (index: bigint) => [GuildTrialTeam, GuildTrialTeam] | null
}

export type GuildTrialCountOperator = "gte" | "lte"
export type GuildTrialProfessionOperator = GuildTrialCountOperator | "balance"
export type GuildTrialSkillOperator = "required" | "forbidden" | GuildTrialCountOperator

export interface GuildTrialLevelRule {
  professionKey: "all" | string
  operator: GuildTrialCountOperator
  value: number
}

export interface GuildTrialProfessionRule {
  id: string
  professionKey: string
  operator: GuildTrialProfessionOperator
  value: number
}

export interface GuildTrialSkillRule {
  id: string
  professionKey: "all" | string
  abilityHrid: string
  operator: GuildTrialSkillOperator
  value: number
}

export interface GuildTrialAssignedAuraRule {
  id: string
  memberId: number
  abilityHrid: string
  abilityLevel?: number
}

export interface GuildTrialAllocationRules {
  levels: GuildTrialLevelRule[]
  professions: GuildTrialProfessionRule[]
  skills: GuildTrialSkillRule[]
  assignedAuras?: GuildTrialAssignedAuraRule[]
}

export type GuildTrialRulesByBoss = GuildTrialAllocationRules | [GuildTrialAllocationRules, GuildTrialAllocationRules]

export interface GuildTrialRuleViolation {
  code: string
  message: string
  teamIndex?: number
  memberId?: number
}

export const DEFAULT_GUILD_TRIAL_RULES: GuildTrialAllocationRules = {
  levels: [{ professionKey: "all", operator: "gte", value: 110 }],
  professions: [
    { id: "default-shield-balance", professionKey: "shield", operator: "balance", value: 0 },
    { id: "default-nature-balance", professionKey: "nature", operator: "balance", value: 0 }
  ],
  skills: [
    { id: "default-water-insanity", professionKey: "water", abilityHrid: "/abilities/insanity", operator: "required", value: 1 },
    { id: "default-nature-rejuvenate", professionKey: "nature", abilityHrid: "/abilities/rejuvenate", operator: "required", value: 1 }
  ],
  assignedAuras: []
}

function rulesForBoss(rules: GuildTrialRulesByBoss, teamIndex: number) {
  return Array.isArray(rules) ? rules[teamIndex] : rules
}

const abilityIndex = abilityDetailMap as Record<string, any>
const itemIndex = itemDetailMap as Record<string, any>

function cloneGuildTrialJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
const AURA_NAMES: Record<string, string> = {
  "/abilities/guardian_aura": "守护光环",
  "/abilities/critical_aura": "暴击光环",
  "/abilities/speed_aura": "速度光环",
  "/abilities/fierce_aura": "物理光环",
  "/abilities/mystic_aura": "元素光环"
}
export const GUILD_TRIAL_AURA_HRIDS = Object.keys(AURA_NAMES)

export function guildTrialAuraName(abilityHrid: string) {
  return AURA_NAMES[abilityHrid] || abilityRuleName(abilityHrid)
}

function combatAbilities(profile: GuildTrialProfile) {
  return [...(profile.abilities || profile.learnedAbilities || [])]
    .filter(item => item?.abilityHrid)
    .map(item => ({ abilityHrid: String(item.abilityHrid), level: Math.max(1, Number(item.level) || 1) }))
}

function defaultProfessionAbilities(professionKey: string, profile?: GuildTrialProfile): GuildTrialAbility[] {
  const profession = GUILD_TRIAL_PROFESSIONS.find(item => item.key === professionKey) || GUILD_TRIAL_PROFESSIONS[0]
  const learnedLevels = new Map<string, number>()
  for (const ability of [...(profile?.learnedAbilities || []), ...(profile?.abilities || [])]) {
    const abilityHrid = String(ability?.abilityHrid || "")
    const level = Number(ability?.level)
    if (!abilityHrid || !Number.isFinite(level) || level <= 0) continue
    learnedLevels.set(abilityHrid, Math.max(learnedLevels.get(abilityHrid) || 0, Math.floor(level)))
  }
  return profession.abilities.map(slug => {
    const abilityHrid = `/abilities/${slug}`
    return { abilityHrid, level: learnedLevels.get(abilityHrid) || 60 }
  })
}

function learnedAbilityLevelMap(profile?: GuildTrialProfile) {
  const levels = new Map<string, number>()
  for (const ability of [...(profile?.learnedAbilities || []), ...(profile?.abilities || [])]) {
    const abilityHrid = String(ability?.abilityHrid || "")
    const level = Number(ability?.level)
    if (!abilityHrid || !Number.isFinite(level) || level <= 0) continue
    levels.set(abilityHrid, Math.max(levels.get(abilityHrid) || 0, Math.floor(level)))
  }
  return levels
}

export function guildTrialAbilitiesForHrids(profile: GuildTrialProfile, abilityHrids: string[]) {
  const levels = learnedAbilityLevelMap(profile)
  return abilityHrids.filter(Boolean).slice(0, 5).map(abilityHrid => ({
    abilityHrid,
    level: levels.get(abilityHrid) || 60
  }))
}

function mainWeapon(profile: GuildTrialProfile) {
  return (profile.equipment || []).find(item => /\/(?:main_hand|two_hand)$/.test(item.itemLocationHrid))?.itemHrid || ""
}

export function hasGuildTrialLevel95Weapon(profile: Pick<GuildTrialProfile, "equipment">) {
  const weapon = mainWeapon(profile as GuildTrialProfile)
  return GUILD_TRIAL_PROFESSIONS.some(profession => {
    const baseHrid = `/items/${profession.weapon}`
    return weapon === baseHrid || weapon.startsWith(`${baseHrid}_`)
  })
}

function hasAbility(abilities: GuildTrialAbility[], slug: string) {
  return abilities.some(item => item.abilityHrid === `/abilities/${slug}`)
}

export function inferGuildTrialRole(profile: GuildTrialProfile) {
  const weapon = mainWeapon(profile)
  const abilities = combatAbilities(profile)
  if (weapon.includes("blazing_trident")) {
    if (hasAbility(abilities, "smoke_burst")) return "烟灭火"
    if (hasAbility(abilities, "firestorm")) return "AOE火"
    return hasAbility(abilities, "precision") ? "精准火" : "纯精准火"
  }
  if (weapon.includes("rippling_trident")) {
    if (hasAbility(abilities, "insanity")) return "疯狂水"
    return hasAbility(abilities, "precision") ? "精准水" : "常规水"
  }
  if (weapon.includes("blooming_trident")) {
    return hasAbility(abilities, "rejuvenate") || hasAbility(abilities, "quick_aid") ? "群奶自然" : "三攻自然"
  }
  if (weapon.includes("crossbow")) {
    return hasAbility(abilities, "pestilent_shot") ? "疫病弩" : "AOE弩"
  }
  if (weapon.includes("cursed_bow") || weapon.includes("bow")) {
    return hasAbility(abilities, "pestilent_shot") ? "疫病弓" : "精准弓"
  }
  if (weapon.includes("bulwark")) {
    if (hasAbility(abilities, "fracturing_impact")) return "碎裂盾"
    return hasAbility(abilities, "precision") ? "精准盾" : "坚韧盾"
  }
  if (weapon.includes("spear")) return hasAbility(abilities, "precision") ? "精准枪" : "常规枪"
  if (weapon.includes("sword")) return hasAbility(abilities, "precision") ? "精准剑" : "常规剑"
  if (weapon.includes("flail") || weapon.includes("bludgeon")) return hasAbility(abilities, "precision") ? "精准锤" : "重扫锤"
  return "常规剑"
}

export function guildTrialAuraStrength(
  member: Pick<NativeGuildTrialMember, "skills" | "auras"> & Partial<Pick<NativeGuildTrialMember, "houseRooms" | "guildBuildingLevels">>,
  abilityHrid: string,
  levelOverride?: number
) {
  const level = Math.max(0, Number(levelOverride) || Number(member.auras?.[abilityHrid]) || 0)
  const ability = abilityIndex[abilityHrid]
  if (!ability || level <= 0) return 0
  return (ability.abilityEffects || [])
    .flatMap((effect: any) => effect.buffs || [])
    .reduce((total: number, buff: any) => {
      const skillLevel = effectiveTrialSkillLevel(member, String(buff.multiplierForSkillHrid || ""))
      const multiplier = buff.multiplierForSkillHrid && Number(buff.multiplierPerSkillLevel || 0) > 0
        ? 1 + skillLevel * Number(buff.multiplierPerSkillLevel || 0)
        : 1
      const flatBoost = (Number(buff.flatBoost || 0) + (level - 1) * Number(buff.flatBoostLevelBonus || 0)) * multiplier
      const ratioBoost = (Number(buff.ratioBoost || 0) + (level - 1) * Number(buff.ratioBoostLevelBonus || 0)) * multiplier
      return total + Math.abs(flatBoost) + Math.abs(ratioBoost)
    }, 0)
}

export function guildTrialAura(member: Pick<NativeGuildTrialMember, "assignedAuraHrid" | "assignedAuraLevelOverride" | "auras" | "skills"> & Partial<Pick<NativeGuildTrialMember, "houseRooms" | "guildBuildingLevels">>) {
  const hrid = String(member.assignedAuraHrid || "")
  if (!AURA_NAMES[hrid]) return null
  const level = Math.max(0, Number(member.assignedAuraLevelOverride) || Number(member.auras?.[hrid]) || 0)
  return {
    hrid,
    name: AURA_NAMES[hrid],
    level,
    strength: guildTrialAuraStrength(member, hrid, level)
  }
}

export function guildTrialMemberProfession(member: Pick<NativeGuildTrialMember, "equipment" | "roleTag" | "skills">) {
  const weapon = member.equipment.find(item => /\/(?:main_hand|two_hand)$/.test(item.itemLocationHrid))?.itemHrid || ""
  const detail = itemIndex[weapon]
  const combatStats = detail?.equipmentDetail?.combatStats || {}
  const primaryTraining = String(combatStats.primaryTraining || detail?.equipmentDetail?.levelRequirements?.[0]?.skillHrid || "")
  const combatStyles = (combatStats.combatStyleHrids || []).map(String)
  const damageType = String(combatStats.damageType || "")
  const equipmentType = String(detail?.equipmentDetail?.type || "")
  let professionKey = ""
  if (primaryTraining === "/skills/magic" || combatStyles.includes("/combat_styles/magic")) {
    professionKey = damageType.endsWith("/fire") ? "fire" : damageType.endsWith("/nature") ? "nature" : "water"
  } else if (primaryTraining === "/skills/ranged" || combatStyles.includes("/combat_styles/ranged")) {
    professionKey = equipmentType === "/equipment_types/two_hand" ? "bow" : "crossbow"
  } else if (primaryTraining === "/skills/defense" || "defensiveDamage" in combatStats) {
    professionKey = "shield"
  } else if (primaryTraining === "/skills/attack" || combatStyles.includes("/combat_styles/stab")) {
    professionKey = "spear"
  } else if (combatStyles.includes("/combat_styles/smash")) {
    professionKey = "mace"
  } else if (primaryTraining === "/skills/melee" || combatStyles.includes("/combat_styles/slash")) {
    professionKey = "sword"
  }
  const profession = GUILD_TRIAL_PROFESSIONS.find(item => item.key === professionKey)
    || GUILD_TRIAL_PROFESSIONS.find(item => weapon.includes(item.weapon))
    || GUILD_TRIAL_PROFESSIONS.find(item => member.roleTag.includes(item.name))
    || (member.roleTag.includes("自然") ? GUILD_TRIAL_PROFESSIONS[2] : GUILD_TRIAL_PROFESSIONS[7])
  const level = Number(member.skills[`/skills/${profession.mainSkill}`]) || 1
  const skillNames: Record<string, string> = { magic: "魔法", ranged: "远程", melee: "近战", defense: "防御" }
  return {
    ...profession,
    actualWeaponItemHrid: weapon,
    iconItemHrid: `/items/${profession.weapon}`,
    mainSkillName: skillNames[profession.mainSkill] || profession.mainSkill,
    level
  }
}

export type GuildTrialWeaponStatus = "ok" | "missing" | "mismatch"

function weaponMainSkill(itemHrid: string) {
  const detail = itemIndex[itemHrid]
  const combatStats = detail?.equipmentDetail?.combatStats || {}
  const primaryTraining = String(combatStats.primaryTraining || detail?.equipmentDetail?.levelRequirements?.[0]?.skillHrid || "")
  const combatStyles = (combatStats.combatStyleHrids || []).map(String)
  if (primaryTraining === "/skills/magic" || combatStyles.includes("/combat_styles/magic")) return "magic"
  if (primaryTraining === "/skills/ranged" || combatStyles.includes("/combat_styles/ranged")) return "ranged"
  if (primaryTraining === "/skills/defense" || "defensiveDamage" in combatStats) return "defense"
  if (primaryTraining === "/skills/attack" || primaryTraining === "/skills/melee"
    || combatStyles.some((style: string) => ["/combat_styles/stab", "/combat_styles/slash", "/combat_styles/smash"].includes(style))) return "melee"
  return GUILD_TRIAL_PROFESSIONS.find(profession => itemHrid.includes(profession.weapon))?.mainSkill || ""
}

export function guildTrialWeaponStatus(member: Pick<NativeGuildTrialMember, "equipment" | "skills">): GuildTrialWeaponStatus {
  const weapon = member.equipment.find(item => /\/(?:main_hand|two_hand)$/.test(item.itemLocationHrid))?.itemHrid || ""
  if (!weapon) return "missing"
  const actualMainSkill = weaponMainSkill(weapon)
  if (!actualMainSkill) return "mismatch"
  const mainSkills = ["magic", "ranged", "melee", "defense"]
  const highestLevel = Math.max(...mainSkills.map(skill => Number(member.skills[`/skills/${skill}`]) || 0))
  const accepted = new Set(mainSkills.filter(skill => (Number(member.skills[`/skills/${skill}`]) || 0) === highestLevel))
  return accepted.has(actualMainSkill) ? "ok" : "mismatch"
}

export function guildTrialMemberRuleLevel(
  member: Pick<NativeGuildTrialMember, "equipment" | "roleTag" | "skills">
) {
  return guildTrialMemberProfession(member).level
}

function professionForRule(member: NativeGuildTrialMember) {
  return guildTrialMemberProfession(member).key
}

function memberCarriesAbility(member: NativeGuildTrialMember, abilityHrid: string) {
  if (abilityIndex[abilityHrid]?.isSpecialAbility && member.assignedAuraHrid) {
    return member.assignedAuraHrid === abilityHrid
  }
  return member.abilities.some(ability => ability.abilityHrid === abilityHrid)
}

function skillRuleApplies(member: NativeGuildTrialMember, rule: GuildTrialSkillRule) {
  return rule.professionKey === "all" || professionForRule(member) === rule.professionKey
}

function abilityRuleName(abilityHrid: string) {
  return String(abilityIndex[abilityHrid]?.name || abilityHrid.replace("/abilities/", ""))
}

function professionRuleName(professionKey: string) {
  return GUILD_TRIAL_PROFESSIONS.find(profession => profession.key === professionKey)?.name || professionKey
}

export function guildTrialMemberEligibilityViolations(
  member: NativeGuildTrialMember,
  rules: GuildTrialAllocationRules = DEFAULT_GUILD_TRIAL_RULES
) {
  const violations: GuildTrialRuleViolation[] = []
  const level = guildTrialMemberRuleLevel(member)
  const levelRules = Array.isArray(rules.levels) && rules.levels.length ? rules.levels : DEFAULT_GUILD_TRIAL_RULES.levels
  for (const [index, levelRule] of levelRules.entries()) {
    const levelRuleApplies = levelRule.professionKey === "all" || professionForRule(member) === levelRule.professionKey
    const threshold = Math.max(1, Number(levelRule.value) || 1)
    if (levelRuleApplies && levelRule.operator === "gte" && level < threshold) {
      violations.push({
        code: `level_minimum:${index}`,
        memberId: member.characterId,
        message: `${member.characterName} 的主属性等级 ${level} 低于要求 ${threshold}`
      })
    } else if (levelRuleApplies && levelRule.operator === "lte" && level > threshold) {
      violations.push({
        code: `level_maximum:${index}`,
        memberId: member.characterId,
        message: `${member.characterName} 的主属性等级 ${level} 高于要求 ${threshold}`
      })
    }
  }
  for (const rule of rules.skills || []) {
    if (!skillRuleApplies(member, rule)) continue
    const carries = memberCarriesAbility(member, rule.abilityHrid)
    if (rule.operator === "required" && !carries) {
      violations.push({
        code: `skill_required:${rule.id}`,
        memberId: member.characterId,
        message: `${member.characterName} 必须携带 ${abilityRuleName(rule.abilityHrid)}`
      })
    } else if (rule.operator === "forbidden" && carries) {
      violations.push({
        code: `skill_forbidden:${rule.id}`,
        memberId: member.characterId,
        message: `${member.characterName} 必须不携带 ${abilityRuleName(rule.abilityHrid)}`
      })
    }
  }
  return violations
}

export function guildTrialRuleViolations(
  teams: GuildTrialTeam[],
  members: NativeGuildTrialMember[],
  rules: GuildTrialRulesByBoss = DEFAULT_GUILD_TRIAL_RULES,
  rosterLimit = 40
) {
  const byId = new Map(members.map(member => [member.characterId, member]))
  const violations: GuildTrialRuleViolation[] = specifiedAuraConfigurationViolations(rules)
  teams.forEach((team, teamIndex) => {
    const teamRules = rulesForBoss(rules, teamIndex)
    const teamMembers = team.memberIds.map(id => byId.get(id)).filter((member): member is NativeGuildTrialMember => Boolean(member))
    if (teamMembers.length > rosterLimit) {
      violations.push({ code: "roster_limit", teamIndex, message: `Boss ${teamIndex + 1} 超过 ${rosterLimit} 人上限` })
    }
    for (const rule of teamRules.assignedAuras || []) {
      const member = byId.get(Number(rule.memberId))
      if (!member) {
        violations.push({ code: `assigned_aura_member_missing:${rule.id}`, teamIndex, memberId: Number(rule.memberId), message: `Boss ${teamIndex + 1} 指定的光环成员不在已选名单中` })
      } else if (!team.memberIds.includes(member.characterId)) {
        violations.push({ code: `assigned_aura_wrong_team:${rule.id}`, teamIndex, memberId: member.characterId, message: `${member.characterName} 被指定为 Boss ${teamIndex + 1} 的${guildTrialAuraName(rule.abilityHrid)}携带者，不能分到另一边` })
      } else if (member.assignedAuraHrid !== rule.abilityHrid) {
        violations.push({ code: `assigned_aura_mismatch:${rule.id}`, teamIndex, memberId: member.characterId, message: `${member.characterName} 必须携带 ${guildTrialAuraName(rule.abilityHrid)}` })
      }
    }
    for (const member of teamMembers) {
      for (const violation of guildTrialMemberEligibilityViolations(member, teamRules)) {
        violations.push({ ...violation, teamIndex })
      }
    }
    for (const rule of teamRules.professions || []) {
      const count = teamMembers.filter(member => professionForRule(member) === rule.professionKey).length
      const value = Math.max(0, Math.floor(Number(rule.value) || 0))
      const name = professionRuleName(rule.professionKey)
      if (rule.operator === "gte" && count < value) {
        violations.push({ code: `profession_gte:${rule.id}`, teamIndex, message: `Boss ${teamIndex + 1} 的${name}职业至少需要 ${value} 人（当前 ${count} 人）` })
      } else if (rule.operator === "lte" && count > value) {
        violations.push({ code: `profession_lte:${rule.id}`, teamIndex, message: `Boss ${teamIndex + 1} 的${name}职业最多允许 ${value} 人（当前 ${count} 人）` })
      }
    }
    for (const rule of teamRules.skills || []) {
      if (rule.operator !== "gte" && rule.operator !== "lte") continue
      const scoped = teamMembers.filter(member => skillRuleApplies(member, rule))
      const count = scoped.filter(member => memberCarriesAbility(member, rule.abilityHrid)).length
      const value = Math.max(0, Math.floor(Number(rule.value) || 0))
      const scope = rule.professionKey === "all" ? "所有人" : `${professionRuleName(rule.professionKey)}职业`
      const ability = abilityRuleName(rule.abilityHrid)
      if (rule.operator === "gte" && count < value) {
        violations.push({ code: `skill_gte:${rule.id}`, teamIndex, message: `Boss ${teamIndex + 1} 的${scope}至少需要 ${value} 人携带 ${ability}（当前 ${count} 人）` })
      } else if (rule.operator === "lte" && count > value) {
        violations.push({ code: `skill_lte:${rule.id}`, teamIndex, message: `Boss ${teamIndex + 1} 的${scope}最多允许 ${value} 人携带 ${ability}（当前 ${count} 人）` })
      }
    }
  })
  const balanceProfessions = new Set(teams.flatMap((_, teamIndex) => (rulesForBoss(rules, teamIndex).professions || [])
    .filter(rule => rule.operator === "balance")
    .map(rule => rule.professionKey)))
  for (const professionKey of balanceProfessions) {
    const counts = teams.map(team => team.memberIds
      .map(id => byId.get(id))
      .filter((member): member is NativeGuildTrialMember => Boolean(member))
      .filter(member => professionForRule(member) === professionKey).length)
    if (Math.abs(counts[0] - counts[1]) > 1) {
      violations.push({
        code: `profession_balance:${professionKey}`,
        message: `${professionRuleName(professionKey)}职业需要尽量平均分配（当前 ${counts[0]} / ${counts[1]}）`
      })
    }
  }
  return violations
}

function specifiedAuraConfigurationViolations(rules: GuildTrialRulesByBoss) {
  const violations: GuildTrialRuleViolation[] = []
  const assignedTeamByMember = new Map<number, number>()
  for (let teamIndex = 0; teamIndex < 2; teamIndex += 1) {
    const seenOnTeam = new Set<number>()
    for (const rule of rulesForBoss(rules, teamIndex).assignedAuras || []) {
      const memberId = Number(rule.memberId)
      if (!memberId) continue
      if (seenOnTeam.has(memberId)) {
        violations.push({ code: `assigned_aura_duplicate:${memberId}`, teamIndex, memberId, message: `同一成员不能在 Boss ${teamIndex + 1} 同时携带多个光环` })
      }
      seenOnTeam.add(memberId)
      const previousTeam = assignedTeamByMember.get(memberId)
      if (previousTeam != null && previousTeam !== teamIndex) {
        violations.push({ code: `assigned_aura_cross_boss:${memberId}`, memberId, message: `同一成员不能同时被指定到 Boss 1 和 Boss 2` })
      } else {
        assignedTeamByMember.set(memberId, teamIndex)
      }
    }
  }
  return violations
}

function equipmentItem(baseHrid: string | undefined, enhancementLevel: number, refined = true): GuildTrialEquipment | null {
  if (!baseHrid) return null
  const refinedHrid = `/items/${baseHrid}_refined`
  const itemHrid = refined && itemIndex[refinedHrid] ? refinedHrid : `/items/${baseHrid}`
  const slot = itemIndex[itemHrid]?.equipmentDetail?.type?.replace("/equipment_types/", "")
  return slot ? { itemLocationHrid: `/item_locations/${slot}`, itemHrid, enhancementLevel } : null
}

function presetArmor(professionKey: string) {
  if (["fire", "water", "nature"].includes(professionKey)) {
    return [
      ["magicians_hat", 12, true], [`royal_${professionKey}_robe_top`, 12, true],
      [`royal_${professionKey}_robe_bottoms`, 12, true], ["chrono_gloves", 12, false],
      ["pathseeker_boots", 12, true], ["enchanted_cloak", 10, true]
    ] as const
  }
  if (["bow", "crossbow"].includes(professionKey)) {
    return [["acrobatic_hood", 12, true], ["kraken_tunic", 12, true], ["kraken_chaps", 12, true],
      ["marksman_bracers", 12, true], ["pathfinder_boots", 12, true], ["chimerical_quiver", 10, true]] as const
  }
  if (professionKey === "shield") {
    return [["corsair_helmet", 12, true], ["anchorbound_plate_body", 12, true], ["anchorbound_plate_legs", 12, true],
      ["dodocamel_gauntlets", 12, true], ["pathbreaker_boots", 12, true], ["sinister_cape", 10, true]] as const
  }
  return [["corsair_helmet", 12, true], ["maelstrom_plate_body", 12, true], ["maelstrom_plate_legs", 12, true],
    ["dodocamel_gauntlets", 12, true], ["pathbreaker_boots", 12, true], ["sinister_cape", 10, true]] as const
}

export function createManualGuildTrialPreset(name: string, professionKey: string, mainLevel: number): NativeGuildTrialMember {
  const profession = GUILD_TRIAL_PROFESSIONS.find(item => item.key === professionKey) || GUILD_TRIAL_PROFESSIONS[0]
  const level = Math.max(1, Math.min(400, Math.floor(Number(mainLevel) || 155)))
  const skills: Record<string, number> = {
    "/skills/attack": 140, "/skills/defense": 135, "/skills/stamina": 135, "/skills/intelligence": 125,
    "/skills/melee": 110, "/skills/ranged": 110, "/skills/magic": 110,
    [`/skills/${profession.mainSkill}`]: level
  }
  const common = [["philosophers_necklace", 7, false], ["philosophers_earrings", 7, false],
    ["philosophers_ring", 7, false], ["guzzling_pouch", 10, false]] as const
  const offhand = "offhand" in profession ? profession.offhand : undefined
  const equipment = [
    equipmentItem(profession.weapon, 14, true),
    equipmentItem(offhand, 12, offhand !== "manticore_shield"),
    ...presetArmor(profession.key).map(item => equipmentItem(item[0], item[1], item[2])),
    ...common.map(item => equipmentItem(item[0], item[1], item[2]))
  ].filter((item): item is GuildTrialEquipment => Boolean(item))
  const profile: GuildTrialProfile = {
    characterId: -Math.floor(Date.now() + Math.random() * 100000),
    characterName: String(name || `${profession.name}预设`).trim(),
    capturedAt: new Date().toISOString(),
    skills,
    equipment,
    abilities: defaultProfessionAbilities(profession.key),
    auras: Object.fromEntries(GUILD_TRIAL_AURA_HRIDS.map(hrid => [hrid, 60])),
    guildBuffs: {},
    guildBuildingLevels: {},
    characterGuildBuffs: {},
    houseRooms: {},
    achievements: {},
    communityBuffs: {}
  }
  return {
    characterId: profile.characterId,
    characterName: profile.characterName,
    capturedAt: profile.capturedAt || null,
    equipment,
    abilities: combatAbilities(profile),
    skills,
    auras: { ...(profile.auras || {}) },
    guildBuffs: { ...(profile.guildBuffs || {}) },
    guildBuildingLevels: copyTrialBuildings(profile.guildBuildingLevels),
    characterGuildBuffs: copyCharacterGuildBuffs(profile.characterGuildBuffs),
    houseRooms: { ...(profile.houseRooms || {}) },
    achievements: { ...(profile.achievements || {}) },
    communityBuffs: { ...(profile.communityBuffs || {}) },
    selected: true,
    roleTag: profession.roleTag,
    powerScore: guildTrialPowerScore(profile)
  }
}

export function guildTrialPowerScore(profile: GuildTrialProfile) {
  const skills = profile.skills || {}
  const combatLevel = ["attack", "defense", "stamina", "intelligence", "melee", "ranged", "magic"]
    .reduce((sum, key) => sum + (Number(skills[`/skills/${key}`]) || 1), 0)
  const equipmentScore = (profile.equipment || []).reduce((sum, item) => sum + 20 + Math.max(0, Number(item.enhancementLevel) || 0) * 4, 0)
  const abilityScore = combatAbilities(profile).reduce((sum, item) => sum + item.level * 1.5, 0)
  return Math.round(combatLevel + equipmentScore + abilityScore)
}

export function membersFromGuildTrialFeed(feed: GuildTrialFeed, previous: NativeGuildTrialMember[] = []) {
  const oldById = new Map(previous.map(member => [member.characterId, member]))
  const profiles = feed.guildMemberProfiles || feed.memberProfiles || []
  const rosterById = new Map((feed.guildRoster || []).map(member => [Number(member.characterId), String(member.characterName || "").trim().normalize("NFKC").toLocaleLowerCase()]))
  const seenIds = new Set<number>()
  const seenNames = new Set<string>()
  return profiles.filter(profile => {
    const characterId = Number(profile.characterId)
    const characterName = String(profile.characterName || "").trim().normalize("NFKC").toLocaleLowerCase()
    if (!Number.isSafeInteger(characterId) || characterId <= 0 || !characterName) return false
    if (rosterById.size && rosterById.get(characterId) !== characterName) return false
    if (seenIds.has(characterId) || seenNames.has(characterName)) return false
    seenIds.add(characterId)
    seenNames.add(characterName)
    return true
  }).map((profile): NativeGuildTrialMember => {
    const old = oldById.get(Number(profile.characterId))
    const capturedEquipment = profile.currentCombatBuild?.equipment?.length
      ? profile.currentCombatBuild.equipment
      : (profile.equipment || [])
    const equipment = capturedEquipment.map(item => ({
      itemLocationHrid: String(item.itemLocationHrid),
      itemHrid: String(item.itemHrid),
      enhancementLevel: Math.max(0, Number(item.enhancementLevel) || 0)
    }))
    const skills = { ...(profile.skills || {}) }
    const roleTag = old?.roleTag || inferGuildTrialRole(profile)
    const professionKey = guildTrialMemberProfession({ equipment, skills, roleTag }).key
    const currentAbilityHrids = (profile.currentCombatBuild?.abilityHrids || []).map(String).filter(Boolean).slice(0, 5)
    const abilities = currentAbilityHrids.length
      ? guildTrialAbilitiesForHrids(profile, currentAbilityHrids)
      : defaultProfessionAbilities(professionKey, profile)
    const learnedAbilities = [...(profile.learnedAbilities || profile.abilities || [])].filter(item => item?.abilityHrid).map(item => ({
      abilityHrid: String(item.abilityHrid),
      level: Math.max(1, Number(item.level) || 60)
    }))
    const combatLoadouts = (profile.combatLoadouts || []).map(loadout => ({
      id: String(loadout.id),
      name: String(loadout.name),
      ordinal: Math.max(0, Number(loadout.ordinal) || 0),
      isDefault: loadout.isDefault === true,
      equipment: (loadout.equipment || []).map(item => ({
        itemLocationHrid: String(item.itemLocationHrid),
        itemHrid: String(item.itemHrid)
      })),
      abilityHrids: (loadout.abilityHrids || []).map(String).filter(Boolean).slice(0, 5),
      abilityCombatTriggersMap: cloneGuildTrialJson(loadout.abilityCombatTriggersMap || {})
    })).sort((left, right) => left.ordinal - right.ordinal || left.name.localeCompare(right.name))
    const member: NativeGuildTrialMember = {
      characterId: Number(profile.characterId),
      characterName: String(profile.characterName || `#${profile.characterId}`),
      capturedAt: profile.capturedAt || null,
      equipment,
      abilities,
      skills,
      auras: Object.fromEntries(GUILD_TRIAL_AURA_HRIDS.map(hrid => [hrid, Math.max(0, Number(profile.auras?.[hrid]) || 0)])),
      guildBuffs: Object.fromEntries(Object.entries(profile.guildBuffs || {}).map(([hrid, level]) => [hrid, Math.max(0, Number(level) || 0)])),
      guildBuildingLevels: profile.guildBuildingLevels == null ? undefined : copyTrialBuildings(profile.guildBuildingLevels),
      characterGuildBuffs: profile.characterGuildBuffs == null ? undefined : copyCharacterGuildBuffs(profile.characterGuildBuffs),
      houseRooms: Object.fromEntries(Object.entries(profile.houseRooms || {}).map(([hrid, level]) => [hrid, Math.max(0, Number(level) || 0)])),
      achievements: Object.fromEntries(Object.entries(profile.achievements || {}).map(([hrid, completed]) => [hrid, completed === true])),
      communityBuffs: Object.fromEntries(Object.entries(profile.communityBuffs || {}).map(([hrid, level]) => [hrid, Math.max(0, Number(level) || 0)])),
      assignedAuraHrid: old?.assignedAuraHrid,
      assignedAuraLevelOverride: old?.assignedAuraLevelOverride,
      selected: old?.selected ?? hasGuildTrialLevel95Weapon(profile),
      roleTag,
      powerScore: 0,
      selfUploaded: Boolean(profile.selfUploaded),
      learnedAbilities,
      currentCombatBuild: profile.currentCombatBuild ? cloneGuildTrialJson(profile.currentCombatBuild) : null,
      combatLoadouts,
      loadoutItems: (profile.loadoutItems || []).map(item => ({
        itemHrid: String(item.itemHrid),
        enhancementLevel: Math.max(0, Number(item.enhancementLevel) || 0)
      })),
      selectedLoadoutId: old?.selectedLoadoutId || "current",
      abilityCombatTriggersMap: cloneGuildTrialJson(profile.currentCombatBuild?.abilityCombatTriggersMap || {})
    }
    member.powerScore = guildTrialPowerScore(member)
    return member
  })
}

function pushMember(team: GuildTrialTeam, member: NativeGuildTrialMember) {
  team.memberIds.push(member.characterId)
  team.powerScore += member.powerScore
}

export function assignGuildTrialAuraCarriers(
  members: NativeGuildTrialMember[],
  rules: GuildTrialRulesByBoss = DEFAULT_GUILD_TRIAL_RULES
) {
  for (const member of members) {
    delete member.assignedAuraHrid
    delete member.assignedAuraLevelOverride
  }
  const assigned = new Set<number>()
  const memberById = new Map(members.map(member => [member.characterId, member]))
  const ruleSets = [rulesForBoss(rules, 0), rulesForBoss(rules, 1)]
  for (const ruleSet of ruleSets) {
    for (const rule of ruleSet.assignedAuras || []) {
      const member = memberById.get(Number(rule.memberId))
      if (!member || assigned.has(member.characterId) || !AURA_NAMES[rule.abilityHrid]) continue
      member.assignedAuraHrid = rule.abilityHrid
      if ((Number(member.auras?.[rule.abilityHrid]) || 0) <= 0 && Number(rule.abilityLevel) > 0) {
        member.assignedAuraLevelOverride = Math.max(1, Math.floor(Number(rule.abilityLevel)))
      }
      assigned.add(member.characterId)
    }
  }
  const carrierOrder = [
    "/abilities/guardian_aura",
    "/abilities/critical_aura",
    "/abilities/fierce_aura",
    "/abilities/mystic_aura",
    "/abilities/speed_aura"
  ]
  for (const auraHrid of carrierOrder) {
    const assignedForAura = members.filter(member => member.assignedAuraHrid === auraHrid).length
    const candidates = members
      .filter(member => !assigned.has(member.characterId))
      .filter(member => guildTrialAuraStrength(member, auraHrid) > 0)
      .filter(member => !ruleSets.some(ruleSet => (ruleSet.skills || []).some(rule => (
        rule.operator === "required"
        && abilityIndex[rule.abilityHrid]?.isSpecialAbility
        && rule.abilityHrid !== auraHrid
        && skillRuleApplies(member, rule)
      ))))
      .sort((left, right) => guildTrialAuraStrength(right, auraHrid) - guildTrialAuraStrength(left, auraHrid)
        || right.powerScore - left.powerScore)
      .slice(0, Math.max(0, 2 - assignedForAura))
    for (const member of candidates) {
      member.assignedAuraHrid = auraHrid
      assigned.add(member.characterId)
    }
  }
  return members.filter(member => member.assignedAuraHrid)
}

function memberConstraintWeight(member: NativeGuildTrialMember, rules: GuildTrialAllocationRules) {
  const professionKey = professionForRule(member)
  const aura = guildTrialAura(member)
  let weight = aura ? 1000 + aura.strength : 0
  for (const rule of rules.professions || []) {
    if (rule.professionKey === professionKey) weight += rule.operator === "gte" ? 8 : 4
  }
  for (const rule of rules.skills || []) {
    if (rule.operator === "gte" && skillRuleApplies(member, rule) && memberCarriesAbility(member, rule.abilityHrid)) weight += 10
    else if (skillRuleApplies(member, rule)) weight += 2
  }
  return weight
}

function canAddMemberToTeam(
  team: GuildTrialTeam,
  member: NativeGuildTrialMember,
  membersById: Map<number, NativeGuildTrialMember>,
  rules: GuildTrialAllocationRules,
  capacity: number
) {
  if (team.memberIds.length >= capacity) return false
  if (guildTrialMemberEligibilityViolations(member, rules).length) return false
  const current = team.memberIds.map(id => membersById.get(id)).filter((item): item is NativeGuildTrialMember => Boolean(item))
  const professionKey = professionForRule(member)
  for (const rule of rules.professions || []) {
    if (rule.operator !== "lte" || rule.professionKey !== professionKey) continue
    const count = current.filter(item => professionForRule(item) === professionKey).length
    if (count + 1 > Math.max(0, Math.floor(Number(rule.value) || 0))) return false
  }
  for (const rule of rules.skills || []) {
    if (rule.operator !== "lte" || !skillRuleApplies(member, rule) || !memberCarriesAbility(member, rule.abilityHrid)) continue
    const count = current.filter(item => skillRuleApplies(item, rule) && memberCarriesAbility(item, rule.abilityHrid)).length
    if (count + 1 > Math.max(0, Math.floor(Number(rule.value) || 0))) return false
  }
  return true
}

function specifiedAuraTeamIndexes(rules: GuildTrialRulesByBoss, memberId: number) {
  return [0, 1].filter(teamIndex => (rulesForBoss(rules, teamIndex).assignedAuras || [])
    .some(rule => Number(rule.memberId) === memberId))
}

function placementScore(
  team: GuildTrialTeam,
  otherTeam: GuildTrialTeam,
  member: NativeGuildTrialMember,
  membersById: Map<number, NativeGuildTrialMember>,
  rules: GuildTrialAllocationRules,
  eligibleCount: number
) {
  const current = team.memberIds.map(id => membersById.get(id)).filter((item): item is NativeGuildTrialMember => Boolean(item))
  const professionKey = professionForRule(member)
  const aura = guildTrialAura(member)?.hrid || ""
  let score = (otherTeam.memberIds.length - team.memberIds.length) * 120
  score -= team.powerScore / Math.max(1, eligibleCount)
  if (aura) {
    const ownHasAura = current.some(item => guildTrialAura(item)?.hrid === aura)
    const otherHasAura = otherTeam.memberIds
      .map(id => membersById.get(id))
      .some(item => item && guildTrialAura(item)?.hrid === aura)
    if (!ownHasAura && otherHasAura) score += 1200
    else if (ownHasAura && !otherHasAura) score -= 1200
    else if (!ownHasAura) score += 480
  }
  for (const rule of rules.professions || []) {
    if (rule.professionKey !== professionKey) continue
    const ownCount = current.filter(item => professionForRule(item) === professionKey).length
    if (rule.operator === "gte" && ownCount < Math.max(0, Number(rule.value) || 0)) score += 1200
    if (rule.operator === "balance") {
      const otherCount = otherTeam.memberIds.map(id => membersById.get(id))
        .filter((item): item is NativeGuildTrialMember => Boolean(item))
        .filter(item => professionForRule(item) === professionKey).length
      score += (otherCount - ownCount) * 700
    }
  }
  for (const rule of rules.skills || []) {
    if (rule.operator !== "gte" || !skillRuleApplies(member, rule) || !memberCarriesAbility(member, rule.abilityHrid)) continue
    const ownCount = current.filter(item => skillRuleApplies(item, rule) && memberCarriesAbility(item, rule.abilityHrid)).length
    if (ownCount < Math.max(0, Number(rule.value) || 0)) score += 1400
  }
  return score
}

function buildGreedyGuildTrialCandidate(
  eligible: NativeGuildTrialMember[],
  encounterHrids: [string, string],
  capacity: number,
  rules: GuildTrialRulesByBoss,
  attempt: number
): [GuildTrialTeam, GuildTrialTeam] {
  const membersById = new Map(eligible.map(member => [member.characterId, member]))
  const teams: [GuildTrialTeam, GuildTrialTeam] = [
    { id: "boss-1", encounterHrid: encounterHrids[0], memberIds: [], powerScore: 0 },
    { id: "boss-2", encounterHrid: encounterHrids[1], memberIds: [], powerScore: 0 }
  ]
  const ordered = [...eligible].sort((left, right) => {
    const rightWeight = Math.max(memberConstraintWeight(right, rulesForBoss(rules, 0)), memberConstraintWeight(right, rulesForBoss(rules, 1)))
    const leftWeight = Math.max(memberConstraintWeight(left, rulesForBoss(rules, 0)), memberConstraintWeight(left, rulesForBoss(rules, 1)))
    const constrained = rightWeight - leftWeight
    if (constrained) return constrained
    const leftRank = (Math.imul(Math.abs(left.characterId) + 17, 1103515245 + attempt * 2) >>> 0) % 10007
    const rightRank = (Math.imul(Math.abs(right.characterId) + 17, 1103515245 + attempt * 2) >>> 0) % 10007
    return leftRank - rightRank || right.powerScore - left.powerScore
  })
  for (const member of ordered) {
    const specifiedTeams = specifiedAuraTeamIndexes(rules, member.characterId)
    const choices = teams.map((team, index) => ({
      index,
      allowed: (!specifiedTeams.length || specifiedTeams.includes(index))
        && canAddMemberToTeam(team, member, membersById, rulesForBoss(rules, index), capacity),
      score: placementScore(team, teams[index === 0 ? 1 : 0], member, membersById, rulesForBoss(rules, index), eligible.length)
        + (specifiedTeams.includes(index) ? 100000 : 0)
        + (((attempt + index) % 2) ? 0.001 : 0)
    })).filter(choice => choice.allowed).sort((left, right) => right.score - left.score)
    if (choices.length) pushMember(teams[choices[0].index], member)
  }
  return teams
}

function binomial(n: number, k: number) {
  if (k < 0 || k > n) return 0n
  const take = Math.min(k, n - k)
  let result = 1n
  for (let index = 1; index <= take; index += 1) {
    result = result * BigInt(n - take + index) / BigInt(index)
  }
  return result
}

export function estimateGuildTrialLineupAssignments(
  initialTeams: [GuildTrialTeam, GuildTrialTeam],
  lockedMemberIds: Iterable<number>,
  optionalMemberIds: Iterable<number> = []
) {
  const locked = new Set(lockedMemberIds)
  const assignedIds = initialTeams.flatMap(team => team.memberIds)
  const optional = new Set([...optionalMemberIds].filter(id => assignedIds.includes(id) && !locked.has(id)))
  if (optional.size) {
    const requiredMovableCount = assignedIds.filter(id => !locked.has(id) && !optional.has(id)).length
    return (2n ** BigInt(requiredMovableCount)) * (3n ** BigInt(optional.size))
  }
  const teamZeroLocked = initialTeams[0].memberIds.filter(id => locked.has(id)).length
  const movableCount = assignedIds.filter(id => !locked.has(id)).length
  return binomial(movableCount, initialTeams[0].memberIds.length - teamZeroLocked)
}

function unrankCombination(n: number, k: number, initialRank: bigint) {
  const result: number[] = []
  let rank = initialRank
  let next = 0
  for (let remaining = k; remaining > 0; remaining -= 1) {
    for (let candidate = next; candidate <= n - remaining; candidate += 1) {
      const blockSize = binomial(n - candidate - 1, remaining - 1)
      if (rank < blockSize) {
        result.push(candidate)
        next = candidate + 1
        break
      }
      rank -= blockSize
    }
  }
  return result
}

export function generateGuildTrialLineupCandidates(
  members: NativeGuildTrialMember[],
  encounterHrids: [string, string],
  rosterLimit = 40,
  rules: GuildTrialRulesByBoss = DEFAULT_GUILD_TRIAL_RULES,
  initialTeams?: [GuildTrialTeam, GuildTrialTeam],
  lockedMemberIds: Iterable<number> = [],
  optionalMemberIds: Iterable<number> = []
): GuildTrialLineupCandidateSet {
  if (!initialTeams) throw new Error("请先生成初始阵容")
  const assignedIds = initialTeams.flatMap(team => team.memberIds)
  if (new Set(assignedIds).size !== assignedIds.length) throw new Error("初始阵容中存在重复成员")
  const assignedIdSet = new Set(assignedIds)
  const eligible = members.filter(member => assignedIdSet.has(member.characterId) && member.selected
    && [0, 1].some(teamIndex => guildTrialMemberEligibilityViolations(member, rulesForBoss(rules, teamIndex)).length === 0))
  const capacity = Math.max(1, Math.floor(Number(rosterLimit) || 40))
  if (assignedIds.length > capacity * 2) throw new Error(`已分配 ${assignedIds.length} 人，超过两队合计上限 ${capacity * 2} 人`)
  if (eligible.length !== assignedIds.length) throw new Error("初始阵容包含未选择或不满足个人规则的成员")
  if (eligible.length < 2) throw new Error(`只有 ${eligible.length} 人满足等级与技能个人规则，无法生成两场 Boss 阵容`)
  const byId = new Map(eligible.map(member => [member.characterId, member]))
  const locked = new Set([...lockedMemberIds].filter(id => assignedIdSet.has(id)))
  const lockedByTeam = initialTeams.map(team => team.memberIds.filter(id => locked.has(id)))
  const movableIds = assignedIds.filter(id => !locked.has(id))
  const optional = new Set([...optionalMemberIds].filter(id => movableIds.includes(id)))
  const optionalIds = movableIds.filter(id => optional.has(id))
  const requiredMovableIds = movableIds.filter(id => !optional.has(id))
  const teamZeroMovableSlots = initialTeams[0].memberIds.length - lockedByTeam[0].length
  const assignmentCount = optionalIds.length
    ? (2n ** BigInt(requiredMovableIds.length)) * (3n ** BigInt(optionalIds.length))
    : binomial(movableIds.length, teamZeroMovableSlots)
  if (!assignmentCount) throw new Error("当前锁定条件无法保持初始阵容人数")

  const candidateAt = (index: bigint): [GuildTrialTeam, GuildTrialTeam] | null => {
    if (index < 0n || index >= assignmentCount) return null
    let teamIds: [number[], number[]]
    if (optionalIds.length) {
      let rank = index
      teamIds = [[...lockedByTeam[0]], [...lockedByTeam[1]]]
      for (const memberId of requiredMovableIds) {
        const teamIndex = Number(rank % 2n)
        rank /= 2n
        teamIds[teamIndex].push(memberId)
      }
      for (const memberId of optionalIds) {
        const destination = Number(rank % 3n)
        rank /= 3n
        if (destination < 2) teamIds[destination].push(memberId)
      }
      if (!teamIds[0].length || !teamIds[1].length) return null
    } else {
      const chosenIndexes = new Set(unrankCombination(movableIds.length, teamZeroMovableSlots, index))
      teamIds = [
        [...lockedByTeam[0], ...movableIds.filter((_, itemIndex) => chosenIndexes.has(itemIndex))],
        [...lockedByTeam[1], ...movableIds.filter((_, itemIndex) => !chosenIndexes.has(itemIndex))]
      ]
    }
    const teams = teamIds.map((memberIds, teamIndex): GuildTrialTeam => ({
      id: teamIndex === 0 ? "boss-1" : "boss-2",
      encounterHrid: encounterHrids[teamIndex],
      memberIds,
      powerScore: memberIds.reduce((total, id) => total + (byId.get(id)?.powerScore || 0), 0)
    })) as [GuildTrialTeam, GuildTrialTeam]
    return guildTrialRuleViolations(teams, eligible, rules, capacity).length ? null : teams
  }

  return { assignmentCount, eligibleCount: eligible.length, movableCount: movableIds.length, candidateAt }
}

export function allocateGuildTrialMembers(
  members: NativeGuildTrialMember[],
  encounterHrids: [string, string],
  rosterLimit = 40,
  rules: GuildTrialRulesByBoss = DEFAULT_GUILD_TRIAL_RULES
): [GuildTrialTeam, GuildTrialTeam] {
  const specifiedAuraViolations = specifiedAuraConfigurationViolations(rules)
  if (specifiedAuraViolations.length) throw new Error(specifiedAuraViolations[0].message)
  const selected = members.filter(member => member.selected)
  for (const member of selected) {
    delete member.assignedAuraHrid
    delete member.assignedAuraLevelOverride
  }
  let eligible = selected.filter(member => [0, 1].some(teamIndex =>
    guildTrialMemberEligibilityViolations(member, rulesForBoss(rules, teamIndex)).length === 0))
  assignGuildTrialAuraCarriers(eligible, rules)
  eligible = selected.filter(member => [0, 1].some(teamIndex =>
    guildTrialMemberEligibilityViolations(member, rulesForBoss(rules, teamIndex)).length === 0))
  const capacity = Math.max(1, Math.floor(Number(rosterLimit) || 40))
  if (selected.length > capacity * 2) throw new Error(`已选 ${selected.length} 人，超过两队合计上限 ${capacity * 2} 人`)
  if (eligible.length < 2) throw new Error(`只有 ${eligible.length} 人满足等级与技能个人规则，无法分配两场 Boss`)
  let best: [GuildTrialTeam, GuildTrialTeam] | null = null
  let bestAssigned = -1
  let lastViolations: GuildTrialRuleViolation[] = []
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const teams = buildGreedyGuildTrialCandidate(eligible, encounterHrids, capacity, rules, attempt)
    if (!teams.every(team => team.memberIds.length)) continue
    const violations = guildTrialRuleViolations(teams, eligible, rules, capacity)
    lastViolations = violations
    if (violations.length) continue
    const assigned = teams[0].memberIds.length + teams[1].memberIds.length
    const powerGap = Math.abs(teams[0].powerScore - teams[1].powerScore)
    const bestPowerGap = best ? Math.abs(best[0].powerScore - best[1].powerScore) : Number.POSITIVE_INFINITY
    if (assigned > bestAssigned || (assigned === bestAssigned && powerGap < bestPowerGap)) {
      best = teams
      bestAssigned = assigned
      if (assigned === eligible.length && powerGap === 0) break
    }
  }
  if (!best) {
    const detail = lastViolations[0]?.message || "现有成员无法同时满足全部等级、职业和技能规则"
    throw new Error(`自动分配失败：${detail}`)
  }
  return best
}

export function guildTrialBuildForMember(member: NativeGuildTrialMember) {
  const build: any = {
    player: {
      attackLevel: Number(member.skills["/skills/attack"]) || 1,
      defenseLevel: Number(member.skills["/skills/defense"]) || 1,
      staminaLevel: Number(member.skills["/skills/stamina"]) || 1,
      intelligenceLevel: Number(member.skills["/skills/intelligence"]) || 1,
      meleeLevel: Number(member.skills["/skills/melee"]) || 1,
      rangedLevel: Number(member.skills["/skills/ranged"]) || 1,
      magicLevel: Number(member.skills["/skills/magic"]) || 1,
      equipment: member.equipment.map(item => ({ ...item }))
    },
    food: { "/action_types/combat": [] },
    drinks: { "/action_types/combat": [] },
    abilities: [] as GuildTrialAbility[],
    triggerMap: {} as Record<string, any[]>,
    houseRooms: { ...member.houseRooms },
    guildBuffs: { ...member.guildBuffs },
    guildBuildingLevels: copyTrialBuildings(member.guildBuildingLevels),
    characterGuildBuffs: copyCharacterGuildBuffs(member.characterGuildBuffs),
    achievements: { ...member.achievements },
    communityBuffs: { ...member.communityBuffs }
  }
  const learned = member.abilities.filter(ability => abilityIndex[ability.abilityHrid])
  const assignedAuraLevel = Number(member.assignedAuraLevelOverride)
    || Number(member.auras?.[member.assignedAuraHrid || ""]) || 0
  const assignedAura = member.assignedAuraHrid && assignedAuraLevel > 0
    ? { abilityHrid: member.assignedAuraHrid, level: assignedAuraLevel }
    : null
  const special = assignedAura || learned.find(ability => abilityIndex[ability.abilityHrid]?.isSpecialAbility)
  const normal = learned.filter(ability => !abilityIndex[ability.abilityHrid]?.isSpecialAbility).slice(0, 4)
  build.abilities = [special || { abilityHrid: "", level: 1 }, ...normal]
  while (build.abilities.length < 5) build.abilities.push({ abilityHrid: "", level: 1 })
  for (const ability of build.abilities) {
    if (!ability.abilityHrid) continue
    const uploadedTriggers = member.abilityCombatTriggersMap
    build.triggerMap[ability.abilityHrid] = Object.prototype.hasOwnProperty.call(uploadedTriggers || {}, ability.abilityHrid)
      ? cloneGuildTrialJson(uploadedTriggers?.[ability.abilityHrid] || [])
      : cloneGuildTrialJson(abilityIndex[ability.abilityHrid]?.defaultCombatTriggers || [])
  }
  return build
}

export function guildTrialEncounterName(hrid: string) {
  return GUILD_TRIAL_ENCOUNTERS.find(item => item.hrid === hrid)?.name || hrid
}
