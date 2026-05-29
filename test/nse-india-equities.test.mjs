import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNseEquityLine,
  extractIndiaEtfRowsFromEquities,
} from "../src/lib/nse-india-equities.mjs";

test("parseNseEquityLine parses standard row", () => {
  const row = parseNseEquityLine(
    "RELIANCE,Reliance Industries Limited,EQ,10-DEC-2024,10,1,INE002A01018,10",
  );
  assert.equal(row?.symbol, "RELIANCE");
  assert.equal(row?.isin, "INE002A01018");
});

test("parseNseEquityLine accepts hyphens and ampersands in symbol", () => {
  const row = parseNseEquityLine(
    "BAJAJ-AUTO,Bajaj Auto Limited,EQ,10-DEC-2024,10,1,INE917I01010,10",
  );
  assert.equal(row?.symbol, "BAJAJ-AUTO");
});

test("extractIndiaEtfRowsFromEquities finds BEES and ETF names", () => {
  const rows = [
    { symbol: "TCS.NS", name: "Tata Consultancy Services Limited", exchange: "NSE", category: "stock" },
    { symbol: "NIFTYBEES.NS", name: "Nippon India ETF Nifty BeES", exchange: "NSE", category: "stock" },
  ];
  const etfs = extractIndiaEtfRowsFromEquities(rows);
  assert.equal(etfs.length, 1);
  assert.equal(etfs[0].symbol, "NIFTYBEES.NS");
  assert.equal(etfs[0].category, "etf");
});
