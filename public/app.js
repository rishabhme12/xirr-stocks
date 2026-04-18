const form = document.querySelector("#estimator-form");
const stockQueryInput = document.querySelector("#stock-query");
const symbolInput = document.querySelector("#symbol");
const tickerResults = document.querySelector("#ticker-results");
const resultsRoot = document.querySelector("#results");
const progressBanner = document.querySelector("#progress-banner");
const progressMessage = document.querySelector("#progress-message");
const progressFill = document.querySelector("#progress-fill");
const statusNode = document.querySelector("#status");
const endDateInput = document.querySelector("#end-date");
const holdingField = document.querySelector("#holding-field");
const stillHoldingInput = document.querySelector("#still-holding");
const holdingState = document.querySelector("#holding-state");
const submitButton = form.querySelector('button[type="submit"]');
const calculatorIntro = document.querySelector("#calculator-intro");
const investorUsBtn = document.querySelector("#investor-us");
const investorInBtn = document.querySelector("#investor-in");
const appStatusEl = document.querySelector("#app-status");

const INVESTOR_STORAGE_KEY = "investorMode";
/** How often to re-check Yahoo Finance reachability via `/api/health`. */
const HEALTH_POLL_MS = 90_000;
const LS_ESTIMATE_FAIL_AT = "xirr_estimateFailAt";

/** Default listing shown on load and after switching US ↔ India. */
const DEFAULT_STOCK_SYMBOL = "INTC";
const DEFAULT_STOCK_DISPLAY = "INTC — Intel Corp";
const DEFAULT_SIP_START_MONTH = "1999-12";

/** INR results: user-facing copy only; FX/EXINUS details are not shown here. */
const METRICS_FOOTNOTE_INR =
  "XIRR is computed on INR cash flows (constant monthly SIP in rupees).";

/** Tracks last applied mode so toggling to the same side does not wipe the form. */
let lastInvestorMode = null;

/** Benchmark keys (server: monthly CSV + Yahoo fill). Inception = first comparable month for the SIP window. */
const BENCHMARK_KEYS = ["sp500", "gold", "silver", "qqq"];
const BENCHMARK_SERIES = [
  { benchmarkKey: "sp500", label: "S&P 500", inception: "1990-01" },
  { benchmarkKey: "gold", label: "GOLD", inception: "1990-01" },
  { benchmarkKey: "silver", label: "SILVER", inception: "1990-01" },
  { benchmarkKey: "qqq", label: "QQQ", inception: "1999-03" },
];

function labelForBenchmarkKey(benchmarkKey) {
  const row = BENCHMARK_SERIES.find((b) => b.benchmarkKey === benchmarkKey);
  return row ? row.label : benchmarkKey;
}

let tickerSearchTimeout = null;
let lastTickerResults = [];
let activeTickerIndex = -1;

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function currencyInr(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function percent(value) {
  if (value === null || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

function normaliseSymbolClient(symbol) {
  return symbol.trim().toUpperCase().replace(/[^A-Z.\-]/g, "");
}

/** Split benchmarks that existed by SIP start vs listed later (no comparable full-window metrics). */
function partitionBenchmarksBySipStart(userStartMonth) {
  const comparableBenchmarks = [];
  const lateBenchmarks = [];
  for (const { benchmarkKey, label, inception } of BENCHMARK_SERIES) {
    if (inception > userStartMonth) {
      lateBenchmarks.push({ benchmarkKey, label, inception });
    } else {
      comparableBenchmarks.push(benchmarkKey);
    }
  }
  return { comparableBenchmarks, lateBenchmarks };
}

function number(value, maximumFractionDigits = 4) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
}

function setAppStatus(state, message) {
  if (!appStatusEl) {
    return;
  }
  appStatusEl.className = `app-status app-status--${state}`;
  const label = appStatusEl.querySelector(".app-status-label");
  if (label) {
    label.textContent = message;
  }
}

async function refreshAppHealth() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setAppStatus(
      "offline",
      "You’re offline. Connect to the internet to load stock prices and run estimates.",
    );
    return;
  }

  setAppStatus("checking", "Checking live prices…");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      setAppStatus(
        "error",
        "We couldn’t finish the connection check. Refresh the page. If this keeps happening, update the app or ask whoever installed it for help.",
      );
      return;
    }
    const data = await response.json();
    const recentFailAt = Number(localStorage.getItem(LS_ESTIMATE_FAIL_AT) || 0);
    const recentFail = recentFailAt > 0 && Date.now() - recentFailAt < 8 * 60 * 1000;
    if (data.yahooFinance) {
      setAppStatus(
        "caution",
        recentFail
          ? "A sample Yahoo request works, but an estimate just failed (often HTTP 429). Wait several minutes before retrying — each run loads your stock + benchmarks + retries."
          : "Sample Yahoo chart request succeeded — that does not guarantee the next estimate will work: full runs use many more chart calls and often hit rate limits.",
      );
    } else {
      setAppStatus(
        "degraded",
        `Yahoo Finance chart data isn’t available right now (${data.yahooDetail || "unknown"}). Wait a few minutes or try another network; estimates will likely fail until this clears.`,
      );
    }
  } catch {
    setAppStatus(
      "error",
      "We can’t reach the stock data for this page. Open the app using the web address from your setup (for example http://127.0.0.1:3000), not a saved HTML file, then refresh.",
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function waitForMinimum(startTime, minimumMilliseconds) {
  const elapsed = Date.now() - startTime;
  if (elapsed < minimumMilliseconds) {
    await sleep(minimumMilliseconds - elapsed);
  }
}

function renderProgressState(stage, source = "Yahoo Finance") {
  const config = {
    idle: {
      bannerClass: "idle",
      fillClass: "stage-idle",
      message: "Ready to calculate",
    },
    fetching: {
      bannerClass: "fetching",
      fillClass: "stage-fetching",
      message: `Fetching data from ${source}`,
    },
    calculating: {
      bannerClass: "calculating",
      fillClass: "stage-calculating",
      message: "Calculating returns",
    },
    done: {
      bannerClass: "done",
      fillClass: "stage-done",
      message: "Done",
    },
    error: {
      bannerClass: "error",
      fillClass: "stage-error",
      message: "Estimate failed",
    },
  }[stage];

  progressBanner.className = `progress-banner ${config.bannerClass}`;
  progressMessage.textContent = config.message;
  progressFill.className = `progress-banner-fill ${config.fillClass}`;
  progressBanner.setAttribute("aria-busy", stage === "fetching" || stage === "calculating" ? "true" : "false");
}

function clearTickerResults() {
  tickerResults.innerHTML = "";
  tickerResults.classList.remove("open");
  stockQueryInput.setAttribute("aria-expanded", "false");
  stockQueryInput.removeAttribute("aria-activedescendant");
  activeTickerIndex = -1;
}

function showTickerResults() {
  if (lastTickerResults.length === 0) {
    return;
  }

  tickerResults.classList.add("open");
  stockQueryInput.setAttribute("aria-expanded", "true");
}

function setSelectedState(hasSelection) {
  stockQueryInput.classList.toggle("has-selection", hasSelection);
}

function applyTickerSelection(ticker) {
  stockQueryInput.value = `${ticker.symbol} — ${ticker.name}`;
  symbolInput.value = ticker.symbol;
  setSelectedState(true);
  clearTickerResults();
  setStatus(`Selected ${ticker.symbol}. Ready to estimate.`);
}

function updateActiveTicker(nextIndex) {
  const options = [...tickerResults.querySelectorAll(".ticker-option")];
  activeTickerIndex = nextIndex;

  for (const [index, option] of options.entries()) {
    const isActive = index === activeTickerIndex;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", isActive ? "true" : "false");

    if (isActive) {
      stockQueryInput.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  }
}

function renderTickerResults(tickers) {
  lastTickerResults = tickers;
  clearTickerResults();

  tickers.forEach((ticker, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "ticker-option";
    option.id = `ticker-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.innerHTML = `<strong>${ticker.symbol}</strong><small>${ticker.name} · ${ticker.exchange}</small>`;
    option.addEventListener("click", () => {
      applyTickerSelection(ticker);
    });
    tickerResults.append(option);
  });

  showTickerResults();
}

async function searchTickers(query) {
  const response = await fetch(`/api/tickers?query=${encodeURIComponent(query)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Could not search tickers.");
  }

  return payload.tickers;
}

async function handleTickerInput() {
  const query = stockQueryInput.value.trim();
  symbolInput.value = "";
  lastTickerResults = [];
  setSelectedState(false);

  if (query.length < 1) {
    clearTickerResults();
    setStatus("Search for a stock to begin.");
    return;
  }

  setStatus("Searching tickers...");

  try {
    const tickers = await searchTickers(query);
    if (tickers.length === 0) {
      clearTickerResults();
      setStatus("No matching US stock found. Try another ticker or company name.", true);
      return;
    }

    renderTickerResults(tickers);
    setStatus("Select a stock from the list.");
  } catch (error) {
    clearTickerResults();
    setStatus(error.message || "Ticker search failed.", true);
  }
}

async function refreshTickerResultsFromCurrentValue() {
  const rawValue = stockQueryInput.value.trim();
  const query = symbolInput.value || rawValue.split("—")[0].trim() || rawValue;

  if (!query) {
    return;
  }

  try {
    const tickers = await searchTickers(query);
    if (tickers.length === 0) {
      clearTickerResults();
      return;
    }

    renderTickerResults(tickers);
    setStatus("Select a stock from the list.");
  } catch {
    clearTickerResults();
  }
}

/** Source of truth for API calls (kept in sync with the US/India toggle). */
function getAmountCurrency() {
  const el = form.elements.amountCurrency;
  return el && el.value === "inr" ? "inr" : "usd";
}

function setAmountCurrency(value) {
  const el = form.elements.amountCurrency;
  if (el) {
    el.value = value === "inr" ? "inr" : "usd";
  }
}

function buildEstimateRequestBody(symbol, options = {}) {
  const ac = getAmountCurrency();
  const body = {
    monthlyAmount: ac === "inr" ? 100 : 1,
    startDate: form.elements.startDate.value,
    purchaseDay: 1,
    amountCurrency: ac,
    stillHolding: stillHoldingInput.checked,
  };
  const endDate = form.elements.endDate.value;
  if (endDate) {
    body.endDate = endDate;
  }
  if (options.benchmark) {
    body.benchmark = options.benchmark;
  } else {
    body.symbol = symbol;
  }
  return body;
}

function isBenchmarkKey(sym) {
  return BENCHMARK_KEYS.includes(sym);
}

function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchEstimate(symbol, options = {}) {
  const body = buildEstimateRequestBody(symbol, options);
  const response = await fetch("/api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Estimate failed (bad response, status ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(payload.error || "Estimate failed.");
  }
  return payload;
}

/**
 * Legacy path: older server or proxy without POST /api/estimate-batch — one request per symbol,
 * spaced slightly to reduce Yahoo 429s.
 */
async function fetchEstimateBatchFallback(primarySymbol, benchmarkKeys) {
  const primary = await fetchEstimate(primarySymbol, {});
  const benchmarks = {};
  for (let i = 0; i < benchmarkKeys.length; i += 1) {
    if (i > 0) {
      await sleep(250);
    }
    const key = benchmarkKeys[i];
    try {
      benchmarks[key] = await fetchEstimate(key, { benchmark: key });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      benchmarks[key] = { __failed: true, error: msg };
    }
  }
  return { primary, benchmarks };
}

/** One round-trip when supported; falls back if batch route is missing (405) or blocked. */
/** Abort client wait if server never responds (rare). Server-side Yahoo retries should finish first with default FAST_429. */
const ESTIMATE_FETCH_MS = 180_000;

async function fetchEstimateBatch(primarySymbol, benchmarkKeys) {
  const body = buildEstimateRequestBody(primarySymbol, {});
  body.benchmarkKeys = benchmarkKeys;
  const controller = new AbortController();
  const abortTimer = window.setTimeout(() => controller.abort(), ESTIMATE_FETCH_MS);
  let response;
  try {
    response = await fetch("/api/estimate-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(
        `Request timed out after ${ESTIMATE_FETCH_MS / 1000}s. Yahoo may be rate-limiting — wait and retry, or try another network.`,
      );
    }
    throw err;
  } finally {
    window.clearTimeout(abortTimer);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Estimate failed (bad response, status ${response.status}).`);
  }
  if (response.status === 405) {
    return fetchEstimateBatchFallback(primarySymbol, benchmarkKeys);
  }
  if (!response.ok) {
    throw new Error(payload.error || "Estimate failed.");
  }
  return payload;
}

function compareXirrDescending(a, b) {
  if (a.xirr === null && b.xirr === null) {
    return 0;
  }
  if (a.xirr === null) {
    return 1;
  }
  if (b.xirr === null) {
    return -1;
  }
  return b.xirr - a.xirr;
}

function sipCopySnippet() {
  return getAmountCurrency() === "inr" ? "₹100/month" : "$1/month";
}

function renderMetricArticle(label, valueHtml, classes = "") {
  return `
    <article class="metric ${classes}">
      <span class="metric-label">${label}</span>
      <strong class="metric-value">${valueHtml}</strong>
    </article>`;
}

function renderEstimateFailure(message) {
  const text = escapeHtmlText(message);
  resultsRoot.classList.remove("empty");
  resultsRoot.setAttribute("aria-busy", "false");
  resultsRoot.innerHTML = `
    <div class="estimate-error-panel" role="alert">
      <p class="estimate-error-title">Estimate couldn’t finish</p>
      <p class="estimate-error-detail">${text}</p>
    </div>
  `;
}

function renderLoadingResults(benchmarkTableRowCount) {
  resultsRoot.classList.remove("empty");
  resultsRoot.setAttribute("aria-busy", "true");
  const rowCount = Math.max(1, Math.min(benchmarkTableRowCount, 8));
  const heroLabels = ["XIRR", "Value multiple"];
  const secondaryLabels = [
    "Portfolio value",
    "Total invested",
    "Total gain",
    "Average purchase price",
    "Current price",
    "Current total shares",
  ];
  resultsRoot.innerHTML = `
    <section class="benchmark-section benchmark-section--lead benchmark-section--loading" aria-labelledby="benchmark-heading-loading">
      <h3 id="benchmark-heading-loading" class="benchmark-heading">Benchmark comparison</h3>
      <p class="meta benchmark-hint">Same ${sipCopySnippet()} rules where comparable. Sorted by XIRR (highest first).</p>
      <div class="benchmark-table-wrap" role="status" aria-live="polite" aria-busy="true">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">XIRR</th>
              <th scope="col">Value multiple</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: rowCount })
              .map(
                () => `
              <tr class="benchmark-row benchmark-row--skeleton">
                <td><span class="shimmer-block shimmer-block--inline">&nbsp;</span></td>
                <td><span class="shimmer-block shimmer-block--narrow">&nbsp;</span></td>
                <td><span class="shimmer-block shimmer-block--medium">&nbsp;</span></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
    <div class="results-metrics-stack">
      <div class="metrics metrics-hero">
        ${heroLabels
          .map(
            (label) => `
            <article class="metric metric--hero metric--loading">
              <span class="metric-label">${label}</span>
              <strong class="metric-value shimmer-block" aria-hidden="true">&nbsp;</strong>
            </article>`,
          )
          .join("")}
      </div>
      <div class="metrics metrics--secondary">
        ${secondaryLabels
          .map(
            (label) => `
            <article class="metric metric--compact metric--loading">
              <span class="metric-label">${label}</span>
              <strong class="metric-value shimmer-block" aria-hidden="true">&nbsp;</strong>
            </article>`,
          )
          .join("")}
      </div>
    </div>
    <div class="results-footnotes meta-shimmer" aria-hidden="true">
      <span class="shimmer-line shimmer-line--long"></span>
      <span class="shimmer-line shimmer-line--medium"></span>
      <span class="shimmer-line shimmer-line--full"></span>
    </div>
  `;
}

function renderBenchmarkTable(primarySymbol, estimatesBySymbol, userStartMonth, sipHint, benchmarkErrors = {}) {
  const sipLabel = sipHint ?? sipCopySnippet();
  const primaryNorm = normaliseSymbolClient(primarySymbol);
  const { comparableBenchmarks, lateBenchmarks } = partitionBenchmarksBySipStart(userStartMonth);

  const topSymbols = [...new Set([...comparableBenchmarks, primaryNorm])];
  const topRows = topSymbols.map((sym) => {
    const payload = estimatesBySymbol[sym];
    return {
      symbol: sym,
      payload,
      xirr: payload?.xirr ?? null,
    };
  });
  topRows.sort(compareXirrDescending);

  const lateRowsToShow = lateBenchmarks.filter(({ benchmarkKey }) => benchmarkKey !== primaryNorm);

  const topHtml = topRows
    .map((row) => {
      const isSelected = row.symbol === primaryNorm;
      const selectedClass = isSelected ? " benchmark-row--selected" : "";
      if (!row.payload) {
        const nameHtml = isBenchmarkKey(row.symbol)
          ? labelForBenchmarkKey(row.symbol)
          : escapeHtmlText(row.symbol);
        const hint = benchmarkErrors[row.symbol]
          ? `<span class="benchmark-error-hint">${escapeHtmlText(benchmarkErrors[row.symbol])}</span>`
          : "Unavailable for this window (missing estimate).";
        return `
              <tr class="benchmark-row benchmark-row--missing${selectedClass}">
                <td><strong>${nameHtml}</strong>${isSelected ? ' <span class="benchmark-you">Your pick</span>' : ""}</td>
                <td colspan="2" class="benchmark-unavailable">${hint}</td>
              </tr>`;
      }
      const { payload } = row;
      const multiple =
        payload.investedMultiple === null ? "N/A" : `${number(payload.investedMultiple, 2)}x`;
      return `
              <tr class="benchmark-row${selectedClass}">
                <td><strong>${payload.symbol}</strong>${isSelected ? ' <span class="benchmark-you">Your pick</span>' : ""}</td>
                <td>${percent(payload.xirr)}</td>
                <td>${multiple}</td>
              </tr>`;
    })
    .join("");

  const lateHtml = lateRowsToShow
    .map(
      ({ label }) => `
              <tr class="benchmark-row benchmark-row--not-in-period">
                <td><strong>${label}</strong></td>
                <td colspan="2" class="benchmark-period-unavailable">Unavailable in that period</td>
              </tr>`,
    )
    .join("");

  return `
    <section class="benchmark-section benchmark-section--lead" aria-labelledby="benchmark-heading">
      <h3 id="benchmark-heading" class="benchmark-heading">Benchmark comparison</h3>
      <p class="meta benchmark-hint">Same ${sipLabel} rules where comparable. Sorted by XIRR (highest first).</p>
      <div class="benchmark-table-wrap">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">XIRR</th>
              <th scope="col">Value multiple</th>
            </tr>
          </thead>
          <tbody>
            ${topHtml}
            ${lateHtml}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderResults(payload, estimatesBySymbol, benchmarkContext) {
  const isInr = payload.currency === "INR";
  const fmt = isInr ? currencyInr : currency;
  const averagePurchasePrice =
    payload.totalShares > 0 ? payload.totalInvested / payload.totalShares : null;
  const currentPriceHtml =
    isInr && payload.latestPriceUsd != null
      ? `${fmt(payload.latestPriceInr ?? payload.latestPrice)}<span class="price-usd-sub">${currency(payload.latestPriceUsd)} per share (US listing)</span>`
      : fmt(payload.latestPrice);
  const primaryMetrics = [
    ["XIRR", percent(payload.xirr)],
    ["Value multiple", payload.investedMultiple === null ? "N/A" : `${number(payload.investedMultiple, 2)}x`],
  ];
  const secondaryMetrics = [
    ["Portfolio value", fmt(payload.portfolioValue)],
    ["Total invested", fmt(payload.totalInvested)],
    ["Total gain", `${fmt(payload.gain)} (${percent(payload.gainPercent)})`],
    ["Average purchase price", averagePurchasePrice === null ? "N/A" : fmt(averagePurchasePrice)],
    ["Current price", currentPriceHtml],
    ["Current total shares", number(payload.totalShares, 6)],
  ];
  const adjustedStartNotice = payload.dataRange.adjustedForListing
    ? `<p class="notice">Requested start month was ${payload.dataRange.requestedStartDate}, but ${
        payload.symbol
      } only has market data from ${payload.dataRange.firstAvailableDate}. Investments were started from ${
        payload.dataRange.effectiveStartMonth
      } instead.</p>`
    : "";
  const sipWindow =
    payload.dataRange.effectiveEndMonth === null
      ? `${payload.dataRange.effectiveStartMonth} through ${payload.dataRange.valuationDate}`
      : `${payload.dataRange.effectiveStartMonth} through ${payload.dataRange.effectiveEndMonth}`;
  const valuationSummary = payload.dataRange.stillHolding
    ? `Portfolio valued using the latest market date: ${payload.dataRange.valuationDate}.`
    : `Returns shown as of ${payload.dataRange.valuationDate}, assuming the position was no longer held after the SIP end date.`;
  const metricsFootnote = isInr ? METRICS_FOOTNOTE_INR : payload.metricsNote;

  resultsRoot.classList.remove("empty");
  resultsRoot.setAttribute("aria-busy", "false");
  resultsRoot.innerHTML = `
    ${adjustedStartNotice}
    ${renderBenchmarkTable(
      payload.symbol,
      estimatesBySymbol,
      benchmarkContext.userStartMonth,
      payload.currency === "INR" ? "₹100/month" : "$1/month",
      benchmarkContext.benchmarkErrors ?? {},
    )}
    <div class="results-metrics-stack">
      <div class="metrics metrics-hero">
        ${primaryMetrics.map(([label, value]) => renderMetricArticle(label, value, "metric--hero")).join("")}
      </div>
      <div class="metrics metrics--secondary">
        ${secondaryMetrics
          .map(([label, value]) => renderMetricArticle(label, value, "metric--compact"))
          .join("")}
      </div>
    </div>
    <div class="results-footnotes">
      <p class="meta meta--footnote">
        ${payload.symbol} SIP contributions ran from ${sipWindow}.
      </p>
      <p class="meta meta--footnote">${valuationSummary}</p>
      <p class="meta meta--footnote">${metricsFootnote}</p>
    </div>
  `;
}

function syncHoldingField() {
  const hasEndDate = Boolean(endDateInput.value.trim());
  holdingField.toggleAttribute("hidden", !hasEndDate);
  holdingField.setAttribute("aria-hidden", hasEndDate ? "false" : "true");

  if (!hasEndDate) {
    stillHoldingInput.checked = true;
  }

  holdingState.textContent = stillHoldingInput.checked ? "Still holding" : "Sold at end";
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!symbolInput.value) {
    const raw = stockQueryInput.value.trim().toUpperCase();
    const inferredSymbol = raw.split(/[^A-Z.\-]/)[0];
    const exactResult = lastTickerResults.find((ticker) => ticker.symbol === inferredSymbol);

    if (exactResult) {
      symbolInput.value = exactResult.symbol;
      stockQueryInput.value = `${exactResult.symbol} — ${exactResult.name}`;
    }
  }

  if (!symbolInput.value) {
    setStatus("Please select a stock from the search results first.", true);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Calculating...";

  const primarySymbol = normaliseSymbolClient(symbolInput.value);
  const userStartMonth = form.elements.startDate.value;
  const { comparableBenchmarks, lateBenchmarks } = partitionBenchmarksBySipStart(userStartMonth);
  const benchmarkTableRows = new Set([
    primarySymbol,
    ...comparableBenchmarks,
    ...lateBenchmarks.map((b) => b.benchmarkKey),
  ]).size;
  renderLoadingResults(benchmarkTableRows);
  setStatus("Fetching data from Yahoo Finance…");
  renderProgressState("fetching");

  try {
    const fetchStartedAt = Date.now();
    const tick = window.setInterval(() => {
      const s = Math.floor((Date.now() - fetchStartedAt) / 1000);
      if (s >= 8) {
        setStatus(
          `Fetching data from Yahoo Finance… (${s}s) — large requests can take 1–3 min if Yahoo is rate-limiting.`,
        );
      }
    }, 4000);
    let batch;
    try {
      batch = await fetchEstimateBatch(primarySymbol, comparableBenchmarks);
    } finally {
      window.clearInterval(tick);
    }
    await waitForMinimum(fetchStartedAt, 400);
    setStatus("Calculating returns…");
    renderProgressState("calculating");

    await sleep(350);

    const estimatesBySymbol = { [primarySymbol]: batch.primary };
    const benchmarkErrors = {};
    for (const key of comparableBenchmarks) {
      const v = batch.benchmarks[key];
      if (v && v.__failed) {
        benchmarkErrors[key] = v.error;
      } else if (v) {
        estimatesBySymbol[key] = v;
      }
    }

    const primaryPayload = batch.primary;

    if (!primaryPayload) {
      throw new Error("Estimate failed.");
    }

    renderProgressState("done");
    localStorage.removeItem(LS_ESTIMATE_FAIL_AT);
    renderResults(primaryPayload, estimatesBySymbol, { userStartMonth, benchmarkErrors });
    setStatus(`Done. Estimate ready for ${primaryPayload.symbol}.`);
    void refreshAppHealth();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    localStorage.setItem(LS_ESTIMATE_FAIL_AT, String(Date.now()));
    renderProgressState("error");
    renderEstimateFailure(msg);
    setStatus(msg, true);
    void refreshAppHealth();
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Estimate Portfolio Value";
  }
}

stockQueryInput.addEventListener("input", () => {
  clearTimeout(tickerSearchTimeout);
  tickerSearchTimeout = setTimeout(handleTickerInput, 250);
});

stockQueryInput.addEventListener("focus", () => {
  if (symbolInput.value) {
    stockQueryInput.select();
    void refreshTickerResultsFromCurrentValue();
  } else if (lastTickerResults.length > 0) {
    showTickerResults();
  }
});

stockQueryInput.addEventListener("click", () => {
  if (symbolInput.value) {
    stockQueryInput.select();
  }
});

stockQueryInput.addEventListener("keydown", (event) => {
  if (!tickerResults.classList.contains("open")) {
    if (event.key === "ArrowDown" && lastTickerResults.length > 0) {
      showTickerResults();
      updateActiveTicker(0);
      event.preventDefault();
    }
    return;
  }

  if (event.key === "ArrowDown") {
    const nextIndex = Math.min(activeTickerIndex + 1, lastTickerResults.length - 1);
    updateActiveTicker(nextIndex);
    event.preventDefault();
    return;
  }

  if (event.key === "ArrowUp") {
    const nextIndex = Math.max(activeTickerIndex - 1, 0);
    updateActiveTicker(nextIndex);
    event.preventDefault();
    return;
  }

  if (event.key === "Enter" && activeTickerIndex >= 0) {
    applyTickerSelection(lastTickerResults[activeTickerIndex]);
    event.preventDefault();
    return;
  }

  if (event.key === "Escape") {
    clearTickerResults();
    event.preventDefault();
  }
});

document.addEventListener("click", (event) => {
  if (!tickerResults.contains(event.target) && event.target !== stockQueryInput) {
    clearTickerResults();
  }
});

form.addEventListener("submit", handleSubmit);
endDateInput.addEventListener("input", syncHoldingField);
endDateInput.addEventListener("change", syncHoldingField);
stillHoldingInput.addEventListener("change", syncHoldingField);
function updateInvestorCopy(mode) {
  const isIn = mode === "in";
  calculatorIntro.textContent = isIn
    ? "Search a ticker, choose the SIP window (from Jan 1990 onward). India mode assumes ₹100/month SIP and shows headline metrics in INR (same US listings)."
    : "Search a ticker, choose the SIP window (from Jan 1990 onward). US mode assumes a $1/month SIP.";
  const emptyEl = document.querySelector("#results-empty-copy");
  if (emptyEl) {
    emptyEl.textContent = isIn
      ? "Run the estimator to see portfolio value in rupees, XIRR on INR cash flows, and per-share values (INR primary, USD in smaller text)."
      : "Run the estimator to see portfolio value, XIRR, average cost, current price, and share count for your monthly SIP.";
  }
}

/** Fresh calculator + empty results (used on load and when switching US ↔ India). */
function resetToCleanView(mode) {
  const isIn = mode === "in";
  clearTickerResults();
  lastTickerResults = [];
  stockQueryInput.value = DEFAULT_STOCK_DISPLAY;
  symbolInput.value = DEFAULT_STOCK_SYMBOL;
  setSelectedState(true);
  form.elements.startDate.value = DEFAULT_SIP_START_MONTH;
  endDateInput.value = "";
  stillHoldingInput.checked = true;
  syncHoldingField();

  resultsRoot.classList.add("empty");
  resultsRoot.setAttribute("aria-busy", "false");
  resultsRoot.innerHTML = '<p class="empty-state" id="results-empty-copy"></p>';

  updateInvestorCopy(isIn ? "in" : "us");
  renderProgressState("idle");
  setStatus(`Selected ${DEFAULT_STOCK_SYMBOL}. Ready to estimate.`);
  submitButton.disabled = false;
  submitButton.textContent = "Estimate Portfolio Value";

  lastInvestorMode = isIn ? "in" : "us";
}

function applyInvestorModeFromToggle(mode) {
  const next = mode === "in" ? "in" : "us";
  if (lastInvestorMode === next) {
    return;
  }
  localStorage.setItem(INVESTOR_STORAGE_KEY, next === "in" ? "in" : "us");
  investorUsBtn.setAttribute("aria-pressed", String(next === "us"));
  investorInBtn.setAttribute("aria-pressed", String(next === "in"));
  setAmountCurrency(next === "in" ? "inr" : "usd");
  resetToCleanView(next);
}

function initInvestorMode() {
  const mode = localStorage.getItem(INVESTOR_STORAGE_KEY) === "in" ? "in" : "us";
  investorUsBtn.setAttribute("aria-pressed", String(mode === "us"));
  investorInBtn.setAttribute("aria-pressed", String(mode === "in"));
  setAmountCurrency(mode === "in" ? "inr" : "usd");
  resetToCleanView(mode);
}

investorUsBtn.addEventListener("click", () => {
  applyInvestorModeFromToggle("us");
});

investorInBtn.addEventListener("click", () => {
  applyInvestorModeFromToggle("in");
});

initInvestorMode();
syncHoldingField();
renderProgressState("idle");

window.addEventListener("online", () => {
  void refreshAppHealth();
});
window.addEventListener("offline", () => {
  setAppStatus(
    "offline",
    "You’re offline. Connect to the internet to load stock prices and run estimates.",
  );
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && navigator.onLine) {
    void refreshAppHealth();
  }
});

void refreshAppHealth();
window.setInterval(() => {
  if (navigator.onLine) {
    void refreshAppHealth();
  }
}, HEALTH_POLL_MS);
