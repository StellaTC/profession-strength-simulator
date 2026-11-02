import { runRustTrialSimulation } from "./services/rustTrialEngine.js";
import { simulateTrialRun } from "./guildTrialEngine/trialSimulation.js";
import encounters from "./guildTrialEngine/data/guildTrialEncounterDetailMap.json";
import { TRIAL_ENGINE_VERSION, TRIAL_REFERENCE_COMMIT, RUST_TRIAL_IMPLEMENTATION_VERSION, JS_TRIAL_IMPLEMENTATION_VERSION } from "./shared/simulationVersion.js";

/** Adapter only: the event engine and normalized trial input follow 8805f411. */
export function trialTeamFromTemplates(templates) {
    const team = [];
    for (const template of templates || []) {
        const build = typeof template.build === "string" ? JSON.parse(template.build) : template.build;
        if (!build?.player) throw new Error("试炼角色资料缺少基础属性");
        const count = Number(template.count ?? 1);
        if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("试炼角色数量无效");
        for (let index = 0; index < count; index++) {
            team.push({
                characterId: template.characterId ?? team.length + 1,
                characterName: template.name,
                preset: {
                    skills: Object.fromEntries(["stamina", "intelligence", "attack", "defense", "melee", "ranged", "magic"]
                        .map(skill => [`/skills/${skill}`, Number(build.player[`${skill}Level`]) || 1])),
                    houseRooms: build.houseRooms || {}, achievements: build.achievements || {},
                    guildBuildingLevels: build.guildBuildingLevels || {}, characterGuildBuffs: build.characterGuildBuffs || {},
                    trialBuild: {
                        equipment: (build.player.equipment || []).map(item => ({ ...item, locationHrid: item.itemLocationHrid })),
                        abilities: (build.abilities || []).flatMap((ability, slot) => ability?.abilityHrid ? [{
                            ...ability, slot, triggers: build.triggerMap?.[ability.abilityHrid] || [],
                        }] : []),
                    },
                },
            });
        }
    }
    if (!team.length) throw new Error("当前 Boss 没有已分配成员");
    if (team.length > 100) throw new Error("试炼人数不能超过 100 人");
    if (new Set(team.map(member => member.characterId)).size !== team.length) throw new Error("试炼队伍含重复成员");
    return team;
}

export async function runGuildTrialPayload(payload, onProgress = () => {}) {
    if (payload.engineVersion && payload.engineVersion !== TRIAL_ENGINE_VERSION) throw new Error("试炼引擎版本已变更，请刷新后重新计算");
    if (payload.dataVersion && payload.dataVersion !== TRIAL_REFERENCE_COMMIT) throw new Error("试炼数据版本不匹配");
    if (payload.combatMode && payload.combatMode !== "guild_trial") throw new Error("试炼模式不匹配");
    const encounter = encounters[payload.encounterHrid];
    if (!encounter) throw new Error("未知试炼 Boss");
    const team = trialTeamFromTemplates(payload.templates);
    const seed = Number(payload.seed ?? 1) >>> 0;
    let result, fallbackReason;
    let implementationVersion = JS_TRIAL_IMPLEMENTATION_VERSION;
    onProgress({ progress: 0, currentLevel: 100, layersCompleted: 0 });
    if (payload.engineImplementation !== "javascript") {
        try {
            result = await runRustTrialSimulation(team, encounter.monsterHrids, seed);
            implementationVersion = RUST_TRIAL_IMPLEMENTATION_VERSION;
        } catch (error) { fallbackReason = error instanceof Error ? error.message : String(error); }
    }
    // A failed WASM subtask is restarted from the original input and seed in full.
    if (!result) result = await simulateTrialRun(team, encounter.monsterHrids, seed, { onProgress });
    onProgress({ progress: 1, currentLevel: result.currentLevel, layersCompleted: result.completedFloor });
    const templateStats = {};
    for (const member of result.memberStats) {
        const name = team.find(entry => entry.characterId === member.characterId).characterName;
        const row = templateStats[name] ||= { count: 0, alive: 0, damage: 0, healing: 0, healthRestored: 0, outOfManaPercent: 0, deaths: 0 };
        row.count++; row.alive += Number(member.alive); row.damage += member.damage;
        row.healing += member.healing; row.healthRestored += member.healthRestored;
        row.outOfManaPercent += member.outOfManaRatio * 100; row.deaths += member.deaths;
    }
    for (const row of Object.values(templateStats)) row.outOfManaPercent /= row.count;
    return { ...result, encounterHrid: payload.encounterHrid, layersCompleted: result.completedFloor,
        participantCount: team.length, totalDamage: result.memberStats.reduce((sum, member) => sum + member.damage, 0),
        implementationVersion, ...(fallbackReason ? { fallbackReason } : {}),
        templateStats, engineVersion: TRIAL_ENGINE_VERSION, referenceCommit: TRIAL_REFERENCE_COMMIT,
        combatMode: "guild_trial", validationStatus: "single_run", runs: 1 };
}

export async function handleGuildTrialMessage(data, scope = globalThis) {
    if (data.type !== "start_guild_trial") return;
    try {
        const result = await runGuildTrialPayload(data, detail => scope.postMessage({ type: "guild_trial_progress", requestId: data.requestId, ...detail }));
        scope.postMessage({ type: "guild_trial_result", requestId: data.requestId, result });
    } catch (error) {
        scope.postMessage({ type: "guild_trial_error", requestId: data.requestId, error: error instanceof Error ? error.message : String(error) });
    }
}

if (typeof globalThis.postMessage === "function" && typeof globalThis.document === "undefined") {
    let pending = Promise.resolve();
    globalThis.onmessage = ({ data }) => { pending = pending.then(() => handleGuildTrialMessage(data)); };
}
