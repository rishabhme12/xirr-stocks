import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import {
  createPortfolioEstimate,
  getStockHistory,
  getTickerDirectory,
} from "./src/lib/stock-data.mjs";
import { parseEstimatorParams } from "./src/lib/estimator-params.mjs";
import { mergeInrPerUsdDaily, dayBeforeIsoDate } from "./src/lib/fx-history.mjs";
import { filterExinusRowsForPreYahooGap, parseExinusMonthlyCsv } from "./src/lib/exinus-monthly-csv.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

function maxYm(left, right) {
  return left >= right ? left : right;
}

/** Resolve EXINUS monthly CSV: env override, then data/exinus-monthly.csv, then data/*EXINUS*.csv (e.g. browser downloads). */
async function readExinusCsvForPreYahoo() {
  const dataDir = path.join(__dirname, "data");
  const tried = [];

  if (process.env.EXINUS_CSV_PATH) {
    const p = process.env.EXINUS_CSV_PATH;
    tried.push(p);
    try {
      const text = await readFile(p, "utf8");
      return { text, csvPath: p };
    } catch (err) {
      if (err && err.code !== "ENOENT") {
        throw err;
      }
    }
  }

  const defaultPath = path.join(dataDir, "exinus-monthly.csv");
  tried.push(defaultPath);
  try {
    const text = await readFile(defaultPath, "utf8");
    return { text, csvPath: defaultPath };
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      throw err;
    }
  }

  let names = [];
  try {
    names = await readdir(dataDir);
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      throw err;
    }
  }
  const fallbackName = names.find((n) => /\.csv$/i.test(n) && /exinus/i.test(n));
  if (fallbackName) {
    const p = path.join(dataDir, fallbackName);
    tried.push(p);
    const text = await readFile(p, "utf8");
    return { text, csvPath: p };
  }

  const hint = tried.length ? ` Tried: ${tried.join(", ")}.` : "";
  throw new Error(
    `INR mode needs USD/INR before Yahoo Finance (~Dec 2003). Place monthly EXINUS CSV at data/exinus-monthly.csv or set EXINUS_CSV_PATH.${hint}`,
  );
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function serveStatic(requestPath, response) {
  const resolvedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(publicDir, path.normalize(resolvedPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }

  try {
    const file = await readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extension) || "application/octet-stream",
    });
    response.end(file);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendJson(response, 404, { error: "File not found." });
      return;
    }

    sendJson(response, 500, { error: "Unable to load asset." });
  }
}

/**
 * Pre-Yahoo USD/INR from monthly EXINUS CSV (export observation_date + rate columns).
 * @returns {{ merged: Array<{date: string, close: number}>, usedExinusCsv: boolean }}
 */
async function buildMergedFxSeries(params, stockHistory) {
  const fxYahoo = await getStockHistory("INR=X");
  const yahooDaily = fxYahoo.dailyPrices;
  if (!yahooDaily.length) {
    throw new Error("USD/INR history from Yahoo Finance is unavailable.");
  }
  const yahooFirstDate = yahooDaily[0].date;
  const yahooFirstMonth = yahooFirstDate.slice(0, 7);
  const firstStockMonth = stockHistory.dailyPrices[0].date.slice(0, 7);
  const effectiveStartMonth = maxYm(params.startDate, firstStockMonth);

  let preYahooRows = [];
  let usedExinusCsv = false;

  if (effectiveStartMonth < yahooFirstMonth) {
    const { text, csvPath } = await readExinusCsvForPreYahoo();
    const parsed = parseExinusMonthlyCsv(text);
    preYahooRows = filterExinusRowsForPreYahooGap(parsed, effectiveStartMonth, yahooFirstDate);
    if (preYahooRows.length === 0) {
      throw new Error(
        `EXINUS CSV at ${csvPath} has no rows for months ${effectiveStartMonth} through before ${yahooFirstMonth}. Add rows or re-download the export.`,
      );
    }
    usedExinusCsv = true;
  }

  const merged = mergeInrPerUsdDaily(preYahooRows, yahooDaily);
  return { merged, usedExinusCsv };
}

async function runEstimate(params) {
  const stockHistory = await getStockHistory(params.symbol);

  if (params.amountCurrency === "usd") {
    return createPortfolioEstimate({
      dailyPrices: stockHistory.dailyPrices,
      monthlyAmount: params.amount,
      startDate: params.startDate,
      endDate: params.endDate,
      stillHolding: params.stillHolding,
      purchaseDay: params.purchaseDay,
      symbol: stockHistory.symbol,
      companyName: stockHistory.companyName,
      latestPrice: stockHistory.latestPrice,
      latestPriceDate: stockHistory.latestPriceDate,
    });
  }

  const { merged: fxDaily, usedExinusCsv } = await buildMergedFxSeries(params, stockHistory);

  const estimate = createPortfolioEstimate({
    dailyPrices: stockHistory.dailyPrices,
    monthlyInr: params.amount,
    fxDailyPrices: fxDaily,
    startDate: params.startDate,
    endDate: params.endDate,
    stillHolding: params.stillHolding,
    purchaseDay: params.purchaseDay,
    symbol: stockHistory.symbol,
    companyName: stockHistory.companyName,
    latestPrice: stockHistory.latestPrice,
    latestPriceDate: stockHistory.latestPriceDate,
  });

  if (estimate.currency === "INR") {
    if (usedExinusCsv) {
      estimate.metricsNote =
        "XIRR is computed on INR cash flows (constant monthly SIP in rupees). Pre-Yahoo USD/INR uses monthly EXINUS from your CSV; overlap uses Yahoo INR=X.";
    } else {
      estimate.metricsNote =
        "XIRR is computed on INR cash flows (constant monthly SIP in rupees). USD/INR from Yahoo INR=X (full window within Yahoo history).";
    }
  }

  return estimate;
}

const server = http.createServer(async (request, response) => {
  if (!request.url || !request.method) {
    sendJson(response, 400, { error: "Bad request." });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    if (url.pathname === "/api/tickers") {
      const query = (url.searchParams.get("query") || "").trim();
      const tickers = await getTickerDirectory(query);
      sendJson(response, 200, { tickers });
      return;
    }

    if (url.pathname === "/api/estimate") {
      const params = parseEstimatorParams(url);
      const estimate = await runEstimate(params);
      sendJson(response, 200, estimate);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    sendJson(response, 400, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`xirr-stocks listening on http://${host}:${port}`);
});
