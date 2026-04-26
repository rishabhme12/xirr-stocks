import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveInrPerUsdForDate,
  resolveInrPerUsdForValuationDate,
} from "./fx-history.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDIA_TICKERS_PATH = path.join(__dirname, "../../data/india-tickers.json");

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CNBC_QUOTE_URL = "https://quote.cnbc.com/quote-html-webservice/quote.htm?requestMethod=itv&realtime=1&output=json&symbols=";
/** SEC asks for a descriptive User-Agent with contact; override in production. */
const SEC_USER_AGENT = (
  process.env.SEC_USER_AGENT || "xirr-stocks/1.0 (set SEC_USER_AGENT for production)"
).trim();
const YAHOO_USER_AGENT = (process.env.YAHOO_USER_AGENT || "Mozilla/5.0 xirr-stocks/1.0").trim();
/** Health probe / docs: full-range-style lower bound (server `probeYahooFinanceReachable`). */
export const YAHOO_CHART_PERIOD1_EARLIEST = Math.floor(Date.UTC(1990, 0, 1) / 1000);
const CACHE_MS = 12 * 60 * 60 * 1000;
/** Max typeahead / directory rows (India uses bundled NSE data; US from SEC). */
const TICKER_DIRECTORY_MAX = 100;

let tickerCache = { loadedAt: 0, data: [] };
let indiaTickerCache = { loadedAt: 0, data: [] };
const stockCache = new Map();

function assertOk(response, sourceName) {
  if (!response.ok) {
    throw new Error(`${sourceName} request failed with status ${response.status}.`);
  }
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function startOfMonth(dateText) {
  return new Date(`${dateText}-01T00:00:00.000Z`);
}

function addMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function diffInYears(startDate, endDate) {
  const milliseconds = endDate.getTime() - startDate.getTime();
  return milliseconds / (365.2425 * 24 * 60 * 60 * 1000);
}

function roundCurrency(value) {
  return Number(value.toFixed(2));
}

function roundNumber(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function maxDateText(left, right) {
  return left >= right ? left : right;
}

function fromUnixTimestamp(seconds) {
  return new Date(seconds * 1000);
}

function findValuationRow(dailyPrices, valuationMonth) {
  for (let index = dailyPrices.length - 1; index >= 0; index -= 1) {
    const row = dailyPrices[index];
    if (row.date.slice(0, 7) === valuationMonth) {
      return row;
    }
  }

  return null;
}

export function parseYahooChart(payload, symbol) {
  const result = payload?.chart?.result?.[0];
  const error = payload?.chart?.error;

  if (error) {
    throw new Error(error.description || `Historical price data is unavailable for ${symbol}.`);
  }

  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  const closes = quote?.close || [];
  const meta = result?.meta || {};

  const dailyPrices = timestamps
    .map((timestamp, index) => {
      const close = closes[index];
      if (!Number.isFinite(close)) {
        return null;
      }

      return {
        date: isoDate(fromUnixTimestamp(timestamp)),
        close: Number(close),
      };
    })
    .filter(Boolean);

  if (dailyPrices.length === 0) {
    throw new Error(`No usable historical rows found for ${symbol}.`);
  }

  const quoteCurrencyRaw = meta.currency;
  const quoteCurrency =
    typeof quoteCurrencyRaw === "string" && quoteCurrencyRaw.length > 0
      ? quoteCurrencyRaw.toUpperCase()
      : null;

  const symUpper = String(meta.symbol || symbol).toUpperCase();
  return {
    symbol: symUpper,
    yahooSymbol: symUpper,
    quoteCurrency,
    companyName: meta.longName || meta.shortName || symbol,
    latestPrice: Number.isFinite(meta.regularMarketPrice)
      ? Number(meta.regularMarketPrice)
      : dailyPrices[dailyPrices.length - 1].close,
    latestPriceDate: meta.regularMarketTime
      ? isoDate(fromUnixTimestamp(meta.regularMarketTime))
      : dailyPrices[dailyPrices.length - 1].date,
    marketCap: Number.isFinite(meta.marketCap) ? Number(meta.marketCap) : null,
    dailyPrices,
  };
}

export function choosePurchasePrice(monthlyRows, desiredDay) {
  const atOrAfter = monthlyRows.find((row) => {
    const day = Number(row.date.slice(8, 10));
    return day >= desiredDay;
  });

  return atOrAfter || monthlyRows[monthlyRows.length - 1];
}

function xnpv(rate, cashFlows) {
  const firstDate = cashFlows[0].date;
  return cashFlows.reduce((sum, cashFlow) => {
    const years = diffInYears(firstDate, cashFlow.date);
    return sum + cashFlow.amount / ((1 + rate) ** years);
  }, 0);
}

function xirr(cashFlows) {
  let low = -0.9999;
  let high = 10;
  let lowValue = xnpv(low, cashFlows);
  let highValue = xnpv(high, cashFlows);

  for (let iteration = 0; iteration < 50 && lowValue * highValue > 0; iteration += 1) {
    high *= 2;
    highValue = xnpv(high, cashFlows);
  }

  if (lowValue * highValue > 0) {
    return null;
  }

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    const midValue = xnpv(mid, cashFlows);

    if (Math.abs(midValue) < 1e-7) {
      return mid;
    }

    if (lowValue * midValue <= 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }

  return (low + high) / 2;
}

export function normaliseSymbol(symbol) {
  /** Keep `=` (forex, e.g. INR=X), `^` (indices), digits (NIFTY50, FEDERALBNK.NS), and `&` (M&M.NS). */
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.=&^-]/g, "");
}

/**
 * True when the Yahoo series is in INR (NSE/BSE listings, Nifty index points) so SIP should
 * be sized as monthlyInr/close with no USD/INR conversion.
 */
export function isInrNativeQuote(quoteCurrency, symbol) {
  if (String(quoteCurrency || "").toUpperCase() === "INR") {
    return true;
  }
  const s = String(symbol || "").toUpperCase();
  return /\.(NS|BO)$/.test(s);
}

async function loadUsTickerRows() {
  const now = Date.now();
  if (tickerCache.data.length > 0 && now - tickerCache.loadedAt < CACHE_MS) {
    return tickerCache.data;
  }

  const response = await fetch(SEC_TICKERS_URL, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json",
    },
  });
  assertOk(response, "SEC ticker directory");

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const header = Array.isArray(payload?.fields) ? payload.fields : [];
  const tickerIndex = header.indexOf("ticker");
  const nameIndex = header.indexOf("name");
  const exchangeIndex = header.indexOf("exchange");

  const tickers = rows
    .map((row) => ({
      symbol: String(row[tickerIndex] || "").toUpperCase(),
      name: String(row[nameIndex] || ""),
      exchange: String(row[exchangeIndex] || ""),
    }))
    .filter((row) => row.symbol && row.name && /NASDAQ|NYSE|AMEX|ARCA/i.test(row.exchange));

  tickerCache = { loadedAt: now, data: tickers };
  return tickers;
}

async function loadIndiaTickerRows() {
  const now = Date.now();
  if (indiaTickerCache.data.length > 0 && now - indiaTickerCache.loadedAt < CACHE_MS) {
    return indiaTickerCache.data;
  }
  const text = await readFile(INDIA_TICKERS_PATH, "utf8");
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error("india-tickers.json must be a JSON array.");
  }
  for (const row of data) {
    if (!row || typeof row.symbol !== "string" || typeof row.name !== "string" || !row.exchange) {
      throw new Error("Each India ticker must have symbol, name, and exchange.");
    }
  }
  indiaTickerCache = { loadedAt: now, data };
  return data;
}

/**
 * Ticker typeahead. `market` = "us" (SEC only), "in" (bundled NSE/BSE Yahoo symbols), "all" (merge).
 * @param {string} [query=""]
 * @param {"us" | "in" | "all"} [market="us"]
 */
export async function getTickerDirectory(query = "", market = "us") {
  const m = String(market || "us").toLowerCase();
  if (m === "in") {
    return filterTickers(await loadIndiaTickerRows(), query);
  }
  if (m === "all") {
    const [us, ind] = await Promise.all([loadUsTickerRows(), loadIndiaTickerRows()]);
    const a = filterTickers(ind, query);
    const b = filterTickers(us, query);
    const seen = new Set();
    const out = [];
    for (const t of a) {
      if (!seen.has(t.symbol)) {
        seen.add(t.symbol);
        out.push(t);
      }
    }
    for (const t of b) {
      if (!seen.has(t.symbol)) {
        seen.add(t.symbol);
        out.push(t);
      }
    }
    return out.slice(0, TICKER_DIRECTORY_MAX);
  }
  return filterTickers(await loadUsTickerRows(), query);
}

function filterTickers(tickers, query) {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed) {
    return tickers.slice(0, TICKER_DIRECTORY_MAX);
  }

  return tickers
    .filter((ticker) => {
      if (ticker.symbol.includes(trimmed) || ticker.name.toUpperCase().includes(trimmed)) {
        return true;
      }
      if (ticker.sector && String(ticker.sector).toUpperCase().includes(trimmed)) {
        return true;
      }
      if (ticker.isin && String(ticker.isin).toUpperCase().includes(trimmed)) {
        return true;
      }
      return false;
    })
    .slice(0, TICKER_DIRECTORY_MAX);
}

async function fetchCnbcQuote(yahooSymbol) {
  let cnbcSymbol = yahooSymbol;
  if (yahooSymbol.endsWith(".NS") || yahooSymbol.endsWith(".BO")) {
    return null; // CNBC Market Cap for Indian stocks is heavily skewed by incorrect shares-outstanding data
  } else if (yahooSymbol === "^GSPC") {
    cnbcSymbol = ".SPX";
  } else if (yahooSymbol === "^NSEI") {
    return null; // Indices don't have market cap
  } else if (yahooSymbol === "^CRSLDX") {
    return null;
  }


  try {
    const url = `${CNBC_QUOTE_URL}${encodeURIComponent(cnbcSymbol)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": YAHOO_USER_AGENT },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const quote = payload.ITVQuoteResult?.ITVQuote?.[0];
    if (!quote || quote.code !== "0") return null;

    const mktcapRaw = quote.mktcapView;
    if (!mktcapRaw) return null;

    const multiplier = mktcapRaw.endsWith("T") ? 1e12 : mktcapRaw.endsWith("B") ? 1e9 : mktcapRaw.endsWith("M") ? 1e6 : 1;
    const numericPart = parseFloat(mktcapRaw.replace(/[TB M,]/g, ""));
    return Number.isFinite(numericPart) ? numericPart * multiplier : null;
  } catch (err) {
    return null;
  }
}

export async function getStockHistory(symbol) {
  const normalised = normaliseSymbol(symbol);
  const cached = stockCache.get(normalised);
  const now = Date.now();

  if (cached && now - cached.loadedAt < CACHE_MS) {
    return cached.value;
  }

  /** Same as working `indian` branch: plain fetch, no process-wide throttle (that added 10s+ delays). */
  const startPeriod = 0;
  const endPeriod = Math.floor(Date.now() / 1000) + 86400;
  const url = `${YAHOO_CHART_URL}${encodeURIComponent(
    normalised,
  )}?period1=${startPeriod}&period2=${endPeriod}&interval=1d&includeAdjustedClose=false&events=split`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": YAHOO_USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const base = `Historical price request failed with status ${response.status}`;
    if (response.status === 404) {
      throw new Error(
        `${base}. Yahoo Finance has no chart data for "${normalised}" (wrong symbol, delisted, or bad exchange). This is unrelated to any EXINUS CSV in your data folder.`,
      );
    }
    if (response.status === 429) {
      throw new Error(
        `${base}. Yahoo Finance is rate-limiting requests from this network. Wait 2–5 minutes and try again, or run the app from another network/VPN.`,
      );
    }
    throw new Error(`${base}.`);
  }

  const payload = await response.json();
  const value = parseYahooChart(payload, normalised);

  /** Try to fetch market cap from CNBC if Yahoo missed it. */
  if (value.marketCap === null) {
    const cnbcMarketCap = await fetchCnbcQuote(normalised);
    if (cnbcMarketCap !== null) {
      value.marketCap = cnbcMarketCap;
    }
  }

  stockCache.set(normalised, { loadedAt: now, value });
  return value;
}

export function createPortfolioEstimate({
  dailyPrices,
  monthlyAmount,
  monthlyInr = null,
  fxDailyPrices = null,
  inrNative = false,
  /** USD-denominated SIP into an INR-quoted series (NIFTY, NSE): convert each $ with USD/INR, buy in INR, value in $ at the end. */
  usdSipInrPriced = false,
  startDate,
  endDate = null,
  stillHolding = true,
  purchaseDay = 1,
  symbol,
  companyName,
  latestPrice = null,
  latestPriceDate = null,
  priceQuote = "USD",
  marketCap = null,
}) {
  if (!dailyPrices.length) {
    throw new Error("Daily price history is required.");
  }

  const inrNativeMode =
    inrNative === true &&
    monthlyInr != null &&
    Number.isFinite(monthlyInr) &&
    monthlyInr > 0;

  const inrWithFxMode =
    inrNativeMode === false &&
    monthlyInr != null &&
    Number.isFinite(monthlyInr) &&
    monthlyInr > 0 &&
    Array.isArray(fxDailyPrices) &&
    fxDailyPrices.length > 0;

  const usdSipInrPricedMode =
    inrNativeMode === false &&
    inrWithFxMode === false &&
    usdSipInrPriced === true &&
    Array.isArray(fxDailyPrices) &&
    fxDailyPrices.length > 0 &&
    Number.isFinite(monthlyAmount) &&
    monthlyAmount > 0;

  if (!inrNativeMode && !inrWithFxMode && !usdSipInrPricedMode) {
    if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
      throw new Error("Monthly investment amount must be greater than zero.");
    }
  }

  const investmentStart = startOfMonth(startDate);
  const firstAvailable = new Date(`${dailyPrices[0].date}T00:00:00.000Z`);
  const firstAvailableMonth = dailyPrices[0].date.slice(0, 7);
  const requestedEnd = endDate ? startOfMonth(endDate) : null;
  const latestValuationDateText = latestPriceDate || dailyPrices[dailyPrices.length - 1].date;
  const latestValuationDate = new Date(`${latestValuationDateText}T00:00:00.000Z`);
  const contributionEnd =
    requestedEnd && requestedEnd < latestValuationDate
      ? requestedEnd
      : startOfMonth(latestValuationDateText.slice(0, 7));

  if (requestedEnd && requestedEnd < investmentStart) {
    throw new Error("End date cannot be before the start date.");
  }

  if (investmentStart > latestValuationDate) {
    throw new Error("Start date cannot be after the latest available market date.");
  }

  const byMonth = new Map();
  for (const row of dailyPrices) {
    const date = new Date(`${row.date}T00:00:00.000Z`);
    const key = monthKey(date);
    if (!byMonth.has(key)) {
      byMonth.set(key, []);
    }
    byMonth.get(key).push(row);
  }

  const contributions = [];
  let cursor = startOfMonth(startDate);
  while (cursor <= contributionEnd) {
    const key = monthKey(cursor);
    const rows = byMonth.get(key);

    if (rows?.length) {
      const purchase = choosePurchasePrice(rows, purchaseDay);
      if (inrNativeMode) {
        const shares = monthlyInr / purchase.close;
        contributions.push({
          month: key,
          purchaseDate: purchase.date,
          purchasePrice: roundNumber(purchase.close, 4),
          invested: roundCurrency(monthlyInr),
          sharesPurchased: roundNumber(shares, 8),
        });
      } else if (inrWithFxMode) {
        const inrPerUsd = resolveInrPerUsdForDate(fxDailyPrices, purchase.date, purchaseDay);
        if (inrPerUsd === null || !(inrPerUsd > 0)) {
          throw new Error(`No USD/INR exchange rate for purchase date ${purchase.date}.`);
        }
        const usdForMonth = monthlyInr / inrPerUsd;
        const shares = usdForMonth / purchase.close;
        contributions.push({
          month: key,
          purchaseDate: purchase.date,
          purchasePrice: roundNumber(purchase.close, 4),
          invested: roundCurrency(usdForMonth),
          sharesPurchased: roundNumber(shares, 8),
          inrPerUsd: roundNumber(inrPerUsd, 4),
        });
      } else if (usdSipInrPricedMode) {
        const inrPerUsd = resolveInrPerUsdForDate(fxDailyPrices, purchase.date, purchaseDay);
        if (inrPerUsd === null || !(inrPerUsd > 0)) {
          throw new Error(`No USD/INR exchange rate for purchase date ${purchase.date}.`);
        }
        const inrForMonth = monthlyAmount * inrPerUsd;
        const shares = inrForMonth / purchase.close;
        contributions.push({
          month: key,
          purchaseDate: purchase.date,
          purchasePrice: roundNumber(purchase.close, 4),
          invested: roundCurrency(monthlyAmount),
          sharesPurchased: roundNumber(shares, 8),
          inrPerUsd: roundNumber(inrPerUsd, 4),
        });
      } else {
        const usdForMonth = monthlyAmount;
        const shares = usdForMonth / purchase.close;
        contributions.push({
          month: key,
          purchaseDate: purchase.date,
          purchasePrice: roundNumber(purchase.close, 4),
          invested: roundCurrency(usdForMonth),
          sharesPurchased: roundNumber(shares, 8),
        });
      }
    }

    cursor = addMonths(cursor, 1);
  }

  if (contributions.length === 0) {
    throw new Error(
      `No price history is available from ${startDate}. Earliest available date is ${dailyPrices[0].date}.`,
    );
  }

  const totalInvestedUsd = contributions.reduce((sum, item) => sum + item.invested, 0);
  const totalShares = contributions.reduce((sum, item) => sum + item.sharesPurchased, 0);
  const effectiveEndMonth = contributions[contributions.length - 1]?.month ?? null;
  const valuationRow =
    !stillHolding && effectiveEndMonth ? findValuationRow(dailyPrices, effectiveEndMonth) : null;

  if (!stillHolding && !valuationRow) {
    throw new Error(`No valuation price is available for the selected end month ${effectiveEndMonth}.`);
  }

  const valuationDateText = valuationRow?.date ?? latestValuationDateText;
  const valuationDate = new Date(`${valuationDateText}T00:00:00.000Z`);
  const valuationPrice = valuationRow?.close ?? latestPrice ?? dailyPrices[dailyPrices.length - 1].close;
  const portfolioValueUsd = totalShares * valuationPrice;

  const effectiveStartMonth = maxDateText(startDate, firstAvailableMonth);
  const adjustedForListing = startDate < firstAvailableMonth;

  const dataRange = {
    firstAvailableDate: dailyPrices[0].date,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    effectiveStartMonth,
    effectiveEndMonth,
    firstContributionDate: contributions[0].purchaseDate,
    valuationDate: valuationDateText,
    stillHolding,
    earliestMarketDate: isoDate(firstAvailable),
    adjustedForListing,
  };

  const initialPrice = contributions[0].purchasePrice;
  const finalPrice = valuationPrice;
  const years = diffInYears(new Date(`${contributions[0].purchaseDate}T00:00:00.000Z`), valuationDate);
  const priceCagr = years > 0 ? (finalPrice / initialPrice) ** (1 / years) - 1 : null;

  const initialMarketCap = marketCap && latestPrice ? marketCap * (initialPrice / latestPrice) : null;
  const finalMarketCap = marketCap && latestPrice ? marketCap * (finalPrice / latestPrice) : null;

  if (inrNativeMode) {
    const totalInvestedInr = contributions.length * monthlyInr;
    const portfolioValueInr = totalShares * valuationPrice;
    const gainInr = portfolioValueInr - totalInvestedInr;
    const latestPriceInr = valuationPrice;
    const cashFlowsInr = contributions.map((item) => ({
      amount: -monthlyInr,
      date: new Date(`${item.purchaseDate}T00:00:00.000Z`),
    }));
    cashFlowsInr.push({ amount: portfolioValueInr, date: valuationDate });
    const annualXirrInr = xirr(cashFlowsInr);
    const pq = priceQuote || "INR";
    return {
      currency: "INR",
      priceQuote: pq,
      inrNative: true,
      symbol,
      companyName,
      totalInvested: roundCurrency(totalInvestedInr),
      totalShares: roundNumber(totalShares, 8),
      latestPrice: roundCurrency(latestPriceInr),
      latestPriceInr: roundCurrency(latestPriceInr),
      latestPriceUsd: null,
      latestPriceDate: valuationDateText,
      portfolioValue: roundCurrency(portfolioValueInr),
      gain: roundCurrency(gainInr),
      gainPercent: totalInvestedInr > 0 ? roundNumber(gainInr / totalInvestedInr, 6) : null,
      xirr: annualXirrInr === null ? null : roundNumber(annualXirrInr, 6),
      investedMultiple: totalInvestedInr > 0 ? roundNumber(portfolioValueInr / totalInvestedInr, 4) : null,
      metricsNote:
        "XIRR is computed on INR cash flows (constant monthly SIP in rupees, INR per share on NSE/BSE or INR index).",
      contributions,
      dataRange,
      initialPrice: roundCurrency(initialPrice),
      finalPrice: roundCurrency(finalPrice),
      priceCagr: priceCagr === null ? null : roundNumber(priceCagr, 6),
      initialMarketCap: initialMarketCap === null ? null : roundCurrency(initialMarketCap),
      finalMarketCap: finalMarketCap === null ? null : roundCurrency(finalMarketCap),
    };
  }

  if (usdSipInrPricedMode) {
    const inrPerUsdValuation = resolveInrPerUsdForValuationDate(fxDailyPrices, valuationDateText);
    if (inrPerUsdValuation === null || !(inrPerUsdValuation > 0)) {
      throw new Error(`No USD/INR exchange rate for valuation date ${valuationDateText}.`);
    }
    const portfolioValueInr = totalShares * valuationPrice;
    const portfolioValueAtEndUsd = portfolioValueInr / inrPerUsdValuation;
    const totalContribUsd = monthlyAmount * contributions.length;
    const latestPriceAsUsd = valuationPrice / inrPerUsdValuation;
    const flowsUsd = contributions.map((c) => ({
      amount: -monthlyAmount,
      date: new Date(`${c.purchaseDate}T00:00:00.000Z`),
    }));
    flowsUsd.push({ amount: portfolioValueAtEndUsd, date: valuationDate });
    const annualXirrUsd = xirr(flowsUsd);
    const gainUsd = portfolioValueAtEndUsd - totalContribUsd;

    const inrPerUsdStart = contributions[0].inrPerUsd || 1;
    const initialPriceUsd = initialPrice / inrPerUsdStart;
    const finalPriceUsd = latestPriceAsUsd;
    const priceCagrUsd = years > 0 ? (finalPriceUsd / initialPriceUsd) ** (1 / years) - 1 : null;

    const initialMarketCapUsd = initialMarketCap !== null ? initialMarketCap / inrPerUsdStart : null;
    const finalMarketCapUsd = finalMarketCap !== null ? finalMarketCap / inrPerUsdValuation : null;

    return {
      currency: "USD",
      priceQuote: "INR",
      inrNative: false,
      usdSipInrPriced: true,
      symbol,
      companyName,
      totalInvested: roundCurrency(totalContribUsd),
      totalShares: roundNumber(totalShares, 8),
      latestPrice: roundCurrency(latestPriceAsUsd),
      latestPriceInr: roundCurrency(valuationPrice),
      latestPriceUsd: null,
      latestPriceDate: valuationDateText,
      portfolioValue: roundCurrency(portfolioValueAtEndUsd),
      gain: roundCurrency(gainUsd),
      gainPercent: totalContribUsd > 0 ? roundNumber(gainUsd / totalContribUsd, 6) : null,
      xirr: annualXirrUsd === null ? null : roundNumber(annualXirrUsd, 6),
      investedMultiple: totalContribUsd > 0 ? roundNumber(portfolioValueAtEndUsd / totalContribUsd, 4) : null,
      metricsNote:
        "XIRR is on US-dollar cash flows: each monthly USD SIP is converted to INR to buy the INR-quoted index; the terminal value is in USD using the valuation-date USD/INR rate.",
      contributions,
      dataRange,
      initialPrice: roundCurrency(initialPriceUsd),
      finalPrice: roundCurrency(finalPriceUsd),
      priceCagr: priceCagrUsd === null ? null : roundNumber(priceCagrUsd, 6),
      initialMarketCap: initialMarketCapUsd === null ? null : roundCurrency(initialMarketCapUsd),
      finalMarketCap: finalMarketCapUsd === null ? null : roundCurrency(finalMarketCapUsd),
    };
  }

  if (inrWithFxMode) {
    const inrPerUsdValuation = resolveInrPerUsdForValuationDate(fxDailyPrices, valuationDateText);
    if (inrPerUsdValuation === null || !(inrPerUsdValuation > 0)) {
      throw new Error(`No USD/INR exchange rate for valuation date ${valuationDateText}.`);
    }
    const totalInvestedInr = contributions.length * monthlyInr;
    const portfolioValueInr = portfolioValueUsd * inrPerUsdValuation;
    const gainInr = portfolioValueInr - totalInvestedInr;
    const latestPriceInr = valuationPrice * inrPerUsdValuation;
    const cashFlowsInr = contributions.map((item) => ({
      amount: -monthlyInr,
      date: new Date(`${item.purchaseDate}T00:00:00.000Z`),
    }));
    cashFlowsInr.push({ amount: portfolioValueInr, date: valuationDate });
    const annualXirrInr = xirr(cashFlowsInr);

    const inrPerUsdStart = contributions[0].inrPerUsd || 1;
    const initialPriceInr = initialPrice * inrPerUsdStart;
    const finalPriceInr = latestPriceInr;
    const priceCagrInr = years > 0 ? (finalPriceInr / initialPriceInr) ** (1 / years) - 1 : null;

    const initialMarketCapInr = initialMarketCap !== null ? initialMarketCap * inrPerUsdStart : null;
    const finalMarketCapInr = finalMarketCap !== null ? finalMarketCap * inrPerUsdValuation : null;

    return {
      currency: "INR",
      priceQuote: "USD",
      inrNative: false,
      symbol,
      companyName,
      totalInvested: roundCurrency(totalInvestedInr),
      totalShares: roundNumber(totalShares, 8),
      latestPrice: roundCurrency(latestPriceInr),
      latestPriceInr: roundCurrency(latestPriceInr),
      latestPriceUsd: roundCurrency(valuationPrice),
      latestPriceDate: valuationDateText,
      portfolioValue: roundCurrency(portfolioValueInr),
      gain: roundCurrency(gainInr),
      gainPercent: totalInvestedInr > 0 ? roundNumber(gainInr / totalInvestedInr, 6) : null,
      xirr: annualXirrInr === null ? null : roundNumber(annualXirrInr, 6),
      investedMultiple: totalInvestedInr > 0 ? roundNumber(portfolioValueInr / totalInvestedInr, 4) : null,
      metricsNote:
        "XIRR is computed on INR cash flows (constant monthly SIP in rupees; USD-quoted series converted with USD/INR).",
      contributions,
      dataRange,
      initialPrice: roundCurrency(initialPriceInr),
      finalPrice: roundCurrency(finalPriceInr),
      priceCagr: priceCagrInr === null ? null : roundNumber(priceCagrInr, 6),
      initialMarketCap: initialMarketCapInr === null ? null : roundCurrency(initialMarketCapInr),
      finalMarketCap: finalMarketCapInr === null ? null : roundCurrency(finalMarketCapInr),
    };
  }

  const gain = portfolioValueUsd - totalInvestedUsd;
  const cashFlows = contributions.map((item) => ({
    amount: -item.invested,
    date: new Date(`${item.purchaseDate}T00:00:00.000Z`),
  }));
  cashFlows.push({ amount: portfolioValueUsd, date: valuationDate });
  const annualXirr = xirr(cashFlows);

  return {
    currency: "USD",
    priceQuote: "USD",
    inrNative: false,
    symbol,
    companyName,
    totalInvested: roundCurrency(totalInvestedUsd),
    totalShares: roundNumber(totalShares, 8),
    latestPrice: roundCurrency(valuationPrice),
    latestPriceDate: valuationDateText,
    portfolioValue: roundCurrency(portfolioValueUsd),
    gain: roundCurrency(gain),
    gainPercent: totalInvestedUsd > 0 ? roundNumber(gain / totalInvestedUsd, 6) : null,
    xirr: annualXirr === null ? null : roundNumber(annualXirr, 6),
    investedMultiple: totalInvestedUsd > 0 ? roundNumber(portfolioValueUsd / totalInvestedUsd, 4) : null,
    metricsNote: "XIRR is the primary return metric for SIP cash flows.",
    contributions,
    dataRange,
    initialPrice: roundCurrency(initialPrice),
    finalPrice: roundCurrency(finalPrice),
    priceCagr: priceCagr === null ? null : roundNumber(priceCagr, 6),
    initialMarketCap: initialMarketCap === null ? null : roundCurrency(initialMarketCap),
    finalMarketCap: finalMarketCap === null ? null : roundCurrency(finalMarketCap),
  };
}

export const __testables = {
  addMonths,
  choosePurchasePrice,
  diffInYears,
  findValuationRow,
  parseYahooChart,
  startOfMonth,
  xirr,
  xnpv,
};
