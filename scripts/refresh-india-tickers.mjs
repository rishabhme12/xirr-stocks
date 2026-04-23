#!/usr/bin/env node
/**
 * Rebuilds data/india-tickers.json from the NSE master equity file (EQUITY_L.csv).
 * Run when you need new listings; commit the updated JSON.
 * Requires: network. Same User-Agent pattern as the rest of the app.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../data/india-tickers.json");
const NSE_EQUITY_CSV = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const UA = (process.env.YAHOO_USER_AGENT || "Mozilla/5.0 xirr-stocks/1.0").trim();

/**
 * NSE format: SYMBOL,NAME,SERIES,DATE,PAID_UP,MARKET_LOT,ISIN,FACE; NAME may contain commas.
 * @param {string} line
 * @returns {{ symbol: string; name: string; series: string; isin: string } | null}
 */
function parseNseEquityLine(line) {
  const parts = line.split(",");
  if (parts.length < 8) {
    return null;
  }
  const symbol = parts[0].trim();
  /** NSE uses hyphens in some tickers (e.g. BAJAJ-AUTO). */
  if (!/^[A-Z0-9][A-Z0-9-]*$/i.test(symbol)) {
    return null;
  }
  const face = parts[parts.length - 1].trim();
  const isin = parts[parts.length - 2].trim();
  const _lot = parts[parts.length - 3].trim();
  const _paid = parts[parts.length - 4].trim();
  const _date = parts[parts.length - 5].trim();
  const series = parts[parts.length - 6].trim();
  const name = parts
    .slice(1, -6)
    .join(",")
    .trim();
  if (!name || !/^INE/i.test(isin) || !/^\d+$/.test(face)) {
    return null;
  }
  return { symbol: symbol.toUpperCase(), name, series, isin: isin.toUpperCase() };
}

const text = await fetch(NSE_EQUITY_CSV, {
  headers: { "User-Agent": UA, Accept: "text/csv" },
}).then((r) => {
  if (!r.ok) {
    throw new Error(`NSE EQUITY_L request failed: ${r.status} ${r.statusText}`);
  }
  return r.text();
});

const lines = text.split(/\r?\n/).filter(Boolean);
const header = lines[0];
if (!/SYMBOL.*ISIN/i.test(header)) {
  throw new Error("Unexpected NSE header row.");
}

const rows = [];
const seen = new Set();
for (const line of lines.slice(1)) {
  const row = parseNseEquityLine(line);
  if (!row) {
    continue;
  }
  if (seen.has(row.symbol)) {
    continue;
  }
  seen.add(row.symbol);
  rows.push({
    symbol: `${row.symbol}.NS`,
    name: row.name,
    exchange: "NSE",
    isin: row.isin,
  });
}

rows.sort((a, b) => a.symbol.localeCompare(b.symbol, "en"));
await writeFile(OUT, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
console.log(`Wrote ${rows.length} NSE names to ${path.relative(process.cwd(), OUT)}`);
