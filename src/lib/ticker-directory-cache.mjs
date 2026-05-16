import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARKET_BENCHMARKS, benchmarkEntryForMarket } from "./market-benchmarks.mjs";
import { fetchNseIndiaEquityTickers, extractIndiaEtfRowsFromEquities } from "./nse-india-equities.mjs";
import {
  fetchUsEtfUniverse,
  fetchUsCommodityFutures,
  fetchIndiaIndexUniverse,
  searchYahooFinanceQuotes,
} from "./yahoo-screener.mjs";
import { logInfo, logWarn } from "./logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "../../data/ticker-cache");
const CACHE_FILE = path.join(CACHE_DIR, "universe.json");
const LEGACY_INDIA_PATH = path.join(__dirname, "../../data/india-tickers.json");

/** Max age before a ticker API call triggers background revalidation (stale-while-revalidate). */
const DEFAULT_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** @type {{ loadedAt: number; indiaStocks: object[]; indiaEtfs: object[]; indiaIndices: object[]; usEtfs: object[]; usCommodities: object[]; source: string }} */
let state = {
  loadedAt: 0,
  indiaStocks: [],
  indiaEtfs: [],
  indiaIndices: [],
  usEtfs: [],
  usCommodities: [],
  source: "none",
};

let refreshInFlight = null;

export function getTickerCacheMaxAgeMs() {
  const raw = Number.parseInt(
    process.env.TICKER_CACHE_MAX_AGE_MS || process.env.TICKER_REFRESH_INTERVAL_MS || "",
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_MAX_AGE_MS;
}

function uniqueBySymbol(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (!r?.symbol || seen.has(r.symbol)) {
      return false;
    }
    seen.add(r.symbol);
    return true;
  });
}

function withCategory(rows, category) {
  return rows.map((r) => ({ ...r, category: r.category || category }));
}

async function loadLegacyIndiaBundled() {
  const text = await readFile(LEGACY_INDIA_PATH, "utf8");
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error("india-tickers.json must be a JSON array.");
  }
  return withCategory(data, "stock");
}

async function loadDiskCache() {
  try {
    const text = await readFile(CACHE_FILE, "utf8");
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") {
      return false;
    }
    state = {
      loadedAt: Date.parse(data.updatedAt) || 0,
      indiaStocks: data.indiaStocks || [],
      indiaEtfs: data.indiaEtfs || [],
      indiaIndices: data.indiaIndices || [],
      usEtfs: data.usEtfs || [],
      usCommodities: data.usCommodities || [],
      source: "disk",
    };
    return state.indiaStocks.length > 0;
  } catch (err) {
    if (err?.code !== "ENOENT") {
      logWarn("ticker-cache", "disk read failed", { message: err.message });
    }
    return false;
  }
}

async function persistDiskCache() {
  await mkdir(CACHE_DIR, { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    indiaStocks: state.indiaStocks,
    indiaEtfs: state.indiaEtfs,
    indiaIndices: state.indiaIndices,
    usEtfs: state.usEtfs,
    usCommodities: state.usCommodities,
  };
  await writeFile(CACHE_FILE, `${JSON.stringify(payload)}\n`, "utf8");
}

/**
 * Refresh NSE equities + Yahoo ETF/futures/index universes.
 * @param {{ reason?: string }} [opts]
 */
export async function refreshTickerDirectories(opts = {}) {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const reason = opts.reason || "manual";
    logInfo("ticker-cache", "refresh started", { reason });

    let indiaStocks = state.indiaStocks;
    let indiaEtfs = state.indiaEtfs;
    let indiaIndices = state.indiaIndices;
    let usEtfs = state.usEtfs;
    let usCommodities = state.usCommodities;

    try {
      indiaStocks = await fetchNseIndiaEquityTickers();
      indiaEtfs = extractIndiaEtfRowsFromEquities(indiaStocks);
    } catch (e) {
      logWarn("ticker-cache", "NSE refresh failed, keeping prior India stocks", {
        message: e.message,
      });
      if (!indiaStocks.length) {
        indiaStocks = await loadLegacyIndiaBundled();
        indiaEtfs = extractIndiaEtfRowsFromEquities(indiaStocks);
      }
    }

    try {
      usEtfs = await fetchUsEtfUniverse();
    } catch (e) {
      logWarn("ticker-cache", "US ETF screener failed", { message: e.message });
    }

    try {
      usCommodities = await fetchUsCommodityFutures();
    } catch (e) {
      logWarn("ticker-cache", "commodity futures screener failed", { message: e.message });
    }

    try {
      indiaIndices = await fetchIndiaIndexUniverse();
    } catch (e) {
      logWarn("ticker-cache", "India index screener failed", { message: e.message });
    }

    const seeds = withCategory(MARKET_BENCHMARKS, null).map((b) => ({
      ...b,
      category: b.category || "index",
    }));

    state = {
      loadedAt: Date.now(),
      indiaStocks,
      indiaEtfs: uniqueBySymbol([...indiaEtfs, ...seeds.filter((s) => s.symbol.endsWith(".NS") && s.category === "etf")]),
      indiaIndices: uniqueBySymbol([
        ...indiaIndices,
        ...seeds.filter((s) => s.category === "index" && benchmarkEntryForMarket(s, "in")),
      ]),
      usEtfs: uniqueBySymbol([
        ...usEtfs,
        ...seeds.filter((s) => s.category === "etf" && !s.symbol.endsWith(".NS")),
      ]),
      usCommodities: uniqueBySymbol([
        ...usCommodities,
        ...seeds.filter((s) => s.category === "commodity"),
      ]),
      source: "network",
    };

    try {
      await persistDiskCache();
    } catch (e) {
      logWarn("ticker-cache", "disk write failed", { message: e.message });
    }

    logInfo("ticker-cache", "refresh done", {
      indiaStocks: state.indiaStocks.length,
      indiaEtfs: state.indiaEtfs.length,
      indiaIndices: state.indiaIndices.length,
      usEtfs: state.usEtfs.length,
      usCommodities: state.usCommodities.length,
    });
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/** Load bundled / disk cache; does not block on network. */
export async function initTickerDirectoryCache() {
  const fromDisk = await loadDiskCache();
  if (!fromDisk) {
    try {
      const bundled = await loadLegacyIndiaBundled();
      state = {
        loadedAt: Date.now(),
        indiaStocks: bundled,
        indiaEtfs: extractIndiaEtfRowsFromEquities(bundled),
        indiaIndices: withCategory(
          MARKET_BENCHMARKS.filter((b) => b.category === "index" && benchmarkEntryForMarket(b, "in")),
          "index",
        ),
        usEtfs: withCategory(
          MARKET_BENCHMARKS.filter((b) => b.category === "etf" && !b.symbol.endsWith(".NS")),
          "etf",
        ),
        usCommodities: withCategory(
          MARKET_BENCHMARKS.filter((b) => b.category === "commodity"),
          "commodity",
        ),
        source: "bundled",
      };
    } catch (e) {
      logWarn("ticker-cache", "bundled India load failed", { message: e.message });
    }
  }
}

export function getTickerDirectoryLoadedAt() {
  return state.loadedAt;
}

/**
 * Stale-while-revalidate: return immediately from cache; refresh in background when stale.
 * Triggered by /api/tickers (client search), not on a timer.
 * @param {{ force?: boolean; reason?: string }} [opts]
 * @returns {Promise<void> | null}
 */
export function revalidateTickerDirectoriesOnUse(opts = {}) {
  if (process.env.TICKER_REFRESH_DISABLE === "1") {
    return null;
  }
  const force = opts.force === true;
  if (!force && !isTickerCacheStale()) {
    return null;
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }
  return refreshTickerDirectories({
    reason: opts.reason || (force ? "revalidate" : "stale"),
  });
}

export function getIndiaStockRows() {
  if (state.indiaStocks.length === 0) {
    return null;
  }
  return state.indiaStocks;
}

/**
 * Cached non-equity rows for a market + category.
 * @param {"us" | "in" | "all"} market
 * @param {"index" | "etf" | "commodity" | "all"} category
 */
export function getCachedSpecialtyRows(market, category) {
  const rows = [];
  const push = (list) => {
    for (const r of list) {
      rows.push(r);
    }
  };

  if (category === "all" || category === "index") {
    if (market === "in" || market === "all") {
      push(state.indiaIndices);
    }
    if (market === "us" || market === "all") {
      push(
        withCategory(
          MARKET_BENCHMARKS.filter((b) => b.category === "index" && benchmarkEntryForMarket(b, market)),
          "index",
        ),
      );
    }
  }
  if (category === "all" || category === "etf") {
    if (market === "in" || market === "all") {
      push(state.indiaEtfs);
    }
    if (market === "us" || market === "all") {
      push(state.usEtfs);
    }
  }
  if (category === "all" || category === "commodity") {
    if (market === "us" || market === "all") {
      push(state.usCommodities);
    }
    if (market === "in" || market === "all") {
      push(state.usCommodities.filter((r) => r.symbol.endsWith("=F")));
    }
  }

  return uniqueBySymbol(rows);
}

/**
 * Yahoo live search for indices / ETFs / commodities (US index universe is too large to prefetch).
 * @param {string} query
 * @param {"us" | "in" | "all"} market
 * @param {"index" | "etf" | "commodity"} category
 */
export async function searchLiveSpecialtyQuotes(query, market, category) {
  const quoteTypes = [category];
  const rows = await searchYahooFinanceQuotes(query, { quoteTypes, market });
  return rows;
}

export function isTickerCacheStale() {
  if (!state.loadedAt) {
    return true;
  }
  return Date.now() - state.loadedAt > getTickerCacheMaxAgeMs();
}
