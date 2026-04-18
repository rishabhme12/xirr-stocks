import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeInrPerUsdDaily,
  resolveInrPerUsdForValuationDate,
  dayBeforeIsoDate,
} from "../src/lib/fx-history.mjs";

test("mergeInrPerUsdDaily prefers Yahoo on duplicate dates", () => {
  const fred = [
    { date: "2003-11-28", close: 46.0 },
    { date: "2003-12-01", close: 45.5 },
  ];
  const yahoo = [
    { date: "2003-12-01", close: 45.57 },
    { date: "2003-12-02", close: 45.6 },
  ];
  const merged = mergeInrPerUsdDaily(fred, yahoo);
  const dec1 = merged.find((r) => r.date === "2003-12-01");
  assert.equal(dec1.close, 45.57);
});

test("resolveInrPerUsdForValuationDate uses exact date when present", () => {
  const rows = [
    { date: "2024-03-01", close: 83.0 },
    { date: "2024-03-15", close: 83.2 },
  ];
  assert.equal(resolveInrPerUsdForValuationDate(rows, "2024-03-15"), 83.2);
});

test("dayBeforeIsoDate steps back one calendar day", () => {
  assert.equal(dayBeforeIsoDate("2003-12-01"), "2003-11-30");
});
