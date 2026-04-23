import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEstimateBatchFromJsonBody,
  parseEstimatorFromJsonBody,
  parseEstimatorParams,
  MIN_SIP_START_MONTH,
} from "../src/lib/estimator-params.mjs";

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

test("parseEstimatorParams accepts benchmark without symbol", () => {
  const url = new URL(
    `http://localhost/api/estimate?benchmark=gold&monthlyAmount=1&startDate=2010-06&amountCurrency=usd`,
  );
  const p = parseEstimatorParams(url);
  assert.equal(p.kind, "benchmark");
  assert.equal(p.benchmark, "gold");
  assert.equal(p.startDate, "2010-06");
});

test("parseEstimatorParams accepts reserved symbol BM_sp500 when benchmark param missing", () => {
  const url = new URL(
    `http://localhost/api/estimate?symbol=BM_sp500&monthlyAmount=1&startDate=2010-06&amountCurrency=usd`,
  );
  const p = parseEstimatorParams(url);
  assert.equal(p.kind, "benchmark");
  assert.equal(p.benchmark, "sp500");
});

test("parseEstimatorParams accepts bm= short param", () => {
  const url = new URL(
    `http://localhost/api/estimate?bm=qqq&monthlyAmount=1&startDate=2010-06&amountCurrency=usd`,
  );
  const p = parseEstimatorParams(url);
  assert.equal(p.kind, "benchmark");
  assert.equal(p.benchmark, "qqq");
});

test("parseEstimatorParams maps legacy corrupted symbol BMSP to sp500 benchmark", () => {
  const url = new URL(
    `http://localhost/api/estimate?symbol=BMSP&monthlyAmount=1&startDate=2010-06&amountCurrency=usd`,
  );
  const p = parseEstimatorParams(url);
  assert.equal(p.kind, "benchmark");
  assert.equal(p.benchmark, "sp500");
});

test("parseEstimatorFromJsonBody sets benchmark without symbol (POST /api/estimate)", () => {
  const p = parseEstimatorFromJsonBody({
    benchmark: "sp500",
    monthlyAmount: 1,
    startDate: "1999-12",
    amountCurrency: "usd",
    stillHolding: true,
    purchaseDay: 1,
  });
  assert.equal(p.kind, "benchmark");
  assert.equal(p.benchmark, "sp500");
});

test("parseEstimatorFromJsonBody sets stock symbol", () => {
  const p = parseEstimatorFromJsonBody({
    symbol: "INTC",
    monthlyAmount: 1,
    startDate: "1999-12",
    amountCurrency: "usd",
    stillHolding: true,
    purchaseDay: 1,
  });
  assert.equal(p.kind, "stock");
  assert.equal(p.symbol, "INTC");
});

test("parseEstimateBatchFromJsonBody returns stock params plus benchmarkKeys", () => {
  const p = parseEstimateBatchFromJsonBody({
    symbol: "INTC",
    benchmarkKeys: ["sp500", "qqq", "nifty50"],
    monthlyAmount: 1,
    startDate: "1999-12",
    amountCurrency: "usd",
    stillHolding: true,
    purchaseDay: 1,
  });
  assert.equal(p.kind, "stock");
  assert.equal(p.symbol, "INTC");
  assert.deepEqual(p.benchmarkKeys, ["sp500", "qqq", "nifty50"]);
});

test("parseEstimatorParams accepts benchmark=nifty50 and BM_nifty50 symbol", () => {
  const u1 = new URL("http://localhost/api/estimate?benchmark=nifty50&monthlyAmount=1&startDate=2010-06&amountCurrency=inr&purchaseDay=1");
  assert.equal(parseEstimatorParams(u1).benchmark, "nifty50");
  const u2 = new URL(
    "http://localhost/api/estimate?symbol=BM_nifty50&monthlyAmount=1&startDate=2010-06&amountCurrency=inr&purchaseDay=1",
  );
  assert.equal(parseEstimatorParams(u2).benchmark, "nifty50");
  const u3 = new URL(
    "http://localhost/api/estimate?symbol=BMNIFTY50&monthlyAmount=1&startDate=2010-06&amountCurrency=inr&purchaseDay=1",
  );
  assert.equal(parseEstimatorParams(u3).benchmark, "nifty50");
});
