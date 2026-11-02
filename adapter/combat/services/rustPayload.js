// scenarioPlayer adapted from wow121/mwi-fastsim @ de2e774; see engine/UPSTREAM.md.
// Initialization uses OUR existing Player/Zone classes, so game-data and buff handling have one source.
import Player from "../combatsimulator/player.js";
import Zone from "../combatsimulator/zone.js";
import Labyrinth from "../combatsimulator/labyrinth.js";
import { buildSimulationExtraBuffs } from "../shared/simulationExtraBuffs.js";
import { getRuntimeCombatGameData } from "../shared/runtimeGameData.js";
import { resolveAbilityDefinition } from "../combatsimulator/abilityDefinitionResolver.js";
const PLAYER_KEYS = [
  "stabAccuracy", "slashAccuracy", "smashAccuracy", "rangedAccuracy", "magicAccuracy",
  "stabDamage", "slashDamage", "smashDamage", "rangedDamage", "magicDamage", "defensiveDamage",
  "taskDamage", "physicalAmplify", "waterAmplify", "natureAmplify", "fireAmplify",
  "healingAmplify", "stabEvasion", "slashEvasion", "smashEvasion", "rangedEvasion",
  "magicEvasion", "armor", "waterResistance", "natureResistance", "fireResistance",
  "maxHitpoints", "maxManapoints", "lifeSteal", "hpRegenPer10", "mpRegenPer10",
  "physicalThorns", "elementalThorns", "combatDropRate", "combatRareFind",
  "combatDropQuantity", "combatExperience", "criticalRate", "criticalDamage",
  "armorPenetration", "waterPenetration", "naturePenetration", "firePenetration",
  "abilityHaste", "tenacity", "manaLeech", "castSpeed", "threat", "parry", "mayhem", "pierce",
  "curse", "fury", "weaken", "ripple", "bloom", "blaze", "attackSpeed", "foodHaste",
  "drinkConcentration", "autoAttackDamage", "abilityDamage", "staminaExperience",
  "intelligenceExperience", "attackExperience", "defenseExperience", "meleeExperience",
  "rangedExperience", "magicExperience", "retaliation",
]
const SKILLS = ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"]

function trig(t) {
  return {
    dependencyHrid: t.dependencyHrid,
    conditionHrid: t.conditionHrid,
    comparatorHrid: t.comparatorHrid,
    value: t.value,
  }
}

function buffDef(b) {
  return {
    uniqueHrid: b.uniqueHrid,
    typeHrid: b.typeHrid,
    ratioBoost: b.ratioBoost,
    ratioBoostLevelBonus: 0,
    flatBoost: b.flatBoost,
    flatBoostLevelBonus: 0,
    duration: b.duration,
    multiplierForSkillHrid: b.multiplierForSkillHrid,
    multiplierPerSkillLevel: b.multiplierPerSkillLevel,
  }
}

function consumable(c) {
  if (!c) return null
  return {
    hrid: c.hrid,
    cooldownDuration: c.cooldownDuration,
    hitpointRestore: c.hitpointRestore,
    manapointRestore: c.manapointRestore,
    recoveryDuration: c.recoveryDuration,
    categoryHrid: c.catagoryHrid,
    buffs: c.buffs.map(buffDef),
    triggers: c.triggers.map(trig),
  }
}

/** Scenario player from a set-up player (permanent buffs already generated). */
export function scenarioPlayer(p) {
  const eq = p.equipment
  const w = eq["/equipment_types/main_hand"] || eq["/equipment_types/two_hand"]
  const equipStats = {}
  for (const k of PLAYER_KEYS) {
    equipStats[k] = Object.values(eq).filter(i => i != null).map(i => i.getCombatStat(k)).reduce((i, a) => i + a, 0)
  }
  const pouch = eq["/equipment_types/pouch"]
  const charm = eq["/equipment_types/charm"]
  return {
    hrid: p.hrid,
    levels: SKILLS.map(s => p[`${s}Level`]),
    equipStats,
    combatStyleHrid: w ? w.getCombatStyle() : "/combat_styles/smash",
    damageType: w ? w.getDamageType() : "/damage_types/physical",
    attackInterval: w ? w.getCombatStat("attackInterval") : 3e9,
    primaryTraining: w ? (w.getPrimaryTraining() ?? "") : "/skills/melee",
    focusTraining: charm ? (charm.getFocusTraining() ?? "") : "",
    foodSlots: pouch ? 1 + pouch.getCombatStat("foodSlots") : 1,
    drinkSlots: pouch ? 1 + pouch.getCombatStat("drinkSlots") : 1,
    bulwark: !!eq["/equipment_types/two_hand"]?.hrid.includes("bulwark"),
    abilities: p.abilities.map(a => a ? { hrid: a.hrid, level: a.level, triggers: a.triggers.map(trig) } : null),
    food: p.food.map(consumable),
    drinks: p.drinks.map(consumable),
    permanentBuffs: Object.values(p.permanentBuffs).map(b => ({
      uniqueHrid: b.uniqueHrid,
      typeHrid: b.typeHrid,
      flatBoost: b.flatBoost,
      ratioBoost: b.ratioBoost,
      duration: b.duration,
    })),
    debuffOnLevelGap: p.debuffOnLevelGap,
    taskDamageEnabled: p.taskDamageEnabled === true,
  }
}


export function compileRustPayload(payload) {
  const mode = payload.combatMode || (payload.labyrinth ? "labyrinth" : "normal");
  if (!["normal", "labyrinth", "task"].includes(mode)) throw new Error("Unsupported combat mode");
  if (mode === "task" && (!payload.zone?.zoneHrid || payload.taskContext?.zoneHrid !== payload.zone.zoneHrid)) throw new Error("Task combat requires a matching zone context");
  const zone = payload.zone ? new Zone(payload.zone.zoneHrid, payload.zone.difficultyTier) : null;
  const lab = payload.labyrinth ? new Labyrinth(payload.labyrinth.labyrinthHrid, payload.labyrinth.roomLevel, payload.labyrinth.crates) : null;
  const players = payload.players.map(dto => {
    const player = Player.createFromDTO(structuredClone(dto));
    player.zoneBuffs = zone?.buffs || lab?.buffs || [];
    player.extraBuffs = buildSimulationExtraBuffs(payload.extra);
    player.taskDamageEnabled = mode === "task";
    player.generatePermanentBuffs();
    return scenarioPlayer(player);
  });
  const maps = getRuntimeCombatGameData().maps;
  return {
    combatMode: mode, seed: payload.seed, simulationTimeLimit: payload.simulationTimeLimit,
    enableHpMpVisualization: payload.extra?.enableHpMpVisualization === true,
    omitWipeDetails: payload.extra?.omitWipeDetails === true,
    traceLimit: payload.traceLimit || 0,
    zone: zone ? { hrid: zone.hrid, difficultyTier: zone.difficultyTier, combatZoneInfo: maps.actionDetailMap[zone.hrid].combatZoneInfo } : null,
    labyrinth: lab ? { monsterHrid: payload.labyrinth.labyrinthHrid, roomLevel: payload.labyrinth.roomLevel } : null,
    players,
  };
}
export function rustGameData() {
  const maps = getRuntimeCombatGameData().maps;
  return { abilities: { ...maps.abilityDetailMap, "/abilities/blaze": resolveAbilityDefinition("blaze"), "/abilities/bloom": resolveAbilityDefinition("bloom") }, abilityAliases: { blaze: "/abilities/blaze", bloom: "/abilities/bloom" },
    monsters: maps.combatMonsterDetailMap, combatStyles: maps.combatStyleDetailMap,
    triggerDependencies: maps.combatTriggerDependencyDetailMap };
}
