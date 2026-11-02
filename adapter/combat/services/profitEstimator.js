import { actionDetailMap, itemDetailMap, monsterDetailIndex } from "../shared/gameDataIndex.js";
import {
    PRICE_MODE_ASK,
    PRICE_MODE_BID,
    normalizePriceMode,
    resolveMarketPrice,
} from "./marketPriceService.js";

const PLAYER_IDS = new Set(["player1", "player2", "player3", "player4", "player5"]);
export const DUNGEON_KEY_MATERIAL_CONSUMPTION_RATE = 0.897;

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function addToNumberMap(targetMap, key, value) {
    const normalizedKey = String(key || "");
    const normalizedValue = Math.max(0, toFiniteNumber(value, 0));
    if (!normalizedKey || normalizedValue <= 0) {
        return;
    }

    const current = toFiniteNumber(targetMap.get(normalizedKey), 0);
    targetMap.set(normalizedKey, current + normalizedValue);
}

function resolvePlayerHrid(playerHrid) {
    const normalized = String(playerHrid || "").trim();
    if (PLAYER_IDS.has(normalized)) {
        return normalized;
    }
    if (normalized && !normalized.startsWith("player")) {
        const prefixed = `player${normalized}`;
        if (PLAYER_IDS.has(prefixed)) {
            return prefixed;
        }
    }
    return "player1";
}

function hasPlayerScopedData(simResult, playerHrid) {
    if (!simResult || !PLAYER_IDS.has(playerHrid)) {
        return false;
    }

    return simResult.dropRateMultiplier?.[playerHrid] != null
        || simResult.experienceGained?.[playerHrid] != null
        || simResult.attacks?.[playerHrid] != null
        || simResult.consumablesUsed?.[playerHrid] != null
        || simResult.manaUsed?.[playerHrid] != null
        || simResult.debuffOnLevelGap?.[playerHrid] != null
        || simResult.combatDropQuantity?.[playerHrid] != null;
}

function resolvePlayerFromSimResult(simResult, preferredPlayerHrid) {
    const normalizedPreferred = resolvePlayerHrid(preferredPlayerHrid);
    if (hasPlayerScopedData(simResult, normalizedPreferred)) {
        return normalizedPreferred;
    }

    const playerMaps = [
        simResult?.dropRateMultiplier,
        simResult?.experienceGained,
        simResult?.attacks,
        simResult?.consumablesUsed,
        simResult?.manaUsed,
        simResult?.debuffOnLevelGap,
        simResult?.combatDropQuantity,
    ];

    for (const playerMap of playerMaps) {
        if (!playerMap || typeof playerMap !== "object") {
            continue;
        }
        const firstPlayer = Object.keys(playerMap).find((key) => PLAYER_IDS.has(String(key || "")));
        if (firstPlayer) {
            return String(firstPlayer);
        }
    }

    return normalizedPreferred;
}

function createEmptyBreakdown() {
    return {
        revenueItems: [],
        expenseItems: [],
        revenue: 0,
        expenses: 0,
        profit: 0,
    };
}

function resolveDungeonInfo(simResult) {
    const action = actionDetailMap?.[String(simResult?.zoneName || "")];
    return action?.combatZoneInfo?.isDungeon === true
        ? action?.combatZoneInfo?.dungeonInfo
        : null;
}

function resolveDungeonRewardDropRate(reward, difficultyTier) {
    const itemHrid = String(reward?.itemHrid || "");
    if (itemHrid.endsWith("_refinement_chest")) {
        if (difficultyTier >= 2) {
            return 1;
        }
        if (difficultyTier === 1) {
            return 1 / 3;
        }
        return 0;
    }

    return Math.max(0, Math.min(1,
        toFiniteNumber(reward?.dropRate, 0)
        + toFiniteNumber(reward?.dropRatePerDifficultyTier, 0) * difficultyTier
    ));
}

export function resolveDungeonKeyIngredients(keyItemHrid) {
    const normalizedKeyHrid = String(keyItemHrid || "");
    if (!normalizedKeyHrid) {
        return [];
    }

    const conventionalActionHrid = normalizedKeyHrid.startsWith("/items/")
        ? normalizedKeyHrid.replace("/items/", "/actions/crafting/")
        : "";
    const directRecipe = conventionalActionHrid ? actionDetailMap?.[conventionalActionHrid] : null;
    const recipe = directRecipe || Object.values(actionDetailMap || {}).find((action) => (
        (action?.outputItems || []).some((output) => String(output?.itemHrid || "") === normalizedKeyHrid)
    ));

    if (!recipe || String(recipe?.category || recipe?.categoryHrid || "") !== "/action_categories/crafting/dungeon_keys") {
        return [];
    }

    const keyOutput = (recipe.outputItems || []).find((output) => (
        String(output?.itemHrid || "") === normalizedKeyHrid
    ));
    const outputCount = Math.max(0, toFiniteNumber(keyOutput?.count, 0));
    if (outputCount <= 0) {
        return [];
    }

    return (recipe.inputItems || [])
        .map((input) => ({
            itemHrid: String(input?.itemHrid || ""),
            count: Math.max(0, toFiniteNumber(input?.count, 0)) / outputCount,
        }))
        .filter((input) => input.itemHrid && input.count > 0);
}

function appendDungeonKeyIngredients(expenseCountMap, keyItemHrid, keyCount) {
    const amount = Math.max(0, toFiniteNumber(keyCount, 0));
    const normalizedKeyHrid = String(keyItemHrid || "");
    if (!normalizedKeyHrid || amount <= 0) {
        return;
    }

    const ingredients = resolveDungeonKeyIngredients(normalizedKeyHrid);
    if (ingredients.length === 0) {
        // Runtime game data can temporarily lead the bundled catalog. Keep the
        // old direct-key pricing as a safe fallback until its recipe is known.
        addToNumberMap(expenseCountMap, normalizedKeyHrid, amount);
        return;
    }

    for (const ingredient of ingredients) {
        addToNumberMap(
            expenseCountMap,
            ingredient.itemHrid,
            ingredient.count * amount * DUNGEON_KEY_MATERIAL_CONSUMPTION_RATE
        );
    }
}

function appendExpectedDungeonRewards(simResult, playerHrid, dropCountMap) {
    const dungeonInfo = resolveDungeonInfo(simResult);
    const completions = Math.max(0, Math.floor(toFiniteNumber(simResult?.dungeonsCompleted, 0)));
    if (!dungeonInfo || completions <= 0) {
        return [];
    }
    const difficultyTier = Math.max(0, Math.floor(toFiniteNumber(simResult?.difficultyTier, 0)));
    const numberOfPlayers = Math.max(1, Math.floor(toFiniteNumber(simResult?.numberOfPlayers, 1)));
    const dropQuantityMultiplier = 1 + Math.max(
        0,
        toFiniteNumber(simResult?.combatDropQuantity?.[playerHrid], 0)
    );
    const expectedRewards = [];
    for (const reward of (dungeonInfo.rewardDropTable || [])) {
        const dropRate = resolveDungeonRewardDropRate(reward, difficultyTier);
        const expectedCount = (
            toFiniteNumber(reward?.minCount, 0)
            + toFiniteNumber(reward?.maxCount, 0)
        ) / 2;
        // Result tabs are player-scoped. Split shared dungeon chests evenly
        // across the party; appendDungeonRewardKeys consumes this same personal
        // amount so entry/chest-key costs use the identical per-player scope.
        const amount = completions * dropRate * expectedCount * dropQuantityMultiplier / numberOfPlayers;
        addToNumberMap(dropCountMap, reward?.itemHrid, amount);
        if (amount > 0) {
            expectedRewards.push({
                itemHrid: String(reward?.itemHrid || ""),
                amount,
            });
        }
    }
    return expectedRewards;
}

function appendDungeonRewardKeys(simResult, expectedRewards, expenseCountMap) {
    const dungeonInfo = resolveDungeonInfo(simResult);
    const entryKeyItemHrid = String(dungeonInfo?.keyItemHrid || "");
    for (const reward of expectedRewards) {
        const amount = Math.max(0, toFiniteNumber(reward?.amount, 0));
        if (amount <= 0) {
            continue;
        }
        // The ordinary reward chest represents the dungeon entry and consumes
        // one entry key. A refinement chest is an additional reward from that
        // same completion, so opening it only consumes its chest key.
        const isRefinementChest = String(reward.itemHrid || "").endsWith("_refinement_chest");
        if (!isRefinementChest) {
            appendDungeonKeyIngredients(expenseCountMap, entryKeyItemHrid, amount);
        }
        const chestKeyItemHrid = String(itemDetailMap?.[reward.itemHrid]?.openKeyItemHrid || "");
        appendDungeonKeyIngredients(expenseCountMap, chestKeyItemHrid, amount);
    }
}

function appendExpectedDropsFromTable(dropTable = [], isRare, context, dropCountMap) {
    for (const drop of dropTable) {
        if (toFiniteNumber(drop.minDifficultyTier, 0) > context.difficultyTier) {
            continue;
        }

        let effectiveRate = 0;
        if (isRare) {
            // Keep parity with legacy single-page logic for rare drop expectation.
            effectiveRate = toFiniteNumber(drop.dropRate, 0) * context.rareFindMultiplier;
        } else {
            const baseDropRate = toFiniteNumber(drop.dropRate, 0)
                + toFiniteNumber(drop.dropRatePerDifficultyTier, 0) * context.difficultyTier;
            const tierMultiplier = 1 + 0.1 * context.difficultyTier;
            const scaledDropRate = Math.min(1, baseDropRate * tierMultiplier);
            effectiveRate = Math.min(1, scaledDropRate * context.dropRateMultiplier);
        }
        if (effectiveRate <= 0) {
            continue;
        }

        const minCount = toFiniteNumber(drop.minCount, 0);
        const maxCount = toFiniteNumber(drop.maxCount, 0);
        const expectedAmount = ((minCount + maxCount) / 2) * (1 + context.debuffOnLevelGap) * (1 + context.dropQuantity);
        const expectedDrops = (context.deathsCount * effectiveRate * expectedAmount) / context.numberOfPlayers;

        addToNumberMap(dropCountMap, drop.itemHrid, expectedDrops);
    }
}

function expectedDropCountMapForMonster(monsterHrid, deathsCount, simResult, playerHrid) {
    const monster = monsterDetailIndex[monsterHrid];
    if (!monster || deathsCount <= 0) {
        return new Map();
    }

    const context = {
        deathsCount: Math.floor(toFiniteNumber(deathsCount, 0)),
        difficultyTier: Math.max(0, Math.floor(toFiniteNumber(simResult.difficultyTier, 0))),
        dropRateMultiplier: toFiniteNumber(simResult.dropRateMultiplier?.[playerHrid], 1),
        rareFindMultiplier: toFiniteNumber(simResult.rareFindMultiplier?.[playerHrid], 1),
        dropQuantity: toFiniteNumber(simResult.combatDropQuantity?.[playerHrid], 0),
        debuffOnLevelGap: toFiniteNumber(simResult.debuffOnLevelGap?.[playerHrid], 0),
        numberOfPlayers: Math.max(1, Math.floor(toFiniteNumber(simResult.numberOfPlayers, 1))),
    };

    if (context.deathsCount <= 0) {
        return new Map();
    }

    const dropCountMap = new Map();
    appendExpectedDropsFromTable(monster.dropTable || [], false, context, dropCountMap);
    appendExpectedDropsFromTable(monster.rareDropTable || [], true, context, dropCountMap);
    return dropCountMap;
}

function toSortedLineItemsFromMap(sourceMap, resolveUnitPrice) {
    const rows = [];
    let total = 0;

    for (const [itemHrid, rawAmount] of sourceMap.entries()) {
        const amount = Math.max(0, toFiniteNumber(rawAmount, 0));
        if (amount <= 0) {
            continue;
        }

        const unitPrice = Math.max(0, toFiniteNumber(resolveUnitPrice(itemHrid), 0));
        const totalValue = amount * unitPrice;
        total += totalValue;

        rows.push({
            itemHrid,
            amount,
            unitPrice,
            totalValue,
        });
    }

    rows.sort((a, b) => b.totalValue - a.totalValue || b.amount - a.amount || a.itemHrid.localeCompare(b.itemHrid));
    return { rows, total };
}

function normalizeRandomValue(randomSource) {
    const value = Number(typeof randomSource === "function" ? randomSource() : Math.random());
    if (!Number.isFinite(value)) {
        return Math.random();
    }
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 0.999999999999;
    }
    return value;
}

function rollFractionalAmount(value, randomSource) {
    const numeric = Math.max(0, toFiniteNumber(value, 0));
    if (Number.isInteger(numeric)) {
        return numeric;
    }
    const intPart = Math.floor(numeric);
    const fraction = numeric - intPart;
    return normalizeRandomValue(randomSource) < fraction ? intPart + 1 : intPart;
}

function buildDropMapsForProfit(simResult, playerHrid, randomSource = Math.random) {
    if (!simResult || simResult.isDungeon) {
        return {
            totalDropMap: new Map(),
            noRngTotalDropMap: new Map(),
        };
    }

    const resolvedPlayer = resolvePlayerHrid(playerHrid);
    const difficultyTier = Math.max(0, toFiniteNumber(simResult.difficultyTier, 0));
    const dropRateMultiplier = toFiniteNumber(simResult.dropRateMultiplier?.[resolvedPlayer], 1);
    const rareFindMultiplier = toFiniteNumber(simResult.rareFindMultiplier?.[resolvedPlayer], 1);
    const dropQuantity = toFiniteNumber(simResult.combatDropQuantity?.[resolvedPlayer], 0);
    const debuffOnLevelGap = toFiniteNumber(simResult.debuffOnLevelGap?.[resolvedPlayer], 0);
    const numberOfPlayers = Math.max(1, toFiniteNumber(simResult.numberOfPlayers, 1));

    const totalDropMap = new Map();
    const noRngTotalDropMap = new Map();

    const monsterHrids = Object.keys(simResult.deaths ?? {})
        .filter((monsterHrid) => !PLAYER_IDS.has(String(monsterHrid || "")))
        .sort();

    for (const monsterHrid of monsterHrids) {
        const rawDeathsCount = simResult.deaths?.[monsterHrid];

        const monster = monsterDetailIndex[monsterHrid];
        const deathsCount = Math.max(0, Math.floor(toFiniteNumber(rawDeathsCount, 0)));
        if (!monster || deathsCount <= 0) {
            continue;
        }

        const dropMap = new Map();
        const rareDropMap = new Map();

        for (const drop of (monster.dropTable ?? [])) {
            if (toFiniteNumber(drop.minDifficultyTier, 0) > difficultyTier) {
                continue;
            }

            const baseDropRate = toFiniteNumber(drop.dropRate, 0)
                + toFiniteNumber(drop.dropRatePerDifficultyTier, 0) * difficultyTier;
            const tierMultiplier = 1 + 0.1 * difficultyTier;
            const dropRate = Math.min(1, tierMultiplier * baseDropRate);
            if (dropRate <= 0) {
                continue;
            }

            dropMap.set(String(drop.itemHrid || ""), {
                dropRate: Math.min(1, dropRate * dropRateMultiplier),
                number: 0,
                dropMin: toFiniteNumber(drop.minCount, 0),
                dropMax: toFiniteNumber(drop.maxCount, 0),
                noRngDropAmount: 0,
            });
        }

        for (const drop of (monster.rareDropTable ?? [])) {
            if (toFiniteNumber(drop.minDifficultyTier, 0) > difficultyTier) {
                continue;
            }

            const dropRate = toFiniteNumber(drop.dropRate, 0) * rareFindMultiplier;
            if (dropRate <= 0) {
                continue;
            }

            rareDropMap.set(String(drop.itemHrid || ""), {
                dropRate,
                number: 0,
                dropMin: toFiniteNumber(drop.minCount, 0),
                dropMax: toFiniteNumber(drop.maxCount, 0),
                noRngDropAmount: 0,
            });
        }

        for (const dropObject of dropMap.values()) {
            const dropMidAmount = (dropObject.dropMax + dropObject.dropMin) / 2;
            dropObject.noRngDropAmount += deathsCount
                * dropObject.dropRate
                * dropMidAmount
                * (1 + debuffOnLevelGap)
                * (1 + dropQuantity)
                / numberOfPlayers;
        }

        for (const dropObject of rareDropMap.values()) {
            const dropMidAmount = (dropObject.dropMax + dropObject.dropMin) / 2;
            dropObject.noRngDropAmount += deathsCount
                * dropObject.dropRate
                * dropMidAmount
                * (1 + debuffOnLevelGap)
                * (1 + dropQuantity)
                / numberOfPlayers;
        }

        for (let index = 0; index < deathsCount; index += 1) {
            for (const dropObject of dropMap.values()) {
                if (normalizeRandomValue(randomSource) > (dropObject.dropRate / numberOfPlayers)) {
                    continue;
                }
                const rolled = Math.floor(
                    normalizeRandomValue(randomSource) * (dropObject.dropMax - dropObject.dropMin + 1) + dropObject.dropMin
                );
                const scaledAmount = rolled * (1 + debuffOnLevelGap) * (1 + dropQuantity);
                dropObject.number += rollFractionalAmount(scaledAmount, randomSource);
            }
            for (const dropObject of rareDropMap.values()) {
                if (normalizeRandomValue(randomSource) > (dropObject.dropRate / numberOfPlayers)) {
                    continue;
                }
                const rolled = Math.floor(
                    normalizeRandomValue(randomSource) * (dropObject.dropMax - dropObject.dropMin + 1) + dropObject.dropMin
                );
                const scaledAmount = rolled * (1 + debuffOnLevelGap) * (1 + dropQuantity);
                dropObject.number += rollFractionalAmount(scaledAmount, randomSource);
            }
        }

        for (const [itemHrid, dropObject] of dropMap.entries()) {
            addToNumberMap(totalDropMap, itemHrid, dropObject.number);
            addToNumberMap(noRngTotalDropMap, itemHrid, dropObject.noRngDropAmount);
        }
        for (const [itemHrid, dropObject] of rareDropMap.entries()) {
            addToNumberMap(totalDropMap, itemHrid, dropObject.number);
            addToNumberMap(noRngTotalDropMap, itemHrid, dropObject.noRngDropAmount);
        }
    }

    return {
        totalDropMap,
        noRngTotalDropMap,
    };
}

function getProfitDropMaps(simResult, playerHrid, options = {}) {
    const resolvedPlayer = resolvePlayerFromSimResult(simResult, playerHrid);
    if (!simResult || simResult.isDungeon) {
        return {
            playerHrid: resolvedPlayer,
            totalDropMap: new Map(),
            noRngTotalDropMap: new Map(),
        };
    }

    const randomSource = options.randomSource;
    const useCache = options.useCache !== false && typeof randomSource !== "function";
    if (!useCache) {
        const direct = buildDropMapsForProfit(simResult, resolvedPlayer, randomSource);
        return {
            playerHrid: resolvedPlayer,
            totalDropMap: direct.totalDropMap,
            noRngTotalDropMap: direct.noRngTotalDropMap,
        };
    }

    if (!simResult.__profitDropMapsCache || typeof simResult.__profitDropMapsCache !== "object") {
        simResult.__profitDropMapsCache = {};
    }

    const cached = simResult.__profitDropMapsCache[resolvedPlayer];
    if (cached && typeof cached === "object") {
        return {
            playerHrid: resolvedPlayer,
            totalDropMap: new Map(cached.totalDropEntries || []),
            noRngTotalDropMap: new Map(cached.noRngTotalDropEntries || []),
        };
    }

    const computed = buildDropMapsForProfit(simResult, resolvedPlayer, Math.random);
    simResult.__profitDropMapsCache[resolvedPlayer] = {
        totalDropEntries: Array.from(computed.totalDropMap.entries()),
        noRngTotalDropEntries: Array.from(computed.noRngTotalDropMap.entries()),
    };

    return {
        playerHrid: resolvedPlayer,
        totalDropMap: computed.totalDropMap,
        noRngTotalDropMap: computed.noRngTotalDropMap,
    };
}

export function buildNoRngProfitBreakdown(simResult, playerHrid, pricingOptions = {}) {
    if (!simResult) {
        return createEmptyBreakdown();
    }

    const resolvedPlayer = resolvePlayerFromSimResult(simResult, playerHrid);
    const dropMode = normalizePriceMode(pricingOptions.dropMode, PRICE_MODE_BID);
    const consumableMode = normalizePriceMode(pricingOptions.consumableMode, PRICE_MODE_ASK);
    const priceTable = pricingOptions.priceTable ?? null;

    const resolveDropPrice = (itemHrid) => resolveMarketPrice(priceTable, itemHrid, dropMode);
    const resolveConsumablePrice = (itemHrid) => resolveMarketPrice(priceTable, itemHrid, consumableMode);

    const dropCountMap = new Map();
    let expectedDungeonRewards = [];
    if (simResult.isDungeon) {
        expectedDungeonRewards = appendExpectedDungeonRewards(simResult, resolvedPlayer, dropCountMap);
    } else {
        for (const [unitHrid, deaths] of Object.entries(simResult.deaths ?? {})) {
            if (PLAYER_IDS.has(unitHrid)) {
                continue;
            }

            const monsterDropCountMap = expectedDropCountMapForMonster(
                unitHrid,
                deaths,
                simResult,
                resolvedPlayer
            );

            for (const [itemHrid, amount] of monsterDropCountMap.entries()) {
                addToNumberMap(dropCountMap, itemHrid, amount);
            }
        }
    }

    const { rows: revenueItems, total: revenue } = toSortedLineItemsFromMap(dropCountMap, resolveDropPrice);

    const consumableCountMap = new Map();
    for (const [itemHrid, usedCount] of Object.entries(simResult.consumablesUsed?.[resolvedPlayer] ?? {})) {
        addToNumberMap(consumableCountMap, itemHrid, usedCount);
    }
    if (simResult.isDungeon) {
        appendDungeonRewardKeys(simResult, expectedDungeonRewards, consumableCountMap);
    }
    const { rows: expenseItems, total: expenses } = toSortedLineItemsFromMap(consumableCountMap, resolveConsumablePrice);

    return {
        revenueItems,
        expenseItems,
        revenue,
        expenses,
        profit: revenue - expenses,
    };
}

export function buildRandomProfitBreakdown(simResult, playerHrid, pricingOptions = {}) {
    if (!simResult) {
        return createEmptyBreakdown();
    }
    if (simResult.isDungeon) {
        // Dungeon income is a completion reward. Use its exact chest EV rather
        // than sampling a second layer of RNG independently for every player.
        return buildNoRngProfitBreakdown(simResult, playerHrid, pricingOptions);
    }

    const resolvedPlayer = resolvePlayerFromSimResult(simResult, playerHrid);
    const dropMode = normalizePriceMode(pricingOptions.dropMode, PRICE_MODE_BID);
    const consumableMode = normalizePriceMode(pricingOptions.consumableMode, PRICE_MODE_ASK);
    const priceTable = pricingOptions.priceTable ?? null;
    const randomSource = pricingOptions.randomSource;
    const useDropCache = pricingOptions.useDropCache !== false;

    const resolveDropPrice = (itemHrid) => resolveMarketPrice(priceTable, itemHrid, dropMode);
    const resolveConsumablePrice = (itemHrid) => resolveMarketPrice(priceTable, itemHrid, consumableMode);

    const { totalDropMap } = getProfitDropMaps(simResult, resolvedPlayer, {
        randomSource,
        useCache: useDropCache,
    });
    const { rows: revenueItems, total: revenue } = toSortedLineItemsFromMap(totalDropMap, resolveDropPrice);

    const consumableCountMap = new Map();
    for (const [itemHrid, usedCount] of Object.entries(simResult.consumablesUsed?.[resolvedPlayer] ?? {})) {
        addToNumberMap(consumableCountMap, itemHrid, usedCount);
    }
    const { rows: expenseItems, total: expenses } = toSortedLineItemsFromMap(consumableCountMap, resolveConsumablePrice);

    return {
        revenueItems,
        expenseItems,
        revenue,
        expenses,
        profit: revenue - expenses,
    };
}

export function estimateNoRngProfit(simResult, playerHrid, pricingOptions = {}) {
    const breakdown = buildNoRngProfitBreakdown(simResult, playerHrid, pricingOptions);
    return {
        revenue: breakdown.revenue,
        expenses: breakdown.expenses,
        profit: breakdown.profit,
    };
}
