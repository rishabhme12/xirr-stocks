import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_BENCHMARKS,
  US_INDEX_SYMBOLS,
  INDIA_INDEX_SYMBOLS,
  benchmarkEntryForMarket,
  normalizeSearchKey,
  resolveIndiaIndexAlias,
  resolveUsIndexKeywordSeeds,
  resolveUsEtfKeywordSeedQueries,
  isSearchableIndiaIndexSymbol,
  isSearchableIndexSymbol,
  isSearchableEtfSymbol,
  isSearchableCommoditySymbol,
} from "../src/lib/market-benchmarks.mjs";
import { getTickerDirectory } from "../src/lib/stock-data.mjs";
import { getCachedSpecialtyRows } from "../src/lib/ticker-directory-cache.mjs";

test("benchmarkEntryForMarket separates US and India caret indices", () => {
  const gspc = MARKET_BENCHMARKS.find((b) => b.symbol === "^GSPC");
  const nsei = MARKET_BENCHMARKS.find((b) => b.symbol === "^NSEI");
  assert.ok(gspc && nsei);
  assert.equal(benchmarkEntryForMarket(gspc, "us"), true);
  assert.equal(benchmarkEntryForMarket(gspc, "in"), false);
  assert.equal(benchmarkEntryForMarket(nsei, "in"), true);
  assert.equal(benchmarkEntryForMarket(nsei, "us"), false);
  assert.equal(US_INDEX_SYMBOLS.has("^GSPC"), true);
  assert.equal(INDIA_INDEX_SYMBOLS.has("^NSEI"), true);
});

test("resolveIndiaIndexAlias maps nifty500 to ^CRSLDX", () => {
  assert.equal(normalizeSearchKey("nifty 500"), "NIFTY500");
  assert.equal(resolveIndiaIndexAlias("nifty 500"), "^CRSLDX");
  assert.equal(resolveIndiaIndexAlias("nifty500"), "^CRSLDX");
});

test("resolveIndiaIndexAlias maps pharma to Nifty Pharma index", () => {
  assert.equal(resolveIndiaIndexAlias("pharma"), "^CNXPHARMA");
  assert.equal(resolveIndiaIndexAlias("nifty pharma"), "^CNXPHARMA");
});

test("resolveIndiaIndexAlias maps midcap to Nifty Midcap 50", () => {
  assert.equal(resolveIndiaIndexAlias("nifty midcap 50"), "^NSEMDCP50");
  assert.equal(resolveIndiaIndexAlias("nifty midcap"), "^NSEMDCP50");
  assert.equal(resolveIndiaIndexAlias("midcap"), "^NSEMDCP50");
});

test("India index search for midcap includes Midcap 50", async () => {
  const rows = await getTickerDirectory("midcap", "in", "index");
  assert.ok(
    rows.some((r) => r.symbol === "^NSEMDCP50" || /midcap 50/i.test(r.name)),
    "expected Nifty Midcap 50",
  );
});

test("isSearchableIndiaIndexSymbol allows caret indices only", () => {
  assert.equal(isSearchableIndiaIndexSymbol("^NSEI"), true);
  assert.equal(isSearchableIndiaIndexSymbol("^NSEBANK"), true);
  assert.equal(isSearchableIndiaIndexSymbol("ABSMSCINAV.NS"), false);
  assert.equal(isSearchableIndiaIndexSymbol("NIFTYBEES.NS"), false);
});

test("isSearchableIndexSymbol allows US caret indices only for US market", () => {
  assert.equal(isSearchableIndexSymbol("^GSPC", "us"), true);
  assert.equal(isSearchableIndexSymbol("^NSEI", "us"), false);
  assert.equal(isSearchableIndexSymbol("SPY", "us"), false);
});

test("isSearchableEtfSymbol rejects INAV and exchange contract tickers", () => {
  assert.equal(isSearchableEtfSymbol("SPY", "us"), true);
  assert.equal(isSearchableEtfSymbol("NIFTYBEES.NS", "in"), true);
  assert.equal(isSearchableEtfSymbol("FOOINAV.NS", "in"), false);
  assert.equal(isSearchableEtfSymbol("XUTM26.CME", "us"), false);
});

test("isSearchableCommoditySymbol allows continuous futures only", () => {
  assert.equal(isSearchableCommoditySymbol("GC=F"), true);
  assert.equal(isSearchableCommoditySymbol("CL=F"), true);
  assert.equal(isSearchableCommoditySymbol("XUTM26.CME"), false);
});

test("US index typeahead seeds use caret symbols only", async () => {
  const rows = await getTickerDirectory("", "us", "index");
  for (const sym of rows.map((r) => r.symbol)) {
    assert.ok(sym.startsWith("^"), `US index search must be caret symbol, got ${sym}`);
  }
});

test("US commodity cache excludes dated contract symbols", () => {
  const rows = getCachedSpecialtyRows("us", "commodity");
  for (const row of rows) {
    assert.ok(
      isSearchableCommoditySymbol(row.symbol),
      `commodity cache must be continuous =F symbol, got ${row.symbol}`,
    );
  }
});

test("India index search for pharma returns Nifty Pharma with display name", async () => {
  const rows = await getTickerDirectory("pharma", "in", "index");
  const hit = rows.find((r) => r.symbol === "^CNXPHARMA");
  assert.ok(hit, "expected Nifty Pharma index");
  assert.equal(hit.name, "Nifty Pharma");
});

test("India stock search does not inject caret indices", async () => {
  const rows = await getTickerDirectory("nifty 500", "in", "stock");
  assert.ok(!rows.some((r) => r.symbol.startsWith("^")), "indices belong on Index tab only");
});

test("India index search surfaces Nifty 500 via alias", async () => {
  const rows = await getTickerDirectory("nifty500", "in", "index");
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].symbol, "^CRSLDX");
});

test("India index typeahead seeds exclude US caret indices", async () => {
  const rows = await getTickerDirectory("", "in", "index");
  const symbols = rows.map((r) => r.symbol);
  assert.ok(symbols.includes("^CRSLDX"));
  assert.ok(symbols.some((s) => INDIA_INDEX_SYMBOLS.has(s)));
  for (const sym of symbols) {
    assert.ok(sym.startsWith("^"), `India index search must be caret symbol, got ${sym}`);
    assert.ok(!/INAV/i.test(sym), `INAV tickers must not appear in index search: ${sym}`);
  }
  for (const us of US_INDEX_SYMBOLS) {
    assert.equal(symbols.includes(us), false, `US index ${us} must not appear for India market`);
  }
});

test("US index typeahead seeds exclude India caret indices", async () => {
  const rows = await getTickerDirectory("", "us", "index");
  const symbols = rows.map((r) => r.symbol);
  assert.ok(symbols.some((s) => US_INDEX_SYMBOLS.has(s)));
  for (const ind of INDIA_INDEX_SYMBOLS) {
    assert.equal(symbols.includes(ind), false, `India index ${ind} must not appear for US market`);
  }
});

test("resolveUsIndexKeywordSeeds maps nasdaq to Nasdaq indices", () => {
  const seeds = resolveUsIndexKeywordSeeds("nasdaq");
  assert.ok(seeds.includes("^IXIC"));
  assert.ok(seeds.includes("^NDX"));
});

test("resolveUsEtfKeywordSeedQueries maps nasdaq to QQQ", () => {
  assert.deepEqual(resolveUsEtfKeywordSeedQueries("nasdaq"), ["QQQ"]);
});

test("US index search for nasdaq returns multiple Nasdaq index variants", async () => {
  const rows = await getTickerDirectory("nasdaq", "us", "index");
  assert.ok(rows.length >= 3, `expected multiple Nasdaq indices, got ${rows.length}`);
  assert.ok(rows.some((r) => r.symbol === "^IXIC"));
  assert.ok(rows.some((r) => r.symbol.startsWith("^NDX")));
});

test("US etf search for nasdaq returns Nasdaq-linked ETFs", async () => {
  const rows = await getTickerDirectory("nasdaq", "us", "etf");
  assert.ok(rows.length >= 1, `expected Nasdaq ETFs, got ${rows.length}`);
  assert.ok(rows.some((r) => r.symbol === "QQQ"));
});

test("US index search for s and p returns core S&P index family", async () => {
  const rows = await getTickerDirectory("s & p", "us", "index");
  assert.ok(rows.length >= 3, `expected core S&P indices, got ${rows.length}`);
  for (const sym of ["^GSPC", "^OEX", "^MID"]) {
    assert.ok(rows.some((r) => r.symbol === sym), `missing ${sym}`);
  }
});

test("US specialty index cache excludes India caret indices", () => {
  for (const category of ["index", "all"]) {
    const rows = getCachedSpecialtyRows("us", category);
    for (const ind of INDIA_INDEX_SYMBOLS) {
      assert.equal(
        rows.some((r) => r.symbol === ind),
        false,
        `India index ${ind} must not be in US specialty cache (${category})`,
      );
    }
  }
});
