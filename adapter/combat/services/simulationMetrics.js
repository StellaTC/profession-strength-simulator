export function resolveCompletedEncounterCount(simResult) {
    if (simResult?.isDungeon) {
        return Math.max(0, Number(simResult?.dungeonsCompleted || 0))
            + Math.max(0, Number(simResult?.dungeonsFailed || 0));
    }
    return Math.max(0, Number(simResult?.encounters || 0));
}

export function resolveCompletedSimulationTime(simResult) {
    const simulatedTime = Math.max(0, Number(simResult?.simulatedTime || 0));
    if (!simResult?.isDungeon || Number(simResult?.dungeonTerminalTrackingVersion || 0) < 1) {
        return simulatedTime;
    }
    return Math.min(simulatedTime, Math.max(0, Number(simResult?.lastDungeonFinishTime || 0)));
}

export function resolvePlayerOutOfManaTimeRatio(simResult, playerHrid) {
    const simulatedTime = Math.max(0, Number(simResult?.simulatedTime || 0));
    if (simulatedTime <= 0) {
        return 0;
    }

    const state = simResult?.playerRanOutOfManaTime?.[String(playerHrid || "")];
    if (!state || typeof state !== "object") {
        return 0;
    }

    let totalTime = Math.max(0, Number(state.totalTimeForOutOfMana || 0));
    if (state.isOutOfMana) {
        const startTime = Math.max(0, Number(state.startTimeForOutOfMana || 0));
        totalTime += Math.max(0, simulatedTime - startTime);
    }

    return Math.max(0, Math.min(1, totalTime / simulatedTime));
}

export function formatOutOfManaTimeRatio(value) {
    const ratio = Math.max(0, Math.min(1, Number(value || 0)));
    const percentage = ratio * 100;
    return `${percentage.toFixed(percentage > 0 && percentage < 0.1 ? 2 : 1)}%`;
}
