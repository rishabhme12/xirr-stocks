import test from "node:test";
import assert from "node:assert/strict";
import {
  lastDayOfUtcMonth,
  parseDatahubDatePriceCsv,
  parseQuotedDmyPriceCsv,
} from "../src/lib/metal-monthly-files.mjs";

test("lastDayOfUtcMonth", () => {
  assert.equal(lastDayOfUtcMonth("2024-01"), "2024-01-31");
  assert.equal(lastDayOfUtcMonth("2024-02"), "2024-02-29");
});

test("parseDatahubDatePriceCsv reads Date,Price", () => {
  const text = `Date,Price
1990-01-01,401.12
1990-02-01,410.00
`;
  const rows = parseDatahubDatePriceCsv(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].month, "1990-01");
  assert.equal(rows[0].close, 401.12);
  assert.equal(rows[0].date, lastDayOfUtcMonth("1990-01"));
});

test("parseQuotedDmyPriceCsv reads Investing XAG export", () => {
  const line = `"01-03-2026","80.8103","75.1300","83.0686","69.5548","","7.56%"`;
  const rows = parseQuotedDmyPriceCsv(`"Date","Price","Open"\n${line}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].month, "2026-03");
  assert.equal(rows[0].close, 80.8103);
});
