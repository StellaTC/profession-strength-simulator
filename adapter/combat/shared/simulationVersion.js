export const SIMULATION_ENGINE_VERSION = "combat-events-2.3.0";
export const TRIAL_REFERENCE_COMMIT = "8805f411da28d7ad3ab2913a486a6b4e892d67d8";
export const TRIAL_ENGINE_VERSION = "trial-1.3.0-8805f411";
export const OPTIMIZER_VERSION = "trial-optimizer-2.3.0-browser.3";

// Same uint32 PRNG as the pinned reference, including seed zero.
export function createSeededRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6d2b79f5;
        let result = value;
        result = Math.imul(result ^ (result >>> 15), result | 1);
        result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
        return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
}

// Implementation identity is separate from the pinned trial rules and optimizer algorithm.
export const RUST_TRIAL_IMPLEMENTATION_VERSION = "rust-trial-wasm-1";
export const JS_TRIAL_IMPLEMENTATION_VERSION = "javascript-trial-1";
