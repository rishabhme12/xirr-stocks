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

function renderResults(payload) {
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
  `;
}

function syncHoldingField() {
  const hasEndDate = Boolean(endDateInput.value);
  holdingField.hidden = !hasEndDate;

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

  const params = new URLSearchParams({
    symbol: symbolInput.value,
    monthlyAmount: "1",
    startDate: form.elements.startDate.value,
    purchaseDay: "1",
  });
  const endDate = form.elements.endDate.value;

  if (endDate) {
    params.set("endDate", endDate);
    params.set("stillHolding", String(stillHoldingInput.checked));
  }

  submitButton.disabled = true;
  submitButton.textContent = "Calculating...";
  setStatus("Fetching data from Yahoo Finance...");
  renderProgressState("fetching");

  try {
    const fetchStartedAt = Date.now();
    const response = await fetch(`/api/estimate?${params.toString()}`);
    await waitForMinimum(fetchStartedAt, 900);
    setStatus("Calculating returns...");
    renderProgressState("calculating");

    const payload = await response.json();
    await sleep(650);

    if (!response.ok) {
      throw new Error(payload.error || "Estimate failed.");
    }

    renderProgressState("done");
    renderResults(payload);
    setStatus(`Done. Estimate ready for ${payload.symbol}.`);
  } catch (error) {
    renderProgressState("error");
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
stillHoldingInput.addEventListener("change", syncHoldingField);
syncHoldingField();
renderProgressState("idle");
