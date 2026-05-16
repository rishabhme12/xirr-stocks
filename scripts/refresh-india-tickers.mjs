#!/usr/bin/env node
/**
 * Rebuilds data/india-tickers.json from NSE EQUITY_L and refreshes data/ticker-cache/universe.json.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchNseIndiaEquityTickers } from "../src/lib/nse-india-equities.mjs";
import { initTickerDirectoryCache, refreshTickerDirectories } from "../src/lib/ticker-directory-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../data/india-tickers.json");

const rows = await fetchNseIndiaEquityTickers();
await writeFile(OUT, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
console.log(`Wrote ${rows.length} NSE names to ${path.relative(process.cwd(), OUT)}`);

await initTickerDirectoryCache();
await refreshTickerDirectories({ reason: "cli" });
console.log("Updated data/ticker-cache/universe.json");
