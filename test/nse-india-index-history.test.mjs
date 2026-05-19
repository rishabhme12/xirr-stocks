import test from "node:test";
import assert from "node:assert/strict";
import {
  __testables,
  resolveNseIndexType,
} from "../src/lib/nse-india-index-history.mjs";

const SAMPLE_INDICES = [
  { index: "NIFTY 50", indexSymbol: "NIFTY 50" },
  { index: "NIFTY SMALLCAP 100", indexSymbol: "NIFTY SMLCAP 100" },
  { index: "NIFTY FINANCIAL SERVICES 25/50", indexSymbol: "NIFTY FINSRV25 50" },
  { index: "NIFTY MIDCAP 50", indexSymbol: "NIFTY MIDCAP 50" },
];

test("parseNseEodDate converts DD-MMM-YYYY to ISO", () => {
  assert.equal(__testables.parseNseEodDate("15-JAN-2024"), "2024-01-15");
  assert.equal(__testables.parseNseEodDate("01-APR-2016"), "2016-04-01");
});

test("resolveNseIndexType maps Yahoo smallcap label to NSE index name", () => {
  assert.equal(resolveNseIndexType("NIFTY SMLCAP 100", SAMPLE_INDICES), "NIFTY SMALLCAP 100");
  assert.equal(
    resolveNseIndexType("NIFTY FINSRV25 50", SAMPLE_INDICES),
    "NIFTY FINANCIAL SERVICES 25/50",
  );
  assert.equal(resolveNseIndexType("Nifty Midcap 50", SAMPLE_INDICES), "NIFTY MIDCAP 50");
});

test("nseRowsToDailyPrices dedupes and sorts by date", () => {
  const rows = __testables.nseRowsToDailyPrices([
    { EOD_TIMESTAMP: "02-JAN-2024", EOD_CLOSE_INDEX_VAL: 100 },
    { EOD_TIMESTAMP: "01-JAN-2024", EOD_CLOSE_INDEX_VAL: 99 },
    { EOD_TIMESTAMP: "01-JAN-2024", EOD_CLOSE_INDEX_VAL: 98 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2024-01-01");
  assert.equal(rows[1].close, 100);
});
