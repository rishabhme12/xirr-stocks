import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadGoldMonthlyRowsFromDataDir,
  loadSilverMonthlyRowsFromDataDir,
} from "./metal-monthly-files.mjs";
import { parseYahooChart } from "./stock-data.mjs";
import { logInfo, logWarn } from "./logger.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BENCHMARK_IDS = ["sp500", "gold", "silver", "qqq"];

/** Yahoo Finance symbols; no API key. Monthly series = last trading day close per calendar month (UTC). */
export const BENCHMARK_YAHOO = {
  sp500: { yahoo: "^GSPC", displaySymbol: "S&P 500", companyName: "S&P 500" },
  gold: {
    yahoo: "GC=F",
    displaySymbol: "GOLD",
    companyName: "GOLD (USD/oz monthly, Datahub + COMEX)",
  },
  silver: {
    yahoo: "SI=F",
    displaySymbol: "SILVER",
    companyName: "SILVER (USD/oz monthly, file + COMEX)",
  },
  qqq: { yahoo: "QQQ", displaySymbol: "QQQ", companyName: "QQQ" },
};

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const EARLIEST_MONTH = "1990-01";
const UNIX_JAN_1990 = Math.floor(Date.UTC(1990, 0, 1) / 1000);

const dataDir = path.join(__dirname, "../../data/benchmark-monthly");
const inflight = new Map();

function currentUtcMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isoDateFromUnix(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function monthKeyFromIsoDate(isoDate) {
  return isoDate.slice(0, 7);
}

/**
 * One row per month: last available daily close in that month (UTC calendar month).
 */
export function dailyPricesToMonthlyRows(dailyPrices) {
  const byMonth = new Map();
  for (const row of dailyPrices) {
    if (!row?.date || !Number.isFinite(row.close)) {
      continue;
    }
    const m = monthKeyFromIsoDate(row.date);
    byMonth.set(m, { month: m, date: row.date, close: Number(row.close) });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function monthlyRowsToDailyPrices(monthlyRows) {
  return monthlyRows.map((r) => ({ date: r.date, close: r.close }));
}

function serialiseCsv(rows) {
  const lines = ["month,date,close", ...rows.map((r) => `${r.month},${r.date},${r.close}`)];
  return `${lines.join("\n")}\n`;
}

function parseMonthlyCsv(text) {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return [];
  }
  const header = lines[0].toLowerCase();
  if (!header.includes("month") || !header.includes("close")) {
    throw new Error("Benchmark CSV must have month,date,close header.");
  }
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    if (parts.length < 3) {
      continue;
    }
    const [month, date, closeRaw] = parts;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      continue;
    }
    const close = Number(closeRaw);
    if (!Number.isFinite(close)) {
      continue;
    }
    rows.push({ month, date, close });
  }
  return rows.sort((a, b) => a.month.localeCompare(b.month));
}

async function readMonthlyRowsFromDisk(benchmarkId) {
  const filePath = path.join(dataDir, `${benchmarkId}.csv`);
  try {
    const text = await readFile(filePath, "utf8");
    return parseMonthlyCsv(text);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeMonthlyCsvAtomic(benchmarkId, rows) {
  await mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, `${benchmarkId}.csv`);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, serialiseCsv(rows), "utf8");
  await rename(tmpPath, filePath);
}

async function fetchYahooDailyRange(yahooSymbol, period1, period2) {
  const url = `${YAHOO_CHART_URL}${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=false`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 xirr-stocks/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const base = `Yahoo Finance request failed with status ${response.status}`;
    if (response.status === 404) {
      throw new Error(`${base}. No chart data for "${yahooSymbol}".`);
    }
    throw new Error(`${base}.`);
  }
  const payload = await response.json();
  const parsed = parseYahooChart(payload, yahooSymbol);
  return parsed;
}

function mergeMonthlyRows(existing, incoming) {
  const map = new Map();
  for (const row of existing) {
    map.set(row.month, row);
  }
  for (const row of incoming) {
    map.set(row.month, row);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

async function loadMetalFileRows(benchmarkId) {
  if (benchmarkId === "gold") {
    return loadGoldMonthlyRowsFromDataDir(EARLIEST_MONTH);
  }
  if (benchmarkId === "silver") {
    return loadSilverMonthlyRowsFromDataDir(EARLIEST_MONTH);
  }
  return [];
}

function nextUtcDayIso(isoDate) {
  const t = new Date(`${isoDate}T12:00:00.000Z`).getTime() + 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Load CSV, fetch Yahoo for any missing months (1990-01 through current month tail), persist, return monthly rows.
 */
export async function ensureBenchmarkMonthlyLoaded(benchmarkId) {
  if (!BENCHMARK_IDS.includes(benchmarkId)) {
    throw new Error(`Unknown benchmark "${benchmarkId}".`);
  }

  const meta = BENCHMARK_YAHOO[benchmarkId];
  const yahooSymbol = meta.yahoo;
  const inflightKey = benchmarkId;
  if (inflight.has(inflightKey)) {
    return inflight.get(inflightKey);
  }

  const promise = (async () => {
    const fileRows = await loadMetalFileRows(benchmarkId);
    let rows = mergeMonthlyRows(fileRows, await readMonthlyRowsFromDisk(benchmarkId));
    const targetMonth = currentUtcMonth();
    const monthsSet = new Set(rows.map((r) => r.month));

    const needsBackfillStart = rows.length > 0 && rows[0].month > EARLIEST_MONTH;
    const needsTail =
      rows.length === 0 ||
      (rows[rows.length - 1].month < targetMonth && !monthsSet.has(targetMonth));

    const missingMiddle =
      rows.length > 1 &&
      (() => {
        for (let i = 1; i < rows.length; i += 1) {
          const prev = rows[i - 1].month;
          const cur = rows[i].month;
          if (monthIndex(cur) - monthIndex(prev) > 1) {
            return true;
          }
        }
        return false;
      })();

    logInfo("benchmark-monthly", "ensure", {
      benchmarkId,
      yahooSymbol,
      csvRows: rows.length,
      lastMonth: rows.length ? rows[rows.length - 1].month : null,
      targetMonth,
      needsTail,
      missingMiddle,
      needsBackfillStart,
    });

    if (rows.length === 0) {
      const end = Math.floor(Date.now() / 1000) + 86400;
      const chart = await fetchYahooDailyRange(yahooSymbol, UNIX_JAN_1990, end);
      rows = dailyPricesToMonthlyRows(chart.dailyPrices);
      if (rows.length > 0) {
        await writeMonthlyCsvAtomic(benchmarkId, rows);
      }
      return rows;
    }

    try {
      if (missingMiddle) {
        const end = Math.floor(Date.now() / 1000) + 86400;
        const chart = await fetchYahooDailyRange(yahooSymbol, UNIX_JAN_1990, end);
        rows = mergeMonthlyRows(rows, dailyPricesToMonthlyRows(chart.dailyPrices));
        if (rows.length > 0) {
          await writeMonthlyCsvAtomic(benchmarkId, rows);
        }
      } else if (needsBackfillStart) {
        const firstTs = Math.floor(new Date(`${rows[0].date}T12:00:00.000Z`).getTime() / 1000);
        const endBackfill = firstTs - 86400;
        if (endBackfill > UNIX_JAN_1990) {
          const chart = await fetchYahooDailyRange(yahooSymbol, UNIX_JAN_1990, endBackfill);
          rows = mergeMonthlyRows(rows, dailyPricesToMonthlyRows(chart.dailyPrices));
          if (rows.length > 0) {
            await writeMonthlyCsvAtomic(benchmarkId, rows);
          }
        }
      }

      if (needsTail) {
        const last = rows[rows.length - 1];
        const start = Math.floor(
          new Date(`${nextUtcDayIso(last.date)}T12:00:00.000Z`).getTime() / 1000,
        );
        const end = Math.floor(Date.now() / 1000) + 86400;
        if (start < end) {
          const chart = await fetchYahooDailyRange(yahooSymbol, start, end);
          rows = mergeMonthlyRows(rows, dailyPricesToMonthlyRows(chart.dailyPrices));
          if (rows.length > 0) {
            await writeMonthlyCsvAtomic(benchmarkId, rows);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarn("benchmark-monthly", "Yahoo merge failed", {
        benchmarkId,
        message: msg,
        fallbackToDiskRows: rows.length > 0,
      });
      if (rows.length > 0) {
        return rows;
      }
      throw new Error(
        `Benchmark "${benchmarkId}" could not load monthly prices (network or Yahoo Finance).`,
      );
    }

    return rows;
  })();

  inflight.set(inflightKey, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(inflightKey);
  }
}

function monthIndex(ym) {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

/**
 * History object compatible with createPortfolioEstimate / getStockHistory shape.
 */
export async function getBenchmarkStockLikeHistory(benchmarkId) {
  const meta = BENCHMARK_YAHOO[benchmarkId];
  const monthlyRows = await ensureBenchmarkMonthlyLoaded(benchmarkId);
  if (monthlyRows.length === 0) {
    throw new Error(`No monthly benchmark data available for ${benchmarkId}.`);
  }

  const dailyPrices = monthlyRowsToDailyPrices(monthlyRows);
  const last = monthlyRows[monthlyRows.length - 1];

  return {
    symbol: meta.displaySymbol,
    companyName: meta.companyName,
    latestPrice: last.close,
    latestPriceDate: last.date,
    dailyPrices,
  };
}

export async function syncAllBenchmarkMonthlyFromYahoo() {
  await mkdir(dataDir, { recursive: true });
  for (const id of BENCHMARK_IDS) {
    await ensureBenchmarkMonthlyLoaded(id);
  }
}

export function getBenchmarkDataDir() {
  return dataDir;
}
