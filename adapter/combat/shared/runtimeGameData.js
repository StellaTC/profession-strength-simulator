import {
    applyRuntimeCombatGameData,
    getBundledCombatGameDataMaps,
    validateRuntimeCombatGameData,
} from "./gameDataIndex.js";

let activeEnvelope = {
    schemaVersion: 1,
    source: "bundled",
    capturedAt: 0,
    gameVersion: "v1.0.28-fallback",
    versionTimestamp: "2026-07-16T04:55:25.440Z",
    maps: getBundledCombatGameDataMaps(),
};

export function normalizeCombatGameDataEnvelope(value) {
    let parsed = value;
    if (typeof parsed === "string") {
        parsed = JSON.parse(parsed);
    }
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Combat game data envelope is invalid.");
    }
    const maps = parsed.maps && typeof parsed.maps === "object" ? parsed.maps : parsed;
    if (!validateRuntimeCombatGameData(maps)) {
        throw new Error("Combat game data is missing required maps.");
    }
    return {
        schemaVersion: 1,
        source: String(parsed.source || "plugin"),
        capturedAt: Number(parsed.capturedAt || Date.now()),
        gameVersion: String(parsed.gameVersion || maps.gameVersion || "unknown"),
        versionTimestamp: String(parsed.versionTimestamp || maps.versionTimestamp || ""),
        maps,
    };
}

export function setRuntimeCombatGameData(value) {
    const next = normalizeCombatGameDataEnvelope(value);
    applyRuntimeCombatGameData(next.maps);
    activeEnvelope = next;
    return activeEnvelope;
}

export function getRuntimeCombatGameData() {
    return activeEnvelope;
}

export function getRuntimeCombatGameDataVersion() {
    return `${activeEnvelope.gameVersion}|${activeEnvelope.versionTimestamp}`;
}
