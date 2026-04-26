import test from "node:test";
import assert from "node:assert/strict";
import {
  __testables,
  createPortfolioEstimate,
  isInrNativeQuote,
  normaliseSymbol,
} from "../src/lib/stock-data.mjs";

test("normaliseSymbol preserves Yahoo FX tickers with equals (INR=X)", () => {
  assert.equal(normaliseSymbol("inr=x"), "INR=X");
  assert.equal(normaliseSymbol("INTC"), "INTC");
  assert.equal(normaliseSymbol("FEDERALBNK.NS"), "FEDERALBNK.NS");
});

test("normaliseSymbol preserves caret for Yahoo indices (^GSPC)", () => {
  assert.equal(normaliseSymbol("^gspc"), "^GSPC");
});

test("parseYahooChart parses historical rows and current quote metadata", () => {
  const payload = {
    chart: {
      result: [
        {
          meta: {
            symbol: "TEST",
            currency: "USD",
            longName: "Test Corp",
            regularMarketPrice: 11.5,
            regularMarketTime: 1704326400,
          },
          timestamp: [1704153600, 1704240000],
          indicators: {
            quote: [
              {
                close: [10.5, 11.25],
              },
            ],
          },
        },
      ],
      error: null,
    },
  };

  const result = __testables.parseYahooChart(payload, "TEST");

  assert.equal(result.dailyPrices.length, 2);
  assert.equal(result.dailyPrices[0].date, "2024-01-02");
  assert.equal(result.dailyPrices[1].close, 11.25);
  assert.equal(result.latestPrice, 11.5);
  assert.equal(result.companyName, "Test Corp");
  assert.equal(result.quoteCurrency, "USD");
  assert.equal(result.yahooSymbol, "TEST");
});

test("isInrNativeQuote true for INR meta or .NS", () => {
  assert.equal(isInrNativeQuote("INR", "FOO"), true);
  assert.equal(isInrNativeQuote("USD", "FEDERALBNK.NS"), true);
  assert.equal(isInrNativeQuote(null, "X.BO"), true);
  assert.equal(isInrNativeQuote("USD", "AAPL"), false);
});

test("createPortfolioEstimate INR native mode: rupee SIP on INR close (no FX)", () => {
  const prices = [
    { date: "2024-01-02", close: 100 },
    { date: "2024-02-01", close: 110 },
    { date: "2024-03-01", close: 120 },
  ];
  const r = createPortfolioEstimate({
    dailyPrices: prices,
    monthlyInr: 1000,
    inrNative: true,
    purchaseDay: 1,
    startDate: "2024-01",
    symbol: "TEST.NS",
    companyName: "Test",
    latestPrice: 120,
    latestPriceDate: "2024-03-01",
    priceQuote: "INR",
  });
  assert.equal(r.currency, "INR");
  assert.equal(r.inrNative, true);
  assert.equal(r.priceQuote, "INR");
  assert.equal(r.latestPriceUsd, null);
  assert.equal(r.contributions.length, 3);
  assert.equal(r.contributions[0].invested, 1000);
  assert.ok(r.xirr !== null);
});

test("createPortfolioEstimate USD SIP into INR-index path: $ → INR each month, terminal value in USD", () => {
  const fx = [
    { date: "2024-01-02", close: 100 },
    { date: "2024-02-01", close: 100 },
    { date: "2024-02-29", close: 100 },
  ];
  const prices = [
    { date: "2024-01-02", close: 100 },
    { date: "2024-02-01", close: 200 },
    { date: "2024-02-29", close: 200 },
  ];
  const r = createPortfolioEstimate({
    dailyPrices: prices,
    monthlyAmount: 1,
    usdSipInrPriced: true,
    fxDailyPrices: fx,
    startDate: "2024-01",
    purchaseDay: 1,
    symbol: "NIFTY",
    companyName: "N",
    stillHolding: true,
  });
  assert.equal(r.currency, "USD");
  assert.equal(r.usdSipInrPriced, true);
  assert.equal(r.priceQuote, "INR");
  assert.equal(r.contributions.length, 2);
  assert.equal(r.contributions[0].invested, 1);
  assert.equal(r.contributions[1].invested, 1);
  // 1*100/100=1 and 1*100/200=0.5 shares, value 1.5*200=300 INR, /100=3 USD, invested 2
  assert.equal(r.totalInvested, 2);
  assert.ok(r.portfolioValue > 2.99);
  assert.ok(r.xirr !== null);
});

test("choosePurchasePrice prefers first trading day on or after desired day", () => {
  const rows = [
    { date: "2024-01-02", close: 10 },
    { date: "2024-01-08", close: 12 },
    { date: "2024-01-31", close: 15 },
  ];

  assert.equal(__testables.choosePurchasePrice(rows, 5).date, "2024-01-08");
  assert.equal(__testables.choosePurchasePrice(rows, 28).date, "2024-01-31");
});

test("findValuationRow returns the last trading day in the requested month", () => {
  const rows = [
    { date: "2024-01-02", close: 10 },
    { date: "2024-02-01", close: 20 },
    { date: "2024-02-29", close: 21 },
    { date: "2024-03-01", close: 30 },
  ];

  assert.equal(__testables.findValuationRow(rows, "2024-02")?.date, "2024-02-29");
  assert.equal(__testables.findValuationRow(rows, "2024-04"), null);
});

test("createPortfolioEstimate computes invested amount, value, and rates", () => {
  const prices = [
    { date: "2024-01-02", close: 10 },
    { date: "2024-01-08", close: 12 },
    { date: "2024-02-01", close: 20 },
    { date: "2024-02-06", close: 25 },
    { date: "2024-03-01", close: 30 },
    { date: "2024-03-05", close: 40 },
  ];

  const result = createPortfolioEstimate({
    dailyPrices: prices,
    monthlyAmount: 100,
    purchaseDay: 5,
    startDate: "2024-01",
    symbol: "TEST",
    companyName: "Test Corp",
    latestPrice: 40,
    latestPriceDate: "2024-03-05",
  });

  assert.equal(result.totalInvested, 300);
  assert.equal(result.latestPrice, 40);
  assert.equal(result.latestPriceDate, "2024-03-05");
  assert.equal(result.portfolioValue, 593.33);
  assert.ok(result.xirr !== null);
  assert.equal(result.investedMultiple, 1.9778);
  assert.equal(result.contributions.length, 3);
  assert.equal(result.contributions[0].purchaseDate, "2024-01-08");
  assert.equal(result.contributions[1].purchaseDate, "2024-02-06");
  assert.equal(result.contributions[2].purchaseDate, "2024-03-05");
  assert.equal(result.dataRange.effectiveStartMonth, "2024-01");
  assert.equal(result.dataRange.effectiveEndMonth, "2024-03");
  assert.equal(result.dataRange.adjustedForListing, false);
  assert.equal(result.currency, "USD");
});

test("createPortfolioEstimate INR mode uses monthly rupee SIP and FX for USD notionals", () => {
  const prices = [
    { date: "2024-01-02", close: 10 },
    { date: "2024-01-08", close: 12 },
    { date: "2024-02-01", close: 20 },
    { date: "2024-02-06", close: 25 },
    { date: "2024-03-01", close: 30 },
    { date: "2024-03-05", close: 40 },
  ];
  const fx = [
    { date: "2024-01-02", close: 83 },
    { date: "2024-01-08", close: 83 },
    { date: "2024-02-01", close: 83 },
    { date: "2024-02-06", close: 83 },
    { date: "2024-03-01", close: 83 },
    { date: "2024-03-05", close: 83 },
  ];
  const result = createPortfolioEstimate({
    dailyPrices: prices,
    monthlyInr: 83,
    fxDailyPrices: fx,
    purchaseDay: 5,
    startDate: "2024-01",
    symbol: "TEST",
    companyName: "Test Corp",
    latestPrice: 40,
    latestPriceDate: "2024-03-05",
  });

  assert.equal(result.currency, "INR");
  assert.equal(result.totalInvested, 249);
  assert.equal(result.latestPriceUsd, 40);
  assert.ok(result.latestPriceInr != null);
  assert.ok(result.xirr !== null);
});

test("createPortfolioEstimate stops SIP contributions at the optional end month", () => {
  const result = createPortfolioEstimate({
    dailyPrices: [
      { date: "2024-01-02", close: 10 },
      { date: "2024-02-01", close: 20 },
      { date: "2024-03-01", close: 30 },
      { date: "2024-04-01", close: 40 },
    ],
    monthlyAmount: 100,
    purchaseDay: 1,
    startDate: "2024-01",
    endDate: "2024-02",
    symbol: "TEST",
    companyName: "Test Corp",
    latestPrice: 40,
    latestPriceDate: "2024-04-01",
  });

  assert.equal(result.totalInvested, 200);
  assert.equal(result.contributions.length, 2);
  assert.equal(result.dataRange.requestedEndDate, "2024-02");
  assert.equal(result.dataRange.effectiveEndMonth, "2024-02");
  assert.equal(result.portfolioValue, 600);
  assert.equal(result.dataRange.stillHolding, true);
});

test("createPortfolioEstimate can value the portfolio at the SIP end month when no longer holding", () => {
  const result = createPortfolioEstimate({
    dailyPrices: [
      { date: "2024-01-02", close: 10 },
      { date: "2024-02-01", close: 20 },
      { date: "2024-02-29", close: 25 },
      { date: "2024-03-01", close: 30 },
      { date: "2024-04-01", close: 40 },
    ],
    monthlyAmount: 100,
    purchaseDay: 1,
    startDate: "2024-01",
    endDate: "2024-02",
    stillHolding: false,
    symbol: "TEST",
    companyName: "Test Corp",
    latestPrice: 40,
    latestPriceDate: "2024-04-01",
  });

  assert.equal(result.totalInvested, 200);
  assert.equal(result.latestPrice, 25);
  assert.equal(result.latestPriceDate, "2024-02-29");
  assert.equal(result.portfolioValue, 375);
  assert.equal(result.dataRange.effectiveEndMonth, "2024-02");
  assert.equal(result.dataRange.stillHolding, false);
});

test("xirr returns null when the rate is not bracketed", () => {
  const result = __testables.xirr([
    { amount: -100, date: new Date("2024-01-01T00:00:00.000Z") },
    { amount: 90, date: new Date("2024-01-02T00:00:00.000Z") },
  ]);

  assert.equal(result, null);
});

test("pre-listing start dates are adjusted to the first tradable month", () => {
  const result = createPortfolioEstimate({
    dailyPrices: [
      { date: "2020-12-09", close: 100 },
      { date: "2021-01-04", close: 120 },
      { date: "2021-02-01", close: 140 },
    ],
    monthlyAmount: 10,
    purchaseDay: 1,
    startDate: "1992-01",
    symbol: "TEST",
    companyName: "Test Corp",
    latestPrice: 140,
    latestPriceDate: "2021-02-01",
  });

  assert.equal(result.totalInvested, 30);
  assert.equal(result.dataRange.requestedStartDate, "1992-01");
  assert.equal(result.dataRange.requestedEndDate, null);
  assert.equal(result.dataRange.effectiveStartMonth, "2020-12");
  assert.equal(result.dataRange.effectiveEndMonth, "2021-02");
  assert.equal(result.dataRange.stillHolding, true);
  assert.equal(result.dataRange.adjustedForListing, true);
  assert.equal(result.contributions[0].purchaseDate, "2020-12-09");
});

test("createPortfolioEstimate rejects an end date before the start date", () => {
  assert.throws(
    () =>
      createPortfolioEstimate({
        dailyPrices: [{ date: "2024-01-02", close: 10 }],
        monthlyAmount: 100,
        purchaseDay: 1,
        startDate: "2024-02",
        endDate: "2024-01",
        symbol: "TEST",
        companyName: "Test Corp",
        latestPrice: 10,
        latestPriceDate: "2024-01-02",
      }),
    /End date cannot be before the start date\./,
  );
});

test("xirr is approximately 100 percent for a one-year doubling", () => {
  const cashFlows = [
    { amount: -100, date: new Date("2023-01-01T00:00:00.000Z") },
    { amount: 200, date: new Date("2024-01-01T00:00:00.000Z") },
  ];
  const result = __testables.xirr(cashFlows);

  assert.ok(result !== null);
  assert.ok(Math.abs(__testables.xnpv(result, cashFlows)) < 0.000001);
});
