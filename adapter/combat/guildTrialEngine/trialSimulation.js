// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatSimulator from "./combatSimulator.js";
import Player from "./player.js";
import Trial from "./trial.js";
import abilityDetailMap from "./data/abilityDetailMap.json";
import houseRoomDetailMap from "./data/houseRoomDetailMap.json";






const ONE_SECOND = 1e9;
const SIXTY_MINUTES = 60 * 60 * ONE_SECOND;

function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6D2B79F5;
        let result = value;
        result = Math.imul(result ^ (result >>> 15), result | 1);
        result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
        return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
}

function combatLevel(levels) {
    return 0.1 * (
        levels.staminaLevel
        + levels.intelligenceLevel
        + levels.attackLevel
        + levels.defenseLevel
        + Math.max(levels.meleeLevel, levels.rangedLevel, levels.magicLevel)
    ) + 0.5 * Math.max(
        levels.attackLevel,
        levels.defenseLevel,
        levels.meleeLevel,
        levels.rangedLevel,
        levels.magicLevel,
    );
}

const GUILD_TRIAL_BUILDING_BY_SKILL = {
    "/skills/stamina": "/guild_buildings/dining_room",
    "/skills/intelligence": "/guild_buildings/library",
    "/skills/attack": "/guild_buildings/dojo",
    "/skills/defense": "/guild_buildings/armory",
    "/skills/melee": "/guild_buildings/gym",
    "/skills/ranged": "/guild_buildings/archery_range",
    "/skills/magic": "/guild_buildings/mystical_study",
};

function guildTrialBuildingLevel(guildBuildingLevels, buildingHrid) {
    const rawBuildingLevel = Number(guildBuildingLevels?.[buildingHrid]);
    const buildingLevel = Number.isInteger(rawBuildingLevel)
        ? Math.max(0, Math.min(20, rawBuildingLevel))
        : 0;
    return buildingLevel;
}

function guildTrialSkillLevel(skills, guildBuildingLevels, skillHrid) {
    const baseLevel = Number(skills?.[skillHrid]) || 0;
    const buildingHrid = GUILD_TRIAL_BUILDING_BY_SKILL[skillHrid];
    return baseLevel + 2 * guildTrialBuildingLevel(guildBuildingLevels, buildingHrid);
}

function buildPlayerDto(member, buildType) {
    const preset = member.preset;
    const selection = preset.trialBuild;
    const skills = preset.skills;
    const guildBuildingLevels = preset.guildBuildingLevels || member.guildBuildingLevels || {};
    const dto = {
        hrid: `player-${member.characterId}`,
        staminaLevel: guildTrialSkillLevel(skills, guildBuildingLevels, "/skills/stamina"),
        intelligenceLevel: guildTrialSkillLevel(skills, guildBuildingLevels, "/skills/intelligence"),
        attackLevel: guildTrialSkillLevel(skills, guildBuildingLevels, "/skills/attack"),
        defenseLevel: guildTrialSkillLevel(skills, guildBuildingLevels, "/skills/defense"),
        meleeLevel: guildTrialSkillLevel(skills, guildBuildingLevels, "/skills/melee"),
        rangedLevel: guildTrialSkillLevel(skills, guildBuildingLevels, "/skills/ranged"),
        magicLevel: guildTrialSkillLevel(skills, guildBuildingLevels, "/skills/magic"),
        equipment: {},
        food: [null, null, null],
        drinks: [null, null, null],
        abilities: [null, null, null, null, null],
        houseRooms: Object.fromEntries(
            Object.entries(preset.houseRooms || {}).filter(([hrid]) => houseRoomDetailMap[hrid]),
        ),
        achievements: preset.achievements || {},
        guildBuildingLevels,
        characterGuildBuffs: preset.characterGuildBuffs || member.characterGuildBuffs || {},
        debuffOnLevelGap: 0,
    };
    for (const item of selection.equipment || []) {
        const type = item.locationHrid.replace("/item_locations/", "/equipment_types/");
        dto.equipment[type] = { hrid: item.itemHrid, enhancementLevel: item.enhancementLevel };
    }
    for (const ability of selection.abilities || []) {
        if (ability.slot < 0 || ability.slot > 4) continue;
        dto.abilities[ability.slot] = {
            hrid: ability.abilityHrid,
            level: ability.level,
            triggers: (ability.triggers || []).slice(0, 4),
        };
    }
    dto.combatLevel = combatLevel(dto);
    return dto;
}

function preparePlayers(team) {
    const dtos = team.map((member) => buildPlayerDto(member, member.buildType));
    for (const dto of dtos) {
        dto.debuffOnLevelGap = 0;
    }
    return dtos.map((dto) => {
        const player = Player.createFromDTO(dto);
        player.extraBuffs = Object.entries(dto.characterGuildBuffs || {})
            .filter(([, guildBuff]) => guildBuff?.isCombat === true)
            .flatMap(([guildBuffHrid, guildBuff]) => (
                Array.isArray(guildBuff.attributes) ? guildBuff.attributes : []
            ).map((attribute, index) => ({
                uniqueHrid: `${guildBuffHrid}:${index}`,
                typeHrid: String(attribute.typeHrid || ""),
                flatBoost: Number(attribute.flatBoost) || 0,
                ratioBoost: Number(attribute.ratioBoost) || 0,
                duration: Number.POSITIVE_INFINITY,
            })))
            .filter((buff) => buff.typeHrid);
        player.baseHitpointRegenPer10 = 0.04
            + 0.003 * guildTrialBuildingLevel(
                dto.guildBuildingLevels,
                "/guild_buildings/dining_room",
            );
        player.baseManapointRegenPer10 = 0.04
            + 0.003 * guildTrialBuildingLevel(
                dto.guildBuildingLevels,
                "/guild_buildings/library",
            );
        return player;
    });
}

function sumDamage(attacks) {
    let damage = 0;
    for (const targets of Object.values(attacks || {})) {
        for (const abilities of Object.values(targets || {})) {
            for (const hits of Object.values(abilities || {})) {
                for (const [hit, count] of Object.entries(hits || {})) {
                    const amount = Number(hit);
                    if (Number.isFinite(amount)) damage += amount * count;
                }
            }
        }
    }
    return damage;
}

function sumValues(values) {
    return Object.values(values || {}).reduce(
        (total, value) => total + (Number(value) || 0),
        0,
    );
}

function damageTakenBy(attacks, targetHrid) {
    let damage = 0;
    for (const [sourceHrid, targets] of Object.entries(attacks || {})) {
        if (targets?.[targetHrid]) {
            damage += sumDamage({
                [sourceHrid]: {
                    [targetHrid]: targets[targetHrid],
                },
            });
        }
    }
    return damage;
}

function countRecordedAttacks(hits) {
    return Object.values(hits || {}).reduce(
        (total, count) => total + (Number(count) || 0),
        0,
    );
}

function incomingAttackCounts(attacks, targetHrid) {
    let normalAttacks = 0;
    let singleTargetAbilityAttacks = 0;
    for (const [sourceHrid, targets] of Object.entries(attacks || {})) {
        if (String(sourceHrid).startsWith("player-")) continue;
        for (const [abilityHrid, hits] of Object.entries(targets?.[targetHrid] || {})) {
            const count = countRecordedAttacks(hits);
            if (abilityHrid === "autoAttack") {
                normalAttacks += count;
                continue;
            }
            const isSingleTargetDamage = (abilityDetailMap[abilityHrid]?.abilityEffects || [])
                .some((effect) => (
                    effect?.effectType === "/ability_effect_types/damage"
                    && effect?.targetType === "enemy"
                ));
            if (isSingleTargetDamage) singleTargetAbilityAttacks += count;
        }
    }
    return { normalAttacks, singleTargetAbilityAttacks };
}

function outOfManaRatio(result, playerHrid) {
    const duration = Number(result.simulatedTime);
    const state = result.playerRanOutOfManaTime[playerHrid];
    if (!state || duration <= 0) return 0;
    const unfinished = state.isOutOfMana
        ? Math.max(0, duration - state.startTimeForOutOfMana)
        : 0;
    return Math.min(
        1,
        Math.max(0, (state.totalTimeForOutOfMana + unfinished) / duration),
    );
}

async function simulateTrialRun(team, monsterHrids, seed, options = {}) {
    const previousRandom = Math.random;
    const random = seededRandom(seed);
    let rngCalls = 0;
    Math.random = options.onEvent ? () => { rngCalls++; return random(); } : random;
    try {
        const players = preparePlayers(structuredClone(team));
        const trial = new Trial(monsterHrids, {
            startingFloor: 1,
            startLevel: 100,
            maxLevel: 300,
            participantCount: players.length,
        });
        const simulator = new CombatSimulator(players, null, null, { trial });
        if (options.onProgress) simulator.addEventListener("progress", event => options.onProgress({
            ...event.detail, currentLevel: trial.currentLevel, layersCompleted: trial.completedFloor,
        }));
        if (options.onEvent) {
            const process = simulator.processEvent.bind(simulator);
            simulator.processEvent = async event => {
                await process(event);
                options.onEvent(event, simulator, rngCalls);
            };
        }
        const result = await simulator.simulate(SIXTY_MINUTES);
        options.onResult?.(result);
        const currentEnemies = simulator.enemies || [];
        return summarizeTrialRun(team, players, currentEnemies, result, seed);
    } finally {
        Math.random = previousRandom;
    }
}
export { ONE_SECOND as ONE_SECOND };
export { SIXTY_MINUTES as SIXTY_MINUTES };
export { simulateTrialRun as simulateTrialRun };

export { buildPlayerDto, preparePlayers, seededRandom };

export function summarizeTrialRun(team, players, currentEnemies, result, seed) {
    const remainingHp = currentEnemies.reduce(
        (total, enemy) => total + Math.max(0, enemy.combatDetails.currentHitpoints),
        0,
    );
    const maximumHp = currentEnemies.reduce(
        (total, enemy) => total + enemy.combatDetails.maxHitpoints,
        0,
    );
    const progress = maximumHp > 0 ? Math.max(0, Math.min(1, 1 - remainingHp / maximumHp)) : 0;
    const partialFloorPoints = Math.min(99, Math.floor(progress * 100));
    const memberNameMap = new Map(team.map((member) => [
        `player-${member.characterId}`,
        {
            characterId: member.characterId,
            characterName: member.characterName,
        },
    ]));
    const memberStats = players.map((player) => {
        const identity = memberNameMap.get(player.hrid);
        const attackCounts = incomingAttackCounts(result.attacks, player.hrid);
        return {
            characterId: identity.characterId,
            characterName: identity.characterName,
            maxHitpoints: player.combatDetails?.maxHitpoints ?? 0,
            damage: sumDamage({ [player.hrid]: result.attacks[player.hrid] }),
            damageTaken: damageTakenBy(result.attacks, player.hrid),
            incomingNormalAttacks: attackCounts.normalAttacks,
            incomingSingleTargetAbilityAttacks: attackCounts.singleTargetAbilityAttacks,
            healing: sumValues(result.healingDone[player.hrid]),
            healthRestored: sumValues(result.hitpointsGained[player.hrid]),
            outOfManaRatio: outOfManaRatio(result, player.hrid),
            ranOutOfMana: Boolean(result.playerRanOutOfMana[player.hrid]),
            deaths: Number(result.deaths[player.hrid]) || 0,
            alive: player.combatDetails.currentHitpoints > 0,
        };
    });
    return {
        remainingEnemies: currentEnemies.map(enemy => ({ hrid: enemy.hrid,
            currentHitpoints: enemy.combatDetails.currentHitpoints, maxHitpoints: enemy.combatDetails.maxHitpoints })),
        seed,
        completedFloor: result.trial.completedFloor,
        currentFloor: result.trial.currentFloor,
        currentLevel: result.trial.currentLevel,
        points: result.trial.points + partialFloorPoints,
        completedFloorPoints: result.trial.points,
        partialFloorPoints,
        currentFloorProgress: progress,
        simulatedSeconds: Number(result.simulatedTime) / ONE_SECOND,
        failed: result.trial.failed,
        endedReason: result.trial.endedReason,
        failureTimeSeconds: result.trial.failureTime == null
            ? null
            : result.trial.failureTime / ONE_SECOND,
        floorResults: result.trial.floorResults.map((floor) => ({
            floor: floor.floor,
            durationSeconds: floor.duration / ONE_SECOND,
            completedAtSeconds: floor.completedAt / ONE_SECOND,
        })),
        maxEnrageStack: result.maxEnrageStack,
        memberStats,
    };
}
