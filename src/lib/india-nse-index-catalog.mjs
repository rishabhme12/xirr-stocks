import { loadAllIndicesRows, resolveNseIndexType } from "./nse-india-index-history.mjs";
import { fetchIndiaIndexUniverse } from "./yahoo-screener.mjs";
import { normalizeSearchKey } from "./market-benchmarks.mjs";
import { logInfo, logWarn } from "./logger.mjs";

const CATALOG_CACHE_MS = 12 * 60 * 60 * 1000;

/** @type {{ loadedAt: number; entries: import("./india-nse-index-catalog.mjs").IndiaIndexCatalogEntry[] }} */
let catalogCache = { loadedAt: 0, entries: [] };

/**
 * @typedef {object} IndiaIndexCatalogEntry
 * @property {string} symbol App symbol shown in typeahead (^NSEI or ^NIFTYSMLCAP250)
 * @property {string} name Display name
 * @property {string} nseIndexType NSE indicesHistory indexType (row.index)
 * @property {string | null} yahooChartSymbol Yahoo chart ticker when known
 * @property {string} exchange
 * @property {string} category
 */

function compactIndexKey(text) {
  return String(text || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function titleCaseIndex(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {Array<{ index?: string; indexSymbol?: string }>} nseRows
 * @param {Array<{ symbol: string; name?: string }>} yahooCaretRows
 */
export function buildIndiaNseIndexCatalog(nseRows, yahooCaretRows = []) {
  /** @type {Map<string, string>} nseIndexType → yahoo symbol */
  const yahooByNse = new Map();

  for (const row of yahooCaretRows) {
    const yahooSym = String(row.symbol || "").toUpperCase();
    if (!yahooSym.startsWith("^")) {
      continue;
    }
    const label = row.name || yahooSym;
    const nseType = resolveNseIndexType(label, nseRows);
    if (nseType) {
      yahooByNse.set(nseType, yahooSym);
    }
  }

  /** @type {Map<string, IndiaIndexCatalogEntry>} */
  const bySymbol = new Map();

  for (const row of nseRows) {
    const nseIndexType = String(row.index || "").trim();
    if (!nseIndexType) {
      continue;
    }
    const yahooChartSymbol = yahooByNse.get(nseIndexType) || null;
    const fallback = `^${compactIndexKey(row.indexSymbol || row.index)}`;
    const symbol = yahooChartSymbol || fallback;
    const name = titleCaseIndex(nseIndexType);
    const entry = {
      symbol,
      name,
      nseIndexType,
      yahooChartSymbol,
      exchange: "INDEX",
      category: "index",
    };
    bySymbol.set(symbol, entry);
    if (yahooChartSymbol && yahooChartSymbol !== symbol && !bySymbol.has(yahooChartSymbol)) {
      bySymbol.set(yahooChartSymbol, { ...entry, symbol: yahooChartSymbol });
    }
  }

  return [...bySymbol.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * @param {IndiaIndexCatalogEntry[]} catalog
 * @param {string} query
 */
export function searchIndiaIndexCatalog(catalog, query, limit = 10) {
  const key = normalizeSearchKey(query);
  if (!key) {
    return catalog.slice(0, limit);
  }

  const scored = catalog
    .map((entry) => ({ entry, score: scoreIndiaIndexCatalogEntry(entry, key) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name, "en"));

  return scored.slice(0, limit).map((row) => row.entry);
}

/**
 * @param {IndiaIndexCatalogEntry} entry
 * @param {string} key normalized query
 */
export function scoreIndiaIndexCatalogEntry(entry, key) {
  const fields = [
    normalizeSearchKey(entry.symbol),
    normalizeSearchKey(entry.name),
    normalizeSearchKey(entry.nseIndexType),
    compactIndexKey(entry.nseIndexType),
    compactIndexKey(entry.name),
    compactIndexKey(entry.symbol.replace(/^\^/, "")),
  ];

  if (fields.some((f) => f === key)) {
    return 100;
  }
  if (fields.some((f) => f && (f.includes(key) || key.includes(f)))) {
    return 60;
  }

  const queryTokens = key.match(/[A-Z]+|\d+/g) || [];
  if (queryTokens.length === 0) {
    return 0;
  }
  const haystack = fields.filter(Boolean).join(" ");
  const matched = queryTokens.filter((t) => t.length >= 2 && haystack.includes(t)).length;
  if (matched === 0) {
    return 0;
  }
  return 20 + matched * 15;
}

/**
 * @param {IndiaIndexCatalogEntry[]} catalog
 * @param {string} symbolOrQuery
 */
export function lookupIndiaIndexCatalogEntry(catalog, symbolOrQuery) {
  const sym = String(symbolOrQuery || "")
    .trim()
    .toUpperCase();
  if (!sym) {
    return null;
  }
  const direct = catalog.find((e) => e.symbol.toUpperCase() === sym);
  if (direct) {
    return direct;
  }
  const key = normalizeSearchKey(symbolOrQuery);
  const hits = searchIndiaIndexCatalog(catalog, key, 1);
  return hits[0] || null;
}

export function getIndiaIndexCatalogEntries() {
  return catalogCache.entries;
}

export function getIndiaIndexCatalogSymbolSet() {
  return new Set(catalogCache.entries.map((e) => e.symbol.toUpperCase()));
}

/** @returns {Array<{ symbol: string; name: string; exchange: string; category: string }>} */
export function getIndiaIndexCatalogTickerRows() {
  return catalogCache.entries.map(({ symbol, name, exchange, category }) => ({
    symbol,
    name,
    exchange,
    category,
  }));
}

/**
 * Load NSE allIndices + Yahoo caret list; build searchable catalog.
 */
export async function refreshIndiaNseIndexCatalog() {
  try {
    const [nseRows, yahooRows] = await Promise.all([
      loadAllIndicesRows(),
      fetchIndiaIndexUniverse().catch(() => []),
    ]);
    const entries = buildIndiaNseIndexCatalog(nseRows, yahooRows);
    catalogCache = { loadedAt: Date.now(), entries };
    logInfo("india-index-catalog", "refreshed", { count: entries.length });
    return entries;
  } catch (err) {
    logWarn("india-index-catalog", "refresh failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function ensureIndiaNseIndexCatalog() {
  const now = Date.now();
  if (catalogCache.entries.length > 0 && now - catalogCache.loadedAt < CATALOG_CACHE_MS) {
    return catalogCache.entries;
  }
  return refreshIndiaNseIndexCatalog();
}

export async function lookupIndiaIndexCatalogEntryAsync(symbolOrQuery) {
  const catalog = await ensureIndiaNseIndexCatalog();
  return lookupIndiaIndexCatalogEntry(catalog, symbolOrQuery);
}

export const __testables = {
  compactIndexKey,
  buildIndiaNseIndexCatalog,
  scoreIndiaIndexCatalogEntry,
};
