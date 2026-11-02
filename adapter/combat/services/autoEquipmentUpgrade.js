import { abilityBookInfoByAbilityHrid, abilityDetailIndex, actionDetailIndex, itemDetailIndex, levelExperienceTable } from "../shared/gameDataIndex.js";
import { getRuntimeCombatGameData } from "../shared/runtimeGameData.js";
import { estimateNoRngProfit } from "./profitEstimator.js";
import {
    resolveCompletedEncounterCount,
    resolveCompletedSimulationTime,
    resolvePlayerOutOfManaTimeRatio,
} from "./simulationMetrics.js";
import { resolveMarketPrice, PRICE_MODE_ASK, PRICE_MODE_BID } from "./marketPriceService.js";
import { classifyWeapon } from "./skillOptimizer";

const ONE_HOUR = 60 * 60 * 1e9;
const ARTISAN_TEA_MATERIAL_MULTIPLIER = 0.89;

function clone(value) {
    // Baselines stored in Vue refs/Pinia are reactive Proxies, which the
    // browser structured-clone algorithm rejects. Combat profile snapshots
    // contain JSON-only data, so this also safely unwraps Vue reactivity.
    return JSON.parse(JSON.stringify(value));
}

function skillKey(skillHrid) {
    return String(skillHrid || "").split("/").filter(Boolean).at(-1) || "";
}

function maxEnhancementLevel() {
    const table = getRuntimeCombatGameData()?.maps?.enhancementLevelSuccessRateTable;
    return Math.max(0, Array.isArray(table) ? table.length : 20);
}

const UPPER_COMMON_TARGETS = {
    neck: "/items/philosophers_necklace",
    earrings: "/items/philosophers_earrings",
    ring: "/items/philosophers_ring",
    pouch: "/items/guzzling_pouch",
};

const MAGIC_ARMOR = {
    head: "/items/magicians_hat",
    hands: "/items/chrono_gloves",
    feet: "/items/pathseeker_boots",
    back: "/items/enchanted_cloak",
};

const MELEE_ARMOR = {
    head: "/items/corsair_helmet",
    body: "/items/maelstrom_plate_body",
    legs: "/items/maelstrom_plate_legs",
    hands: "/items/dodocamel_gauntlets",
    feet: "/items/pathbreaker_boots",
    back: "/items/sinister_cape",
};

const RANGED_ARMOR = {
    head: "/items/acrobatic_hood",
    body: "/items/kraken_tunic",
    legs: "/items/kraken_chaps",
    hands: "/items/marksman_bracers",
    feet: "/items/pathfinder_boots",
    back: "/items/chimerical_quiver",
};

export const UPPER_EQUIPMENT_TARGETS = {
    water: { weapon: "/items/rippling_trident", off_hand: "/items/bishops_codex", ...MAGIC_ARMOR, body: "/items/royal_water_robe_top", legs: "/items/royal_water_robe_bottoms", ...UPPER_COMMON_TARGETS },
    fire: { weapon: "/items/blazing_trident", off_hand: "/items/bishops_codex", ...MAGIC_ARMOR, body: "/items/royal_fire_robe_top", legs: "/items/royal_fire_robe_bottoms", ...UPPER_COMMON_TARGETS },
    nature: { weapon: "/items/blooming_trident", off_hand: "/items/bishops_codex", ...MAGIC_ARMOR, body: "/items/royal_nature_robe_top", legs: "/items/royal_nature_robe_bottoms", ...UPPER_COMMON_TARGETS },
    sword: { weapon: "/items/regal_sword", off_hand: "/items/knights_aegis", ...MELEE_ARMOR, ...UPPER_COMMON_TARGETS },
    mace: { weapon: "/items/chaotic_flail", off_hand: "/items/knights_aegis", ...MELEE_ARMOR, ...UPPER_COMMON_TARGETS },
    spear: { weapon: "/items/furious_spear", off_hand: "/items/knights_aegis", ...MELEE_ARMOR, ...UPPER_COMMON_TARGETS },
    bow: { weapon: "/items/cursed_bow", ...RANGED_ARMOR, ...UPPER_COMMON_TARGETS },
    crossbow: { weapon: "/items/sundering_crossbow", off_hand: "/items/manticore_shield", ...RANGED_ARMOR, ...UPPER_COMMON_TARGETS },
    shield: {
        weapon: "/items/griffin_bulwark",
        head: "/items/corsair_helmet",
        body: "/items/anchorbound_plate_body",
        legs: "/items/anchorbound_plate_legs",
        hands: "/items/dodocamel_gauntlets",
        feet: "/items/pathbreaker_boots",
        back: "/items/sinister_cape",
        ...UPPER_COMMON_TARGETS,
    },
};

const DEFENSIVE_TARGETS = {
    body: "/items/anchorbound_plate_body",
    legs: "/items/anchorbound_plate_legs",
};

const MAELSTROM_TARGETS = {
    body: "/items/maelstrom_plate_body",
    legs: "/items/maelstrom_plate_legs",
};

const TEN_LEVEL_SLOTS = new Set(["weapon", "off_hand", "head", "body", "legs", "hands", "feet"]);
const DEFENSIVE_CLASSES = new Set(["sword", "mace", "spear"]);
const REPLACEMENT_SLOT_ORDER = ["weapon", "off_hand", "head", "body", "legs", "hands", "feet", "back", "neck", "earrings", "ring", "pouch"];

function refinementFamilyIndexes(refinementIndex) {
    const refinedByBase = new Map();
    const baseByItem = new Map();
    for (const [baseHrid, refinement] of refinementIndex) {
        const refinedHrid = String(refinement?.afterItemHrid || "");
        if (!refinedHrid) continue;
        refinedByBase.set(baseHrid, refinedHrid);
        baseByItem.set(baseHrid, baseHrid);
        baseByItem.set(refinedHrid, baseHrid);
    }
    return { refinedByBase, baseByItem };
}

function requirementMessage(requirement) {
    return requirement.missing.map((item) => `${skillKey(item.skillHrid)} ${item.actual}/${item.required}`).join("、");
}

function replacementCandidate({ player, slot, kind, baseTargetHrid, defaultLevel, defaultRefined, refinedByBase, baseByItem }) {
    const equipped = player?.equipment?.[slot] || {};
    const beforeItemHrid = String(equipped.itemHrid || "");
    const beforeLevel = Math.max(0, Math.floor(Number(equipped.enhancementLevel || 0)));
    const refinedTargetHrid = String(refinedByBase.get(baseTargetHrid) || "");
    const refined = Boolean(defaultRefined && refinedTargetHrid);
    const afterItemHrid = refined ? refinedTargetHrid : baseTargetHrid;
    const requirement = validateEquipmentRequirements(player, afterItemHrid);
    return {
        id: `${kind === "upper_replacement" ? "upper" : "defensive"}-${slot}`,
        slot,
        kind,
        beforeItemHrid,
        beforeLevel,
        currentBaseItemHrid: String(baseByItem.get(beforeItemHrid) || beforeItemHrid),
        baseTargetHrid,
        refinedTargetHrid,
        afterLevel: Math.max(0, Math.min(maxEnhancementLevel(), Math.floor(Number(defaultLevel || 0)))),
        refined,
        selected: requirement.valid,
        eligible: requirement.valid,
        skipReason: requirement.valid ? "" : requirementMessage(requirement),
    };
}

export function generateEquipmentReplacementCandidates(player) {
    const refinementIndex = buildRefinementIndex();
    const { refinedByBase, baseByItem } = refinementFamilyIndexes(refinementIndex);
    const itemMap = getRuntimeCombatGameData()?.maps?.itemDetailMap || itemDetailIndex || {};
    const weaponHrid = String(player?.equipment?.weapon?.itemHrid || "");
    const classId = classifyWeapon(weaponHrid, itemMap[weaponHrid]);
    const upper = [];
    const defensive = [];
    const targets = classId ? UPPER_EQUIPMENT_TARGETS[classId] : null;

    if (targets) {
        for (const slot of REPLACEMENT_SLOT_ORDER) {
            const baseTargetHrid = targets[slot];
            if (!baseTargetHrid) continue;
            const beforeItemHrid = String(player?.equipment?.[slot]?.itemHrid || "");
            const currentBaseItemHrid = String(baseByItem.get(beforeItemHrid) || beforeItemHrid);
            if (currentBaseItemHrid === baseTargetHrid) continue;
            upper.push(replacementCandidate({
                player,
                slot,
                kind: "upper_replacement",
                baseTargetHrid,
                defaultLevel: TEN_LEVEL_SLOTS.has(slot) ? 10 : 5,
                defaultRefined: false,
                refinedByBase,
                baseByItem,
            }));
        }
    }

    if (classId && DEFENSIVE_CLASSES.has(classId)) {
        for (const [slot, baseTargetHrid] of Object.entries(DEFENSIVE_TARGETS)) {
            const beforeItemHrid = String(player?.equipment?.[slot]?.itemHrid || "");
            const currentBaseItemHrid = String(baseByItem.get(beforeItemHrid) || beforeItemHrid);
            if (currentBaseItemHrid === baseTargetHrid) continue;
            const isMaelstrom = currentBaseItemHrid === MAELSTROM_TARGETS[slot];
            defensive.push(replacementCandidate({
                player,
                slot,
                kind: "defensive_replacement",
                baseTargetHrid,
                defaultLevel: isMaelstrom ? Number(player?.equipment?.[slot]?.enhancementLevel || 0) : 10,
                defaultRefined: Boolean(beforeItemHrid && baseByItem.get(beforeItemHrid) && beforeItemHrid !== currentBaseItemHrid),
                refinedByBase,
                baseByItem,
            }));
        }
    }

    return { classId, enhancementCap: maxEnhancementLevel(), upper, defensive };
}

export function materializeEquipmentReplacementVariant(player, candidate) {
    const refinementIndex = buildRefinementIndex();
    const { refinedByBase } = refinementFamilyIndexes(refinementIndex);
    const refinedTargetHrid = String(refinedByBase.get(candidate.baseTargetHrid) || candidate.refinedTargetHrid || "");
    const afterItemHrid = candidate.refined && refinedTargetHrid ? refinedTargetHrid : String(candidate.baseTargetHrid || "");
    const afterLevel = Math.max(0, Math.min(maxEnhancementLevel(), Math.floor(Number(candidate.afterLevel || 0))));
    const requirement = validateEquipmentRequirements(player, afterItemHrid);
    const snapshot = clone(player);
    snapshot.equipment ||= {};
    snapshot.equipment[candidate.slot] = {
        ...(snapshot.equipment[candidate.slot] || {}),
        itemHrid: afterItemHrid,
        enhancementLevel: afterLevel,
    };
    return {
        ...candidate,
        afterItemHrid,
        afterLevel,
        refined: Boolean(candidate.refined && refinedTargetHrid),
        eligible: requirement.valid,
        skipReason: requirement.valid ? "" : requirementMessage(requirement),
        snapshot,
    };
}

export function buildRefinementIndex() {
    const result = new Map();
    const maps = getRuntimeCombatGameData()?.maps || {};
    const actionMap = maps.actionDetailMap || actionDetailIndex || {};
    const itemMap = maps.itemDetailMap || itemDetailIndex || {};
    for (const action of Object.values(actionMap)) {
        const beforeItemHrid = String(action?.upgradeItemHrid || "");
        const output = (action?.outputItems || []).find((item) => (
            item?.itemHrid && itemMap[item.itemHrid]?.categoryHrid === "/item_categories/equipment"
        ));
        // retainAllEnhancement identifies equipment refinement/upgrade recipes and
        // prevents ordinary tier crafting recipes from appearing as “精炼”.
        if (!beforeItemHrid || !output || action?.retainAllEnhancement !== true) continue;
        result.set(beforeItemHrid, {
            actionHrid: String(action.hrid || ""),
            beforeItemHrid,
            afterItemHrid: String(output.itemHrid),
            outputCount: Math.max(1, Number(output.count || 1)),
            retainAllEnhancement: true,
            inputItems: clone(action.inputItems || []),
        });
    }
    return result;
}

export function validateEquipmentRequirements(player, itemHrid) {
    const itemMap = getRuntimeCombatGameData()?.maps?.itemDetailMap || itemDetailIndex || {};
    const requirements = itemMap[itemHrid]?.equipmentDetail?.levelRequirements || [];
    const missing = requirements.filter((requirement) => {
        const key = skillKey(requirement.skillHrid);
        // Imported combat snapshots only contain combat skill levels. Do not
        // reject total-level gear when the source snapshot cannot represent it.
        if (key === "total_level" && !Number.isFinite(Number(player?.levels?.[key]))) return false;
        const current = Number(player?.levels?.[key] || 1);
        return current < Number(requirement.level || 0);
    });
    return {
        valid: missing.length === 0,
        missing: missing.map((requirement) => ({
            skillHrid: String(requirement.skillHrid || ""),
            required: Number(requirement.level || 0),
            actual: Number(player?.levels?.[skillKey(requirement.skillHrid)] || 1),
        })),
    };
}

export function generateAutomaticEquipmentVariants(player) {
    const variants = [];
    const skipped = [];
    const refinementIndex = buildRefinementIndex();
    const enhancementCap = maxEnhancementLevel();

    for (const [slot, equipped] of Object.entries(player?.equipment || {})) {
        const itemHrid = String(equipped?.itemHrid || "");
        if (!itemHrid) continue;
        const equipmentType = String(itemDetailIndex[itemHrid]?.equipmentDetail?.type || "");
        if (slot === "charm" || slot === "trinket" || equipmentType === "/equipment_types/charm" || equipmentType === "/equipment_types/trinket") {
            skipped.push({ slot, kind: "excluded", itemHrid, reason: "护符和勋章不参与自动提升建议" });
            continue;
        }
        const level = Math.max(0, Math.floor(Number(equipped?.enhancementLevel || 0)));
        const itemName = String(itemDetailIndex[itemHrid]?.name || itemHrid);

        for (const increase of [1, 2]) {
            const targetLevel = level + increase;
            if (targetLevel > enhancementCap) {
                skipped.push({ slot, kind: `plus_${increase}`, itemHrid, reason: `已达到 +${enhancementCap} 上限` });
                continue;
            }
            const snapshot = clone(player);
            snapshot.equipment[slot] = { ...snapshot.equipment[slot], enhancementLevel: targetLevel };
            variants.push({
                id: `${slot}-plus-${increase}`,
                slot,
                kind: `plus_${increase}`,
                label: `${itemName} +${level} → +${targetLevel}`,
                beforeItemHrid: itemHrid,
                beforeLevel: level,
                afterItemHrid: itemHrid,
                afterLevel: targetLevel,
                eligible: true,
                snapshot,
            });
        }

        const refinement = refinementIndex.get(itemHrid);
        if (!refinement) {
            skipped.push({ slot, kind: "refine", itemHrid, reason: "没有可用精炼配方" });
            continue;
        }
        const requirement = validateEquipmentRequirements(player, refinement.afterItemHrid);
        const afterLevel = refinement.retainAllEnhancement ? level : 0;
        const snapshot = clone(player);
        snapshot.equipment[slot] = {
            ...snapshot.equipment[slot],
            itemHrid: refinement.afterItemHrid,
            enhancementLevel: afterLevel,
        };
        variants.push({
            id: `${slot}-refine`,
            slot,
            kind: "refine",
            label: `${itemName} +${level} → ${String(itemDetailIndex[refinement.afterItemHrid]?.name || refinement.afterItemHrid)} +${afterLevel}`,
            beforeItemHrid: itemHrid,
            beforeLevel: level,
            afterItemHrid: refinement.afterItemHrid,
            afterLevel,
            eligible: requirement.valid,
            skipReason: requirement.valid ? "" : requirement.missing.map((item) => (
                `${skillKey(item.skillHrid)} ${item.actual}/${item.required}`
            )).join("、"),
            refinement,
            snapshot,
        });
    }

    const abilityLevelCap = Math.max(1, levelExperienceTable.length - 1);
    for (const [index, ability] of (player?.abilities || []).entries()) {
        const abilityHrid = String(ability?.abilityHrid || "");
        if (!abilityHrid) continue;
        const currentLevel = Math.max(1, Math.floor(Number(ability?.level || 1)));
        const generatedTargets = new Set();
        for (const increase of [5, 10]) {
            const targetLevel = Math.min(abilityLevelCap, currentLevel + increase);
            if (targetLevel <= currentLevel || generatedTargets.has(targetLevel)) {
                skipped.push({ slot: `ability_${index + 1}`, kind: `ability_plus_${increase}`, itemHrid: abilityHrid, reason: `已达到等级上限 ${abilityLevelCap}` });
                continue;
            }
            generatedTargets.add(targetLevel);
            const snapshot = clone(player);
            snapshot.abilities[index] = { ...snapshot.abilities[index], level: targetLevel };
            const bookCost = computeAbilityBookUpgradeCost(abilityHrid, currentLevel, targetLevel, {});
            variants.push({
                id: `ability-${index + 1}-plus-${increase}`,
                slot: `ability_${index + 1}`,
                kind: `ability_plus_${increase}`,
                label: `${String(abilityDetailIndex[abilityHrid]?.name || abilityHrid)} Lv.${currentLevel} → Lv.${targetLevel}`,
                abilityHrid,
                abilityIndex: index,
                beforeLevel: currentLevel,
                afterLevel: targetLevel,
                eligible: Boolean(bookCost?.bookItemHrid && bookCost?.xpPerBook > 0),
                skipReason: bookCost?.bookItemHrid ? "" : "未找到对应技能书",
                snapshot,
            });
        }
    }
    return { enhancementCap, variants, skipped };
}

export function computeAbilityBookUpgradeCost(abilityHrid, fromLevel, toLevel, priceTable) {
    const start = Math.max(1, Math.floor(Number(fromLevel || 1)));
    const target = Math.max(start, Math.min(levelExperienceTable.length - 1, Math.floor(Number(toLevel || start))));
    const startXp = Number(levelExperienceTable[start]);
    const targetXp = Number(levelExperienceTable[target]);
    const book = abilityBookInfoByAbilityHrid[String(abilityHrid || "")];
    const bookItemHrid = String(book?.itemHrid || "");
    const xpPerBook = Number(book?.xpPerBook || 0);
    const xpRequired = Number.isFinite(startXp) && Number.isFinite(targetXp) ? Math.max(0, targetXp - startXp) : null;
    const bookCount = xpRequired != null && xpPerBook > 0 ? Math.ceil(xpRequired / xpPerBook) : null;
    const quote = priceTable?.[bookItemHrid];
    const ask = Number(quote?.ask);
    const purchaseFallback = Number(itemDetailIndex[bookItemHrid]?.purchasePrice ?? itemDetailIndex[bookItemHrid]?.shopPrice);
    const unitPrice = Number.isFinite(ask) && ask >= 0
        ? ask
        : (Number.isFinite(purchaseFallback) && purchaseFallback >= 0 ? purchaseFallback : null);
    return {
        mode: "ability_book",
        abilityHrid: String(abilityHrid || ""),
        fromLevel: start,
        toLevel: target,
        xpRequired,
        bookItemHrid,
        bookName: String(itemDetailIndex[bookItemHrid]?.name || bookItemHrid),
        xpPerBook,
        bookCount,
        unitPrice,
        costAvailable: bookCount != null && unitPrice != null,
        cost: bookCount != null && unitPrice != null ? bookCount * unitPrice : null,
    };
}

export function computeRefinementMaterialCost(refinement, priceTable) {
    if (!refinement) return null;
    const outputCount = Math.max(1, Number(refinement.outputCount || 1));
    const items = (refinement.inputItems || [])
        .filter((input) => String(input.itemHrid || "") !== String(refinement.beforeItemHrid || ""))
        .map((input) => {
            const unitPrice = resolveMarketPrice(priceTable, input.itemHrid, PRICE_MODE_ASK);
            const rawCount = Number(input.count || 0) / outputCount;
            const count = rawCount * ARTISAN_TEA_MATERIAL_MULTIPLIER;
            return {
                itemHrid: String(input.itemHrid || ""),
                rawCount,
                count,
                unitPrice,
                total: unitPrice * count,
            };
        });
    return {
        cost: items.reduce((sum, item) => sum + item.total, 0),
        mode: "refinement",
        includesExistingBase: false,
        retainAllEnhancement: refinement.retainAllEnhancement === true,
        artisanTeaMaterialMultiplier: ARTISAN_TEA_MATERIAL_MULTIPLIER,
        items,
    };
}

export function summarizeUpgradeSimulation(simResult, playerId, priceTable) {
    const playerHrid = `player${String(playerId || "1").replace(/^player/, "")}`;
    const completedSimulationTime = resolveCompletedSimulationTime(simResult);
    const hours = completedSimulationTime > 0 ? completedSimulationTime / ONE_HOUR : Number.POSITIVE_INFINITY;
    const experience = Object.values(simResult?.experienceGained?.[playerHrid] || {})
        .reduce((sum, value) => sum + Number(value || 0), 0);
    const profitLower = estimateNoRngProfit(simResult, playerHrid, {
        priceTable,
        dropMode: PRICE_MODE_BID,
        consumableMode: PRICE_MODE_ASK,
    });
    const profitUpper = estimateNoRngProfit(simResult, playerHrid, {
        priceTable,
        dropMode: PRICE_MODE_ASK,
        consumableMode: PRICE_MODE_BID,
    });
    return {
        xpPerHour: experience / hours,
        encountersPerHour: resolveCompletedEncounterCount(simResult) / hours,
        deathsPerHour: Number(simResult?.deaths?.[playerHrid] || 0) / hours,
        revenuePerHour: Number(profitLower.revenue || 0) / hours,
        expensesPerHour: Number(profitLower.expenses || 0) / hours,
        revenueUpperPerHour: Number(profitUpper.revenue || 0) / hours,
        expensesLowerPerHour: Number(profitUpper.expenses || 0) / hours,
        profitPerHour: Number(profitLower.profit || 0) / hours,
        profitLowerPerHour: Number(profitLower.profit || 0) / hours,
        profitUpperPerHour: Number(profitUpper.profit || 0) / hours,
        profitMidpointPerHour: (Number(profitLower.profit || 0) + Number(profitUpper.profit || 0)) / 2 / hours,
        outOfManaTimeRatio: resolvePlayerOutOfManaTimeRatio(simResult, playerHrid),
    };
}

function mean(rows, key) {
    if (!rows.length) return 0;
    return rows.reduce((sum, row) => sum + Number(row?.[key] || 0), 0) / rows.length;
}

function meanWithFallback(rows, key, fallbackKey) {
    if (!rows.length) return 0;
    const hasKey = rows.some((row) => Number.isFinite(Number(row?.[key])));
    return mean(rows, hasKey ? key : fallbackKey);
}

export function aggregateUpgradeResults({ baselineRuns = [], variants = [] }) {
    const baseline = {
        rounds: baselineRuns.length,
        xpPerHour: mean(baselineRuns, "xpPerHour"),
        encountersPerHour: mean(baselineRuns, "encountersPerHour"),
        revenuePerHour: mean(baselineRuns, "revenuePerHour"),
        profitPerHour: meanWithFallback(baselineRuns, "profitLowerPerHour", "profitPerHour"),
        profitLowerPerHour: meanWithFallback(baselineRuns, "profitLowerPerHour", "profitPerHour"),
        profitUpperPerHour: meanWithFallback(baselineRuns, "profitUpperPerHour", "profitPerHour"),
        profitMidpointPerHour: meanWithFallback(baselineRuns, "profitMidpointPerHour", "profitPerHour"),
        outOfManaTimeRatio: mean(baselineRuns, "outOfManaTimeRatio"),
    };
    const rows = variants.map((variant) => {
        const metrics = {
            xpPerHour: mean(variant.runs || [], "xpPerHour"),
            encountersPerHour: mean(variant.runs || [], "encountersPerHour"),
            revenuePerHour: mean(variant.runs || [], "revenuePerHour"),
            profitPerHour: meanWithFallback(variant.runs || [], "profitLowerPerHour", "profitPerHour"),
            profitLowerPerHour: meanWithFallback(variant.runs || [], "profitLowerPerHour", "profitPerHour"),
            profitUpperPerHour: meanWithFallback(variant.runs || [], "profitUpperPerHour", "profitPerHour"),
            profitMidpointPerHour: meanWithFallback(variant.runs || [], "profitMidpointPerHour", "profitPerHour"),
            outOfManaTimeRatio: mean(variant.runs || [], "outOfManaTimeRatio"),
        };
        const incrementalProfitLowerPerHour = metrics.profitLowerPerHour - baseline.profitLowerPerHour;
        const incrementalProfitUpperPerHour = metrics.profitUpperPerHour - baseline.profitUpperPerHour;
        const incrementalProfitMidpointPerHour = metrics.profitMidpointPerHour - baseline.profitMidpointPerHour;
        const costAvailable = variant.costAvailable !== false && variant.upgradeCost != null && Number.isFinite(Number(variant.upgradeCost));
        const upgradeCost = costAvailable ? Math.max(0, Number(variant.upgradeCost)) : null;
        return {
            ...variant,
            runs: undefined,
            rounds: (variant.runs || []).length,
            ...metrics,
            // The midpoint is the single value used for sorting and payback.
            incrementalProfitPerHour: incrementalProfitMidpointPerHour,
            incrementalProfitLowerPerHour,
            incrementalProfitUpperPerHour,
            incrementalProfitMidpointPerHour,
            upgradeCost,
            costAvailable,
            paybackHours: incrementalProfitMidpointPerHour > 0 && costAvailable ? upgradeCost / incrementalProfitMidpointPerHour : null,
        };
    });
    rows.sort((left, right) => {
        const leftPayback = left.paybackHours == null ? Number.POSITIVE_INFINITY : left.paybackHours;
        const rightPayback = right.paybackHours == null ? Number.POSITIVE_INFINITY : right.paybackHours;
        return Number(Boolean(right.costAvailable)) - Number(Boolean(left.costAvailable))
            || leftPayback - rightPayback
            || right.incrementalProfitPerHour - left.incrementalProfitPerHour
            || left.upgradeCost - right.upgradeCost;
    });
    return { baseline, rows };
}

export function isScreeningUpgradeVariant(variant) {
    return variant?.kind === "plus_1"
        || variant?.kind === "ability_plus_5"
        || variant?.kind === "refine"
        || variant?.kind === "upper_replacement"
        || variant?.kind === "defensive_replacement";
}

export function isFollowUpUpgradeVariant(variant) {
    return variant?.kind === "plus_2" || variant?.kind === "ability_plus_10";
}

function screeningKindForFollowUp(kind) {
    if (kind === "plus_2") return "plus_1";
    if (kind === "ability_plus_10") return "ability_plus_5";
    return "";
}

export function selectPromotedFollowUpVariants({ preliminaryRows = [], variants = [], keepCount = 10 }) {
    const rankedRows = preliminaryRows.filter((row) => isScreeningUpgradeVariant(row));
    const cutoff = Math.min(rankedRows.length, Math.max(1, Math.floor(Number(keepCount) || 10)));
    const ranks = new Map(rankedRows.map((row, index) => [row.id, index + 1]));
    const screeningBySlotAndKind = new Map(rankedRows.map((row) => [`${row.slot}|${row.kind}`, row]));
    const promoted = [];
    const skipped = [];
    for (const variant of variants.filter((item) => isFollowUpUpgradeVariant(item))) {
        const parent = screeningBySlotAndKind.get(`${variant.slot}|${screeningKindForFollowUp(variant.kind)}`);
        const rank = parent ? ranks.get(parent.id) : null;
        if (rank != null && rank <= cutoff) {
            promoted.push({ ...variant, screeningRank: rank, screeningCutoff: cutoff, screeningParentId: parent.id });
        }
        else {
            skipped.push({
                ...variant,
                screeningRank: rank,
                screeningCutoff: cutoff,
                reason: rank == null
                    ? "缺少对应的 +1/+5 初筛结果"
                    : `对应初筛方案排名第 ${rank}，未进入前 ${cutoff} 名`,
            });
        }
    }
    return { cutoff, totalScreened: rankedRows.length, promoted, skipped };
}
