import gameDataIndex from "./gameDataIndex.generated.json";
import abilityDetailMapData from "../combatsimulator/data/abilityDetailMap.json";
import abilitySlotsLevelRequirementListData from "../combatsimulator/data/abilitySlotsLevelRequirementList.json";
import achievementDetailMapData from "../combatsimulator/data/achievementDetailMap.json";
import achievementTierDetailMapData from "../combatsimulator/data/achievementTierDetailMap.json";
import actionDetailMapData from "../combatsimulator/data/actionDetailMap.json";
import buffTypeDetailMap from "../combatsimulator/data/buffTypeDetailMap.json";
import combatMonsterDetailMapData from "../combatsimulator/data/combatMonsterDetailMap.json";
import combatStyleDetailMapData from "../combatsimulator/data/combatStyleDetailMap.json";
import combatTriggerComparatorDetailMapData from "../combatsimulator/data/combatTriggerComparatorDetailMap.json";
import combatTriggerConditionDetailMapData from "../combatsimulator/data/combatTriggerConditionDetailMap.json";
import combatTriggerDependencyDetailMapData from "../combatsimulator/data/combatTriggerDependencyDetailMap.json";
import communityBuffTypeDetailMapData from "../combatsimulator/data/communityBuffTypeDetailMap.json";
import damageTypeDetailMapData from "../combatsimulator/data/damageTypeDetailMap.json";
import enhancementLevelSuccessRateTableData from "../combatsimulator/data/enhancementLevelSuccessRateTable.json";
import enhancementLevelTotalBonusMultiplierTableData from "../combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json";
import equipmentTypeDetailMapData from "../combatsimulator/data/equipmentTypeDetailMap.json";
import guildBuffDetailMapData from "../combatsimulator/data/guildBuffDetailMap.json";
import guildShrineDetailMapData from "../combatsimulator/data/guildShrineDetailMap.json";
import houseRoomDetailMapData from "../combatsimulator/data/houseRoomDetailMap.json";
import itemCategoryDetailMap from "../combatsimulator/data/itemCategoryDetailMap.json";
import itemDetailMapData from "../combatsimulator/data/itemDetailMap.json";
import itemLocationDetailMapData from "../combatsimulator/data/itemLocationDetailMap.json";
import labyrinthCrateDetailMapData from "../combatsimulator/data/labyrinthCrateDetailMap.json";
import levelExperienceTableData from "../combatsimulator/data/levelExperienceTable.json";
import openableLootDropMapData from "../combatsimulator/data/openableLootDropMap.json";
import skillDetailMap from "../combatsimulator/data/skillDetailMap.json";
import dungeonTokenShopItemDetailMapData from "../combatsimulator/data/dungeonTokenShopItemDetailMap.json";

export const REQUIRED_COMBAT_GAME_DATA_KEYS = Object.freeze([
    "abilityDetailMap", "abilitySlotsLevelRequirementList", "achievementDetailMap", "achievementTierDetailMap",
    "actionDetailMap", "buffTypeDetailMap", "combatMonsterDetailMap", "combatStyleDetailMap",
    "combatTriggerComparatorDetailMap", "combatTriggerConditionDetailMap", "combatTriggerDependencyDetailMap",
    "communityBuffTypeDetailMap", "damageTypeDetailMap", "enhancementLevelSuccessRateTable",
    "enhancementLevelTotalBonusMultiplierTable", "equipmentTypeDetailMap",
    "guildBuffDetailMap", "guildShrineDetailMap", "houseRoomDetailMap", "itemCategoryDetailMap",
    "itemDetailMap", "itemLocationDetailMap", "labyrinthCrateDetailMap", "levelExperienceTable",
    "openableLootDropMap", "skillDetailMap",
]);

export const OPTIONAL_COMBAT_GAME_DATA_KEYS = Object.freeze([
    "shopItemDetailMap",
]);

const runtimeMapTargets = {
    abilityDetailMap: abilityDetailMapData,
    abilitySlotsLevelRequirementList: abilitySlotsLevelRequirementListData,
    achievementDetailMap: achievementDetailMapData,
    achievementTierDetailMap: achievementTierDetailMapData,
    actionDetailMap: actionDetailMapData,
    buffTypeDetailMap,
    combatMonsterDetailMap: combatMonsterDetailMapData,
    combatStyleDetailMap: combatStyleDetailMapData,
    combatTriggerComparatorDetailMap: combatTriggerComparatorDetailMapData,
    combatTriggerConditionDetailMap: combatTriggerConditionDetailMapData,
    combatTriggerDependencyDetailMap: combatTriggerDependencyDetailMapData,
    communityBuffTypeDetailMap: communityBuffTypeDetailMapData,
    damageTypeDetailMap: damageTypeDetailMapData,
    enhancementLevelSuccessRateTable: enhancementLevelSuccessRateTableData,
    enhancementLevelTotalBonusMultiplierTable: enhancementLevelTotalBonusMultiplierTableData,
    equipmentTypeDetailMap: equipmentTypeDetailMapData,
    guildBuffDetailMap: guildBuffDetailMapData,
    guildShrineDetailMap: guildShrineDetailMapData,
    houseRoomDetailMap: houseRoomDetailMapData,
    itemCategoryDetailMap,
    itemDetailMap: itemDetailMapData,
    itemLocationDetailMap: itemLocationDetailMapData,
    labyrinthCrateDetailMap: labyrinthCrateDetailMapData,
    levelExperienceTable: levelExperienceTableData,
    openableLootDropMap: openableLootDropMapData,
    skillDetailMap,
    shopItemDetailMap: dungeonTokenShopItemDetailMapData,
};

export const LEVEL_KEYS = gameDataIndex?.metadata?.levelKeys || [];
// Task badges participate in combat through their taskDamage stat. Older
// generated indexes treated the trinket slot as preview-only, which meant the
// equipped badge was silently omitted from simulation DTOs after import.
export const EQUIPMENT_SLOT_KEYS = Object.freeze(Array.from(new Set([
    ...(gameDataIndex?.metadata?.equipmentSlotKeys || []),
    "trinket",
])));

export const itemDetailIndex = gameDataIndex?.itemDetailIndex || {};
// Keep immutable copies of the bundled canonical names. Runtime plugin catalogs
// replace the live indexes below, and their `name` fields can use a different
// locale or a slightly different refined-item spelling. UI translation uses
// these HRID-keyed names as stable dictionary keys.
export const bundledItemNameByHrid = Object.freeze({ ...(gameDataIndex?.itemNameByHrid || {}) });
export const bundledAbilityNameByHrid = Object.freeze({ ...(gameDataIndex?.abilityNameByHrid || {}) });
export const bundledActionNameByHrid = Object.freeze({ ...(gameDataIndex?.actionNameByHrid || {}) });
export const bundledHouseRoomNameByHrid = Object.freeze({ ...(gameDataIndex?.houseRoomNameByHrid || {}) });
export const itemVendorPriceByHrid = gameDataIndex?.itemVendorPriceByHrid || {};
export const abilityDetailIndex = gameDataIndex?.abilityDetailIndex || {};
export const actionDetailIndex = gameDataIndex?.actionDetailIndex || {};
// Full runtime maps used by simulation/economy code. Unlike the generated UI
// indexes, these retain dungeon reward tables and are replaced in-place when
// the plugin catalog changes versions.
export const actionDetailMap = actionDetailMapData;
export const itemDetailMap = itemDetailMapData;
export const openableLootDropMap = openableLootDropMapData;
export const shopItemDetailMap = dungeonTokenShopItemDetailMapData;
export const monsterDetailIndex = gameDataIndex?.monsterDetailIndex || {};
export const houseRoomDetailIndex = gameDataIndex?.houseRoomDetailIndex || {};
export const buffTypeDetailIndex = buffTypeDetailMap || {};
export const skillDetailIndex = skillDetailMap || {};
export const itemCategoryDetailIndex = itemCategoryDetailMap || {};

export const levelExperienceTable = Array.isArray(gameDataIndex?.levelExperienceTable) ? gameDataIndex.levelExperienceTable : [];
export const abilityBookInfoByAbilityHrid = gameDataIndex?.abilityBookInfoByAbilityHrid || {};

export const equipmentOptionsBySlot = gameDataIndex?.equipmentBySlot || {};
export const foodOptions = Array.isArray(gameDataIndex?.foodOptions) ? gameDataIndex.foodOptions : [];
export const drinkOptions = Array.isArray(gameDataIndex?.drinkOptions) ? gameDataIndex.drinkOptions : [];
export const abilityOptions = Array.isArray(gameDataIndex?.abilityOptions) ? gameDataIndex.abilityOptions : [];
export const specialAbilityOptions = Array.isArray(gameDataIndex?.specialAbilityOptions) ? gameDataIndex.specialAbilityOptions : [];
export const zoneOptions = Array.isArray(gameDataIndex?.zones) ? gameDataIndex.zones : [];
export const dungeonOptions = Array.isArray(gameDataIndex?.dungeons) ? gameDataIndex.dungeons : [];
export const groupZoneHrids = Array.isArray(gameDataIndex?.groupZoneHrids) ? gameDataIndex.groupZoneHrids : [];
export const soloZoneHrids = Array.isArray(gameDataIndex?.soloZoneHrids) ? gameDataIndex.soloZoneHrids : [];
export const labyrinthOptions = Array.isArray(gameDataIndex?.labyrinthOptions) ? gameDataIndex.labyrinthOptions : [];
export const houseRoomOptions = Array.isArray(gameDataIndex?.houseRoomOptions) ? gameDataIndex.houseRoomOptions : [];
export const houseRoomHrids = Array.isArray(gameDataIndex?.houseRoomHrids) ? gameDataIndex.houseRoomHrids : [];
export const labyrinthCrateOptions = gameDataIndex?.labyrinthCrates || { coffee: [], food: [], tea: [] };
function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) {
        deepFreeze(child);
    }
    return Object.freeze(value);
}

export const enhancementData = deepFreeze(gameDataIndex?.enhancementData || {});
export const skillingData = deepFreeze(gameDataIndex?.skillingData || {});

function replaceCollection(target, source) {
    if (Array.isArray(target)) {
        target.splice(0, target.length, ...(Array.isArray(source) ? source : []));
        return;
    }
    for (const key of Object.keys(target || {})) {
        delete target[key];
    }
    Object.assign(target, source && typeof source === "object" ? source : {});
}

function sortOptions(options) {
    return options.sort((left, right) => (
        Number(left?.sortIndex || 0) - Number(right?.sortIndex || 0)
        || Number(left?.itemLevel || 0) - Number(right?.itemLevel || 0)
        || String(left?.name || "").localeCompare(String(right?.name || ""))
    ));
}

function resolveEquipmentSlot(typeHrid, equipmentTypeMap) {
    if (typeHrid === "/equipment_types/main_hand" || typeHrid === "/equipment_types/two_hand") {
        return "weapon";
    }
    const locationHrid = String(equipmentTypeMap?.[typeHrid]?.itemLocationHrid || "");
    const prefix = "/item_locations/";
    const slot = locationHrid.startsWith(prefix) ? locationHrid.slice(prefix.length) : "";
    return EQUIPMENT_SLOT_KEYS.includes(slot) ? slot : "";
}

function rebuildRuntimeIndexes(maps) {
    const itemMap = maps.itemDetailMap || {};
    const equipmentTypeMap = maps.equipmentTypeDetailMap || {};
    const nextItems = {};
    const nextVendor = {};
    const nextBooks = {};
    const nextEquipment = Object.fromEntries(EQUIPMENT_SLOT_KEYS.map((slot) => [slot, []]));
    const nextFood = [];
    const nextDrinks = [];
    for (const item of Object.values(itemMap)) {
        const hrid = String(item?.hrid || "");
        if (!hrid) continue;
        nextItems[hrid] = item;
        nextVendor[hrid] = Math.max(0, Number(item?.sellPrice || 0));
        const abilityHrid = String(item?.abilityBookDetail?.abilityHrid || "");
        const xpPerBook = Number(item?.abilityBookDetail?.experienceGain || 0);
        if (abilityHrid && xpPerBook > Number(nextBooks?.[abilityHrid]?.xpPerBook || 0)) {
            nextBooks[abilityHrid] = { itemHrid: hrid, xpPerBook };
        }
        const option = { hrid, name: String(item?.name || hrid), itemLevel: Number(item?.itemLevel || 0), sortIndex: Number(item?.sortIndex || 0) };
        if (item?.categoryHrid === "/item_categories/equipment") {
            const slot = resolveEquipmentSlot(String(item?.equipmentDetail?.type || ""), equipmentTypeMap);
            if (slot) nextEquipment[slot].push(option);
        } else if (item?.categoryHrid === "/item_categories/food") {
            nextFood.push(option);
        } else if (item?.categoryHrid === "/item_categories/drink") {
            nextDrinks.push(option);
        }
    }
    for (const values of Object.values(nextEquipment)) sortOptions(values);
    replaceCollection(itemDetailIndex, nextItems);
    replaceCollection(itemVendorPriceByHrid, nextVendor);
    replaceCollection(abilityBookInfoByAbilityHrid, nextBooks);
    replaceCollection(equipmentOptionsBySlot, nextEquipment);
    replaceCollection(foodOptions, sortOptions(nextFood));
    replaceCollection(drinkOptions, sortOptions(nextDrinks));

    const nextAbilities = {};
    const normalAbilities = [];
    const specialAbilities = [];
    for (const ability of Object.values(maps.abilityDetailMap || {})) {
        const hrid = String(ability?.hrid || "");
        if (!hrid) continue;
        nextAbilities[hrid] = ability;
        const option = { hrid, name: String(ability?.name || hrid), sortIndex: Number(ability?.sortIndex || 0) };
        (ability?.isSpecialAbility ? specialAbilities : normalAbilities).push(option);
    }
    replaceCollection(abilityDetailIndex, nextAbilities);
    replaceCollection(abilityOptions, sortOptions(normalAbilities));
    replaceCollection(specialAbilityOptions, sortOptions(specialAbilities));

    const nextActions = {};
    const zones = [];
    const dungeons = [];
    const groupHrids = [];
    const soloHrids = [];
    for (const action of Object.values(maps.actionDetailMap || {})) {
        const hrid = String(action?.hrid || "");
        if (!hrid) continue;
        nextActions[hrid] = action;
        if (action?.type !== "/action_types/combat") continue;
        const option = { hrid, name: String(action?.name || hrid), maxDifficulty: Number(action?.maxDifficulty || 0), sortIndex: Number(action?.sortIndex || 0) };
        if (action?.combatZoneInfo?.isDungeon === true) {
            dungeons.push(option);
        } else {
            zones.push(option);
            const spawnCount = Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount || 0);
            if (spawnCount > 1) groupHrids.push(hrid);
            if (spawnCount === 1) soloHrids.push(hrid);
        }
    }
    replaceCollection(actionDetailIndex, nextActions);
    replaceCollection(zoneOptions, sortOptions(zones));
    replaceCollection(dungeonOptions, sortOptions(dungeons));
    replaceCollection(groupZoneHrids, groupHrids);
    replaceCollection(soloZoneHrids, soloHrids);

    const nextMonsters = {};
    const labs = [];
    for (const monster of Object.values(maps.combatMonsterDetailMap || {})) {
        const hrid = String(monster?.hrid || "");
        if (!hrid) continue;
        nextMonsters[hrid] = monster;
        if (monster?.isLabyrinthMonster === true) labs.push({ hrid, name: String(monster?.name || hrid), sortIndex: Number(monster?.sortIndex || 0) });
    }
    replaceCollection(monsterDetailIndex, nextMonsters);
    replaceCollection(labyrinthOptions, sortOptions(labs));

    const nextRooms = {};
    const roomOptions = [];
    const roomHrids = [];
    for (const room of Object.values(maps.houseRoomDetailMap || {})) {
        const hrid = String(room?.hrid || "");
        if (!hrid) continue;
        nextRooms[hrid] = room;
        roomHrids.push(hrid);
        roomOptions.push({ hrid, name: String(room?.name || hrid), sortIndex: Number(room?.sortIndex || 0) });
    }
    replaceCollection(houseRoomDetailIndex, nextRooms);
    replaceCollection(houseRoomOptions, sortOptions(roomOptions));
    replaceCollection(houseRoomHrids, roomHrids);
    replaceCollection(levelExperienceTable, maps.levelExperienceTable || []);

    for (const [crateType, hrids] of Object.entries({
        coffee: ["/items/basic_coffee_crate", "/items/advanced_coffee_crate", "/items/expert_coffee_crate"],
        food: ["/items/basic_food_crate", "/items/advanced_food_crate", "/items/expert_food_crate"],
        tea: ["/items/basic_tea_crate", "/items/advanced_tea_crate", "/items/expert_tea_crate"],
    })) {
        replaceCollection(labyrinthCrateOptions[crateType], hrids.map((hrid) => ({ hrid, name: String(itemMap?.[hrid]?.name || hrid) })));
    }
}

export function validateRuntimeCombatGameData(maps) {
    if (!maps || typeof maps !== "object") return false;
    return REQUIRED_COMBAT_GAME_DATA_KEYS.every((key) => {
        const value = maps[key];
        return Array.isArray(value) ? value.length > 0 : Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
    });
}

export function applyRuntimeCombatGameData(maps) {
    if (!validateRuntimeCombatGameData(maps)) {
        throw new Error("Combat game data is incomplete or invalid.");
    }
    for (const key of REQUIRED_COMBAT_GAME_DATA_KEYS) {
        replaceCollection(runtimeMapTargets[key], maps[key]);
    }
    for (const key of OPTIONAL_COMBAT_GAME_DATA_KEYS) {
        if (maps[key] && typeof maps[key] === "object") {
            replaceCollection(runtimeMapTargets[key], maps[key]);
        }
    }
    rebuildRuntimeIndexes(maps);
    return true;
}

export function getBundledCombatGameDataMaps() {
    return Object.fromEntries(
        [...REQUIRED_COMBAT_GAME_DATA_KEYS, ...OPTIONAL_COMBAT_GAME_DATA_KEYS]
            .map((key) => [key, runtimeMapTargets[key]])
    );
}

function normalizeSkillHrid(skillKey) {
    const normalized = String(skillKey || "").trim();
    if (!normalized) {
        return "";
    }

    if (normalized.startsWith("/skills/")) {
        return `/skills/${normalized.slice("/skills/".length).toLowerCase()}`;
    }

    const shortKey = normalized.split("/").filter(Boolean).pop() || normalized;
    return `/skills/${shortKey.toLowerCase()}`;
}

export function getItemName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(itemDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getAbilityName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(abilityDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getActionName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(actionDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getMonsterName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(monsterDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getHouseRoomName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(houseRoomDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getBuffTypeName(hrid, fallback = "") {
    const normalized = String(hrid || "").trim();
    if (!normalized) {
        return String(fallback || "");
    }
    return String(buffTypeDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getSkillName(skillKey, fallback = "") {
    const raw = String(skillKey || "").trim();
    if (!raw) {
        return String(fallback || "");
    }

    const normalizedHrid = normalizeSkillHrid(raw);
    return String(skillDetailIndex?.[normalizedHrid]?.name || fallback || raw);
}

export function getItemCategoryName(hrid, fallback = "") {
    const normalized = String(hrid || "").trim();
    if (!normalized) {
        return String(fallback || "");
    }
    return String(itemCategoryDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getSortedHouseRoomOptions() {
    return houseRoomOptions;
}
