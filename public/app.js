const form = document.querySelector("#estimator-form");
const stockQueryInput = document.querySelector("#stock-query");
const symbolInput = document.querySelector("#symbol");
const tickerResults = document.querySelector("#ticker-results");
const resultsRoot = document.querySelector("#results");
const resultsPanel = document.querySelector("#results-panel");
const progressBanner = document.querySelector("#progress-banner");
const progressMessage = document.querySelector("#progress-message");
const progressFill = document.querySelector("#progress-fill");
const statusNode = document.querySelector("#status");
const endDateInput = document.querySelector("#end-date");
const startDateDisplay = document.querySelector("#start-date-display");
const startDateCalendarBtn = document.querySelector("#start-date-calendar");
const startMonthSheet = document.querySelector("#start-month-sheet");
const endDateDisplay = document.querySelector("#end-date-display");
const endDateCalendarBtn = document.querySelector("#end-date-calendar");
const endMonthSheet = document.querySelector("#end-month-sheet");
const holdingField = document.querySelector("#holding-field");
const stillHoldingInput = document.querySelector("#still-holding");
const holdingState = document.querySelector("#holding-state");
const submitButton = form.querySelector('button[type="submit"]');
const calculatorIntro = document.querySelector("#calculator-intro");
const investorUsBtn = document.querySelector("#investor-us");
const investorInBtn = document.querySelector("#investor-in");

const investorCurrencyWrap = document.querySelector("#investor-currency-wrap");
const stockQueryClear = document.querySelector("#stock-query-clear");

const INVESTOR_STORAGE_KEY = "investorMode";
const MARKET_STORAGE_KEY = "xirr_market";

/** US market default listing. */
const DEFAULT_STOCK_SYMBOL = "INTC";
const DEFAULT_STOCK_DISPLAY = "INTC — Intel Corp";
const DEFAULT_SIP_START_MONTH = "1999-12";
/** India market default (NSE, Yahoo). */
const DEFAULT_IN_STOCK_SYMBOL = "FEDERALBNK.NS";
const DEFAULT_IN_STOCK_DISPLAY = "FEDERALBNK.NS — The Federal Bank Limited";
const DEFAULT_IN_SIP_START_MONTH = "2010-01";

/** Matches server `MIN_SIP_START_MONTH` — month-only SIP uses YYYY-MM in the API. */
const MIN_SIP_MONTH = "1990-01";
const MAX_SIP_MONTH = "2100-12";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isYmInAllowedRange(ym) {
  return ym >= MIN_SIP_MONTH && ym <= MAX_SIP_MONTH;
}

/** Last decade includes 2090–2100 (product max year). */
function decadeEndYear(decadeStart) {
  return decadeStart === 2090 ? 2100 : decadeStart + 9;
}

function yearsInDecade(decadeStart) {
  const y0 = Math.max(1990, decadeStart);
  const y1 = decadeEndYear(decadeStart);
  const years = [];
  for (let y = y0; y <= y1; y += 1) {
    years.push(y);
  }
  return years;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** SIP is month-based; show month + year only (no day in the field). */
function formatYmAsMmYyyy(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return "";
  }
  const [y, mo] = ym.split("-");
  return `${pad2(Number(mo))}/${y}`;
}

/**
 * Parse mm/yyyy into YYYY-MM. Also accepts legacy dd/mm/yyyy (uses calendar month only).
 * @returns {string | null}
 */
function parseSipMonthDisplayToYm(text) {
  const raw = String(text).trim();
  if (!raw) {
    return null;
  }
  const my = /^(\d{1,2})\/(\d{4})$/.exec(raw);
  if (my) {
    const mo = Number(my[1]);
    const y = Number(my[2]);
    if (mo < 1 || mo > 12) {
      return null;
    }
    const ym = `${y}-${pad2(mo)}`;
    return isYmInAllowedRange(ym) ? ym : null;
  }
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) {
      return null;
    }
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
      return null;
    }
    const ym = `${y}-${pad2(mo)}`;
    return isYmInAllowedRange(ym) ? ym : null;
  }
  return null;
}

function formatMmYyyyDigitsOnly(digits) {
  const d = String(digits).replace(/\D/g, "").slice(0, 6);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

function caretAfterNthMmYyyyDigit(formatted, digitCount) {
  if (digitCount <= 0) {
    return 0;
  }
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/\d/.test(formatted[i])) {
      seen += 1;
      if (seen === digitCount) {
        return i + 1;
      }
    }
  }
  return formatted.length;
}

/**
 * Keep input to digits + auto-insert `/` after the month (max 6 digits → mm/yyyy).
 * Block extra digits; select all on focus/click for quick replace.
 */
function attachMmYyyyInputBehavior(inputEl) {
  inputEl.addEventListener("input", () => {
    const digits = inputEl.value.replace(/\D/g, "").slice(0, 6);
    const newVal = formatMmYyyyDigitsOnly(digits);
    inputEl.value = newVal;
    const pos = caretAfterNthMmYyyyDigit(newVal, digits.length);
    inputEl.setSelectionRange(pos, pos);
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      inputEl.blur();
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const nav = [
      "Backspace",
      "Delete",
      "Tab",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ];
    if (nav.includes(event.key)) {
      return;
    }
    const digitsNow = inputEl.value.replace(/\D/g, "");
    /** Block 7th digit only when caret has no selection — if all text is selected, we're replacing, not appending. */
    if (/^[0-9]$/.test(event.key) && digitsNow.length >= 6) {
      const selStart = inputEl.selectionStart ?? 0;
      const selEnd = inputEl.selectionEnd ?? 0;
      if (selStart === selEnd) {
        event.preventDefault();
        return;
      }
    }
    if (event.key.length === 1 && !/[0-9]/.test(event.key)) {
      event.preventDefault();
    }
  });

  function selectAllMmYyyy() {
    const len = inputEl.value.length;
    if (len > 0) {
      inputEl.setSelectionRange(0, len);
    }
  }

  /** Clicks from outside used to place the caret before rAF/select, so the first digit appended. */
  inputEl.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (document.activeElement !== inputEl) {
      event.preventDefault();
      inputEl.focus({ preventScroll: true });
      selectAllMmYyyy();
    }
  });

  inputEl.addEventListener("focus", () => {
    selectAllMmYyyy();
  });
}

function setMonthDateFieldFromYm(hiddenInput, displayInput, ym) {
  hiddenInput.value = ym || "";
  if (ym) {
    displayInput.value = formatYmAsMmYyyy(ym);
  } else {
    displayInput.value = "";
  }
  displayInput.classList.remove("date-field__text--invalid");
  displayInput.removeAttribute("aria-invalid");
}

let monthSheetOutsideHandlersBound = false;

function closeAllMonthSheets() {
  document.querySelectorAll(".month-sheet").forEach((el) => {
    el.hidden = true;
  });
  document.querySelectorAll(".date-field__calendar").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
  });
}

function ensureMonthSheetGlobalHandlers() {
  if (monthSheetOutsideHandlersBound) {
    return;
  }
  monthSheetOutsideHandlersBound = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest(".date-field")) {
      return;
    }
    closeAllMonthSheets();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    closeAllMonthSheets();
  });
}

function wireMonthDateField({ hiddenInput, displayInput, calendarBtn, optional, sheetRoot, defaultViewYear }) {
  ensureMonthSheetGlobalHandlers();

  const monthsView = sheetRoot.querySelector(".month-sheet__view--months");
  const yearsView = sheetRoot.querySelector(".month-sheet__view--years");
  const grid = monthsView.querySelector(".month-sheet__grid");
  const prevY = monthsView.querySelector(".month-sheet__prev-y");
  const nextY = monthsView.querySelector(".month-sheet__next-y");
  const yearJumpBtn = monthsView.querySelector(".month-sheet__year-jump");
  const yearJumpNum = monthsView.querySelector(".month-sheet__year-jump-num");
  const yearBackBtn = yearsView.querySelector(".month-sheet__year-back");
  const decadePrev = yearsView.querySelector(".month-sheet__decade-prev");
  const decadeNext = yearsView.querySelector(".month-sheet__decade-next");
  const decadeLabel = yearsView.querySelector(".month-sheet__decade-label");
  const yearPickGrid = yearsView.querySelector(".month-sheet__year-pick-grid");
  const clearBtn = sheetRoot.querySelector(".month-sheet__clear");
  const thisMonthBtn = sheetRoot.querySelector(".month-sheet__this-month");
  const closeSheetBtn = sheetRoot.querySelector(".month-sheet__close-sheet");

  let viewYear = 1999;
  let decadeStart = 1990;

  function yearFromCurrentValue() {
    const v = hiddenInput.value;
    if (/^\d{4}-\d{2}$/.test(v)) {
      return Number(v.slice(0, 4));
    }
    return defaultViewYear();
  }

  function renderMonthGrid() {
    grid.innerHTML = "";
    const selectedYm = hiddenInput.value;
    for (let m = 1; m <= 12; m += 1) {
      const ym = `${viewYear}-${pad2(m)}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "month-sheet__mo";
      btn.textContent = MONTH_SHORT[m - 1];
      if (!isYmInAllowedRange(ym)) {
        btn.disabled = true;
      }
      if (ym === selectedYm) {
        btn.classList.add("month-sheet__mo--selected");
      }
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hiddenInput.value = ym;
        displayInput.value = formatYmAsMmYyyy(ym);
        displayInput.classList.remove("date-field__text--invalid");
        displayInput.removeAttribute("aria-invalid");
        sheetRoot.hidden = true;
        calendarBtn.setAttribute("aria-expanded", "false");
        if (optional) {
          syncHoldingField();
        }
      });
      grid.append(btn);
    }
    if (yearJumpNum) {
      yearJumpNum.textContent = String(viewYear);
    }
    if (yearJumpBtn) {
      yearJumpBtn.setAttribute("aria-label", `Choose year (${viewYear})`);
    }
    prevY.disabled = viewYear <= 1990;
    nextY.disabled = viewYear >= 2100;
  }

  function showMonthsSubView() {
    monthsView.hidden = false;
    yearsView.hidden = true;
  }

  function renderYearPickGrid() {
    const y0 = Math.max(1990, decadeStart);
    const y1 = decadeEndYear(decadeStart);
    decadeLabel.textContent = `${y0} – ${y1}`;
    decadePrev.disabled = decadeStart <= 1990;
    decadeNext.disabled = decadeStart >= 2090;
    yearPickGrid.innerHTML = "";
    const years = yearsInDecade(decadeStart);
    for (const y of years) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "month-sheet__year-cell";
      cell.textContent = String(y);
      if (y === viewYear) {
        cell.classList.add("month-sheet__year-cell--current");
      }
      cell.addEventListener("click", (ev) => {
        ev.stopPropagation();
        viewYear = y;
        showMonthsSubView();
        renderMonthGrid();
      });
      yearPickGrid.append(cell);
    }
  }

  function showYearsSubView() {
    decadeStart = Math.min(2090, Math.max(1990, Math.floor(viewYear / 10) * 10));
    monthsView.hidden = true;
    yearsView.hidden = false;
    renderYearPickGrid();
  }

  function openSheet() {
    closeAllMonthSheets();
    viewYear = Math.max(1990, Math.min(2100, yearFromCurrentValue()));
    showMonthsSubView();
    renderMonthGrid();
    sheetRoot.hidden = false;
    calendarBtn.setAttribute("aria-expanded", "true");
    if (thisMonthBtn) {
      const d = new Date();
      const ymNow = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      thisMonthBtn.disabled = !isYmInAllowedRange(ymNow);
    }
  }

  function closeSheet() {
    sheetRoot.hidden = true;
    showMonthsSubView();
    calendarBtn.setAttribute("aria-expanded", "false");
  }

  const restoreAfterInvalid = () => {
    if (hiddenInput.value) {
      displayInput.value = formatYmAsMmYyyy(hiddenInput.value);
    } else {
      displayInput.value = "";
    }
    displayInput.classList.remove("date-field__text--invalid");
    displayInput.removeAttribute("aria-invalid");
  };

  const commitFromText = () => {
    const raw = displayInput.value.trim();
    if (optional && raw === "") {
      hiddenInput.value = "";
      displayInput.classList.remove("date-field__text--invalid");
      displayInput.removeAttribute("aria-invalid");
      syncHoldingField();
      return true;
    }
    const ym = parseSipMonthDisplayToYm(raw);
    if (!ym) {
      displayInput.classList.add("date-field__text--invalid");
      displayInput.setAttribute("aria-invalid", "true");
      return false;
    }
    hiddenInput.value = ym;
    displayInput.value = formatYmAsMmYyyy(ym);
    displayInput.classList.remove("date-field__text--invalid");
    displayInput.removeAttribute("aria-invalid");
    if (optional) {
      syncHoldingField();
    }
    return true;
  };

  displayInput.addEventListener("blur", () => {
    const ok = commitFromText();
    if (!ok) {
      restoreAfterInvalid();
    }
  });

  attachMmYyyyInputBehavior(displayInput);

  calendarBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!sheetRoot.hidden) {
      closeSheet();
      return;
    }
    openSheet();
  });

  prevY.addEventListener("click", (event) => {
    event.stopPropagation();
    if (viewYear > 1990) {
      viewYear -= 1;
      renderMonthGrid();
    }
  });

  nextY.addEventListener("click", (event) => {
    event.stopPropagation();
    if (viewYear < 2100) {
      viewYear += 1;
      renderMonthGrid();
    }
  });

  if (yearJumpBtn) {
    yearJumpBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showYearsSubView();
    });
  }

  if (yearBackBtn) {
    yearBackBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showMonthsSubView();
    });
  }

  decadePrev.addEventListener("click", (event) => {
    event.stopPropagation();
    if (decadeStart > 1990) {
      decadeStart -= 10;
      renderYearPickGrid();
    }
  });

  decadeNext.addEventListener("click", (event) => {
    event.stopPropagation();
    if (decadeStart < 2090) {
      decadeStart += 10;
      renderYearPickGrid();
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      hiddenInput.value = "";
      displayInput.value = "";
      closeSheet();
      syncHoldingField();
    });
  }

  if (thisMonthBtn) {
    thisMonthBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const d = new Date();
      const ym = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      if (!isYmInAllowedRange(ym)) {
        return;
      }
      hiddenInput.value = ym;
      displayInput.value = formatYmAsMmYyyy(ym);
      displayInput.classList.remove("date-field__text--invalid");
      displayInput.removeAttribute("aria-invalid");
      closeSheet();
      syncHoldingField();
    });
  }

  if (closeSheetBtn) {
    closeSheetBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeSheet();
    });
  }

  sheetRoot.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!yearsView.hidden) {
      event.preventDefault();
      event.stopPropagation();
      showMonthsSubView();
    }
  });
}

/** INR results: user-facing copy only; FX/EXINUS details are not shown here. */
const METRICS_FOOTNOTE_INR =
  "XIRR is computed on INR cash flows (constant monthly SIP in rupees).";

/** Tracks last applied mode so toggling to the same side does not wipe the form. */
let lastInvestorMode = null;

/** Benchmark keys (server: monthly CSV + Yahoo fill). */
const BENCHMARK_BASE = {
  sp500: { label: "S&P 500", inception: "1990-01" },
  gold: { label: "GOLD", inception: "1990-01" },
  silver: { label: "SILVER", inception: "1990-01" },
  qqq: { label: "QQQ", inception: "1999-03" },
  nifty50: { label: "NIFTY 50", inception: "1995-12" },
  nifty500: { label: "NIFTY 500", inception: "1995-01" },
};

const BENCHMARK_ORDER_US = ["sp500", "gold", "silver", "qqq", "nifty50", "nifty500"];
const BENCHMARK_ORDER_IN = ["nifty50", "nifty500", "sp500", "gold", "silver", "qqq"];
const BENCHMARK_KEYS = BENCHMARK_ORDER_US;

let currentMarket = "us";

function getMarket() {
  return currentMarket;
}

function getBenchmarkSeries() {
  const order = getMarket() === "in" ? BENCHMARK_ORDER_IN : BENCHMARK_ORDER_US;
  return order.map((benchmarkKey) => ({ benchmarkKey, ...BENCHMARK_BASE[benchmarkKey] }));
}

function labelForBenchmarkKey(benchmarkKey) {
  return BENCHMARK_BASE[benchmarkKey]?.label || benchmarkKey;
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
  /** Match server-side normalisation: keep alphanumeric, dot, hyphen, equals, ampersand, and caret. */
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.=&^-]/g, "");
}

/** Split benchmarks that existed by SIP start vs listed later (no comparable full-window metrics). */
function partitionBenchmarksBySipStart(userStartMonth) {
  const comparableBenchmarks = [];
  const lateBenchmarks = [];
  for (const { benchmarkKey, label, inception } of getBenchmarkSeries()) {
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

function formatMarketCap(value, isInr) {
  if (value === null || Number.isNaN(value) || value === 0) {
    return "N/A";
  }
  const absValue = Math.abs(value);
  if (isInr) {
    if (absValue >= 1e12) {
      return (value / 1e12).toFixed(2) + " L Cr";
    }
    if (absValue >= 1e7) {
      return (value / 1e7).toFixed(2) + " Cr";
    }
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
  }
  if (absValue >= 1e12) {
    return (value / 1e12).toFixed(2) + "T";
  }
  if (absValue >= 1e9) {
    return (value / 1e9).toFixed(2) + "B";
  }
  if (absValue >= 1e6) {
    return (value / 1e6).toFixed(2) + "M";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
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

function getDataSourceName() {
  return "historical data";
}

function renderProgressState(stage, source) {
  const src = source || getDataSourceName();
  const config = {
    idle: {
      bannerClass: "idle",
      fillClass: "stage-idle",
      message: "Ready to calculate",
    },
    fetching: {
      bannerClass: "fetching",
      fillClass: "stage-fetching",
      message: `Fetching data from ${src}`,
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
  updateClearButtonVisibility();
  clearTickerResults();
  setStatus(`Selected ${ticker.symbol}. Ready to estimate.`);
}

function updateClearButtonVisibility() {
  if (stockQueryClear) {
    stockQueryClear.hidden = !stockQueryInput.value.trim();
  }
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
    const sym = escapeHtmlText(ticker.symbol);
    const sub = buildTickerOptionSubline(ticker);
    option.innerHTML = `<strong>${sym}</strong><small class="ticker-option__meta">${sub}</small>`;
    option.addEventListener("click", () => {
      applyTickerSelection(ticker);
    });
    tickerResults.append(option);
  });

  showTickerResults();
}

function getTickerMarketParam() {
  if (getMarket() === "in") {
    return "in";
  }
  return "us";
}

async function searchTickers(query) {
  const response = await fetch(
    `/api/tickers?query=${encodeURIComponent(query)}&market=${encodeURIComponent(getTickerMarketParam())}`,
  );
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
      setStatus(
        getMarket() === "in"
          ? "No matching NSE/BSE name. Try another name, or paste a Yahoo symbol (e.g. RELIANCE.NS)."
          : "No matching US stock found. Try another ticker or company name.",
        true,
      );
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

/** GET query string — same shape as the working `indian` branch (proxies keep query params reliably). */
function buildEstimateSearchParams(symbol, options = {}) {
  const ac = getAmountCurrency();
  const startDate = options.startDate ?? form.elements.startDate.value;
  let monthlyAmount;
  if (ac === "inr") {
    monthlyAmount = getMarket() === "in" ? "1000" : "100";
  } else {
    monthlyAmount = "1";
  }
  const params = new URLSearchParams({
    monthlyAmount,
    startDate,
    purchaseDay: "1",
    amountCurrency: ac,
  });
  const endDate = options.endDate !== undefined ? options.endDate : form.elements.endDate.value;
  if (endDate) {
    params.set("endDate", endDate);
    params.set("stillHolding", String(stillHoldingInput.checked));
  }
  if (options.benchmark) {
    params.set("benchmark", options.benchmark);
  } else {
    params.set("symbol", symbol);
  }
  return params;
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

/**
 * US tickers: name · exchange. India tickers: + sector, optional ISIN in small type.
 */
function buildTickerOptionSubline(ticker) {
  const name = escapeHtmlText(ticker.name);
  const ex = escapeHtmlText(ticker.exchange || "");
  if (ticker.sector) {
    const sec = escapeHtmlText(ticker.sector);
    const isinPart = ticker.isin
      ? ` · <span class="ticker-option__isin">ISIN ${escapeHtmlText(ticker.isin)}</span>`
      : "";
    return `${name} · ${ex} · ${sec}${isinPart}`;
  }
  return `${name} · ${ex}`;
}

/**
 * GET /api/estimate — primary stock first, then benchmarks in parallel with the stock’s effective SIP start.
 */
async function fetchEstimateGet(symbol, options = {}) {
  const params = buildEstimateSearchParams(symbol, options);
  const response = await fetch(`/api/estimate?${params.toString()}`, { cache: "no-store" });
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
  if (getMarket() === "in") {
    return "₹1,000/month";
  }
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
  const rowCount = Math.max(1, Math.min(benchmarkTableRowCount, 12));
  const skeletonRows3Cols = Array.from({ length: rowCount })
    .map(
      () => `
              <tr class="benchmark-row benchmark-row--skeleton">
                <td><span class="shimmer-block shimmer-block--inline">&nbsp;</span></td>
                <td><span class="shimmer-block shimmer-block--narrow">&nbsp;</span></td>
                <td><span class="shimmer-block shimmer-block--medium">&nbsp;</span></td>
              </tr>`,
    )
    .join("");

  const skeletonRows4Cols = Array.from({ length: rowCount })
    .map(
      () => `
              <tr class="benchmark-row benchmark-row--skeleton">
                <td><span class="shimmer-block shimmer-block--inline">&nbsp;</span></td>
                <td><span class="shimmer-block shimmer-block--medium">&nbsp;</span></td>
                <td><span class="shimmer-block shimmer-block--medium">&nbsp;</span></td>
                <td><span class="shimmer-block shimmer-block--medium">&nbsp;</span></td>
              </tr>`,
    )
    .join("");

  resultsRoot.innerHTML = `
    <section class="benchmark-section benchmark-section--lead benchmark-section--loading" aria-labelledby="benchmark-heading-loading">
      <h3 id="benchmark-heading-loading" class="benchmark-heading">SIP Benchmark comparison</h3>
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
            ${skeletonRows3Cols}
          </tbody>
        </table>
      </div>
    </section>

    <section class="benchmark-section benchmark-section--loading" aria-labelledby="lumpsum-heading-loading">
      <h3 id="lumpsum-heading-loading" class="benchmark-heading">Lump Sum Benchmark comparison</h3>
      <div class="benchmark-table-wrap" role="status" aria-live="polite" aria-busy="true">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">CAGR</th>
              <th scope="col">Value multiple</th>
            </tr>
          </thead>
          <tbody>
            ${skeletonRows3Cols}
          </tbody>
        </table>
      </div>
    </section>

    <section class="benchmark-section benchmark-section--loading" aria-labelledby="price-heading-loading">
      <h3 id="price-heading-loading" class="benchmark-heading">Price details</h3>
      <div class="benchmark-table-wrap" role="status" aria-live="polite" aria-busy="true">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Avg purchase price (SIP)</th>
              <th scope="col">Initial price</th>
              <th scope="col">Final price</th>
            </tr>
          </thead>
          <tbody>
            ${skeletonRows4Cols}
          </tbody>
        </table>
      </div>
    </section>

    <section class="benchmark-section benchmark-section--loading" aria-labelledby="marketcap-heading-loading">
      <h3 id="marketcap-heading-loading" class="benchmark-heading">Market Capitalization</h3>
      <div class="results-metrics-stack" style="margin-top: 1rem;">
        <div class="metrics metrics--secondary">
          <article class="metric metric--compact metric--loading">
            <span class="metric-label">Initial market cap</span>
            <strong class="metric-value shimmer-block" aria-hidden="true">&nbsp;</strong>
          </article>
          <article class="metric metric--compact metric--loading">
            <span class="metric-label">Final market cap</span>
            <strong class="metric-value shimmer-block" aria-hidden="true">&nbsp;</strong>
          </article>
        </div>
      </div>
    </section>
    
    <div class="results-footnotes meta-shimmer" aria-hidden="true">
      <span class="shimmer-line shimmer-line--long"></span>
      <span class="shimmer-line shimmer-line--medium"></span>
      <span class="shimmer-line shimmer-line--full"></span>
    </div>
  `;
}

function renderBenchmarkTable(primarySymbol, estimatesBySymbol, comparisonSipStartMonth, sipHint, benchmarkErrors = {}) {
  const sipLabel = sipHint ?? sipCopySnippet();
  const primaryNorm = normaliseSymbolClient(primarySymbol);
  const { comparableBenchmarks, lateBenchmarks } = partitionBenchmarksBySipStart(comparisonSipStartMonth);

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
                <td>
                  <strong>${escapeHtmlText(String(payload.symbol))}</strong>${
                    isSelected ? ' <span class="benchmark-you">Your pick</span>' : ""
                  }
                </td>
                <td data-label="XIRR">${percent(payload.xirr)}</td>
                <td data-label="Value multiple">${multiple}</td>
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
      <h3 id="benchmark-heading" class="benchmark-heading">SIP Benchmark comparison</h3>
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

function renderLumpSumBenchmarkTable(primarySymbol, estimatesBySymbol, comparisonSipStartMonth, benchmarkErrors = {}) {
  const primaryNorm = normaliseSymbolClient(primarySymbol);
  const { comparableBenchmarks, lateBenchmarks } = partitionBenchmarksBySipStart(comparisonSipStartMonth);

  const topSymbols = [...new Set([...comparableBenchmarks, primaryNorm])];
  const topRows = topSymbols.map((sym) => {
    const payload = estimatesBySymbol[sym];
    return {
      symbol: sym,
      payload,
      cagr: payload?.priceCagr ?? null,
    };
  });
  topRows.sort((a, b) => {
    if (a.cagr === null && b.cagr === null) return 0;
    if (a.cagr === null) return 1;
    if (b.cagr === null) return -1;
    return b.cagr - a.cagr;
  });

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
      const multipleVal = payload.initialPrice > 0 ? (payload.finalPrice / payload.initialPrice) : null;
      const multiple = multipleVal === null ? "N/A" : `${number(multipleVal, 2)}x`;
      
      return `
              <tr class="benchmark-row${selectedClass}">
                <td>
                  <strong>${escapeHtmlText(String(payload.symbol))}</strong>${
                    isSelected ? ' <span class="benchmark-you">Your pick</span>' : ""
                  }
                </td>
                <td data-label="CAGR">${percent(payload.priceCagr)}</td>
                <td data-label="Value multiple">${multiple}</td>
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
    <section class="benchmark-section" aria-labelledby="lumpsum-benchmark-heading">
      <h3 id="lumpsum-benchmark-heading" class="benchmark-heading">Lump Sum Benchmark comparison</h3>
      <div class="benchmark-table-wrap">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">CAGR</th>
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

/** Grams per troy ounce — international commodity standard. */
const TROY_OZ_GRAMS = 31.1035;
/** Factor to convert a per-troy-oz price to a per-10g price. */
const OZ_TO_10G = TROY_OZ_GRAMS / 10; // ≈ 3.11035

const METAL_DISPLAY_SYMBOLS = new Set(["GOLD", "SILVER"]);

function isMetal(payloadSymbol) {
  return METAL_DISPLAY_SYMBOLS.has(String(payloadSymbol).toUpperCase());
}

function renderPriceTable(primarySymbol, estimatesBySymbol, comparisonSipStartMonth, benchmarkErrors = {}) {
  const primaryNorm = normaliseSymbolClient(primarySymbol);
  const { comparableBenchmarks } = partitionBenchmarksBySipStart(comparisonSipStartMonth);

  const topSymbols = [...new Set([...comparableBenchmarks, primaryNorm])];
  const topRows = topSymbols.map((sym) => {
    const payload = estimatesBySymbol[sym];
    return {
      symbol: sym,
      payload,
      cagr: payload?.priceCagr ?? null,
    };
  });
  topRows.sort((a, b) => {
    if (a.cagr === null && b.cagr === null) return 0;
    if (a.cagr === null) return 1;
    if (b.cagr === null) return -1;
    return b.cagr - a.cagr;
  });

  let hasInrMetal = false;
  let hasUsdMetal = false;

  const topHtml = topRows.map(row => {
     const isSelected = row.symbol === primaryNorm;
     const selectedClass = isSelected ? " benchmark-row--selected" : "";
     if (!row.payload) {
       const nameHtml = isBenchmarkKey(row.symbol) ? labelForBenchmarkKey(row.symbol) : escapeHtmlText(row.symbol);
       const hint = benchmarkErrors[row.symbol] ? `<span class="benchmark-error-hint">${escapeHtmlText(benchmarkErrors[row.symbol])}</span>` : "Unavailable";
       return `<tr class="benchmark-row benchmark-row--missing${selectedClass}">
                 <td><strong>${nameHtml}</strong>${isSelected ? ' <span class="benchmark-you">Your pick</span>' : ""}</td>
                 <td colspan="3" class="benchmark-unavailable">${hint}</td>
               </tr>`;
     }

     const payload = row.payload;
     const isInr = payload.currency === "INR";
     const metal = isMetal(payload.symbol);

     let fmt = isInr ? currencyInr : currency;
     let symbolLabel = escapeHtmlText(String(payload.symbol));
     let averagePurchasePrice = payload.totalShares > 0 ? payload.totalInvested / payload.totalShares : null;
     let initialPrice = payload.initialPrice;
     let finalPrice = payload.finalPrice;

     if (metal && isInr) {
       // Convert per-troy-oz INR price → per-10g INR price
       hasInrMetal = true;
       symbolLabel += " *";
       if (averagePurchasePrice !== null) averagePurchasePrice = averagePurchasePrice / OZ_TO_10G;
       initialPrice = initialPrice / OZ_TO_10G;
       finalPrice = finalPrice / OZ_TO_10G;
     } else if (metal && !isInr) {
       // Keep USD per troy oz, just flag for footnote
       hasUsdMetal = true;
       symbolLabel += " †";
     }

     const avgPurchasePriceFormatted = averagePurchasePrice === null ? "N/A" : fmt(averagePurchasePrice);
     const initialPriceFormatted = fmt(initialPrice);
     const finalPriceFormatted = fmt(finalPrice);

     return `              <tr class="benchmark-row${selectedClass}">
                <td><strong>${symbolLabel}</strong>${isSelected ? ' <span class="benchmark-you">Your pick</span>' : ""}</td>
                <td data-label="Avg purchase price">${avgPurchasePriceFormatted}</td>
                <td data-label="Initial price">${initialPriceFormatted}</td>
                <td data-label="Final price">${finalPriceFormatted}</td>
              </tr>`;
  }).join("");

  const inrMetalNote = hasInrMetal
    ? `<p class="meta meta--footnote">* Gold &amp; Silver prices shown per 10 grams (Indian standard), converted from USD/troy oz using the period's exchange rate.</p>`
    : "";
  const usdMetalNote = hasUsdMetal
    ? `<p class="meta meta--footnote">† Gold &amp; Silver prices are per troy oz (~31.1 g) in USD — the international COMEX commodity standard.</p>`
    : "";

  return `
    <section class="benchmark-section" aria-labelledby="price-table-heading">
      <h3 id="price-table-heading" class="benchmark-heading">Price details</h3>
      <div class="benchmark-table-wrap">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Avg purchase price (SIP)</th>
              <th scope="col">Initial price</th>
              <th scope="col">Final price</th>
            </tr>
          </thead>
          <tbody>
            ${topHtml}
          </tbody>
        </table>
      </div>
      ${inrMetalNote}
      ${usdMetalNote}
      <p class="meta meta--footnote" style="margin-top: 0.5rem;"><strong>Note:</strong> This calculator uses Adjusted Close prices (Total Return methodology). It assumes the full value of cash dividends, stock splits, bonus issues, rights issues, and spin-offs (demergers) is instantly reinvested back into the parent stock. It does not track separate spin-off holdings.</p>
    </section>
  `;
}

function renderResults(payload, estimatesBySymbol, benchmarkContext) {
  const isInr = payload.currency === "INR";
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

  const initialMarketCapFormatted = formatMarketCap(payload.initialMarketCap, isInr);
  const finalMarketCapFormatted = formatMarketCap(payload.finalMarketCap, isInr);

  resultsRoot.classList.remove("empty");
  resultsRoot.setAttribute("aria-busy", "false");
  resultsRoot.innerHTML = `
    ${adjustedStartNotice}
    ${renderBenchmarkTable(
      payload.symbol,
      estimatesBySymbol,
      benchmarkContext.comparisonSipStartMonth,
      payload.currency === "INR" ? sipCopySnippet() : "$1/month",
      benchmarkContext.benchmarkErrors ?? {},
    )}
    ${renderLumpSumBenchmarkTable(
      payload.symbol,
      estimatesBySymbol,
      benchmarkContext.comparisonSipStartMonth,
      benchmarkContext.benchmarkErrors ?? {},
    )}
    ${renderPriceTable(
      payload.symbol,
      estimatesBySymbol,
      benchmarkContext.comparisonSipStartMonth,
      benchmarkContext.benchmarkErrors ?? {},
    )}

    ${
      payload.splitCount !== undefined && payload.dividendCount !== undefined
        ? `
    <section class="benchmark-section" aria-labelledby="corporate-actions-heading">
      <h3 id="corporate-actions-heading" class="benchmark-heading">Corporate Actions during SIP</h3>
      <div class="results-metrics-stack" style="margin-top: 1rem;">
        <div class="metrics metrics--secondary">
          <article class="metric metric--compact">
            <span class="metric-label">Stock splits</span>
            <strong class="metric-value">${payload.splitCount}</strong>
          </article>
          <article class="metric metric--compact">
            <span class="metric-label">Dividends</span>
            <strong class="metric-value">${payload.dividendCount}</strong>
          </article>
        </div>
      </div>
    </section>`
        : ""
    }
    
    <section class="benchmark-section" aria-labelledby="marketcap-heading">
      <h3 id="marketcap-heading" class="benchmark-heading">Market Capitalization</h3>
      <div class="results-metrics-stack" style="margin-top: 1rem;">
        <div class="metrics metrics--secondary">
          <article class="metric metric--compact">
            <span class="metric-label">Initial market cap</span>
            <strong class="metric-value">${initialMarketCapFormatted}</strong>
          </article>
          <article class="metric metric--compact">
            <span class="metric-label">Final market cap</span>
            <strong class="metric-value">${finalMarketCapFormatted}</strong>
          </article>
        </div>
      </div>
    </section>

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

  const startYmSubmit = parseSipMonthDisplayToYm(startDateDisplay.value.trim());
  if (!startYmSubmit) {
    setStatus("Enter a valid SIP start month as mm/yyyy (from 01/1990 onward).", true);
    startDateDisplay.focus();
    return;
  }
  form.elements.startDate.value = startYmSubmit;
  startDateDisplay.value = formatYmAsMmYyyy(startYmSubmit);

  const endRawSubmit = endDateDisplay.value.trim();
  if (endRawSubmit) {
    const endYmSubmit = parseSipMonthDisplayToYm(endRawSubmit);
    if (!endYmSubmit) {
      setStatus("End month must be a valid mm/yyyy, or leave it blank.", true);
      endDateDisplay.focus();
      return;
    }
    if (endYmSubmit < startYmSubmit) {
      setStatus("End date cannot be before the start date.", true);
      return;
    }
    endDateInput.value = endYmSubmit;
    endDateDisplay.value = formatYmAsMmYyyy(endYmSubmit);
  } else {
    endDateInput.value = "";
    endDateDisplay.value = "";
  }
  syncHoldingField();

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
  setStatus(`Fetching historical data…`);
  renderProgressState("fetching", getDataSourceName());

  try {
    const fetchStartedAt = Date.now();
    const tick = window.setInterval(() => {
      const s = Math.floor((Date.now() - fetchStartedAt) / 1000);
      if (s >= 8) {
        setStatus(
          `Fetching data… (${s}s) — large requests can take 1–3 min if the data provider is rate-limiting.`,
        );
      }
    }, 4000);
    let primaryPayload;
    try {
      primaryPayload = await fetchEstimateGet(primarySymbol, {});
    } finally {
      window.clearInterval(tick);
    }
    await waitForMinimum(fetchStartedAt, 400);
    setStatus("Calculating returns…");
    renderProgressState("calculating");

    await sleep(350);

    const comparisonSipStartMonth = primaryPayload.dataRange.effectiveStartMonth;
    const { comparableBenchmarks: benchmarksToFetch } = partitionBenchmarksBySipStart(comparisonSipStartMonth);

    let settled = [];
    if (benchmarksToFetch.length > 0) {
      settled = await Promise.allSettled(
        benchmarksToFetch.map((key) =>
          fetchEstimateGet("", { benchmark: key, startDate: comparisonSipStartMonth }),
        ),
      );
    }

    const estimatesBySymbol = { [primarySymbol]: primaryPayload };
    const benchmarkErrors = {};
    for (let i = 0; i < benchmarksToFetch.length; i += 1) {
      const key = benchmarksToFetch[i];
      const r = settled[i];
      if (r.status === "fulfilled") {
        estimatesBySymbol[key] = r.value;
      } else {
        benchmarkErrors[key] =
          r.reason instanceof Error ? r.reason.message : String(r.reason);
      }
    }

    renderProgressState("done");
    renderResults(primaryPayload, estimatesBySymbol, { comparisonSipStartMonth, benchmarkErrors });
    setStatus(`Done. Estimate ready for ${primaryPayload.symbol}.`);
    if (window.innerWidth <= 700 && resultsPanel) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      /* Scroll to the Results card (heading + status), not #results (benchmark is first inside it). */
      resultsPanel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    renderProgressState("error");
    renderEstimateFailure(msg);
    setStatus(msg, true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Estimate Portfolio Value";
  }
}

stockQueryInput.addEventListener("input", () => {
  updateClearButtonVisibility();
  clearTimeout(tickerSearchTimeout);
  tickerSearchTimeout = setTimeout(handleTickerInput, 250);
});

if (stockQueryClear) {
  stockQueryClear.addEventListener("click", () => {
    stockQueryInput.value = "";
    symbolInput.value = "";
    setSelectedState(false);
    updateClearButtonVisibility();
    clearTickerResults();
    stockQueryInput.focus();
    setStatus("Search for a stock to begin.");
  });
}

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
stillHoldingInput.addEventListener("change", syncHoldingField);
function updateInvestorCopy() {
  calculatorIntro.textContent = "";
  const emptyEl = document.querySelector("#results-empty-copy");
  if (emptyEl) {
    if (getMarket() === "in") {
      emptyEl.textContent =
        "Run the estimator for a rupee SIP, XIRR, and cost basis. S&P, QQQ, and metal benchmarks appear in rupees (USD/INR in the background).";
    } else {
      emptyEl.textContent =
        getAmountCurrency() === "inr"
          ? "Run the estimator to see portfolio value in rupees, XIRR on INR cash flows, and per-share values (INR primary, USD in smaller text)."
          : "Run the estimator to see portfolio value, XIRR, average cost, current price, and share count for your monthly SIP.";
    }
  }
}

function getEmptyResultsInnerHtml() {
  return `<div class="results-empty-inner">
              <div class="results-empty-icon" aria-hidden="true">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="6" y="8" width="36" height="32" rx="4" stroke="currentColor" stroke-width="1.5" opacity="0.35" />
                  <path
                    d="M12 32 L18 22 L24 26 L32 14 L36 18"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    opacity="0.55"
                  />
                  <circle cx="12" cy="32" r="2" fill="currentColor" opacity="0.45" />
                  <circle cx="18" cy="22" r="2" fill="currentColor" opacity="0.45" />
                  <circle cx="24" cy="26" r="2" fill="currentColor" opacity="0.45" />
                  <circle cx="32" cy="14" r="2" fill="currentColor" opacity="0.45" />
                </svg>
              </div>
              <p class="results-empty-title">No results yet</p>
              <p class="results-empty-copy empty-state" id="results-empty-copy"></p>
            </div>`;
}

function getDefaultsForMarket(market) {
  if (market === "in") {
    return {
      display: DEFAULT_IN_STOCK_DISPLAY,
      symbol: DEFAULT_IN_STOCK_SYMBOL,
      start: DEFAULT_IN_SIP_START_MONTH,
    };
  }
  return {
    display: DEFAULT_STOCK_DISPLAY,
    symbol: DEFAULT_STOCK_SYMBOL,
    start: DEFAULT_SIP_START_MONTH,
  };
}

function updateShellForMarket() {
  const m = getMarket();
  const tag = document.getElementById("app-brand-tagline");
  const usTrust = document.querySelector("[data-trust-us]");
  const inTrust = document.querySelector("[data-trust-in]");
  const stockLabel = document.getElementById("stock-field-label");
  if (tag) tag.textContent = "Stocks · SIP · Commodities · Educational";
  if (m === "in") {
    if (usTrust) usTrust.hidden = true;
    if (inTrust) inTrust.hidden = true;
    if (stockLabel) stockLabel.textContent = "India stock";
    stockQueryInput.placeholder = "e.g. Federal Bank or FEDERALBNK";
  } else {
    if (usTrust) usTrust.hidden = true;
    if (inTrust) inTrust.hidden = true;
    if (stockLabel) stockLabel.textContent = "US stock";
    stockQueryInput.placeholder = "Search Intel or INTC";
  }
}

function syncInvestorToggleToCurrency() {
  if (getMarket() !== "us") {
    return;
  }
  const isInr = getAmountCurrency() === "inr";
  investorUsBtn.setAttribute("aria-pressed", String(!isInr));
  investorInBtn.setAttribute("aria-pressed", String(isInr));
}

/** India market hides the $/₹ control; still sync pressed state so it is never "stuck" on $ if the row is shown. */
function syncInvestorToggleForMarketUI() {
  if (getMarket() === "in") {
    investorUsBtn.setAttribute("aria-pressed", "false");
    investorInBtn.setAttribute("aria-pressed", "true");
  } else {
    syncInvestorToggleToCurrency();
  }
}

/** Fresh calculator + empty results (used on load and when switching market or investor). */
function resetToCleanView() {
  const market = currentMarket;
  const def = getDefaultsForMarket(market);
  clearTickerResults();
  lastTickerResults = [];
  stockQueryInput.value = def.display;
  symbolInput.value = def.symbol;
  setSelectedState(true);
  setMonthDateFieldFromYm(form.elements.startDate, startDateDisplay, def.start);
  setMonthDateFieldFromYm(endDateInput, endDateDisplay, "");
  stillHoldingInput.checked = true;
  syncHoldingField();
  if (investorCurrencyWrap) {
    investorCurrencyWrap.hidden = market === "in";
  }
  syncInvestorToggleForMarketUI();
  updateShellForMarket();
  resultsRoot.classList.add("empty");
  resultsRoot.setAttribute("aria-busy", "false");
  resultsRoot.innerHTML = getEmptyResultsInnerHtml();
  updateInvestorCopy();
  renderProgressState("idle");
  setStatus(`Selected ${def.symbol}. Ready to estimate.`);
  submitButton.disabled = false;
  submitButton.textContent = "Estimate Portfolio Value";
  lastInvestorMode = getAmountCurrency() === "inr" ? "in" : "us";
}

function applyMarketFromToggle(m) {
  const next = m === "in" ? "in" : "us";
  if (currentMarket === next) {
    return;
  }
  currentMarket = next;
  localStorage.setItem(MARKET_STORAGE_KEY, next);
  if (next === "in") {
    setAmountCurrency("inr");
  } else {
    const im = localStorage.getItem(INVESTOR_STORAGE_KEY) === "in" ? "in" : "us";
    setAmountCurrency(im === "in" ? "inr" : "usd");
  }
  resetToCleanView();
}

function applyInvestorModeFromToggle(mode) {
  if (getMarket() !== "us") {
    return;
  }
  const next = mode === "in" ? "in" : "us";
  if (lastInvestorMode === next) {
    return;
  }
  localStorage.setItem(INVESTOR_STORAGE_KEY, next);
  setAmountCurrency(next === "in" ? "inr" : "usd");

  // If we have an active selection and results, re-calculate instantly.
  if (symbolInput.value && !resultsRoot.classList.contains("empty")) {
    syncInvestorToggleToCurrency();
    updateInvestorCopy();
    lastInvestorMode = next;
    handleSubmit(new Event("submit"));
  } else {
    resetToCleanView();
  }
}

function initApp() {
  currentMarket = localStorage.getItem(MARKET_STORAGE_KEY) === "in" ? "in" : "us";
  if (currentMarket === "in") {
    setAmountCurrency("inr");
  } else {
    const im = localStorage.getItem(INVESTOR_STORAGE_KEY) === "in" ? "in" : "us";
    setAmountCurrency(im === "in" ? "inr" : "usd");
  }
  resetToCleanView();
}

investorUsBtn.addEventListener("click", () => {
  applyInvestorModeFromToggle("us");
});

investorInBtn.addEventListener("click", () => {
  applyInvestorModeFromToggle("in");
});

wireMonthDateField({
  hiddenInput: form.elements.startDate,
  displayInput: startDateDisplay,
  calendarBtn: startDateCalendarBtn,
  optional: false,
  sheetRoot: startMonthSheet,
  defaultViewYear: () => Number(DEFAULT_SIP_START_MONTH.slice(0, 4)),
});
wireMonthDateField({
  hiddenInput: endDateInput,
  displayInput: endDateDisplay,
  calendarBtn: endDateCalendarBtn,
  optional: true,
  sheetRoot: endMonthSheet,
  defaultViewYear: () => new Date().getFullYear(),
});

function initLegalDisclosure() {
  const details = document.getElementById("important-information");
  if (!details || !(details instanceof HTMLDetailsElement)) {
    return;
  }

  const openIfHash = () => {
    if (window.location.hash === "#important-information") {
      details.open = true;
    }
  };

  openIfHash();
  window.addEventListener("hashchange", openIfHash);

  document.querySelectorAll('a[href="#important-information"]').forEach((link) => {
    link.addEventListener("click", () => {
      details.open = true;
    });
  });
}

function initLegalTabs() {
  const root = document.querySelector("[data-legal-tabs]");
  if (!root) {
    return;
  }
  const tabs = Array.from(root.querySelectorAll('.legal-tabs__tab[role="tab"]'));
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls") || ""));
  const keyNext = ["ArrowRight", "ArrowDown"];
  const keyPrev = ["ArrowLeft", "ArrowUp"];

  function selectIndex(nextIndex) {
    const i = (nextIndex + tabs.length) % tabs.length;
    tabs.forEach((tab, j) => {
      const selected = j === i;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = panels[j];
      if (panel) {
        panel.hidden = !selected;
      }
    });
    tabs[i].focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      selectIndex(index);
    });
    tab.addEventListener("keydown", (event) => {
      if (keyNext.includes(event.key)) {
        event.preventDefault();
        selectIndex(index + 1);
      } else if (keyPrev.includes(event.key)) {
        event.preventDefault();
        selectIndex(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        selectIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        selectIndex(tabs.length - 1);
      }
    });
  });
}

function setupMarketToggles() {
  const btns = document.querySelectorAll("[data-market-btn]");
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      const market = btn.getAttribute("data-market-btn");
      applyMarketFromToggle(market);
      syncMarketToggles();
      updateShellForMarket();
    });
  });
}

function syncMarketToggles() {
  const m = getMarket();
  const btns = document.querySelectorAll("[data-market-btn]");
  btns.forEach(btn => {
    const isTarget = btn.getAttribute("data-market-btn") === m;
    btn.setAttribute("aria-pressed", isTarget ? "true" : "false");
  });
}

// Initialize
setupMarketToggles();
syncMarketToggles();

initApp();
syncHoldingField();
renderProgressState("idle");
initLegalDisclosure();
initLegalTabs();

// Mobile menu toggle
(function() {
  const btn = document.getElementById("mobile-menu-btn");
  const overlay = document.getElementById("mobile-nav-overlay");
  if (btn && overlay) {
    btn.addEventListener("click", () => {
      overlay.classList.toggle("open");
      const isOpen = overlay.classList.contains("open");
      btn.setAttribute("aria-expanded", isOpen);
      // Change icon to X if open
      btn.innerHTML = isOpen 
        ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
        : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`;
    });
  }
})();
