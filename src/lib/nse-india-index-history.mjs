const NSE_HOME = "https://www.nseindia.com/";
const NSE_ALL_INDICES = "https://www.nseindia.com/api/allIndices";
const NSE_INDEX_HISTORY = "https://www.nseindia.com/api/historicalOR/indicesHistory";
const UA = (process.env.YAHOO_USER_AGENT || "Mozilla/5.0 xirr-stocks/1.0").trim();

/** Yahoo chart rows below this count trigger an NSE backfill for India caret indices. */
export const SHALLOW_YAHOO_INDEX_DAYS = 60;
const ALL_INDICES_CACHE_MS = 12 * 60 * 60 * 1000;
const CHUNK_CALENDAR_DAYS = 360;
const CHUNK_DELAY_MS = 120;
const EARLIEST_INDEX_DATE = new Date(Date.UTC(1990, 0, 1));

const MONTH_ABBR = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

let sessionCache = { loadedAt: 0, cookie: "" };
let allIndicesCache = { loadedAt: 0, rows: [] };
const historyInflight = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeIndexKey(text) {
  return String(text || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function compactIndexKey(text) {
  return normalizeIndexKey(text).replace(/\s+/g, "");
}

function formatNseApiDate(date) {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}-${m}-${y}`;
}

function addCalendarDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function readSetCookieHeader(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }
  const raw = response.headers.get("set-cookie");
  return raw ? raw.split(/,(?=[^;]+?=)/).map((c) => c.split(";")[0]).join("; ") : "";
}

async function getNseSessionCookie() {
  const now = Date.now();
  if (sessionCache.cookie && now - sessionCache.loadedAt < ALL_INDICES_CACHE_MS) {
    return sessionCache.cookie;
  }
  const response = await fetch(NSE_HOME, { headers: { "User-Agent": UA } });
  if (!response.ok) {
    throw new Error(`NSE home request failed: ${response.status}`);
  }
  const cookie = readSetCookieHeader(response);
  sessionCache = { loadedAt: now, cookie };
  return cookie;
}

async function nseJsonGet(url) {
  const cookie = await getNseSessionCookie();
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: NSE_HOME,
      Cookie: cookie,
    },
  });
  if (!response.ok) {
    throw new Error(`NSE request failed: ${response.status} ${url}`);
  }
  return response.json();
}

export function parseNseEodDate(eodTimestamp) {
  const match = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/.exec(String(eodTimestamp || "").trim().toUpperCase());
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = MONTH_ABBR[match[2]];
  const year = Number(match[3]);
  if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null;
  }
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * Map a Yahoo index label (^CNXSC → "NIFTY SMLCAP 100") to NSE `indexType` for indicesHistory.
 * @param {string} yahooLabel
 * @param {Array<{ index?: string; indexSymbol?: string }>} allIndicesRows
 */
export function resolveNseIndexType(yahooLabel, allIndicesRows) {
  const label = normalizeIndexKey(yahooLabel);
  if (!label) {
    return null;
  }
  const compact = compactIndexKey(label);

  for (const row of allIndicesRows) {
    const indexName = normalizeIndexKey(row.index);
    const indexSymbol = normalizeIndexKey(row.indexSymbol);
    if (label === indexName || label === indexSymbol) {
      return row.index || null;
    }
    if (compact === compactIndexKey(indexName) || compact === compactIndexKey(indexSymbol)) {
      return row.index || null;
    }
  }

  for (const row of allIndicesRows) {
    const indexSymbol = compactIndexKey(row.indexSymbol);
    if (!indexSymbol) {
      continue;
    }
    if (compact.includes(indexSymbol) || indexSymbol.includes(compact.replace(/^NIFTY/, ""))) {
      return row.index || null;
    }
  }

  return null;
}

export async function loadAllIndicesRows() {
  const now = Date.now();
  if (allIndicesCache.rows.length > 0 && now - allIndicesCache.loadedAt < ALL_INDICES_CACHE_MS) {
    return allIndicesCache.rows;
  }
  const payload = await nseJsonGet(NSE_ALL_INDICES);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  allIndicesCache = { loadedAt: now, rows };
  return rows;
}

function nseRowsToDailyPrices(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const date = parseNseEodDate(row.EOD_TIMESTAMP);
    const close = Number(row.EOD_CLOSE_INDEX_VAL);
    if (!date || !Number.isFinite(close)) {
      continue;
    }
    byDate.set(date, { date, close });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchNseIndexChunk(indexType, fromDate, toDate) {
  const params = new URLSearchParams({
    indexType,
    from: formatNseApiDate(fromDate),
    to: formatNseApiDate(toDate),
  });
  const payload = await nseJsonGet(`${NSE_INDEX_HISTORY}?${params.toString()}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

/**
 * Daily index closes from NSE (chunked; max 365 calendar days per request).
 * @param {string} indexType NSE `index` name, e.g. "NIFTY SMALLCAP 100"
 * @param {Date} [fromDate]
 */
export async function fetchNseIndiaIndexDailyPrices(indexType, fromDate = EARLIEST_INDEX_DATE) {
  const inflightKey = `${indexType}|${fromDate.toISOString().slice(0, 10)}`;
  if (historyInflight.has(inflightKey)) {
    return historyInflight.get(inflightKey);
  }

  const promise = (async () => {
    const endDate = new Date();
    const merged = [];
    let cursor = new Date(fromDate.getTime());

    while (cursor <= endDate) {
      const chunkEnd = addCalendarDays(cursor, CHUNK_CALENDAR_DAYS);
      const boundedEnd = chunkEnd > endDate ? endDate : chunkEnd;
      const chunkRows = await fetchNseIndexChunk(indexType, cursor, boundedEnd);
      merged.push(...chunkRows);
      cursor = addCalendarDays(boundedEnd, 1);
      if (cursor <= endDate) {
        await sleep(CHUNK_DELAY_MS);
      }
    }

    return nseRowsToDailyPrices(merged);
  })();

  historyInflight.set(inflightKey, promise);
  try {
    return await promise;
  } finally {
    historyInflight.delete(inflightKey);
  }
}

function buildIndiaIndexHistory(yahooSymbol, yahooLabel, dailyPrices) {
  const last = dailyPrices[dailyPrices.length - 1];
  return {
    symbol: yahooSymbol,
    yahooSymbol: yahooSymbol,
    quoteCurrency: "INR",
    companyName: yahooLabel,
    dailyPrices,
    latestPrice: last.close,
    latestPriceDate: last.date,
    marketCap: null,
    events: {},
  };
}

/**
 * Full history from NSE when Yahoo chart is missing or too shallow.
 * @param {string} yahooSymbol User-facing caret symbol (e.g. ^CNXMIDCAP)
 * @param {string} yahooLabel Display / NSE match label (e.g. Nifty Midcap 50)
 * @param {string} [nseIndexType] When known (from catalog), skip name resolution
 */
export async function fetchIndiaIndexHistoryFromNse(yahooSymbol, yahooLabel, nseIndexType = null) {
  if (!/^\^/.test(yahooSymbol) || yahooSymbol === "^BSESN") {
    return null;
  }
  let indexType = nseIndexType;
  if (!indexType) {
    const allIndices = await loadAllIndicesRows();
    indexType =
      resolveNseIndexType(yahooLabel, allIndices) ||
      resolveNseIndexType(String(yahooSymbol).replace(/^\^/, ""), allIndices);
  }
  if (!indexType) {
    return null;
  }
  const dailyPrices = await fetchNseIndiaIndexDailyPrices(indexType);
  if (dailyPrices.length === 0) {
    return null;
  }
  return buildIndiaIndexHistory(yahooSymbol, yahooLabel, dailyPrices);
}

/**
 * Replace shallow Yahoo caret-index history with NSE EOD data when available.
 * @param {string} yahooSymbol e.g. ^CNXSC
 * @param {object} parsed Yahoo chart parse result
 */
export async function enrichShallowIndiaIndexFromNse(yahooSymbol, parsed) {
  if (!/^\^/.test(yahooSymbol) || yahooSymbol === "^BSESN") {
    return parsed;
  }
  if ((parsed.dailyPrices?.length ?? 0) >= SHALLOW_YAHOO_INDEX_DAYS) {
    return parsed;
  }

  const yahooLabel = parsed.companyName || parsed.symbol || yahooSymbol;
  try {
    const nseHistory = await fetchIndiaIndexHistoryFromNse(yahooSymbol, yahooLabel);
    if (!nseHistory || nseHistory.dailyPrices.length <= (parsed.dailyPrices?.length ?? 0)) {
      return parsed;
    }
    return { ...parsed, ...nseHistory, companyName: parsed.companyName || yahooLabel };
  } catch {
    return parsed;
  }
}

export const __testables = {
  formatNseApiDate,
  resolveNseIndexType,
  parseNseEodDate,
  nseRowsToDailyPrices,
};
