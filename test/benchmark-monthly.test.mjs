import test from "node:test";
import assert from "node:assert/strict";
import { dailyPricesToMonthlyRows, monthlyRowsToDailyPrices } from "../src/lib/benchmark-monthly.mjs";

test("dailyPricesToMonthlyRows keeps last close per calendar month", () => {
  const daily = [
    { date: "2024-01-02", close: 10 },
    { date: "2024-01-30", close: 12 },
    { date: "2024-02-01", close: 20 },
  ];
  const m = dailyPricesToMonthlyRows(daily);
  assert.equal(m.length, 2);
  assert.equal(m[0].month, "2024-01");
  assert.equal(m[0].close, 12);
  assert.equal(m[0].date, "2024-01-30");
  assert.equal(m[1].month, "2024-02");
});

test("monthlyRowsToDailyPrices maps to estimator daily shape", () => {
  const daily = monthlyRowsToDailyPrices([
    { month: "2024-01", date: "2024-01-31", close: 100 },
  ]);
  assert.equal(daily.length, 1);
  assert.equal(daily[0].date, "2024-01-31");
  assert.equal(daily[0].close, 100);
});
