import test from "node:test";
import assert from "node:assert/strict";
import { parseEstimatorParams, MIN_SIP_START_MONTH } from "../src/lib/estimator-params.mjs";

test("parseEstimatorParams reads amountCurrency and monthlyAmount", () => {
  const url = new URL(
    `http://localhost/api/estimate?symbol=intc&monthlyAmount=50&startDate=2010-06&amountCurrency=inr&purchaseDay=1`,
  );
  const p = parseEstimatorParams(url);
  assert.equal(p.amountCurrency, "inr");
  assert.equal(p.amount, 50);
  assert.equal(p.startDate, "2010-06");
});

test("parseEstimatorParams rejects SIP start before minimum month", () => {
  const url = new URL(
    `http://localhost/api/estimate?symbol=INTC&monthlyAmount=1&startDate=1989-12&amountCurrency=usd`,
  );
  assert.throws(
    () => parseEstimatorParams(url),
    (err) => err instanceof Error && err.message.includes(MIN_SIP_START_MONTH),
  );
});
