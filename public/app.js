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

/** ETF inception as first month (YYYY-MM) for overlap with the SIP window. */
const BENCHMARK_ETFS = [
  { symbol: "SPY", inception: "1993-01" },
  { symbol: "QQQ", inception: "1999-03" },
  { symbol: "GLD", inception: "2004-11" },
  { symbol: "SLV", inception: "2006-04" },
];

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

/** Split ETFs that existed by SIP start vs listed later (no comparable full-window metrics). */
function partitionBenchmarksBySipStart(userStartMonth) {
  const comparableBenchmarks = [];
  const lateBenchmarks = [];
  for (const { symbol, inception } of BENCHMARK_ETFS) {
    if (inception > userStartMonth) {
      lateBenchmarks.push({ symbol, inception });
    } else {
      comparableBenchmarks.push(symbol);
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

function buildEstimateSearchParams(symbol) {
  const params = new URLSearchParams({
    symbol,
    monthlyAmount: "1",
    startDate: form.elements.startDate.value,
    purchaseDay: "1",
  });
  const endDate = form.elements.endDate.value;
  if (endDate) {
    params.set("endDate", endDate);
    params.set("stillHolding", String(stillHoldingInput.checked));
  }
  return params;
}

async function fetchEstimate(symbol) {
  const params = buildEstimateSearchParams(symbol);
  const response = await fetch(`/api/estimate?${params.toString()}`);
  const payload = await response.json();
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

function renderLoadingResults(benchmarkTableRowCount) {
  resultsRoot.classList.remove("empty");
  resultsRoot.setAttribute("aria-busy", "true");
  const rowCount = Math.max(1, Math.min(benchmarkTableRowCount, 8));
  const metricLabels = [
    "Portfolio value",
    "Total invested",
    "Total gain",
    "Average purchase price",
    "Current price",
    "Current total shares",
    "XIRR",
    "Value multiple",
  ];
  resultsRoot.innerHTML = `
    <div class="metrics">
      ${metricLabels
        .map(
          (label) => `
            <article class="metric metric--loading">
              <span class="metric-label">${label}</span>
              <strong class="metric-value shimmer-block" aria-hidden="true">&nbsp;</strong>
            </article>`,
        )
        .join("")}
    </div>
    <div class="meta-shimmer" aria-hidden="true">
      <span class="shimmer-line shimmer-line--long"></span>
      <span class="shimmer-line shimmer-line--medium"></span>
      <span class="shimmer-line shimmer-line--full"></span>
    </div>
    <section class="benchmark-section benchmark-section--loading" aria-labelledby="benchmark-heading-loading">
      <h3 id="benchmark-heading-loading" class="benchmark-heading">Benchmark comparison</h3>
      <p class="meta benchmark-hint">Same $1/month rules where comparable. Sorted by XIRR (highest first).</p>
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
  `;
}

function renderBenchmarkTable(primarySymbol, estimatesBySymbol, userStartMonth) {
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

  const lateRowsToShow = lateBenchmarks.filter(({ symbol }) => symbol !== primaryNorm);

  const topHtml = topRows
    .map((row) => {
      const isSelected = row.symbol === primaryNorm;
      const selectedClass = isSelected ? " benchmark-row--selected" : "";
      if (!row.payload) {
        return `
              <tr class="benchmark-row benchmark-row--missing${selectedClass}">
                <td><strong>${row.symbol}</strong>${isSelected ? ' <span class="benchmark-you">Your pick</span>' : ""}</td>
                <td colspan="2" class="benchmark-unavailable">Unavailable for this window</td>
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
      ({ symbol }) => `
              <tr class="benchmark-row benchmark-row--not-in-period">
                <td><strong>${symbol}</strong></td>
                <td colspan="2" class="benchmark-period-unavailable">Unavailable in that period</td>
              </tr>`,
    )
    .join("");

  return `
    <section class="benchmark-section" aria-labelledby="benchmark-heading">
      <h3 id="benchmark-heading" class="benchmark-heading">Benchmark comparison</h3>
      <p class="meta benchmark-hint">Same $1/month rules where comparable. Sorted by XIRR (highest first).</p>
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
  const averagePurchasePrice =
    payload.totalShares > 0 ? payload.totalInvested / payload.totalShares : null;
  const metrics = [
    ["Portfolio value", currency(payload.portfolioValue)],
    ["Total invested", currency(payload.totalInvested)],
    ["Total gain", `${currency(payload.gain)} (${percent(payload.gainPercent)})`],
    ["Average purchase price", averagePurchasePrice === null ? "N/A" : currency(averagePurchasePrice)],
    ["Current price", currency(payload.latestPrice)],
    ["Current total shares", number(payload.totalShares, 6)],
    ["XIRR", percent(payload.xirr)],
    ["Value multiple", payload.investedMultiple === null ? "N/A" : `${number(payload.investedMultiple, 2)}x`],
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

  resultsRoot.classList.remove("empty");
  resultsRoot.setAttribute("aria-busy", "false");
  resultsRoot.innerHTML = `
    ${adjustedStartNotice}
    <div class="metrics">
      ${metrics
        .map(
          ([label, value]) => `
            <article class="metric">
              <span class="metric-label">${label}</span>
              <strong class="metric-value">${value}</strong>
            </article>`,
        )
        .join("")}
    </div>
    <p class="meta">
      ${payload.symbol} SIP contributions ran from ${sipWindow}.
    </p>
    <p class="meta">${valuationSummary}</p>
    <p class="meta">${payload.metricsNote}</p>
    ${renderBenchmarkTable(payload.symbol, estimatesBySymbol, benchmarkContext.userStartMonth)}
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
    ...lateBenchmarks.map((b) => b.symbol),
  ]).size;
  renderLoadingResults(benchmarkTableRows);
  setStatus("Fetching data from Yahoo Finance...");
  renderProgressState("fetching");

  const symbolsToFetch = [...new Set([primarySymbol, ...comparableBenchmarks])];

  try {
    const fetchStartedAt = Date.now();
    const settled = await Promise.allSettled(symbolsToFetch.map((sym) => fetchEstimate(sym)));
    await waitForMinimum(fetchStartedAt, 900);
    setStatus("Calculating returns...");
    renderProgressState("calculating");

    await sleep(650);

    const estimatesBySymbol = {};
    for (let index = 0; index < symbolsToFetch.length; index += 1) {
      const sym = symbolsToFetch[index];
      const result = settled[index];
      if (result.status === "fulfilled") {
        estimatesBySymbol[normaliseSymbolClient(result.value.symbol)] = result.value;
      }
    }

    const primaryPayload = estimatesBySymbol[primarySymbol];
    const primarySettled = settled[symbolsToFetch.indexOf(primarySymbol)];

    if (!primaryPayload) {
      const reason =
        primarySettled && primarySettled.status === "rejected"
          ? primarySettled.reason
          : new Error("Estimate failed.");
      throw reason instanceof Error ? reason : new Error(String(reason));
    }

    renderProgressState("done");
    renderResults(primaryPayload, estimatesBySymbol, { userStartMonth });
    setStatus(`Done. Estimate ready for ${primaryPayload.symbol}.`);
  } catch (error) {
    renderProgressState("error");
    resultsRoot.setAttribute("aria-busy", "false");
    resultsRoot.classList.add("empty");
    resultsRoot.innerHTML =
      '<p class="empty-state">Estimate could not be completed. Check the message below and try again.</p>';
    setStatus(error.message || "Estimate failed.", true);
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
syncHoldingField();
renderProgressState("idle");
