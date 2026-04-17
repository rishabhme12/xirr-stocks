import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  createPortfolioEstimate,
  getStockHistory,
  getTickerDirectory,
  normaliseSymbol,
} from "./src/lib/stock-data.mjs";

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

function parseEstimatorParams(url) {
  const symbol = normaliseSymbol(url.searchParams.get("symbol") || "");
  const amount = Number(url.searchParams.get("monthlyAmount") || "1");
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const stillHoldingRaw = (url.searchParams.get("stillHolding") || "true").toLowerCase();
  const purchaseDay = Number(url.searchParams.get("purchaseDay") || "1");

  if (!symbol) {
    throw new Error("Stock symbol is required.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Monthly investment amount must be greater than zero.");
  }

  if (!/^\d{4}-\d{2}$/.test(startDate)) {
    throw new Error("Start date must be in YYYY-MM format.");
  }

  if (endDate && !/^\d{4}-\d{2}$/.test(endDate)) {
    throw new Error("End date must be in YYYY-MM format.");
  }

  if (endDate && endDate < startDate) {
    throw new Error("End date cannot be before the start date.");
  }

  if (!["true", "false"].includes(stillHoldingRaw)) {
    throw new Error("Still holding must be true or false.");
  }

  if (!Number.isInteger(purchaseDay) || purchaseDay < 1 || purchaseDay > 28) {
    throw new Error("Purchase day must be between 1 and 28.");
  }

  return {
    symbol,
    amount,
    startDate,
    endDate: endDate || null,
    stillHolding: stillHoldingRaw !== "false",
    purchaseDay,
  };
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
      const stockHistory = await getStockHistory(params.symbol);
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
      });

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
