import {
  enrichTickerDisplayName,
  INDIA_INDEX_SYMBOLS,
  US_INDEX_SYMBOLS,
} from "./market-benchmarks.mjs";
import { getYahooSession, YAHOO_USER_AGENT } from "./yahoo-session.mjs";
import { logDebug, logWarn } from "./logger.mjs";

const PREDEFINED_URL = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const SCREENER_URL = "https://query1.finance.yahoo.com/v1/finance/screener";
const SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search";

const US_ETF_SCREENERS = [
  "top_etfs_us",
  "top_performing_etfs",
  "bond_etfs",
  "technology_etfs",
  "commodity_etfs",
];

const PAGE_DELAY_MS = 120;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} quote
 * @param {string} category
 */
export function quoteToTickerRow(quote, category) {
  const symbol = String(quote.symbol || "").toUpperCase();
  if (!symbol) {
    return null;
  }
  const name = String(quote.longname || quote.shortname || quote.symbol || symbol).trim();
  let cat = category;
  const qt = String(quote.quoteType || "").toUpperCase();
  if (qt === "ETF" || cat === "etf") {
    cat = "etf";
  } else if (qt === "INDEX" || symbol.startsWith("^")) {
    cat = "index";
  } else if (qt === "FUTURE" || symbol.endsWith("=F")) {
    cat = "commodity";
  }
  return enrichTickerDisplayName({
    symbol,
    name,
    exchange: String(quote.exchange || quote.fullExchangeName || "").trim(),
    category: cat,
  });
}

async function fetchPredefinedPage(scrId, count, start) {
  const url = `${PREDEFINED_URL}?scrIds=${encodeURIComponent(scrId)}&count=${count}&start=${start}`;
  const response = await fetch(url, {
    headers: { "User-Agent": YAHOO_USER_AGENT, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Yahoo predefined screener "${scrId}" failed: ${response.status}`);
  }
  const payload = await response.json();
  const block = payload?.finance?.result?.[0];
  return {
    quotes: block?.quotes || [],
    total: block?.total ?? 0,
  };
}

/** Paginate a Yahoo predefined screener (max 250 per page). */
export async function fetchPredefinedScreenerAll(scrId, { pageSize = 250 } = {}) {
  const first = await fetchPredefinedPage(scrId, pageSize, 0);
  const total = first.total || first.quotes.length;
  const all = [...first.quotes];
  for (let start = pageSize; start < total; start += pageSize) {
    await sleep(PAGE_DELAY_MS);
    const page = await fetchPredefinedPage(scrId, pageSize, start);
    all.push(...page.quotes);
  }
  logDebug("yahoo-screener", "predefined screener loaded", { scrId, total, fetched: all.length });
  return all;
}

async function fetchCustomScreenerPage(session, body) {
  const url = `${SCREENER_URL}?crumb=${encodeURIComponent(session.crumb)}&corsDomain=finance.yahoo.com`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": YAHOO_USER_AGENT,
      "Content-Type": "application/json",
      Cookie: session.cookies,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Yahoo screener POST failed: ${response.status} ${text.slice(0, 120)}`);
  }
  const payload = await response.json();
  const err = payload?.finance?.error;
  if (err) {
    throw new Error(err.description || "Yahoo screener error");
  }
  const block = payload?.finance?.result?.[0];
  return {
    quotes: block?.quotes || [],
    total: block?.total ?? 0,
  };
}

/** Paginate custom screener (INDEX capped at 25 rows/page by Yahoo). */
export async function fetchCustomScreenerAll(quoteType, region, { pageSize = 25 } = {}) {
  const session = await getYahooSession();
  if (!session) {
    throw new Error("Could not establish Yahoo session for screener.");
  }

  const base = {
    count: pageSize,
    sortField: "ticker",
    sortType: "ASC",
    quoteType,
    query: { operator: "eq", operands: ["region", region] },
  };

  const first = await fetchCustomScreenerPage(session, { ...base, offset: 0 });
  const total = first.total || first.quotes.length;
  const all = [...first.quotes];
  for (let offset = pageSize; offset < total; offset += pageSize) {
    await sleep(PAGE_DELAY_MS);
    const page = await fetchCustomScreenerPage(session, { ...base, offset });
    all.push(...page.quotes);
  }
  logDebug("yahoo-screener", "custom screener loaded", { quoteType, region, total, fetched: all.length });
  return all;
}

/**
 * Live typeahead via Yahoo search (indices, ETFs, commodities not fully listable).
 * @param {string} query
 * @param {{ quoteTypes?: string[]; market?: "us" | "in" | "all" }} [opts]
 */
export async function searchYahooFinanceQuotes(query, opts = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return [];
  }
  const market = opts.market || "all";
  const quoteTypes = opts.quoteTypes || null;

  const url = `${SEARCH_URL}?q=${encodeURIComponent(trimmed)}&quotesCount=50&newsCount=0&enableFuzzyQuery=true`;
  let response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": YAHOO_USER_AGENT, Accept: "application/json" },
    });
  } catch (e) {
    logWarn("yahoo-screener", "search failed", { query: trimmed, message: e.message });
    return [];
  }
  if (!response.ok) {
    logWarn("yahoo-screener", "search failed", { status: response.status, query: trimmed });
    return [];
  }
  const payload = await response.json();
  const quotes = payload?.quotes || [];

  return quotes
    .map((q) => {
      const symbol = String(q.symbol || "").toUpperCase();
      const qt = String(q.quoteType || "").toUpperCase();
      let category = "stock";
      if (qt === "ETF") {
        category = "etf";
      } else if (qt === "INDEX" || symbol.startsWith("^")) {
        category = "index";
      } else if (qt === "FUTURE" || symbol.endsWith("=F")) {
        category = "commodity";
      } else if (qt === "EQUITY") {
        category = "stock";
      }

      if (quoteTypes && !quoteTypes.includes(category)) {
        return null;
      }
      if (market === "in" && category === "stock" && !/\.(NS|BO)$/.test(symbol)) {
        return null;
      }
      if (market === "us" && /\.(NS|BO)$/.test(symbol)) {
        return null;
      }
      if (market === "in" && category !== "stock" && !/\.(NS|BO)$/.test(symbol) && !symbol.startsWith("^")) {
        return null;
      }
      if (market === "in" && category === "index" && US_INDEX_SYMBOLS.has(symbol)) {
        return null;
      }
      if (market === "us" && category === "index" && INDIA_INDEX_SYMBOLS.has(symbol)) {
        return null;
      }

      return quoteToTickerRow(q, category);
    })
    .filter(Boolean);
}

export async function fetchUsEtfUniverse() {
  const merged = new Map();
  for (const scrId of US_ETF_SCREENERS) {
    try {
      const quotes = await fetchPredefinedScreenerAll(scrId);
      for (const q of quotes) {
        const row = quoteToTickerRow(q, "etf");
        if (row) {
          merged.set(row.symbol, row);
        }
      }
      await sleep(PAGE_DELAY_MS);
    } catch (e) {
      logWarn("yahoo-screener", "ETF screener skipped", { scrId, message: e.message });
    }
  }
  return [...merged.values()];
}

export async function fetchUsCommodityFutures() {
  const quotes = await fetchPredefinedScreenerAll("futures");
  return quotes.map((q) => quoteToTickerRow(q, "commodity")).filter(Boolean);
}

export async function fetchIndiaIndexUniverse() {
  const quotes = await fetchCustomScreenerAll("INDEX", "in");
  return quotes.map((q) => quoteToTickerRow(q, "index")).filter(Boolean);
}
