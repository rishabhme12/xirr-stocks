import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_BENCHMARKS,
  US_INDEX_SYMBOLS,
  INDIA_INDEX_SYMBOLS,
  benchmarkEntryForMarket,
  normalizeSearchKey,
  resolveIndiaIndexAlias,
} from "../src/lib/market-benchmarks.mjs";
import { getTickerDirectory } from "../src/lib/stock-data.mjs";

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
  for (const us of US_INDEX_SYMBOLS) {
    assert.equal(symbols.includes(us), false, `US index ${us} must not appear for India market`);
  }
});
