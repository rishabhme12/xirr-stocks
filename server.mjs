import http from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { logError, logInfo, logStartupSummary, logWarn } from "./src/lib/logger.mjs";
import { getBenchmarkStockLikeHistory } from "./src/lib/benchmark-monthly.mjs";
import {
  createPortfolioEstimate,
  getStockHistory,
  getTickerDirectory,
  isInrNativeQuote,
} from "./src/lib/stock-data.mjs";
import {
  parseEstimateBatchFromJsonBody,
  parseEstimatorFromJsonBody,
  parseEstimatorParams,
} from "./src/lib/estimator-params.mjs";
import { mergeInrPerUsdDaily, dayBeforeIsoDate } from "./src/lib/fx-history.mjs";
import { filterExinusRowsForPreYahooGap, parseExinusMonthlyCsv } from "./src/lib/exinus-monthly-csv.mjs";
import { getClientIp } from "./src/lib/client-ip.mjs";
import { rateLimitAllow } from "./src/lib/rate-limit.mjs";
import { baseSecurityHeaders } from "./src/lib/http-security.mjs";
import { applyPublicSiteUrlPlaceholders } from "./src/lib/public-site-url.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

function isPathUnderPublicRoot(filePath) {
  const rel = path.relative(publicDir, filePath);
  if (rel === "") {
    return true;
  }
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}
const port = Number(process.env.PORT || 3000);
/** Railway and other PaaS need 0.0.0.0; local dev defaults to loopback unless HOST is set. */
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

const maxJsonBodyBytes = Math.min(
  10 * 1024 * 1024,
  Math.max(1024, Number.parseInt(process.env.MAX_JSON_BODY_BYTES || "262144", 10) || 262144),
);

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

function sendJson(response, request, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...baseSecurityHeaders(request),
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request, maxBytes = maxJsonBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        request.destroy();
        reject(Object.assign(new Error("Payload too large"), { code: "PAYLOAD_TOO_LARGE" }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function shouldApplyApiRateLimit(pathname, method) {
  if (pathname === "/api/health") {
    return false;
  }
  if (method === "OPTIONS") {
    return false;
  }
  return pathname.startsWith("/api/");
}

async function serveStatic(requestPath, response, request) {
  const resolvedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(publicDir, path.normalize(resolvedPath));

  if (!isPathUnderPublicRoot(filePath)) {
    sendJson(response, request, 403, { error: "Forbidden." });
    return;
  }

  try {
    const extension = path.extname(filePath);
    const raw = await readFile(filePath);
    const body =
      extension === ".html"
        ? applyPublicSiteUrlPlaceholders(raw.toString("utf8"), request)
        : raw;
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extension) || "application/octet-stream",
      ...baseSecurityHeaders(request),
    });
    response.end(body);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendJson(response, request, 404, { error: "File not found." });
      return;
    }

    sendJson(response, request, 500, { error: "Unable to load asset." });
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

function inrNativeForHistory(stockHistory) {
  return isInrNativeQuote(
    stockHistory.quoteCurrency,
    stockHistory.yahooSymbol || stockHistory.symbol,
  );
}

async function resolveStockHistory(params) {
  if (params.kind === "benchmark") {
    return getBenchmarkStockLikeHistory(params.benchmark);
  }
  return getStockHistory(params.symbol);
}

async function runEstimate(params) {
  const t0 = Date.now();
  const label =
    params.kind === "benchmark" ? `benchmark:${params.benchmark}` : `stock:${params.symbol}`;
  logInfo("estimate", "start", {
    label,
    currency: params.amountCurrency,
    startDate: params.startDate,
  });
  try {
    const stockHistory = await resolveStockHistory(params);

    if (params.amountCurrency === "usd") {
      if (inrNativeForHistory(stockHistory)) {
        const { merged: fxDaily } = await buildMergedFxSeries(params, stockHistory);
        const estimate = createPortfolioEstimate({
          dailyPrices: stockHistory.dailyPrices,
          monthlyAmount: params.amount,
          usdSipInrPriced: true,
          fxDailyPrices: fxDaily,
          startDate: params.startDate,
          endDate: params.endDate,
          stillHolding: params.stillHolding,
          purchaseDay: params.purchaseDay,
          symbol: stockHistory.symbol,
          companyName: stockHistory.companyName,
          latestPrice: stockHistory.latestPrice,
          latestPriceDate: stockHistory.latestPriceDate,
          priceQuote: stockHistory.quoteCurrency || "INR",
        });
        if (params.kind === "benchmark") {
          estimate.metricsNote = `${estimate.metricsNote} Benchmark series uses cached monthly closes (Yahoo Finance) with API fill for missing months.`;
        }
        logInfo("estimate", "done", { label, ms: Date.now() - t0, resultSymbol: estimate.symbol });
        return estimate;
      }
      const estimate = createPortfolioEstimate({
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
        priceQuote: stockHistory.quoteCurrency || "USD",
      });
      logInfo("estimate", "done", { label, ms: Date.now() - t0, resultSymbol: estimate.symbol });
      return estimate;
    }

    if (inrNativeForHistory(stockHistory)) {
      const estimate = createPortfolioEstimate({
        dailyPrices: stockHistory.dailyPrices,
        monthlyInr: params.amount,
        inrNative: true,
        startDate: params.startDate,
        endDate: params.endDate,
        stillHolding: params.stillHolding,
        purchaseDay: params.purchaseDay,
        symbol: stockHistory.symbol,
        companyName: stockHistory.companyName,
        latestPrice: stockHistory.latestPrice,
        latestPriceDate: stockHistory.latestPriceDate,
        priceQuote: stockHistory.quoteCurrency || "INR",
      });
      if (params.kind === "benchmark") {
        estimate.metricsNote = `${estimate.metricsNote} Benchmark series uses cached monthly closes (Yahoo Finance) with API fill for missing months.`;
      }
      logInfo("estimate", "done", { label, ms: Date.now() - t0, resultSymbol: estimate.symbol });
      return estimate;
    }

    const { merged: fxDaily } = await buildMergedFxSeries(params, stockHistory);

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
      priceQuote: "USD",
    });

    if (params.kind === "benchmark") {
      estimate.metricsNote = `${estimate.metricsNote} Benchmark series uses cached monthly closes (Yahoo Finance) with API fill for missing months.`;
    }

    logInfo("estimate", "done", { label, ms: Date.now() - t0, resultSymbol: estimate.symbol });
    return estimate;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("estimate", "failed", { label, ms: Date.now() - t0, message });
    throw error;
  }
}

async function runEstimateBatch(params) {
  const t0 = Date.now();
  const { benchmarkKeys, ...stockParams } = params;
  logInfo("estimate-batch", "start", {
    symbol: stockParams.symbol,
    benchmarkKeys,
    count: benchmarkKeys.length,
  });
  const primary = await runEstimate(stockParams);
  const benchmarkStartDate = primary.dataRange.effectiveStartMonth;
  const benchmarks = {};
  for (const key of benchmarkKeys) {
    try {
      benchmarks[key] = await runEstimate({
        kind: "benchmark",
        benchmark: key,
        amount: stockParams.amount,
        amountCurrency: stockParams.amountCurrency,
        startDate: benchmarkStartDate,
        endDate: stockParams.endDate,
        stillHolding: stockParams.stillHolding,
        purchaseDay: stockParams.purchaseDay,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error.";
      logWarn("estimate-batch", "benchmark failed", { key, message });
      benchmarks[key] = { __failed: true, error: message };
    }
  }
  const failed = benchmarkKeys.filter((k) => benchmarks[k].__failed).length;
  logInfo("estimate-batch", "done", {
    symbol: stockParams.symbol,
    ms: Date.now() - t0,
    benchmarksOk: benchmarkKeys.length - failed,
    benchmarksFailed: failed,
  });
  return { primary, benchmarks };
}

const server = http.createServer(async (request, response) => {
  if (!request.url || !request.method) {
    sendJson(response, request, 400, { error: "Bad request." });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const reqId = randomBytes(4).toString("hex");
  const httpStart = Date.now();

  try {
    if (
      request.method === "OPTIONS" &&
      (pathname === "/api/estimate" || pathname === "/api/estimate-batch")
    ) {
      logInfo("http", "OPTIONS preflight", { reqId, pathname });
      response.writeHead(204, {
        ...baseSecurityHeaders(request),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      response.end();
      return;
    }

    if (shouldApplyApiRateLimit(pathname, request.method)) {
      const ip = getClientIp(request);
      const limit = rateLimitAllow(ip);
      if (!limit.ok) {
        logWarn("http", "rate limited", { reqId, pathname, ip });
        sendJson(
          response,
          request,
          429,
          { error: "Too many requests. Try again shortly." },
          { "Retry-After": String(limit.retryAfterSec) },
        );
        return;
      }
    }

    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, request, 200, { ok: true, service: "xirr-stocks" });
      return;
    }

    if (pathname.startsWith("/api/")) {
      logInfo("http", "request", { reqId, method: request.method, pathname });
    }

    if (pathname === "/api/tickers" && request.method === "GET") {
      const query = (url.searchParams.get("query") || "").trim();
      let market = (url.searchParams.get("market") || "us").toLowerCase();
      if (market !== "us" && market !== "in" && market !== "all") {
        market = "us";
      }
      const tickers = await getTickerDirectory(query, market);
      sendJson(response, request, 200, { tickers });
      logInfo("http", "response", {
        reqId,
        pathname,
        status: 200,
        ms: Date.now() - httpStart,
        tickerCount: tickers.length,
      });
      return;
    }

    if (pathname === "/api/estimate") {
      if (request.method === "GET") {
        const params = parseEstimatorParams(url);
        const estimate = await runEstimate(params);
        sendJson(response, request, 200, estimate, { "Cache-Control": "no-store" });
        logInfo("http", "response", {
          reqId,
          pathname,
          status: 200,
          ms: Date.now() - httpStart,
          kind: params.kind,
        });
        return;
      }
      if (request.method === "POST") {
        let raw;
        try {
          raw = await readRequestBody(request);
        } catch (err) {
          if (err && err.code === "PAYLOAD_TOO_LARGE") {
            sendJson(response, request, 413, { error: "Request body too large." });
            return;
          }
          throw err;
        }
        let body;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          logWarn("http", "bad JSON body", { reqId, pathname });
          sendJson(response, request, 400, { error: "Invalid JSON body." });
          return;
        }
        const params = parseEstimatorFromJsonBody(body);
        const estimate = await runEstimate(params);
        sendJson(response, request, 200, estimate, { "Cache-Control": "no-store" });
        logInfo("http", "response", {
          reqId,
          pathname,
          status: 200,
          ms: Date.now() - httpStart,
          kind: params.kind,
        });
        return;
      }
      sendJson(response, request, 405, { error: "Method not allowed." });
      logWarn("http", "response", { reqId, pathname, status: 405, ms: Date.now() - httpStart });
      return;
    }

    if (pathname === "/api/estimate-batch" && request.method === "POST") {
      let raw;
      try {
        raw = await readRequestBody(request);
      } catch (err) {
        if (err && err.code === "PAYLOAD_TOO_LARGE") {
          sendJson(response, request, 413, { error: "Request body too large." });
          return;
        }
        throw err;
      }
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        logWarn("http", "bad JSON body", { reqId, pathname });
        sendJson(response, request, 400, { error: "Invalid JSON body." });
        return;
      }
      try {
        const params = parseEstimateBatchFromJsonBody(body);
        const payload = await runEstimateBatch(params);
        sendJson(response, request, 200, payload, { "Cache-Control": "no-store" });
        logInfo("http", "response", {
          reqId,
          pathname,
          status: 200,
          ms: Date.now() - httpStart,
          symbol: params.symbol,
          benchmarkCount: params.benchmarkKeys.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error.";
        logError("http", "estimate-batch handler error", {
          reqId,
          pathname,
          message,
          ms: Date.now() - httpStart,
        });
        sendJson(response, request, 400, { error: message });
      }
      return;
    }

    if (pathname === "/api/estimate-batch") {
      sendJson(response, request, 405, { error: "Method not allowed." });
      logWarn("http", "response", { reqId, pathname, status: 405, ms: Date.now() - httpStart });
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, request, 405, { error: "Method not allowed." });
      logWarn("http", "response", { reqId, pathname, status: 405, ms: Date.now() - httpStart });
      return;
    }

    await serveStatic(pathname, response, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    logError("http", "unhandled", {
      reqId,
      pathname,
      message,
      ms: Date.now() - httpStart,
    });
    sendJson(response, request, 400, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`xirr-stocks listening on http://${host}:${port}`);
  logStartupSummary();
});
