import {
    actionDetailMap,
    itemDetailIndex,
    itemVendorPriceByHrid,
    openableLootDropMap,
    shopItemDetailMap,
} from "../shared/gameDataIndex.js";

export const PRICE_MODE_ASK = "ask";
export const PRICE_MODE_BID = "bid";
export const PRICE_MODE_VENDOR = "vendor";

export const MARKETPLACE_SERVER_URL = "/api/marketplace";
export const MARKETPLACE_REQUEST_TIMEOUT_MS = 10_000;
export const MARKETPLACE_CLIENT_CACHE_TTL_MS = 60 * 60_000;

export function isMarketPriceCacheFresh(lastFetchedAt, now = Date.now()) {
    const fetchedAt = toFiniteNumber(lastFetchedAt, 0);
    return fetchedAt > 0 && Math.max(0, toFiniteNumber(now, Date.now()) - fetchedAt) < MARKETPLACE_CLIENT_CACHE_TTL_MS;
}

const TREASURE_CHEST_HRIDS = [
    "/items/small_treasure_chest",
    "/items/medium_treasure_chest",
    "/items/large_treasure_chest",
];

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getVendorPriceByItemHrid(itemHrid) {
    return Math.max(0, toFiniteNumber(itemVendorPriceByHrid?.[itemHrid], 0));
}

export function normalizePriceMode(mode, fallback = PRICE_MODE_BID) {
    const normalized = String(mode || "").toLowerCase();
    if (normalized === PRICE_MODE_ASK || normalized === PRICE_MODE_BID || normalized === PRICE_MODE_VENDOR) {
        return normalized;
    }
    return fallback;
}

function resolveEntryByMode(entry, mode) {
    const normalizedMode = normalizePriceMode(mode, PRICE_MODE_BID);
    const ask = toFiniteNumber(entry?.ask, -1);
    const bid = toFiniteNumber(entry?.bid, -1);
    const vendor = Math.max(0, toFiniteNumber(entry?.vendor, 0));

    if (normalizedMode === PRICE_MODE_VENDOR) {
        return vendor;
    }

    if (normalizedMode === PRICE_MODE_BID) {
        if (bid >= 0) {
            return bid;
        }
        if (ask >= 0) {
            return ask;
        }
        return vendor;
    }

    if (ask >= 0) {
        return ask;
    }
    if (bid >= 0) {
        return bid;
    }
    return vendor;
}

export function resolveMarketPrice(priceTable, itemHrid, mode = PRICE_MODE_BID) {
    const hrid = String(itemHrid || "");
    if (!hrid) {
        return 0;
    }

    const entry = priceTable?.[hrid];
    if (!entry) {
        return getVendorPriceByItemHrid(hrid);
    }

    return Math.max(0, toFiniteNumber(resolveEntryByMode(entry, mode), 0));
}

export function resolveItemRevenuePrice(priceTable, itemHrid, mode = PRICE_MODE_BID) {
    const directValue = resolveMarketPrice(priceTable, itemHrid, mode);
    if (directValue > 0) {
        return directValue;
    }

    // Dungeon tokens are account-bound and have no marketplace/vendor quote,
    // but they can be exchanged for tradable dungeon materials. Value each
    // token by the best single-currency shop redemption at the selected market
    // side. Requiring exactly one cost avoids attributing other shop inputs to
    // the token when future recipes use multiple currencies.
    let bestExchangeValue = 0;
    for (const shopItem of Object.values(shopItemDetailMap || {})) {
        const costs = Array.isArray(shopItem?.costs) ? shopItem.costs : [];
        if (costs.length !== 1 || String(costs[0]?.itemHrid || "") !== String(itemHrid || "")) {
            continue;
        }
        const tokenCost = Math.max(0, toFiniteNumber(costs[0]?.count, 0));
        const productHrid = String(shopItem?.itemHrid || "");
        if (tokenCost <= 0 || !productHrid || productHrid === itemHrid) {
            continue;
        }
        const productValue = resolveMarketPrice(priceTable, productHrid, mode);
        bestExchangeValue = Math.max(bestExchangeValue, productValue / tokenCost);
    }

    return Math.max(0, toFiniteNumber(bestExchangeValue, 0));
}

export function computeOpenableExpectedValue(table, chestHrid, mode, visiting = new Set()) {
    const drops = Array.isArray(openableLootDropMap[chestHrid]) ? openableLootDropMap[chestHrid] : [];
    if (visiting.has(chestHrid)) {
        return 0;
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(chestHrid);
    let total = 0;

    for (const drop of drops) {
        const dropRate = Math.max(0, toFiniteNumber(drop?.dropRate, 0));
        const minCount = Math.max(0, toFiniteNumber(drop?.minCount, 0));
        const maxCount = Math.max(0, toFiniteNumber(drop?.maxCount, 0));
        const expectedCount = (minCount + maxCount) / 2;
        const itemHrid = String(drop?.itemHrid || "");
        const unitValue = Array.isArray(openableLootDropMap[itemHrid])
            ? computeOpenableExpectedValue(table, itemHrid, mode, nextVisiting)
            : resolveItemRevenuePrice(table, itemHrid, mode);
        total += unitValue * dropRate * expectedCount;
    }

    return Math.max(0, toFiniteNumber(total, 0));
}

function addSyntheticEntries(table) {
    table["/items/coin"] = { ask: 1, bid: 1, vendor: 1 };

    const dungeonRewardContainers = Object.values(actionDetailMap || {}).flatMap((action) => {
        if (action?.combatZoneInfo?.isDungeon !== true) {
            return [];
        }
        return (action?.combatZoneInfo?.dungeonInfo?.rewardDropTable || [])
            .map((drop) => String(drop?.itemHrid || ""))
            .filter((itemHrid) => Array.isArray(openableLootDropMap[itemHrid]));
    });
    const containers = new Set([...TREASURE_CHEST_HRIDS, ...dungeonRewardContainers]);
    for (const chestHrid of containers) {
        table[chestHrid] = {
            ask: computeOpenableExpectedValue(table, chestHrid, PRICE_MODE_ASK),
            bid: computeOpenableExpectedValue(table, chestHrid, PRICE_MODE_BID),
            vendor: computeOpenableExpectedValue(table, chestHrid, PRICE_MODE_VENDOR),
        };
    }
}

export function createDefaultPriceTable() {
    const table = {};

    for (const item of Object.values(itemDetailIndex || {})) {
        const hrid = String(item?.hrid || "");
        if (!hrid) {
            continue;
        }

        table[hrid] = {
            ask: -1,
            bid: -1,
            vendor: getVendorPriceByItemHrid(hrid),
        };
    }

    addSyntheticEntries(table);
    return table;
}

export function hydratePriceTableWithMarketData(marketData, baseTable = createDefaultPriceTable()) {
    const table = { ...baseTable };
    const source = marketData && typeof marketData === "object" ? marketData : {};

    for (const [hrid, levelQuotes] of Object.entries(source)) {
        const levelZero = levelQuotes?.["0"];
        if (!levelZero || typeof levelZero !== "object") {
            continue;
        }

        const existing = table[hrid] || {
            ask: -1,
            bid: -1,
            vendor: getVendorPriceByItemHrid(hrid),
        };

        table[hrid] = {
            ask: toFiniteNumber(levelZero.a, existing.ask),
            bid: toFiniteNumber(levelZero.b, existing.bid),
            vendor: Math.max(0, toFiniteNumber(existing.vendor, 0)),
        };
    }

    addSyntheticEntries(table);
    return table;
}

function normalizeEnhancementQuoteEntry(rawQuote) {
    if (!rawQuote || typeof rawQuote !== "object") {
        return null;
    }
    const ask = toFiniteNumber(rawQuote?.a, -1);
    const bid = toFiniteNumber(rawQuote?.b, -1);
    if (ask < 0 && bid < 0) {
        return null;
    }
    return {
        ask,
        bid,
    };
}

export function extractEnhancementDataFromMarketData(marketData) {
    const source = marketData && typeof marketData === "object" ? marketData : {};
    const enhancementQuotesByItem = {};
    const enhancementLevelsByItem = {};

    for (const [rawHrid, rawLevelQuotes] of Object.entries(source)) {
        const hrid = String(rawHrid || "");
        if (!hrid || !rawLevelQuotes || typeof rawLevelQuotes !== "object") {
            continue;
        }

        const quoteMap = {};
        const levels = [];

        for (const [rawLevel, rawQuote] of Object.entries(rawLevelQuotes)) {
            const level = Number(rawLevel);
            if (!Number.isFinite(level) || level < 0) {
                continue;
            }

            const normalizedQuote = normalizeEnhancementQuoteEntry(rawQuote);
            if (!normalizedQuote) {
                continue;
            }

            quoteMap[String(level)] = normalizedQuote;
            if (level > 0) {
                levels.push(level);
            }
        }

        if (Object.keys(quoteMap).length > 0) {
            enhancementQuotesByItem[hrid] = quoteMap;
        }
        if (levels.length > 0) {
            enhancementLevelsByItem[hrid] = Array.from(new Set(levels)).sort((a, b) => a - b);
        }
    }

    return {
        enhancementQuotesByItem,
        enhancementLevelsByItem,
    };
}

async function fetchMarketplacePayload(fetchImpl, url, requestTimeoutMs) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Math.max(1, toFiniteNumber(requestTimeoutMs, MARKETPLACE_REQUEST_TIMEOUT_MS));
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
            controller?.abort();
            const error = new Error(`Price request timed out after ${timeoutMs}ms: ${url}`);
            error.name = "TimeoutError";
            reject(error);
        }, timeoutMs);
    });
    const requestPromise = (async () => {
        const response = await fetchImpl(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...(controller ? { signal: controller.signal } : {}),
        });
        const payload = await response.json();
        if (!response?.ok) {
            throw new Error(String(payload?.detail || `Price request failed: ${response?.status || "unknown"}`));
        }
        const lastModified = response?.headers?.get?.("last-modified") || "";
        const parsedLastModified = Date.parse(lastModified);
        return {
            payload,
            sourceUpdatedAt: toFiniteNumber(payload?.sourceUpdatedAt, Number.isFinite(parsedLastModified) ? parsedLastModified : 0),
        };
    })();

    try {
        return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
        if (timeoutId != null) {
            globalThis.clearTimeout(timeoutId);
        }
    }
}

export async function fetchMarketPriceTable(
    fetchImpl = globalThis.fetch,
    { requestTimeoutMs = MARKETPLACE_REQUEST_TIMEOUT_MS } = {},
) {
    if (typeof fetchImpl !== "function") {
        throw new Error("Fetch API is unavailable in current environment.");
    }

    const responseData = await fetchMarketplacePayload(fetchImpl, MARKETPLACE_SERVER_URL, requestTimeoutMs);
    const payload = responseData.payload;
    const marketData = payload?.marketData;
    const priceTable = hydratePriceTableWithMarketData(marketData);
    const {
        enhancementQuotesByItem,
        enhancementLevelsByItem,
    } = extractEnhancementDataFromMarketData(marketData);
    return {
        sourceUrl: String(payload?.sourceUrl || MARKETPLACE_SERVER_URL),
        fetchedAt: Date.now(),
        sourceUpdatedAt: Number(responseData.sourceUpdatedAt || payload?.fetchedAt || Date.now()),
        stale: payload?.stale === true,
        priceTable,
        enhancementQuotesByItem,
        enhancementLevelsByItem,
    };
}
