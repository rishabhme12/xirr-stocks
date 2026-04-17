import test from "node:test";
import assert from "node:assert/strict";
import {
  filterExinusRowsForPreYahooGap,
  parseExinusMonthlyCsv,
} from "../src/lib/exinus-monthly-csv.mjs";

test("parseExinusMonthlyCsv reads observation_date,EXINUS CSV", () => {
  const csv = `observation_date,EXINUS
1990-01-01,16.9633
1990-02-01,16.9895
`;
  const rows = parseExinusMonthlyCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "1990-01-01");
  assert.equal(rows[0].close, 16.9633);
});

test("filterExinusRowsForPreYahooGap trims to months before Yahoo FX start", () => {
  const rows = [
    { date: "2003-10-01", close: 46 },
    { date: "2003-11-01", close: 45.5 },
    { date: "2003-12-01", close: 45.57 },
  ];
  const gap = filterExinusRowsForPreYahooGap(rows, "2003-10", "2003-12-01");
  assert.equal(gap.length, 2);
  assert.equal(gap[gap.length - 1].date, "2003-11-01");
});
