import CombatSimulator from "./combatsimulator/combatSimulator.js";
import Player from "./combatsimulator/player.js";
import Zone from "./combatsimulator/zone.js";
import Labyrinth from "./combatsimulator/labyrinth.js";
import { buildSimulationExtraBuffs } from "./shared/simulationExtraBuffs.js";
import { setRuntimeCombatGameData } from "./shared/runtimeGameData.js";
import { createSeededRandom, SIMULATION_ENGINE_VERSION } from "./shared/simulationVersion.js";
import { runRustSimulation, VERIFIED_RUST_MODES, RUST_IMPLEMENTATION_VERSION } from "./services/rustEngine.js";

/**
 * Environment-independent simulation entry used by both browser Workers and the
 * outbound-only Mac compute agent. A seed is optional for ordinary runs; upgrade
 * comparisons pass the same seed per round to baseline and every variant.
 */
export async function runJavaScriptSimulation(eventData = {}, onProgress = () => {}) {
    const combatMode = eventData.combatMode || (eventData.labyrinth ? "labyrinth" : "normal");
    if (!["normal", "labyrinth", "task"].includes(combatMode)) throw new Error("Unsupported combat mode");
    const taskDamageEnabled = combatMode === "task";
    if (taskDamageEnabled && (!eventData.zone?.zoneHrid || eventData.taskContext?.zoneHrid !== eventData.zone.zoneHrid)) {
        throw new Error("Task combat requires a matching zone context");
    }
    if (eventData?.gameDataEnvelope) {
        setRuntimeCombatGameData(eventData.gameDataEnvelope);
    }

    const extraBuffs = buildSimulationExtraBuffs(eventData.extra);
    const zone = eventData.zone
        ? new Zone(eventData.zone.zoneHrid, eventData.zone.difficultyTier)
        : null;
    const labyrinth = eventData.labyrinth
        ? new Labyrinth(eventData.labyrinth.labyrinthHrid, eventData.labyrinth.roomLevel, eventData.labyrinth.crates)
        : null;
    const players = (eventData.players || []).map((playerData) => {
        const player = Player.createFromDTO(structuredClone(playerData));
        player.zoneBuffs = zone?.buffs || labyrinth?.buffs || [];
        player.extraBuffs = extraBuffs;
        player.taskDamageEnabled = taskDamageEnabled;
        return player;
    });
    const enableHpMpVisualization = eventData.extra?.enableHpMpVisualization || false;
    const simulator = new CombatSimulator(players, zone, labyrinth, { enableHpMpVisualization, omitWipeDetails: eventData.extra?.omitWipeDetails === true });
    simulator.addEventListener("progress", (event) => onProgress({
        progress: event.detail.progress,
        zone: event.detail.zone,
        difficultyTier: event.detail.difficultyTier,
        labyrinth: event.detail.labyrinth,
        roomLevel: event.detail.roomLevel,
        timeSeriesData: event.detail.timeSeriesData,
    }));

    const originalRandom = Math.random;
    const random = eventData.seed != null ? createSeededRandom(eventData.seed) : originalRandom;
    let rngCalls = 0, eventCount = 0;
    const eventTrace = [];
    const traceLimit = Math.max(0, Math.min(100000, Number(eventData.traceLimit) || 0));
    Math.random = traceLimit ? () => { rngCalls++; return random(); } : random;
    if (traceLimit) {
        const processEvent = simulator.processEvent.bind(simulator);
        simulator.processEvent = async event => {
            await processEvent(event);
            eventCount++;
            if (eventTrace.length < traceLimit) eventTrace.push({
                kind: event.type, time: event.time, rngCalls,
                players: simulator.players.map(p => [p.hrid, p.combatDetails.currentHitpoints, p.combatDetails.currentManapoints]),
                enemies: (simulator.enemies || []).map(p => [p.hrid, p.combatDetails.currentHitpoints])
            });
        };
    }
    try {
        const result = await simulator.simulate(eventData.simulationTimeLimit);
        if (traceLimit) Object.assign(result, {eventTrace, eventCount, rngCalls});
        return Object.assign(result, { engineVersion: SIMULATION_ENGINE_VERSION, combatMode, seed: eventData.seed });
    } finally {
        Math.random = originalRandom;
    }
}

export async function runSimulationPayload(eventData = {}, onProgress = () => {}) {
    const mode = eventData.combatMode || (eventData.labyrinth ? "labyrinth" : "normal");
    const payload = { ...eventData, seed: eventData.seed ?? Math.floor(Math.random() * 0x100000000) };
    if (payload.gameDataEnvelope) setRuntimeCombatGameData(payload.gameDataEnvelope);
    if (payload.engineImplementation !== "javascript" && VERIFIED_RUST_MODES.includes(mode)) {
        try {
            onProgress({ progress: 0 });
            const result = await runRustSimulation(payload);
            onProgress({ progress: 1 });
            return { ...result, engineVersion: SIMULATION_ENGINE_VERSION, combatMode: mode, seed: payload.seed,
                implementationVersion: RUST_IMPLEMENTATION_VERSION };
        } catch (error) {
            const result = await runJavaScriptSimulation(payload, onProgress);
            return { ...result, implementationVersion: "javascript", fallbackReason: String(error?.message || error) };
        }
    }
    const result = await runJavaScriptSimulation(payload, onProgress);
    return { ...result, implementationVersion: "javascript" };
}

export async function handleSimulationMessage(eventData = {}, workerScope = globalThis) {
    if (eventData.type !== "start_simulation") return;
    try {
        const simResult = await runSimulationPayload(eventData, (detail) => {
            workerScope.postMessage({ type: "simulation_progress", ...detail });
        });
        workerScope.postMessage({ type: "simulation_result", simResult });
    } catch (error) {
        workerScope.postMessage({
            type: "simulation_error",
            error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        });
    }
}

if (typeof globalThis.postMessage === "function" && typeof globalThis.document === "undefined") {
    globalThis.onmessage = (event) => handleSimulationMessage(event.data, globalThis);
}
