// Trial rules and catalog remain pinned independently from ordinary combat.
import { BrowserRustEngine } from './rustEngine.js';
import { scenarioPlayer } from './rustPayload.js';
import { preparePlayers, summarizeTrialRun, SIXTY_MINUTES } from '../guildTrialEngine/trialSimulation.js';
import abilities from '../guildTrialEngine/data/abilityDetailMap.json';
import monsters from '../guildTrialEngine/data/combatMonsterDetailMap.json';
import trialMonsters from '../guildTrialEngine/data/guildTrialMonsterDetailMap.json';
import combatStyles from '../guildTrialEngine/data/combatStyleDetailMap.json';
import triggerDependencies from '../guildTrialEngine/data/combatTriggerDependencyDetailMap.json';
import { abilityFromCombatStat } from '../guildTrialEngine/ability.js';
import { GUILD_TRIAL_MONSTER_PATCH_2026_07_15 as patches } from '../guildTrialEngine/monster.js';

export { RUST_TRIAL_IMPLEMENTATION_VERSION } from "../shared/simulationVersion.js";
export function rustTrialGameData() {
  return {
    abilities: { ...abilities, '/abilities/blaze': abilityFromCombatStat.blaze, '/abilities/bloom': abilityFromCombatStat.bloom },
    abilityAliases: { blaze: '/abilities/blaze', bloom: '/abilities/bloom' },
    monsters: Object.fromEntries(Object.entries({ ...monsters, ...trialMonsters }).map(([hrid, entry]) =>
      [hrid, { ...entry, trialPatch: patches[hrid] }])),
    combatStyles, triggerDependencies,
  };
}
export function compileRustTrial(team, monsterHrids, seed, traceLimit = 0) {
  if (!Array.isArray(team) || team.length < 1 || team.length > 100) throw new Error('试炼人数必须为 1～100 人');
  if (!Array.isArray(monsterHrids) || !monsterHrids.length || monsterHrids.some(h => !trialMonsters[h])) throw new Error('无效试炼首领');
  const players = preparePlayers(structuredClone(team)).map(player => {
    player.generatePermanentBuffs();
    return { ...scenarioPlayer(player), baseHitpointRegenPer10: player.baseHitpointRegenPer10,
      baseManapointRegenPer10: player.baseManapointRegenPer10 };
  });
  return { combatMode: 'guild_trial', seed: seed >>> 0, players, trial: { monsterHrids }, simulationTimeLimit: SIXTY_MINUTES, traceLimit };
}
export function summarizeRustTrial(team, raw, seed) {
  return summarizeTrialRun(team, raw.finalPlayers, raw.finalEnemies, raw, seed >>> 0);
}
let active = null;
let loading = null;
export async function runRustTrialSimulation(team, monsterHrids, seed) {
  if (!active && !loading) loading = (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}engine/mwi_engine.wasm`);
    if (!response.ok) throw new Error(`WASM 加载失败 (${response.status})`);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    const engine = new BrowserRustEngine(instance.exports);
    engine.setGameData(rustTrialGameData());
    active = engine;
  })().finally(() => { loading = null; });
  if (loading) await loading;
  try { return summarizeRustTrial(team, active.run(compileRustTrial(team, monsterHrids, seed)), seed); }
  catch (error) { active = null; throw error; }
}
