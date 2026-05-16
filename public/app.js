const form = document.querySelector("#estimator-form");
const stockQueryInput = document.querySelector("#stock-query");
const symbolInput = document.querySelector("#symbol");
const tickerResults = document.querySelector("#ticker-results");
const tickerOptionsList = document.querySelector("#ticker-options-list");
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
const searchCapsules = document.querySelector("#search-capsules");
let activeCategory = "stock";

const INVESTOR_STORAGE_KEY = "investorMode";
const INVESTOR_SESSION_TS_KEY = "investorModeTs";
/** Within a browser tab session, remember currency toggle for at most this long. */
const INVESTOR_SESSION_TTL_MS = 15 * 60 * 1000;
const MARKET_STORAGE_KEY = "xirr_market";

function defaultInvestorModeForMarket(market) {
  return market === "in" ? "in" : "us";
}

function readSessionInvestorMode() {
  const mode = sessionStorage.getItem(INVESTOR_STORAGE_KEY);
  if (mode !== "in" && mode !== "us") {
    return null;
  }
  const ts = Number(sessionStorage.getItem(INVESTOR_SESSION_TS_KEY));
  if (!Number.isFinite(ts) || Date.now() - ts > INVESTOR_SESSION_TTL_MS) {
    sessionStorage.removeItem(INVESTOR_STORAGE_KEY);
    sessionStorage.removeItem(INVESTOR_SESSION_TS_KEY);
    return null;
  }
  return mode;
}

function writeSessionInvestorMode(mode) {
  sessionStorage.setItem(INVESTOR_STORAGE_KEY, mode === "in" ? "in" : "us");
  sessionStorage.setItem(INVESTOR_SESSION_TS_KEY, String(Date.now()));
}

function resolveInvestorMode(market) {
  return readSessionInvestorMode() ?? defaultInvestorModeForMarket(market);
}

/** Cache for company info to allow toggling without refetching. */
let cachedCompanyInfo = null;

/** US market default listing. */
const DEFAULT_STOCK_SYMBOL = "INTC";
const DEFAULT_STOCK_DISPLAY = "INTC — Intel Corp";
const DEFAULT_SIP_START_MONTH = "1999-12";
/** India market default (NSE, Yahoo). */
const DEFAULT_IN_STOCK_SYMBOL = "FEDERALBNK.NS";
const DEFAULT_IN_STOCK_DISPLAY = "FEDERALBNK — The Federal Bank Limited";
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

const REAL_WORLD_ADJUSTMENT_FOOTNOTE =
  "# XIRR, CAGR, and value multiple include a conservative adjustment (~2% for stocks, ~1% for indices/ETFs, ~0.8% for commodities) for estimated dividend taxes, brokerage, and market friction to reflect real-world outcomes.";

/** Tracks last applied mode so toggling to the same side does not wipe the form. */
let lastInvestorMode = null;

/** Benchmark keys (server: monthly CSV + Yahoo fill). */
const BENCHMARK_BASE = {
  sp500: { label: "S&P 500 TR", inception: "1990-01" },
  gold: { label: "GOLD", inception: "1990-01" },
  silver: { label: "SILVER", inception: "1990-01" },
  qqq: { label: "QQQ", inception: "1999-03" },
  nifty50: { label: "NIFTY 50", inception: "1995-12" },
  nifty500: { label: "NIFTY 500", inception: "1995-01" },
  sensex: { label: "SENSEX", inception: "1997-07" },
};

/**
 * Conservative real-world haircuts to account for dividend tax, brokerage, and slippage.
 * These are subtracted from the raw annualized returns.
 */
const REAL_WORLD_HAIRCUTS = {
  STOCK: 0.02,     // 2.0%
  ETF: 0.01,       // 1.0%
  INDEX: 0.01,     // 1.0%
  COMMODITY: 0.008 // 0.8%
};

function getAssetType(sym, name = "") {
  const normSym = String(sym).toUpperCase();
  const normName = String(name).toUpperCase();
  
  if (normSym.includes("GOLD") || normSym.includes("SILVER") || normSym.endsWith("=F")) {
    return "COMMODITY";
  }
  if (isBenchmarkKey(sym) || normSym.startsWith("^")) {
    return "INDEX";
  }
  if (/ETF|FUND|TRUST|INVESCO|VANGUARD|ISHARES|SPDR|BEES/i.test(normName)) {
    return "ETF";
  }
  return "STOCK";
}

function getAssetHaircut(sym, name = "") {
  const type = getAssetType(sym, name);
  return REAL_WORLD_HAIRCUTS[type] || REAL_WORLD_HAIRCUTS.STOCK;
}

const BENCHMARK_ORDER_US = ["sp500", "gold", "silver", "qqq", "nifty50", "nifty500", "sensex"];
const BENCHMARK_ORDER_IN = ["nifty50", "nifty500", "sensex", "sp500", "gold", "silver", "qqq"];
const BENCHMARK_KEYS = [...new Set([...BENCHMARK_ORDER_US, ...BENCHMARK_ORDER_IN])];

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
/** First ticker API call per page load asks server to revalidate stale cache. */
let tickerCacheRevalidateSent = false;

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

function formatDisplaySymbol(symbol) {
  if (!symbol) return "";
  return String(symbol).replace(/\.(NS|BO)$/i, "");
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

function formatCompactFinalValue(value, isInr) {
  if (value === null || isNaN(value)) return "N/A";

  const absValue = Math.abs(value);
  let formattedValue = "";
  const symbol = isInr ? "₹" : "$";

  if (isInr) {
    if (absValue >= 1e7) {
      formattedValue = symbol + (value / 1e7).toFixed(2) + " Cr";
    } else if (absValue >= 1e5) {
      formattedValue = symbol + (value / 1e5).toFixed(2) + " L";
    } else {
      formattedValue = symbol + Math.round(value).toLocaleString("en-IN");
    }
  } else {
    if (absValue >= 1e9) {
      formattedValue = symbol + (value / 1e9).toFixed(2) + " B";
    } else if (absValue >= 1e6) {
      formattedValue = symbol + (value / 1e6).toFixed(2) + " M";
    } else {
      formattedValue = symbol + Math.round(value).toLocaleString("en-US");
    }
  }

  return formattedValue;
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
  if (tickerOptionsList) {
    tickerOptionsList.innerHTML = "";
  }
  tickerResults.classList.remove("open");
  stockQueryInput.setAttribute("aria-expanded", "false");
  stockQueryInput.removeAttribute("aria-activedescendant");
  activeTickerIndex = -1;
  lastTickerResults = [];
}

function openDropdown() {
  // Re-trigger the entry animation by briefly removing and re-adding the class
  tickerResults.classList.remove("open");
  // Force reflow
  void tickerResults.offsetHeight;
  tickerResults.classList.add("open");
  stockQueryInput.setAttribute("aria-expanded", "true");
}

function showTickerResults() {
  tickerResults.classList.add("open");
  stockQueryInput.setAttribute("aria-expanded", "true");
}

function setSelectedState(hasSelection) {
  stockQueryInput.classList.toggle("has-selection", hasSelection);
}

function applyTickerSelection(ticker) {
  const displaySym = formatDisplaySymbol(ticker.symbol);
  const label = String(ticker.name || displaySym).trim();
  stockQueryInput.value =
    getMarket() === "in" ? `${label} — ${displaySym}` : `${displaySym} — ${label}`;
  symbolInput.value = ticker.symbol;
  setSelectedState(true);
  clearTickerResults();
  setStatus(`Selected ${displaySym}. Ready to estimate (${sipCopySnippet()}).`);
}

function updateActiveTicker(nextIndex) {
  if (!tickerOptionsList) return;
  const options = [...tickerOptionsList.querySelectorAll(".ticker-option")];
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
  if (tickerOptionsList) {
    tickerOptionsList.innerHTML = "";
  }

  tickers.forEach((ticker, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "ticker-option";
    option.id = `ticker-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.innerHTML = formatTickerOptionHtml(ticker);
    option.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyTickerSelection(ticker);
    });
    if (tickerOptionsList) {
      tickerOptionsList.append(option);
    }
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
  const market = getMarket();
  const revalidate = !tickerCacheRevalidateSent ? "&revalidate=1" : "";
  tickerCacheRevalidateSent = true;
  const res = await fetch(
    `/api/tickers?query=${encodeURIComponent(query)}&market=${market}&category=${activeCategory}${revalidate}`
  );
  const payload = await res.json();

  if (!res.ok) {
    throw new Error(payload.error || "Could not search tickers.");
  }

  return payload.tickers;
}

async function handleTickerSearch(query) {
  // If no query given, use whatever is in the input
  if (query === undefined) {
    query = stockQueryInput.value.trim();
  } else {
    query = String(query).trim();
  }

  if (!query) {
    clearTickerResults();
    return;
  }

  if (tickerOptionsList) {
    tickerOptionsList.innerHTML = `<div class="ticker-empty-state">Searching...</div>`;
  }
  openDropdown();

  try {
    const tickers = await searchTickers(query);
    lastTickerResults = tickers;

    if (!tickerOptionsList) return;
    tickerOptionsList.innerHTML = "";

    if (tickers.length === 0) {
      const emptyMsg = getMarket() === "in"
        ? "No results. Try a different name or paste a Yahoo symbol (e.g. RELIANCE.NS)."
        : "No results. Try a different ticker or company name.";
      tickerOptionsList.innerHTML = `<div class="ticker-empty-state">${emptyMsg}</div>`;
      setStatus("");
      return;
    }

    tickers.forEach((ticker, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "ticker-option";
      option.id = `ticker-option-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.innerHTML = formatTickerOptionHtml(ticker);
      option.addEventListener("mousedown", (e) => {
        // Prevent blur from closing the dropdown before click fires
        e.preventDefault();
      });
      option.addEventListener("click", () => {
        applyTickerSelection(ticker);
      });
      tickerOptionsList.append(option);
    });
    if (tickers.length >= 10) {
      const hint = document.createElement("p");
      hint.className = "ticker-results-hint";
      hint.textContent = "Showing top 10 — type more to narrow results.";
      tickerOptionsList.append(hint);
    }
    setStatus("");
  } catch (error) {
    if (tickerOptionsList) {
      tickerOptionsList.innerHTML = `<div class="ticker-empty-state">Search failed. Try again.</div>`;
    }
    setStatus(error.message || "Ticker search failed.", true);
  }
}

// Legacy alias for any remaining callsites
async function handleTickerInput() {
  return handleTickerSearch();
}

async function refreshTickerResultsFromCurrentValue() {
  const rawValue = stockQueryInput.value.trim();
  const query = symbolInput.value || rawValue.split("—")[0].trim() || rawValue;

  if (!query) {
    return;
  }

  await handleTickerSearch(query);
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
    monthlyAmount = "10000";
  } else {
    monthlyAmount = "100";
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

/** India: symbol · exchange · sector under the company name. US: name · exchange in the subline. */
function buildTickerOptionMeta(ticker) {
  const parts = [];
  const ex = String(ticker.exchange || "").trim();
  if (ex) {
    parts.push(escapeHtmlText(ex));
  }
  if (ticker.sector) {
    parts.push(escapeHtmlText(ticker.sector));
  }
  if (ticker.isin) {
    parts.push(`<span class="ticker-option__isin">ISIN ${escapeHtmlText(ticker.isin)}</span>`);
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function formatTickerOptionHtml(ticker) {
  const sym = escapeHtmlText(formatDisplaySymbol(ticker.symbol));
  const name = escapeHtmlText(String(ticker.name || sym).trim());
  if (getMarket() === "in") {
    return `<strong class="ticker-option__name">${name}</strong><small class="ticker-option__meta"><span class="ticker-option__symbol">${sym}</span>${buildTickerOptionMeta(ticker)}</small>`;
  }
  return `<strong>${sym}</strong><small class="ticker-option__meta">${name}${buildTickerOptionMeta(ticker)}</small>`;
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
    return "₹10,000/month";
  }
  return getAmountCurrency() === "inr" ? "₹10,000/month" : "$100/month";
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

  const skeletonRows5Cols = Array.from({ length: rowCount })
    .map(
      () => `
              <tr class="benchmark-row benchmark-row--skeleton">
                <td><span class="shimmer-block shimmer-block--inline">&nbsp;</span></td>
                <td><span class="shimmer-block shimmer-block--medium">&nbsp;</span></td>
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
              <th scope="col">XIRR #</th>
              <th scope="col">Value multiple #</th>
              <th scope="col">Invested value</th>
              <th scope="col">Final value</th>
            </tr>
          </thead>
          <tbody>
            ${skeletonRows5Cols}
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
              <th scope="col">CAGR #</th>
              <th scope="col">Value multiple #</th>
              <th scope="col">Invested value</th>
              <th scope="col">Final value</th>
            </tr>
          </thead>
          <tbody>
            ${skeletonRows5Cols}
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

    <section class="benchmark-section benchmark-section--loading" aria-labelledby="company-info-heading-loading">
      <h3 id="company-info-heading-loading" class="benchmark-heading">Company Info</h3>
      <div class="results-metrics-stack" style="margin-top: 1rem;">
        <div class="metrics metrics--secondary">
          <article class="metric metric--compact metric--loading">
            <span class="metric-label">Founded</span>
            <strong class="metric-value shimmer-block" aria-hidden="true">&nbsp;</strong>
          </article>
          <article class="metric metric--compact metric--loading">
            <span class="metric-label">Current market cap</span>
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
    let netXirr = null;
    if (payload && payload.xirr !== null) {
      const haircut = getAssetHaircut(sym, payload.companyName || "");
      netXirr = Math.max(-1, payload.xirr - haircut);
    }
    return {
      symbol: sym,
      payload,
      xirr: netXirr,
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
          : escapeHtmlText(formatDisplaySymbol(row.symbol));
        const hint = benchmarkErrors[row.symbol]
          ? `<span class="benchmark-error-hint">${escapeHtmlText(benchmarkErrors[row.symbol])}</span>`
          : "Unavailable for this window (missing estimate).";
        return `
              <tr class="benchmark-row benchmark-row--missing${selectedClass}">
                <td><strong>${nameHtml}</strong></td>
                <td colspan="4" class="benchmark-unavailable">${hint}</td>
              </tr>`;
      }
      const { payload } = row;
      const netXirr = row.xirr;
      const isInr = payload.currency === "INR";
      
      // Mathematically accurate Net Multiple using the Future Value of an Annuity formula.
      // Since Multiple = [(1+r)^n - 1] / (r * n), we recalculate based on the net XIRR.
      let netMultipleStr = "N/A";
      let investedValueStr = "N/A";
      let netPortfolioValueStr = "N/A";

      const totalInvested = payload.totalInvested ?? null;
      if (totalInvested !== null && totalInvested > 0) {
        investedValueStr = formatCompactFinalValue(totalInvested, isInr);
      }

      if (payload.investedMultiple !== null && netXirr !== null) {
        const n = payload.contributions ? payload.contributions.length : 0;
        if (n > 0) {
          // Monthly rate r from annual rate R: (1+r)^12 = 1+R
          const rMonthly = Math.pow(1 + netXirr, 1 / 12) - 1;
          let netMultipleVal;
          if (Math.abs(rMonthly) < 1e-10) {
            netMultipleVal = 1;
          } else {
            netMultipleVal = (Math.pow(1 + rMonthly, n) - 1) / (rMonthly * n);
          }
          netMultipleStr = `${number(netMultipleVal, 2)}x`;
          
          if (totalInvested !== null && totalInvested > 0) {
            const netPortfolioValue = totalInvested * netMultipleVal;
            netPortfolioValueStr = formatCompactFinalValue(netPortfolioValue, isInr);
          }
        }
      }
      
      return `
              <tr class="benchmark-row${selectedClass}">
                <td>
                  <strong>${escapeHtmlText(formatDisplaySymbol(String(payload.symbol)))}</strong>
                </td>
                <td data-label="XIRR #">${percent(netXirr)}</td>
                <td data-label="Value multiple #">${netMultipleStr}</td>
                <td data-label="Invested value">${investedValueStr}</td>
                <td data-label="Final value">${netPortfolioValueStr}</td>
              </tr>`;
    })
    .join("");

  const lateHtml = lateRowsToShow
    .map(
      ({ label }) => `
              <tr class="benchmark-row benchmark-row--not-in-period">
                <td><strong>${label}</strong></td>
                <td colspan="4" class="benchmark-period-unavailable">Unavailable in that period</td>
              </tr>`,
    )
    .join("");

  return `
    <section class="benchmark-section benchmark-section--lead" aria-labelledby="benchmark-heading">
      <div class="benchmark-table-wrap">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">XIRR #</th>
              <th scope="col">Value multiple #</th>
              <th scope="col">Invested value</th>
              <th scope="col">Final value</th>
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
    let netCagr = null;
    if (payload && payload.priceCagr !== null) {
      const haircut = getAssetHaircut(sym, payload.companyName || "");
      netCagr = Math.max(-1, payload.priceCagr - haircut);
    }
    return {
      symbol: sym,
      payload,
      cagr: netCagr,
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
          : escapeHtmlText(formatDisplaySymbol(row.symbol));
        const hint = benchmarkErrors[row.symbol]
          ? `<span class="benchmark-error-hint">${escapeHtmlText(benchmarkErrors[row.symbol])}</span>`
          : "Unavailable for this window (missing estimate).";
        return `
              <tr class="benchmark-row benchmark-row--missing${selectedClass}">
                <td><strong>${nameHtml}</strong></td>
                <td colspan="4" class="benchmark-unavailable">${hint}</td>
              </tr>`;
      }
      const { payload } = row;
      const netCagr = row.cagr;
      const isInr = payload.currency === "INR";
      const lumpSumInvestment = isInr ? 10000 : 100;
      
      // Mathematically accurate Net Multiple using the compound interest formula: (1 + r)^t
      let netMultipleStr = "N/A";
      let investedValueStr = formatCompactFinalValue(lumpSumInvestment, isInr);
      let netFinalValueStr = "N/A";

      if (netCagr !== null) {
        const years = payload.years ?? (payload.dataRange ? (new Date(payload.dataRange.valuationDate) - new Date(payload.dataRange.firstContributionDate)) / (1000 * 60 * 60 * 24 * 365.25) : 0);
        const netMultipleVal = Math.pow(1 + netCagr, years);
        netMultipleStr = `${number(netMultipleVal, 2)}x`;
        const netFinalValue = lumpSumInvestment * netMultipleVal;
        netFinalValueStr = formatCompactFinalValue(netFinalValue, isInr);
      }
      
      return `
              <tr class="benchmark-row${selectedClass}">
                <td>
                  <strong>${escapeHtmlText(formatDisplaySymbol(String(payload.symbol)))}</strong>
                </td>
                <td data-label="CAGR #">${percent(netCagr)}</td>
                <td data-label="Value multiple #">${netMultipleStr}</td>
                <td data-label="Invested value">${investedValueStr}</td>
                <td data-label="Final value">${netFinalValueStr}</td>
              </tr>`;
    })
    .join("");

  const lateHtml = lateRowsToShow
    .map(
      ({ label }) => `
              <tr class="benchmark-row benchmark-row--not-in-period">
                <td><strong>${label}</strong></td>
                <td colspan="4" class="benchmark-period-unavailable">Unavailable in that period</td>
              </tr>`,
    )
    .join("");

  return `
    <section class="benchmark-section benchmark-section--embedded" aria-labelledby="lumpsum-benchmark-heading">
      <div class="benchmark-table-wrap">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">CAGR #</th>
              <th scope="col">Value multiple #</th>
              <th scope="col">Invested value</th>
              <th scope="col">Final value</th>
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
    let netCagr = null;
    if (payload && payload.priceCagr !== null) {
      const haircut = getAssetHaircut(sym, payload.companyName || "");
      netCagr = Math.max(-1, payload.priceCagr - haircut);
    }
    return {
      symbol: sym,
      payload,
      cagr: netCagr,
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
       const nameHtml = isBenchmarkKey(row.symbol) ? labelForBenchmarkKey(row.symbol) : escapeHtmlText(formatDisplaySymbol(row.symbol));
       const hint = benchmarkErrors[row.symbol] ? `<span class="benchmark-error-hint">${escapeHtmlText(benchmarkErrors[row.symbol])}</span>` : "Unavailable";
       return `<tr class="benchmark-row benchmark-row--missing${selectedClass}">
                 <td><strong>${nameHtml}</strong></td>
                 <td colspan="3" class="benchmark-unavailable">${hint}</td>
               </tr>`;
     }

     const payload = row.payload;
     const isInr = payload.currency === "INR";
     const metal = isMetal(payload.symbol);

     let fmt = isInr ? currencyInr : currency;
     let symbolLabel = escapeHtmlText(formatDisplaySymbol(String(payload.symbol)));
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
                <td><strong>${symbolLabel}</strong></td>
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
    <section class="benchmark-section benchmark-section--embedded" aria-labelledby="price-table-heading">
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
      <p class="meta meta--footnote">${REAL_WORLD_ADJUSTMENT_FOOTNOTE}</p>
      <p class="meta meta--footnote" style="margin-top: 0.5rem;"><strong>Note:</strong> This calculator uses Adjusted Close prices (Total Return methodology). It assumes the full value of cash dividends, stock splits, bonus issues, rights issues, and spin-offs (demergers) is instantly reinvested back into the parent stock. It does not track separate spin-off holdings.</p>
    </section>
  `;
}

function renderResultsSections(payload, estimatesBySymbol, benchmarkContext) {
  const isInr = payload.currency === "INR";
  const sipHint = isInr ? "₹10,000/month" : "$100/month";
  const lumpSumHint = isInr ? "₹10,000" : "$100";
  const benchmarkErrors = benchmarkContext.benchmarkErrors ?? {};
  
  const assetType = getAssetType(payload.symbol, payload.companyName);
  const showCorpActions = (assetType === "STOCK") && payload.splitCount !== undefined && payload.dividendCount !== undefined;
  const showCompanyInfo = (assetType === "STOCK" || assetType === "ETF");
  const companyInfoLabel = assetType === "ETF" ? "Fund Info" : "Company Info";

  return `
    <nav class="results-tabs" id="results-tabs" aria-label="Jump to section">
      <button type="button" class="results-tab active" data-target="section-sip">SIP Comparison</button>
      <button type="button" class="results-tab" data-target="section-lumpsum">Lump Sum</button>
      <button type="button" class="results-tab" data-target="section-prices">Price Details</button>
      ${showCorpActions 
        ? `<button type="button" class="results-tab" data-target="section-corp-actions">Corp Actions</button>` 
        : ""
      }
      ${showCompanyInfo
        ? `<button type="button" class="results-tab" data-target="section-company-info">${companyInfoLabel}</button>`
        : ""
      }
    </nav>

    <div id="section-sip" class="result-section">
      <h3 class="benchmark-heading" style="margin-bottom: 1rem;">SIP Comparison (${sipHint})</h3>
      ${renderBenchmarkTable(payload.symbol, estimatesBySymbol, benchmarkContext.comparisonSipStartMonth, sipHint, benchmarkErrors)}
    </div>

    <div id="section-lumpsum" class="result-section">
      <h3 class="benchmark-heading" style="margin-bottom: 1rem;">Lump Sum Comparison (${lumpSumHint})</h3>
      ${renderLumpSumBenchmarkTable(payload.symbol, estimatesBySymbol, benchmarkContext.comparisonSipStartMonth, benchmarkErrors)}
    </div>

    <div id="section-prices" class="result-section">
      <h3 class="benchmark-heading" style="margin-bottom: 1rem;">Price Details</h3>
      ${renderPriceTable(payload.symbol, estimatesBySymbol, benchmarkContext.comparisonSipStartMonth, benchmarkErrors)}
    </div>
  `;
}

function initResultsNav() {
  const tabs = document.querySelectorAll(".results-tab[data-target]");
  if (!tabs.length) return;

  let isClickScrolling = false;

  // Click → smooth scroll to target section
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = document.getElementById(tab.dataset.target);
      if (target) {
        // Immediately highlight the clicked tab
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        tab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        
        // Prevent observer from overriding during the smooth scroll
        isClickScrolling = true;
        setTimeout(() => { isClickScrolling = false; }, 800);
        
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  // Scroll-spy: highlight the tab whose section is in view
  const sections = Array.from(tabs)
    .map(tab => document.getElementById(tab.dataset.target))
    .filter(Boolean);

  if (!sections.length) return;

  const observer = new IntersectionObserver(
    entries => {
      if (isClickScrolling) return; // Ignore intersections triggered by tab clicks
      
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          tabs.forEach(tab => {
            tab.classList.toggle("active", tab.dataset.target === id);
          });
          const activeTab = document.querySelector(`.results-tab[data-target="${id}"]`);
          if (activeTab) activeTab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      });
    },
    {
      rootMargin: "-20% 0px -40% 0px", // More generous intersection area
      threshold: 0
    }
  );

  sections.forEach(s => observer.observe(s));

  // Fallback: If user scrolls to the absolute bottom, force the last tab active.
  // This handles short sections that never reach the top of the viewport.
  window.addEventListener("scroll", () => {
    if (isClickScrolling) return;
    
    // Check if scrolled to bottom
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 50) {
      tabs.forEach(t => t.classList.remove("active"));
      const lastTab = tabs[tabs.length - 1];
      if (lastTab && !lastTab.classList.contains("active")) {
        lastTab.classList.add("active");
        lastTab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, { passive: true });
}


function renderResults(payload, estimatesBySymbol, benchmarkContext) {
  const isMarketCapInr = payload.priceQuote === "INR";
  const adjustedStartNotice = payload.dataRange.adjustedForListing
    ? `<p class="notice">Requested start month was ${payload.dataRange.requestedStartDate}, but ${
        formatDisplaySymbol(payload.symbol)
      } only has market data from ${payload.dataRange.firstAvailableDate}. Investments were started from ${
        payload.dataRange.effectiveStartMonth
      } instead.</p>`
    : "";

  const currentMarketCapFormatted = formatMarketCap(payload.marketCap ?? null, isMarketCapInr);
  
  const assetType = getAssetType(payload.symbol, payload.companyName);
  const showCorpActions = (assetType === "STOCK") && payload.splitCount !== undefined && payload.dividendCount !== undefined;
  const showCompanyInfo = (assetType === "STOCK" || assetType === "ETF");
  const companyInfoHeading = assetType === "ETF" ? "Fund Info" : "Company Info";

  resultsRoot.classList.remove("empty");
  resultsRoot.setAttribute("aria-busy", "false");
  resultsRoot.innerHTML = `
    ${adjustedStartNotice}
    ${renderResultsSections(
      payload,
      estimatesBySymbol,
      benchmarkContext
    )}

    ${
      showCorpActions
        ? `
    <section id="section-corp-actions" class="result-section benchmark-section" aria-labelledby="corporate-actions-heading">
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

    ${
      showCompanyInfo
        ? `
    <section id="section-company-info" class="result-section benchmark-section" aria-labelledby="company-info-heading">
      <h3 id="company-info-heading" class="benchmark-heading">${companyInfoHeading}</h3>
      <div id="company-info-container" class="company-info-section" aria-live="polite">
        ${renderCompanyInfoLoading()}
      </div>
    </section>`
        : ""
    }
  `;

  if (showCompanyInfo) {
    handleLoadCompanyInfo(payload.symbol, payload.companyName, currentMarketCapFormatted);
  }

  // Initialize scroll-spy nav after rendering
  initResultsNav();
}

function renderCompanyInfoLoading() {
  return `
    <div class="company-card company-card--loading">
      <div class="company-card__header">
        <span class="company-card__logo company-card__logo--placeholder shimmer-block" aria-hidden="true"></span>
        <div class="company-card__title-group">
          <span class="shimmer-line shimmer-line--medium"></span>
          <span class="shimmer-line shimmer-line--long"></span>
        </div>
      </div>
      <div class="company-card__facts">
        ${[1, 2, 3, 4].map(() => `
          <div class="company-card__fact">
            <span class="company-card__fact-marker shimmer-block" aria-hidden="true"></span>
            <div>
              <span class="shimmer-line shimmer-line--medium"></span>
              <span class="shimmer-line shimmer-line--long"></span>
            </div>
          </div>
        `).join("")}
      </div>
      <p class="company-card__story">
        <span class="shimmer-line shimmer-line--full"></span>
        <span class="shimmer-line shimmer-line--long"></span>
      </p>
    </div>
  `;
}

async function handleLoadCompanyInfo(symbol, companyName, currentMarketCapFormatted) {
  const container = document.querySelector("#company-info-container");
  if (!container) return;
  
  if (cachedCompanyInfo && cachedCompanyInfo.symbol === symbol) {
    renderCompanyCard(container, cachedCompanyInfo.info, symbol, companyName, currentMarketCapFormatted);
    return;
  }

  try {
    const response = await fetch(`/api/company-info?symbol=${encodeURIComponent(symbol)}`);
    if (!response.ok) throw new Error("Failed to load company info");
    const info = await response.json();

    cachedCompanyInfo = { symbol, info };
    renderCompanyCard(container, info, symbol, companyName, currentMarketCapFormatted);
  } catch (err) {
    console.error(err);
    const safeCompanyName = escapeHtmlText(companyName);
    const safeMarketCap = escapeHtmlText(currentMarketCapFormatted || "N/A");
    container.innerHTML = `
      <div class="company-card">
        <header class="company-card__header">
          <div class="company-card__title-group">
            <h3 class="company-card__name">${safeCompanyName}</h3>
          </div>
        </header>
        <div class="company-card__facts">
          <div class="company-card__fact">
            <span class="company-card__fact-marker" aria-hidden="true"></span>
            <div>
              <div class="company-card__fact-label">Current market cap</div>
              <div class="company-card__fact-value">${safeMarketCap}</div>
            </div>
          </div>
        </div>
        <p class="meta" style="margin-top: 1rem;">Company profile is unavailable right now.</p>
      </div>
    `;
  }
}

function renderCompanyCard(container, info, symbol, companyName, currentMarketCapFormatted) {
  const domain = info.website ? info.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : null;
  const logoUrl = domain ? `https://logo.clearbit.com/${domain}?size=128` : null;
  const hq = [info.city, info.state, info.country].filter(Boolean).join(", ");

  const fmtEmployees = info.fullTimeEmployees
    ? info.fullTimeEmployees >= 1000
      ? (info.fullTimeEmployees / 1000).toFixed(0) + "K+"
      : info.fullTimeEmployees.toLocaleString()
    : null;

  const isIndian = symbol.endsWith(".NS") || symbol.endsWith(".BO");
  const currencySymbol = isIndian ? "₹" : "$";

  const fmtCeoPay = info.ceo?.totalPay
    ? currencySymbol + (info.ceo.totalPay >= 1_000_000
        ? (info.ceo.totalPay / 1_000_000).toFixed(1) + "M"
        : (info.ceo.totalPay / 1000).toFixed(0) + "K")
    : null;

  let facts = [];

  if (info.isETF) {
    const fmtExpenseRatio = info.expenseRatio ? (info.expenseRatio * 100).toFixed(2) + "%" : null;
    const fmtYield = info.yield ? (info.yield * 100).toFixed(2) + "%" : null;

    facts = [
      currentMarketCapFormatted ? { label: "Net Assets", value: currentMarketCapFormatted } : null,
      fmtExpenseRatio ? { label: "Expense Ratio", value: fmtExpenseRatio } : null,
      fmtYield ? { label: "Yield", value: fmtYield } : null,
      info.industry ? { label: "Fund Family", value: info.industry } : null,
      info.sector ? { label: "Category", value: info.sector } : null,
      info.website ? { label: "Website", value: `<a href="${escapeHtmlText(info.website)}" target="_blank" rel="noopener noreferrer">${escapeHtmlText(domain)}</a>`, isHtml: true } : null,
    ].filter(Boolean);
  } else {
    facts = [
      info.foundedYear ? { label: "Founded", value: info.foundedYear } : null,
      currentMarketCapFormatted ? { label: "Current market cap", value: currentMarketCapFormatted } : null,
      fmtEmployees ? { label: "Employees", value: fmtEmployees } : null,
      hq ? { label: "HQ", value: hq } : null,
      info.ceo?.name ? { label: info.ceo.title || "CEO", value: info.ceo.name + (info.ceo.age ? `, age ${info.ceo.age}` : "") } : null,
      fmtCeoPay ? { label: "CEO Pay", value: fmtCeoPay + "/yr" } : null,
      info.website ? { label: "Website", value: `<a href="${escapeHtmlText(info.website)}" target="_blank" rel="noopener noreferrer">${escapeHtmlText(domain)}</a>`, isHtml: true } : null,
    ].filter(Boolean);
  }

  const description = escapeHtmlText(info.description || (info.isETF ? "No fund description available." : "No description available."));
  const safeCompanyName = escapeHtmlText(companyName);
  const safeLogoUrl = logoUrl ? escapeHtmlText(logoUrl) : null;

  container.innerHTML = `
    <div class="company-card animate-fade-in">
      <header class="company-card__header">
        ${safeLogoUrl ? `<img src="${safeLogoUrl}" alt="${safeCompanyName} Logo" class="company-card__logo" onerror="this.style.display='none'">` : ""}
        <div class="company-card__title-group">
          <h3 class="company-card__name">${safeCompanyName}</h3>
          <div class="company-card__meta">
            ${info.sector && !info.isETF ? `<span class="company-card__tag">${escapeHtmlText(info.sector)}</span>` : ""}
            ${info.industry && !info.isETF ? `<span class="company-card__tag company-card__tag--secondary">${escapeHtmlText(info.industry)}</span>` : ""}
            ${info.isETF ? `<span class="company-card__tag company-card__tag--secondary">ETF</span>` : ""}
          </div>
        </div>
      </header>

      ${facts.length > 0 ? `
      <div class="company-card__facts">
        ${facts.map(f => `
          <div class="company-card__fact">
            <span class="company-card__fact-marker" aria-hidden="true"></span>
            <div>
              <div class="company-card__fact-label">${escapeHtmlText(f.label)}</div>
              <div class="company-card__fact-value">${f.isHtml ? f.value : escapeHtmlText(f.value)}</div>
            </div>
          </div>
        `).join("")}
      </div>` : ""}

      <p id="company-description" class="company-card__story company-card__story--clamped">${description}</p>
      <button type="button" id="toggle-company-description" class="btn btn--minimal company-card__read-more" aria-expanded="false" aria-controls="company-description">
          <span>Read more</span>
          <svg class="company-card__read-more-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
    </div>
  `;

  const descriptionNode = container.querySelector("#company-description");
  const toggleBtn = container.querySelector("#toggle-company-description");
  if (descriptionNode && toggleBtn) {
    requestAnimationFrame(() => {
      if (descriptionNode.scrollHeight <= descriptionNode.clientHeight + 2) {
        toggleBtn.remove();
      }
    });
    toggleBtn.addEventListener("click", () => {
      const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";
      toggleBtn.setAttribute("aria-expanded", String(!isExpanded));
      descriptionNode.classList.toggle("company-card__story--clamped", isExpanded);
      toggleBtn.querySelector("span").textContent = isExpanded ? "Read more" : "Read less";
      toggleBtn.querySelector("polyline").setAttribute("points", isExpanded ? "6 9 12 15 18 9" : "18 15 12 9 6 15");
    });
  }
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
    const raw = stockQueryInput.value.trim();
    const inferredSymbol = normaliseSymbolClient(raw.split(/[^A-Za-z0-9.^=&_-]/)[0] || raw);
    const exactResult = lastTickerResults.find(
      (ticker) => ticker.symbol === inferredSymbol || formatDisplaySymbol(ticker.symbol) === inferredSymbol,
    );

    if (exactResult) {
      symbolInput.value = exactResult.symbol;
      const displaySym = formatDisplaySymbol(exactResult.symbol);
      stockQueryInput.value = `${displaySym} — ${exactResult.name}`;
    } else if (inferredSymbol) {
      const market = getMarket();
      const needsIndiaSuffix = market === "in" && !/\.(NS|BO)$/.test(inferredSymbol) && !/^\^/.test(inferredSymbol) && !/=/.test(inferredSymbol);
      symbolInput.value = needsIndiaSuffix ? `${inferredSymbol}.NS` : inferredSymbol;
    }
  }

  if (!symbolInput.value) {
    setStatus("Enter a ticker symbol or pick a search result.", true);
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
    setStatus("Calculating returns…");
    renderProgressState("calculating");

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
    setStatus(`Done. Estimate ready for ${formatDisplaySymbol(primaryPayload.symbol)}.`);
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

stockQueryInput.addEventListener("focus", () => {
  if (symbolInput.value) {
    stockQueryInput.value = "";
    symbolInput.value = "";
    setSelectedState(false);
    clearTickerResults();
  }
  const q = stockQueryInput.value.trim();
  if (q) {
    handleTickerSearch(q);
  }
});

stockQueryInput.addEventListener("input", () => {
  clearTimeout(tickerSearchTimeout);
  tickerSearchTimeout = setTimeout(() => handleTickerSearch(), 250);
});

// Replaced by the focus handler above

stockQueryInput.addEventListener("click", () => {
  // handled by focus
});

stockQueryInput.addEventListener("keydown", (event) => {
  if (!tickerResults.classList.contains("open")) {
    if (event.key === "ArrowDown" && stockQueryInput.value.trim() && lastTickerResults.length > 0) {
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
  const isInsideDropdown = tickerResults.contains(event.target);
  const isSearchInput = event.target === stockQueryInput;
  const isCapsule = event.target.closest(".capsule");
  if (!isInsideDropdown && !isSearchInput && !isCapsule) {
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
      if (getAmountCurrency() === "usd") {
        emptyEl.textContent =
          "Run the estimator for a USD SIP, XIRR, and cost basis for Indian stocks. Returns include the USD/INR currency leg to show true dollar returns for an American investor.";
      } else {
        emptyEl.textContent =
          "Run the estimator for a rupee SIP, XIRR, and cost basis. S&P, QQQ, and metal benchmarks appear in rupees (USD/INR in the background).";
      }
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
    if (stockLabel) stockLabel.textContent = "US stock";
  }
}

function syncInvestorToggleToCurrency() {
  const isInr = getAmountCurrency() === "inr";
  investorUsBtn.setAttribute("aria-pressed", String(!isInr));
  investorInBtn.setAttribute("aria-pressed", String(isInr));
}

/** India market hides the $/₹ control; still sync pressed state so it is never "stuck" on $ if the row is shown. */
function syncInvestorToggleForMarketUI() {
  syncInvestorToggleToCurrency();
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
    investorCurrencyWrap.hidden = false;
  }
  syncInvestorToggleForMarketUI();
  syncMarketToggles();
  updateShellForMarket();
  resultsRoot.classList.add("empty");
  resultsRoot.setAttribute("aria-busy", "false");
  resultsRoot.innerHTML = getEmptyResultsInnerHtml();
  updateInvestorCopy();
  renderProgressState("idle");
  setStatus(`Selected ${formatDisplaySymbol(def.symbol)}. Ready to estimate.`);
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
  const im = resolveInvestorMode(next);
  setAmountCurrency(im === "in" ? "inr" : "usd");
  resetToCleanView();
}

function applyInvestorModeFromToggle(mode) {
  const next = mode === "in" ? "in" : "us";
  if (lastInvestorMode === next) {
    return;
  }
  writeSessionInvestorMode(next);
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
  localStorage.removeItem(INVESTOR_STORAGE_KEY);
  const im = resolveInvestorMode(currentMarket);
  setAmountCurrency(im === "in" ? "inr" : "usd");
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
// Capsule Logic
if (searchCapsules) {
  searchCapsules.addEventListener("mousedown", (e) => {
    // Prevent blur on input which would close dropdown
    e.preventDefault();
  });
  searchCapsules.addEventListener("click", (e) => {
    const btn = e.target.closest(".capsule");
    if (!btn) return;

    searchCapsules.querySelectorAll(".capsule").forEach(c => {
      c.classList.remove("active");
      c.setAttribute("aria-selected", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    activeCategory = btn.dataset.category;

    // Clear symbol if they had a prior selection and re-search
    if (symbolInput.value) {
      symbolInput.value = "";
      setSelectedState(false);
    }

    const query = stockQueryInput.value.trim();
    if (query) {
      handleTickerSearch(query);
    } else {
      clearTickerResults();
    }
  });
}
