import { getLang, getTrans } from "@/locales"
import supplementalNamesZh from '@/locales/combat-names-zh'
import gameNamesZh from '@/locales/lang/zh-cn'
import {
  abilityDetailIndex,
  bundledAbilityNameByHrid,
  bundledActionNameByHrid,
  bundledHouseRoomNameByHrid,
  bundledItemNameByHrid,
  getBundledCombatGameDataMaps,
  itemDetailIndex
} from "../shared/gameDataIndex.js"

const combatAbilityIndex = abilityDetailIndex as Record<string, any>
const combatItemIndex = itemDetailIndex as Record<string, any>

const COMBAT_HRID_LABELS_ZH: Record<string, string> = {
  ...supplementalNamesZh,
  "/house_rooms/dairy_barn": "牛棚", "/house_rooms/garden": "花园", "/house_rooms/log_shed": "木棚", "/house_rooms/forge": "锻造间", "/house_rooms/workshop": "工坊",
  "/house_rooms/sewing_parlor": "缝纫室", "/house_rooms/kitchen": "厨房", "/house_rooms/brewery": "酿造间", "/house_rooms/laboratory": "实验室", "/house_rooms/observatory": "天文台",
  "/house_rooms/dining_room": "餐厅", "/house_rooms/library": "图书馆", "/house_rooms/dojo": "道场", "/house_rooms/armory": "军械库", "/house_rooms/gym": "健身房",
  "/house_rooms/archery_range": "射箭场", "/house_rooms/mystical_study": "神秘书房",
  "/guild_shrines/force": "力量神龛", "/guild_shrines/rarity": "稀有神龛", "/guild_shrines/scholar": "学者神龛", "/guild_shrines/spirit": "精神神龛", "/guild_shrines/tempo": "节奏神龛",
  "/achievement_tiers/beginner": "初学者", "/achievement_tiers/novice": "新手", "/achievement_tiers/adept": "熟练", "/achievement_tiers/veteran": "老手", "/achievement_tiers/champion": "冠军", "/achievement_tiers/elite": "精英",
  "/actions/combat/fly": "苍蝇", "/actions/combat/rat": "杰瑞", "/actions/combat/skunk": "臭鼬", "/actions/combat/porcupine": "豪猪", "/actions/combat/slimy": "史莱姆",
  "/actions/combat/smelly_planet": "臭臭星球", "/actions/combat/frog": "青蛙", "/actions/combat/snake": "蛇", "/actions/combat/swampy": "沼泽怪", "/actions/combat/alligator": "鳄鱼",
  "/actions/combat/swamp_planet": "沼泽星球", "/actions/combat/sea_snail": "海蜗牛", "/actions/combat/crab": "螃蟹", "/actions/combat/aquahorse": "水马", "/actions/combat/nom_nom": "吞吞怪",
  "/actions/combat/turtle": "海龟", "/actions/combat/aqua_planet": "海洋星球", "/actions/combat/jungle_sprite": "丛林精灵", "/actions/combat/myconid": "蕈人", "/actions/combat/treant": "树人",
  "/actions/combat/centaur_archer": "半人马弓手", "/actions/combat/jungle_planet": "丛林星球", "/actions/combat/gobo_stabby": "刺刺哥布林", "/actions/combat/gobo_slashy": "斩斩哥布林", "/actions/combat/gobo_smashy": "砸砸哥布林",
  "/actions/combat/gobo_shooty": "射射哥布林", "/actions/combat/gobo_boomy": "爆爆哥布林", "/actions/combat/gobo_planet": "哥布林星球", "/actions/combat/eye": "魔眼", "/actions/combat/eyes": "双眼怪",
  "/actions/combat/veyes": "群眼怪", "/actions/combat/planet_of_the_eyes": "魔眼星球", "/actions/combat/novice_sorcerer": "见习术士", "/actions/combat/ice_sorcerer": "冰霜术士", "/actions/combat/flame_sorcerer": "烈焰术士",
  "/actions/combat/elementalist": "元素法师", "/actions/combat/sorcerers_tower": "术士之塔", "/actions/combat/gummy_bear": "软糖熊", "/actions/combat/panda": "熊猫", "/actions/combat/black_bear": "黑熊",
  "/actions/combat/grizzly_bear": "灰熊", "/actions/combat/polar_bear": "北极熊", "/actions/combat/bear_with_it": "熊之星球", "/actions/combat/magnetic_golem": "磁力魔像", "/actions/combat/stalactite_golem": "钟乳石魔像",
  "/actions/combat/granite_golem": "花岗岩魔像", "/actions/combat/golem_cave": "魔像洞穴", "/actions/combat/zombie": "僵尸", "/actions/combat/vampire": "吸血鬼", "/actions/combat/werewolf": "狼人",
  "/actions/combat/twilight_zone": "暮光星球", "/actions/combat/abyssal_imp": "深渊小鬼", "/actions/combat/soul_hunter": "灵魂猎手", "/actions/combat/infernal_warlock": "地狱术士", "/actions/combat/infernal_abyss": "地狱深渊",
  "/actions/combat/chimerical_den": "奇美拉巢穴", "/actions/combat/sinister_circus": "邪恶马戏团", "/actions/combat/enchanted_fortress": "魔法堡垒", "/actions/combat/pirate_cove": "海盗湾",
  "/monsters/cyclops": "独眼巨人", "/monsters/dryad": "树精", "/monsters/frost_sniper": "冰霜狙击手", "/monsters/giant_mantis": "巨型螳螂", "/monsters/giant_scorpion": "巨型蝎子",
  "/monsters/mimic": "宝箱怪", "/monsters/pyre_hunter": "烈焰猎手", "/monsters/salamander": "火蜥蜴", "/monsters/shadow_archer": "暗影弓手", "/monsters/siren": "海妖",
  "/combat_trigger_dependencies/all_allies": "所有队友总计", "/combat_trigger_dependencies/all_enemies": "所有敌人总计", "/combat_trigger_dependencies/self": "自身", "/combat_trigger_dependencies/targeted_enemy": "目标敌人",
  "/combat_trigger_conditions/number_of_active_units": "存活单位数量", "/combat_trigger_conditions/number_of_dead_units": "死亡单位数量", "/combat_trigger_conditions/lowest_hp_percentage": "最低生命百分比",
  "/combat_trigger_conditions/missing_hp": "已损失生命", "/combat_trigger_conditions/current_hp": "当前生命", "/combat_trigger_conditions/missing_mp": "已损失法力", "/combat_trigger_conditions/current_mp": "当前法力"
}

const COMBAT_HRID_BY_ZH_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(COMBAT_HRID_LABELS_ZH).map(([hrid, label]) => [label, hrid])
)

const SLOT_LABELS: Record<string, string> = {
  head: "头部", body: "身体", legs: "腿部", feet: "鞋子", hands: "手部",
  back: "背部", neck: "项链", earrings: "耳环", ring: "戒指", charm: "护符",
  trinket: "勋章", pouch: "袋子", weapon: "武器", off_hand: "副手"
}

const LEVEL_LABELS: Record<string, string> = {
  stamina: "耐力", intelligence: "智力", attack: "攻击", defense: "防御",
  melee: "近战", ranged: "远程", magic: "魔法"
}

const TRIGGER_LABELS: Record<string, string> = {
  "Allies' Total": "所有队友总计",
  "Enemies' Total": "所有敌人总计",
  My: "自身",
  "Target Enemy's": "目标敌人",
  "Is Active": "已生效",
  "Is Inactive": "未生效",
  "Hitpoints": "生命值",
  "Manapoints": "法力值",
  "Missing Hitpoints": "已损失生命值",
  "Missing Manapoints": "已损失法力值"
}

function humanizeHrid(hrid: string) {
  const slug = hrid.split("/").filter(Boolean).at(-1) || hrid
  return slug.split("_").filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
}

const canonicalCombatNamesByHrid: Record<string, string> = {
  ...Object.fromEntries(Object.values(getBundledCombatGameDataMaps()).flatMap((map:any) =>
    Object.entries(map).filter(([hrid, value]:any) => hrid.startsWith('/') && value?.name)
      .map(([hrid, value]:any) => [hrid, String(value.name)]))),
  ...(bundledItemNameByHrid as Record<string, string>),
  ...(bundledAbilityNameByHrid as Record<string, string>),
  ...(bundledActionNameByHrid as Record<string, string>),
  ...(bundledHouseRoomNameByHrid as Record<string, string>)
}
const canonicalHridByName = Object.fromEntries(Object.entries(canonicalCombatNamesByHrid).map(([hrid,name])=>[name,hrid]))
for (const [hrid, name] of Object.entries(canonicalCombatNamesByHrid)) {
  const chinese = (gameNamesZh as Record<string,string>)[name] || (gameNamesZh as Record<string,string>)[name.replace(/\s*[★☆]\s*$/, ' (R)')]
  if (chinese) COMBAT_HRID_BY_ZH_LABEL[chinese] ??= hrid
}

function translationCandidates(name: unknown, hrid: string) {
  const names = [String(name || "").trim(), canonicalCombatNamesByHrid[hrid] || ""].filter(Boolean)
  return [...new Set(names.flatMap(value => [
    value,
    value.replace(/\s*[★☆]\s*$/, " (R)"),
    value.replace(/\s*\((?:Refined|R)\)\s*$/i, " (R)")
  ]))]
}

export function translateCombatName(name: unknown, hrid = "") {
  const raw = String(name || "").trim()
  const resolvedHrid = COMBAT_HRID_BY_ZH_LABEL[hrid] || hrid || COMBAT_HRID_BY_ZH_LABEL[raw] || canonicalHridByName[raw] || ''
  if (getLang() === "zhCn" && resolvedHrid && COMBAT_HRID_LABELS_ZH[resolvedHrid]) return COMBAT_HRID_LABELS_ZH[resolvedHrid]
  if (getLang() === 'en' && /[\u3400-\u9fff]/.test(raw) && canonicalCombatNamesByHrid[resolvedHrid]) return canonicalCombatNamesByHrid[resolvedHrid]
  for (const candidate of translationCandidates(raw, resolvedHrid)) {
    const translated = getTrans(candidate)
    if (translated !== candidate) return translated
  }
  if (getLang() !== "zhCn" && COMBAT_HRID_BY_ZH_LABEL[raw]) {
    return canonicalCombatNamesByHrid[resolvedHrid] || humanizeHrid(resolvedHrid)
  }
  return raw || canonicalCombatNamesByHrid[resolvedHrid] || (resolvedHrid ? humanizeHrid(resolvedHrid) : "-")
}

export function translateCombatOption(option: { name?: string, hrid?: string }) {
  return translateCombatName(option?.name, option?.hrid)
}

export function translateCombatItemWithLevel(hrid: string, enhancementLevel: number) {
  return `${translateCombatName("", hrid)} +${Math.max(0, Math.floor(Number(enhancementLevel) || 0))}`
}

export function translateCombatSlot(slot: string) {
  const abilityMatch = /^ability_(\d+)$/.exec(slot)
  if (abilityMatch) return getLang() === "zhCn" ? `技能 ${abilityMatch[1]}` : `Ability ${abilityMatch[1]}`
  return getLang() === "zhCn" ? (SLOT_LABELS[slot] || translateCombatName(slot)) : humanizeHrid(slot)
}

export function translateCombatLevel(key: string) {
  return getLang() === "zhCn" ? (LEVEL_LABELS[key] || translateCombatName(key)) : humanizeHrid(key)
}

export function translateTriggerLabel(name: string, hrid = "") {
  if (getLang() !== "zhCn") return translateCombatName(name, hrid)
  const direct = TRIGGER_LABELS[name] || COMBAT_HRID_LABELS_ZH[hrid]
  if (direct) return direct
  const conditionPrefix = "/combat_trigger_conditions/"
  if (hrid.startsWith(conditionPrefix)) {
    const abilityHrid = `/abilities/${hrid.slice(conditionPrefix.length)}`
    const ability = combatAbilityIndex[abilityHrid]
    if (ability?.name) return translateCombatName(ability.name, abilityHrid)
  }
  return translateCombatName(name, hrid)
}

export function translateUpgradeVariant(row: Record<string, any>) {
  if (String(row?.kind || "").startsWith("ability_plus_")) {
    if (!row?.abilityHrid || !Number.isFinite(Number(row?.beforeLevel)) || !Number.isFinite(Number(row?.afterLevel))) {
      return row?.label ? translateCombatName(row.label) : translateCombatSlot(String(row?.slot || "ability"))
    }
    const name = translateCombatName(combatAbilityIndex[row.abilityHrid]?.name, row.abilityHrid)
    return `${name} Lv.${row.beforeLevel} → Lv.${row.afterLevel}`
  }
  const before = translateCombatName(combatItemIndex[row?.beforeItemHrid]?.name, row?.beforeItemHrid)
  if (["refine", "upper_replacement", "defensive_replacement"].includes(String(row?.kind || ""))) {
    const after = translateCombatName(combatItemIndex[row?.afterItemHrid]?.name, row?.afterItemHrid)
    const beforeLabel = row?.beforeItemHrid ? `${before} +${row.beforeLevel}` : (getLang() === "zhCn" ? "无" : "None")
    return `${beforeLabel} → ${after} +${row.afterLevel}`
  }
  if (row?.beforeItemHrid) return `${before} +${row.beforeLevel} → +${row.afterLevel}`
  return translateCombatName(row?.label || "")
}
