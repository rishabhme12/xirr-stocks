import test from "node:test";
import assert from "node:assert/strict";
import { getTickerDirectory } from "../src/lib/stock-data.mjs";

test("India tickers: ISIN in data; filter by name (sector optional, from NSE listing refresh)", async () => {
  const bank = await getTickerDirectory("bank", "in");
  assert.ok(bank.length >= 1, "at least one match for bank");
  assert.ok(bank.some((r) => /bank/i.test(r.name) || (r.sector && /financial/i.test(r.sector))));

  const tcs = await getTickerDirectory("TCS", "in");
  assert.ok(tcs.some((r) => r.symbol === "TCS.NS" && r.isin));
});

test("India empty query returns a bounded set of rows (no network)", async () => {
  const q = await getTickerDirectory("", "in");
  assert.ok(Array.isArray(q));
  assert.ok(q.length > 0 && q.length <= 100);
  assert.ok(q[0].symbol && q[0].name);
});

test("India directory includes NSE large caps from bundled data (no network)", async () => {
  const y = await getTickerDirectory("yes bank", "in");
  assert.ok(
    y.some((r) => r.symbol === "YESBANK.NS" && /Yes Bank/i.test(r.name)),
    "Yes Bank in bundled NSE list",
  );
  const g = await getTickerDirectory("GROWW", "in");
  assert.ok(
    g.some((r) => r.symbol === "GROWW.NS" && r.isin),
    "GROWW in bundled NSE list",
  );
  const m = await getTickerDirectory("meesho", "in");
  assert.ok(
    m.some((r) => r.symbol === "MEESHO.NS" && /Meesho/i.test(r.name)),
    "Meesho in bundled NSE list",
  );

  const bajaj = await getTickerDirectory("bajaj-auto", "in");
  assert.ok(
    bajaj.some((r) => r.symbol === "BAJAJ-AUTO.NS"),
    "NSE tickers with hyphens (e.g. BAJAJ-AUTO) must be in the list",
  );
});
