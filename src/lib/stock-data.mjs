const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CACHE_MS = 12 * 60 * 60 * 1000;

let tickerCache = { loadedAt: 0, data: [] };
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

function parseYahooChart(payload, symbol) {
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

  return {
    symbol: String(meta.symbol || symbol).toUpperCase(),
    companyName: meta.longName || meta.shortName || symbol,
    latestPrice: Number.isFinite(meta.regularMarketPrice)
      ? Number(meta.regularMarketPrice)
      : dailyPrices[dailyPrices.length - 1].close,
    latestPriceDate: meta.regularMarketTime
      ? isoDate(fromUnixTimestamp(meta.regularMarketTime))
      : dailyPrices[dailyPrices.length - 1].date,
    dailyPrices,
  };
}

function choosePurchasePrice(monthlyRows, desiredDay) {
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
  return symbol.trim().toUpperCase().replace(/[^A-Z.\-]/g, "");
}

export async function getTickerDirectory(query = "") {
  const now = Date.now();
  if (tickerCache.data.length > 0 && now - tickerCache.loadedAt < CACHE_MS) {
    return filterTickers(tickerCache.data, query);
  }

  const response = await fetch(SEC_TICKERS_URL, {
    headers: {
      "User-Agent": "xirr-stocks/1.0 support@example.com",
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
  return filterTickers(tickers, query);
}

function filterTickers(tickers, query) {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed) {
    return tickers.slice(0, 25);
  }

  return tickers
    .filter((ticker) => ticker.symbol.includes(trimmed) || ticker.name.toUpperCase().includes(trimmed))
    .slice(0, 25);
}

export async function getStockHistory(symbol) {
  const normalised = normaliseSymbol(symbol);
  const cached = stockCache.get(normalised);
  const now = Date.now();

  if (cached && now - cached.loadedAt < CACHE_MS) {
    return cached.value;
  }

  const startPeriod = 0;
  const endPeriod = Math.floor(Date.now() / 1000) + 86400;
  const url = `${YAHOO_CHART_URL}${encodeURIComponent(
    normalised,
  )}?period1=${startPeriod}&period2=${endPeriod}&interval=1d&includeAdjustedClose=false&events=split`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 xirr-stocks/1.0",
      Accept: "application/json",
    },
  });
  assertOk(response, "Historical price");

  const payload = await response.json();
  const value = parseYahooChart(payload, normalised);

  stockCache.set(normalised, { loadedAt: now, value });
  return value;
}

export function createPortfolioEstimate({
  dailyPrices,
  monthlyAmount,
  startDate,
  endDate = null,
  stillHolding = true,
  purchaseDay = 1,
  symbol,
  companyName,
  latestPrice = null,
  latestPriceDate = null,
}) {
  if (!dailyPrices.length) {
    throw new Error("Daily price history is required.");
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
      const shares = monthlyAmount / purchase.close;
      contributions.push({
        month: key,
        purchaseDate: purchase.date,
        purchasePrice: roundNumber(purchase.close, 4),
        invested: roundCurrency(monthlyAmount),
        sharesPurchased: roundNumber(shares, 8),
      });
    }

    cursor = addMonths(cursor, 1);
  }

  if (contributions.length === 0) {
    throw new Error(
      `No price history is available from ${startDate}. Earliest available date is ${dailyPrices[0].date}.`,
    );
  }

  const totalInvested = contributions.reduce((sum, item) => sum + item.invested, 0);
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
  const portfolioValue = totalShares * valuationPrice;
  const gain = portfolioValue - totalInvested;
  const cashFlows = contributions.map((item) => ({
    amount: -item.invested,
    date: new Date(`${item.purchaseDate}T00:00:00.000Z`),
  }));
  cashFlows.push({ amount: portfolioValue, date: valuationDate });
  const annualXirr = xirr(cashFlows);
  const effectiveStartMonth = maxDateText(startDate, firstAvailableMonth);
  const adjustedForListing = startDate < firstAvailableMonth;

  return {
    symbol,
    companyName,
    totalInvested: roundCurrency(totalInvested),
    totalShares: roundNumber(totalShares, 8),
    latestPrice: roundCurrency(valuationPrice),
    latestPriceDate: valuationDateText,
    portfolioValue: roundCurrency(portfolioValue),
    gain: roundCurrency(gain),
    gainPercent: totalInvested > 0 ? roundNumber(gain / totalInvested, 6) : null,
    xirr: annualXirr === null ? null : roundNumber(annualXirr, 6),
    investedMultiple: totalInvested > 0 ? roundNumber(portfolioValue / totalInvested, 4) : null,
    metricsNote: "XIRR is the primary return metric for SIP cash flows.",
    contributions,
    dataRange: {
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
    },
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
