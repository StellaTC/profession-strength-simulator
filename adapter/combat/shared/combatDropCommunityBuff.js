export const COMBAT_DROP_BUFF_MIN_LEVEL = 0;
export const COMBAT_DROP_BUFF_MAX_LEVEL = 20;
export const COMBAT_DROP_BUFF_DEFAULT_LEVEL = 20;
export const COMBAT_EXPERIENCE_BUFF_MIN_LEVEL = COMBAT_DROP_BUFF_MIN_LEVEL;
export const COMBAT_EXPERIENCE_BUFF_MAX_LEVEL = COMBAT_DROP_BUFF_MAX_LEVEL;
export const COMBAT_EXPERIENCE_BUFF_DEFAULT_LEVEL = COMBAT_DROP_BUFF_DEFAULT_LEVEL;

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCombatDropBuffLevel(value, fallback = COMBAT_DROP_BUFF_DEFAULT_LEVEL) {
    const normalizedFallback = Math.max(
        COMBAT_DROP_BUFF_MIN_LEVEL,
        Math.min(COMBAT_DROP_BUFF_MAX_LEVEL, Math.floor(toFiniteNumber(fallback, COMBAT_DROP_BUFF_DEFAULT_LEVEL)))
    );
    return Math.max(
        COMBAT_DROP_BUFF_MIN_LEVEL,
        Math.min(COMBAT_DROP_BUFF_MAX_LEVEL, Math.floor(toFiniteNumber(value, normalizedFallback)))
    );
}

export function resolveCombatDropBuffLevel(settings = {}, fallback = COMBAT_DROP_BUFF_DEFAULT_LEVEL) {
    if (settings?.comDropEnabled === false) {
        return COMBAT_DROP_BUFF_MIN_LEVEL;
    }
    return normalizeCombatDropBuffLevel(settings?.comDrop, fallback);
}

export function getCombatDropBuffBonus(level) {
    const normalizedLevel = normalizeCombatDropBuffLevel(level, COMBAT_DROP_BUFF_MIN_LEVEL);
    if (normalizedLevel <= 0) {
        return 0;
    }
    return 0.2 + 0.005 * (normalizedLevel - 1);
}

export function normalizeCombatExperienceBuffLevel(value, fallback = COMBAT_EXPERIENCE_BUFF_DEFAULT_LEVEL) {
    return normalizeCombatDropBuffLevel(value, fallback);
}

export function resolveCombatExperienceBuffLevel(settings = {}, fallback = COMBAT_EXPERIENCE_BUFF_DEFAULT_LEVEL) {
    if (settings?.comExpEnabled === false) {
        return COMBAT_EXPERIENCE_BUFF_MIN_LEVEL;
    }
    return normalizeCombatExperienceBuffLevel(settings?.comExp, fallback);
}

export function getCombatExperienceBuffBonus(level) {
    return getCombatDropBuffBonus(level);
}
