import { BENCHMARK_IDS } from "./benchmark-monthly.mjs";
import { normaliseSymbol } from "./stock-data.mjs";

/** Earliest selectable SIP start month (product rule). */
export const MIN_SIP_START_MONTH = "1990-01";

function validateCommonFields({
  amount,
  startDate,
  endDate,
  stillHoldingRaw,
  purchaseDay,
  amountCurrencyRaw,
}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Monthly investment amount must be greater than zero.");
  }

  if (!/^\d{4}-\d{2}$/.test(startDate)) {
    throw new Error("Start date must be in YYYY-MM format.");
  }

  if (startDate < MIN_SIP_START_MONTH) {
    throw new Error(`SIP start month cannot be before ${MIN_SIP_START_MONTH}.`);
  }

  if (endDate && !/^\d{4}-\d{2}$/.test(endDate)) {
    throw new Error("End date must be in YYYY-MM format.");
  }

  if (endDate && endDate < startDate) {
    throw new Error("End date cannot be before the start date.");
  }

  if (endDate && endDate < MIN_SIP_START_MONTH) {
    throw new Error(`SIP end month cannot be before ${MIN_SIP_START_MONTH}.`);
  }

  if (!["true", "false"].includes(stillHoldingRaw)) {
    throw new Error("Still holding must be true or false.");
  }

  if (!Number.isInteger(purchaseDay) || purchaseDay < 1 || purchaseDay > 28) {
    throw new Error("Purchase day must be between 1 and 28.");
  }

  if (!["usd", "inr"].includes(amountCurrencyRaw)) {
    throw new Error("amountCurrency must be usd or inr.");
  }
}

/**
 * Benchmark id from `benchmark`, short `bm`, or reserved `symbol=BM_<id>`.
 * @returns {{ id: string } | { id: null, invalidDirect: string | null }}
 */
function parseBenchmarkId(sp) {
  const direct = (sp.get("benchmark") || sp.get("bm") || "").trim().toLowerCase();
  if (direct) {
    if (!BENCHMARK_IDS.includes(direct)) {
      return { id: null, invalidDirect: direct };
    }
    return { id: direct, invalidDirect: null };
  }
  const sym = (sp.get("symbol") || "").trim();
  const idGroup = BENCHMARK_IDS.join("|");
  const m = new RegExp(`^BM_(${idGroup})$`, "i").exec(sym);
  if (m) {
    return { id: m[1].toLowerCase(), invalidDirect: null };
  }
  return { id: null, invalidDirect: null };
}

/**
 * Core parser: GET query string or POST JSON bridged into URLSearchParams.
 * @param {URLSearchParams} sp
 */
export function parseEstimatorFromSearchParams(sp) {
  const amount = Number(sp.get("monthlyAmount") || "1");
  const startDate = sp.get("startDate") || "";
  const endDate = sp.get("endDate") || "";
  const stillHoldingRaw = (sp.get("stillHolding") || "true").toLowerCase();
  const purchaseDay = Number(sp.get("purchaseDay") || "1");
  const amountCurrencyRaw = (sp.get("amountCurrency") || "usd").toLowerCase();

  validateCommonFields({
    amount,
    startDate,
    endDate,
    stillHoldingRaw,
    purchaseDay,
    amountCurrencyRaw,
  });

  const common = {
    amount,
    amountCurrency: amountCurrencyRaw,
    startDate,
    endDate: endDate || null,
    stillHolding: stillHoldingRaw !== "false",
    purchaseDay,
  };

  const parsedBm = parseBenchmarkId(sp);
  if (parsedBm.invalidDirect) {
    throw new Error(`benchmark must be one of: ${BENCHMARK_IDS.join(", ")}.`);
  }
  if (parsedBm.id) {
    return { kind: "benchmark", benchmark: parsedBm.id, ...common };
  }

  const symbol = normaliseSymbol(sp.get("symbol") || "");

  const corruptedBenchmark = {
    BMSP: "sp500",
    BMGOLD: "gold",
    BMSILVER: "silver",
    BMQQQ: "qqq",
    BMNIFTY50: "nifty50",
    BMNIFTY500: "nifty500",
  }[symbol];
  if (corruptedBenchmark) {
    return { kind: "benchmark", benchmark: corruptedBenchmark, ...common };
  }

  if (!symbol) {
    throw new Error("Stock symbol is required.");
  }

  return { kind: "stock", symbol, ...common };
}

/**
 * POST /api/estimate JSON body (preferred; avoids proxies dropping query params).
 */
export function parseEstimatorFromJsonBody(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("Request body must be a JSON object.");
  }
  const sp = new URLSearchParams();
  const set = (k, v) => {
    if (v === undefined || v === null || v === "") {
      return;
    }
    sp.set(k, String(v));
  };
  set("benchmark", obj.benchmark);
  set("bm", obj.bm);
  set("symbol", obj.symbol);
  sp.set("monthlyAmount", obj.monthlyAmount != null ? String(obj.monthlyAmount) : "1");
  if (obj.startDate != null && obj.startDate !== "") {
    sp.set("startDate", String(obj.startDate));
  }
  if (obj.endDate) {
    set("endDate", obj.endDate);
  }
  const sh = obj.stillHolding;
  const shStr = typeof sh === "boolean" ? (sh ? "true" : "false") : String(sh ?? "true");
  sp.set("stillHolding", shStr);
  sp.set("purchaseDay", obj.purchaseDay != null ? String(obj.purchaseDay) : "1");
  sp.set("amountCurrency", String(obj.amountCurrency ?? "usd").toLowerCase());
  return parseEstimatorFromSearchParams(sp);
}

/**
 * POST /api/estimate-batch — one stock plus zero or more benchmarks (same SIP params).
 */
export function parseEstimateBatchFromJsonBody(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("Request body must be a JSON object.");
  }
  const rawKeys = obj.benchmarkKeys;
  if (!Array.isArray(rawKeys)) {
    throw new Error("benchmarkKeys must be an array.");
  }
  const benchmarkKeys = [];
  for (const k of rawKeys) {
    const id = String(k).trim().toLowerCase();
    if (!BENCHMARK_IDS.includes(id)) {
      throw new Error(`benchmarkKeys entry "${k}" is not a valid benchmark.`);
    }
    benchmarkKeys.push(id);
  }
  const { benchmarkKeys: _bk, benchmark: _b, bm: _m, ...rest } = obj;
  const stockParams = parseEstimatorFromJsonBody(rest);
  if (stockParams.kind !== "stock") {
    throw new Error("estimate-batch requires a stock symbol (benchmark-only requests use /api/estimate).");
  }
  return { ...stockParams, benchmarkKeys };
}

/**
 * GET /api/estimate?…
 */
export function parseEstimatorParams(url) {
  return parseEstimatorFromSearchParams(url.searchParams);
}
