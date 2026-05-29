/** Yahoo caret indices by home market (caret alone is not enough to infer region). */
export const US_INDEX_SYMBOLS = new Set([
  "^GSPC",
  "^SPX",
  "^OEX",
  "^MID",
  "^IXIC",
  "^NDX",
  "^NDXT",
  "^NDXX",
  "^DJI",
  "^NYA",
  "^RUT",
  "^RUI",
  "^RUA",
  "^RUJ",
  "^RUO",
]);
export const INDIA_INDEX_SYMBOLS = new Set([
  "^NSEI",
  "^BSESN",
  "^NSEBANK",
  "^CNXIT",
  "^NSEMDCP50",
  "^CRSLDX",
  "^CNXPHARMA",
  "^CNXAUTO",
  "^CNXFMCG",
  "^CNXMETAL",
  "^CNXENERGY",
  "^CNXREALTY",
  "^CNXMEDIA",
  "^CNXINFRA",
]);

export const VALID_LONG_TERM_INDICES = new Set([
  // US & Global Flagships
  "^GSPC",     // S&P 500
  "^SPX",      // S&P 500 Alternative
  "^OEX",      // S&P 100
  "^MID",      // S&P MidCap 400
  "^IXIC",     // Nasdaq Composite
  "^NDX",      // Nasdaq 100
  "^NDXT",     // Nasdaq-100 Technology Sector
  "^NDXX",     // Nasdaq-100 Ex-Tech Sector
  "^DJI",      // Dow Jones Industrial Average
  "^NYA",      // NYSE Composite
  "^RUT",      // Russell 2000
  "^RUI",      // Russell 1000
  "^RUA",      // Russell 3000
  "^RUJ",      // Russell 2000 Growth
  "^RUO",      // Russell 2000 Value
  "^VIX",      // CBOE Volatility Index
  "^NDXE",     // Nasdaq-100 Equal Weighted Index (USD)
  "^FTSE",     // FTSE 100
  "^N225",     // Nikkei 225
  "^GDAXI",    // DAX Index
  "^HSI",      // Hang Seng Index
  "^SSMI",     // Swiss Market Index
  "^FCHI",     // CAC 40
  "^BFX",      // BEL 20

  // Indian Flagships
  "^NSEI",       // Nifty 50
  "^BSESN",      // S&P BSE SENSEX
  "^NSEBANK",    // Nifty Bank
  "^CNXIT",      // Nifty IT
  "^NSEMDCP50",  // Nifty Midcap 50
  "^CRSLDX",     // Nifty 500
  "^CNXPHARMA",  // Nifty Pharma
  "^CNXAUTO",    // Nifty Auto
  "^CNXFMCG",    // Nifty FMCG
  "^CNXMETAL",   // Nifty Metal
  "^CNXENERGY",  // Nifty Energy
  "^CNXREALTY",  // Nifty Realty
  "^CNXMEDIA",   // Nifty Media
  "^CNXINFRA",   // Nifty Infra
]);


/** Human-readable NSE index names (Yahoo/screener often return only the caret symbol). */
export const INDIA_INDEX_DISPLAY_NAMES = {
  "^NSEI": "Nifty 50",
  "^BSESN": "S&P BSE Sensex",
  "^NSEBANK": "Nifty Bank",
  "^CNXIT": "Nifty IT",
  "^NSEMDCP50": "Nifty Midcap 50",
  "^CRSLDX": "Nifty 500",
  "^CNXPHARMA": "Nifty Pharma",
  "^CNXAUTO": "Nifty Auto",
  "^CNXFMCG": "Nifty FMCG",
  "^CNXMETAL": "Nifty Metal",
  "^CNXENERGY": "Nifty Energy",
  "^CNXREALTY": "Nifty Realty",
  "^CNXMEDIA": "Nifty Media",
  "^CNXINFRA": "Nifty Infra",
};

/** Normalized query → Yahoo index symbol (Nifty 500 is ^CRSLDX, not NIFTY500.*). */
export const INDIA_INDEX_SEARCH_ALIASES = {
  NIFTY50: "^NSEI",
  NIFTY500: "^CRSLDX",
  SENSEX: "^BSESN",
  NIFTYPHARMA: "^CNXPHARMA",
  NIFTYMIDCAP50: "^NSEMDCP50",
  NIFTYMIDCAP: "^NSEMDCP50",
};

/**
 * US index brand words → flagship caret symbols for live expansion
 * (Yahoo name search often returns 0 INDEX rows for "nasdaq", "dow", etc.).
 */
export const US_INDEX_KEYWORD_ALIASES = {
  NASDAQ: ["^IXIC", "^NDX", "^NDXT", "^NDXX", "^NDXE"],
  DOW: ["^DJI"],
  DJIA: ["^DJI"],
  RUSSELL: ["^RUT", "^RUI", "^RUA", "^RUJ", "^RUO"],
  SP: ["^GSPC", "^SPX", "^OEX", "^MID"],
  SNP: ["^GSPC", "^SPX", "^OEX", "^MID"],
  "S&P": ["^GSPC", "^SPX", "^OEX", "^MID"],
};

/** US ETF brand words → ticker to search when the name lacks the brand (e.g. QQQ vs "nasdaq"). */
export const US_ETF_KEYWORD_SEED_QUERIES = {
  NASDAQ: "QQQ",
  DOW: "DIA",
  DJIA: "DIA",
  RUSSELL: "IWM",
  SP500: "SPY",
  SNP: "SPY",
  SP: "SPY",
  "S&P": "SPY",
};

/** Sector/theme words → index (Yahoo typeahead needs "nifty pharma", not "pharma" alone). */
export const INDIA_INDEX_KEYWORD_ALIASES = {
  PHARMA: "^CNXPHARMA",
  BANK: "^NSEBANK",
  AUTO: "^CNXAUTO",
  FMCG: "^CNXFMCG",
  METAL: "^CNXMETAL",
  ENERGY: "^CNXENERGY",
  REALTY: "^CNXREALTY",
  MEDIA: "^CNXMEDIA",
  INFRA: "^CNXINFRA",
  MIDCAP: "^NSEMDCP50",
};

export function normalizeSearchKey(text) {
  return String(text || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const INAV_SYMBOL_RE = /INAV/i;
const BHARAT_BOND_SYMBOL_RE = /BHARATBOND/i;
const US_ETF_TICKER_RE = /^[A-Z][A-Z0-9-]{0,19}$/;

/**
 * India index typeahead: Yahoo caret indices only (^NSEI, ^NSEBANK, etc.).
 * @deprecated Use isSearchableIndexSymbol(symbol, "in")
 */
export function isSearchableIndiaIndexSymbol(symbol) {
  return isSearchableIndexSymbol(symbol, "in");
}

export function isSearchableIndexSymbol(symbol, market = "all") {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!sym.startsWith("^")) {
    return false;
  }
  if (market === "us") {
    return !INDIA_INDEX_SYMBOLS.has(sym);
  }
  if (market === "in") {
    return INDIA_INDEX_SYMBOLS.has(sym);
  }
  return true;
}


/**
 * Continuous Yahoo futures only (GC=F). Excludes dated exchange contracts (XUTM26.CME).
 * @param {string} symbol
 */
export function isSearchableCommoditySymbol(symbol) {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  return /^[A-Z0-9]+=F$/.test(sym);
}

/**
 * @param {string} symbol
 * @param {"us" | "in" | "all"} [market="all"]
 */
export function isSearchableEtfSymbol(symbol, market = "all") {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!sym || sym.startsWith("^") || sym.includes("=")) {
    return false;
  }
  if (INAV_SYMBOL_RE.test(sym) || BHARAT_BOND_SYMBOL_RE.test(sym)) {
    return false;
  }
  if (/\.\w{2,}$/.test(sym) && !/\.(NS|BO)$/.test(sym)) {
    return false;
  }

  if (market === "in") {
    return /\.(NS|BO)$/.test(sym);
  }
  if (market === "us") {
    return !/\.(NS|BO)$/.test(sym) && US_ETF_TICKER_RE.test(sym);
  }
  if (/\.(NS|BO)$/.test(sym)) {
    return true;
  }
  return US_ETF_TICKER_RE.test(sym);
}

/**
 * @param {string} symbol
 * @param {"index" | "etf" | "commodity"} category
 * @param {"us" | "in" | "all"} [market="all"]
 */
export function isSearchableSpecialtySymbol(symbol, category, market = "all") {
  switch (category) {
    case "index":
      return isSearchableIndexSymbol(symbol, market);
    case "etf":
      return isSearchableEtfSymbol(symbol, market);
    case "commodity":
      return isSearchableCommoditySymbol(symbol);
    default:
      return true;
  }
}

/**
 * @param {string} symbol
 * @param {"index" | "etf" | "commodity"} category
 * @param {"us" | "in" | "all"} requestedMarket
 */
export function inferSpecialtyRowMarket(symbol, category, requestedMarket = "all") {
  if (requestedMarket !== "all") {
    return requestedMarket;
  }
  const sym = String(symbol || "").toUpperCase();
  if (category === "index") {
    if (INDIA_INDEX_SYMBOLS.has(sym)) {
      return "in";
    }
    if (US_INDEX_SYMBOLS.has(sym)) {
      return "us";
    }
    return "all";
  }
  if (category === "etf") {
    return /\.(NS|BO)$/.test(sym) ? "in" : "us";
  }
  return "us";
}

/**
 * @param {{ symbol: string; category?: string }} row
 * @param {"index" | "etf" | "commodity" | "all"} category
 * @param {"us" | "in" | "all"} market
 */
export function filterSearchableSpecialtyRows(rows, category, market = "all") {
  return rows.filter((row) => {
    const cat = category === "all" ? row.category : category;
    if (cat !== "index" && cat !== "etf" && cat !== "commodity") {
      return true;
    }
    const rowMarket = inferSpecialtyRowMarket(row.symbol, cat, market);
    return isSearchableSpecialtySymbol(row.symbol, cat, rowMarket);
  });
}

/** @returns {string[]} caret symbols to expand via Yahoo for US index typeahead */
export function resolveUsIndexKeywordSeeds(query) {
  const key = normalizeSearchKey(query);
  if (!key) {
    return [];
  }
  if (US_INDEX_KEYWORD_ALIASES[key]) {
    return [...US_INDEX_KEYWORD_ALIASES[key]];
  }
  const seeds = [];
  for (const [word, symbols] of Object.entries(US_INDEX_KEYWORD_ALIASES)) {
    if (key === word || (word.length >= 4 && key.includes(word))) {
      for (const sym of symbols) {
        if (!seeds.includes(sym)) {
          seeds.push(sym);
        }
      }
    }
  }
  return seeds;
}

/** @returns {string[]} ETF tickers to query when brand name search returns nothing */
export function resolveUsEtfKeywordSeedQueries(query) {
  const key = normalizeSearchKey(query);
  if (!key) {
    return [];
  }
  const out = [];
  if (US_ETF_KEYWORD_SEED_QUERIES[key]) {
    out.push(US_ETF_KEYWORD_SEED_QUERIES[key]);
  }
  for (const [word, seed] of Object.entries(US_ETF_KEYWORD_SEED_QUERIES)) {
    if (key === word || (word.length >= 4 && key.includes(word))) {
      if (!out.includes(seed)) {
        out.push(seed);
      }
    }
  }
  if (key === "S&P" || key.includes("SNP")) {
    for (const seed of ["SPY", "VOO", "MDY", "IJR", "OEF"]) {
      if (!out.includes(seed)) {
        out.push(seed);
      }
    }
  }
  return out;
}

export function resolveIndiaIndexAlias(query) {
  const key = normalizeSearchKey(query);
  if (INDIA_INDEX_SEARCH_ALIASES[key]) {
    return INDIA_INDEX_SEARCH_ALIASES[key];
  }
  if (key.startsWith("NIFTY")) {
    const tail = key.slice(5);
    if (tail && INDIA_INDEX_KEYWORD_ALIASES[tail]) {
      return INDIA_INDEX_KEYWORD_ALIASES[tail];
    }
    if (tail && INDIA_INDEX_SEARCH_ALIASES[`NIFTY${tail}`]) {
      return INDIA_INDEX_SEARCH_ALIASES[`NIFTY${tail}`];
    }
  }
  for (const [word, sym] of Object.entries(INDIA_INDEX_KEYWORD_ALIASES)) {
    if (key === word || (word.length >= 4 && key.includes(word))) {
      return sym;
    }
  }
  return null;
}

/** Replace Yahoo caret codes with NSE-style index names when the feed only sends a symbol. */
export function enrichTickerDisplayName(row) {
  if (!row?.symbol) {
    return row;
  }
  const sym = String(row.symbol).toUpperCase();
  const label = INDIA_INDEX_DISPLAY_NAMES[sym];
  if (label) {
    return { ...row, name: label };
  }
  const name = String(row.name || "").trim();
  if (!name || name.toUpperCase() === sym || name.startsWith("^")) {
    return row;
  }
  return row;
}

function isIndiaMarketCaretIndex(sym) {
  return INDIA_INDEX_SYMBOLS.has(sym);
}

/**
 * Whether a benchmark row belongs in US vs India typeahead (not amount currency).
 * @param {{ symbol: string, category?: string }} entry
 * @param {"us" | "in" | "all"} market
 */
export function benchmarkEntryForMarket(entry, market) {
  if (market === "all") {
    return true;
  }
  const sym = String(entry.symbol || "").toUpperCase();
  if (market === "in") {
    if (sym.endsWith(".NS") || sym.endsWith(".BO")) {
      return true;
    }
    if (isIndiaMarketCaretIndex(sym)) {
      return true;
    }
    if (US_INDEX_SYMBOLS.has(sym)) {
      return false;
    }
    if (entry.category === "commodity" || sym.endsWith("=F")) {
      return true;
    }
    return false;
  }
  if (sym.endsWith(".NS") || sym.endsWith(".BO") || INDIA_INDEX_SYMBOLS.has(sym)) {
    return false;
  }
  return true;
}

/**
 * Major market indices and commodities for search suggestions.
 * Includes both US and India markets.
 */
export const MARKET_BENCHMARKS = [
  // INDICES - US
  { symbol: "^GSPC", name: "S&P 500 Index", exchange: "INDEX", category: "index" },
  { symbol: "^OEX", name: "S&P 100 Index", exchange: "INDEX", category: "index" },
  { symbol: "^MID", name: "S&P MidCap 400 Index", exchange: "INDEX", category: "index" },
  { symbol: "^IXIC", name: "Nasdaq Composite", exchange: "INDEX", category: "index" },
  { symbol: "^NDX", name: "Nasdaq-100 Index", exchange: "INDEX", category: "index" },
  { symbol: "^DJI", name: "Dow Jones Industrial Average", exchange: "INDEX", category: "index" },
  { symbol: "^NYA", name: "NYSE Composite", exchange: "INDEX", category: "index" },
  { symbol: "^RUT", name: "Russell 2000", exchange: "INDEX", category: "index" },
  
  // INDICES - INDIA
  { symbol: "^NSEI", name: "Nifty 50", exchange: "INDEX", category: "index" },
  { symbol: "^BSESN", name: "S&P BSE SENSEX", exchange: "INDEX", category: "index" },
  { symbol: "^NSEBANK", name: "Nifty Bank", exchange: "INDEX", category: "index" },
  { symbol: "^CNXIT", name: "Nifty IT", exchange: "INDEX", category: "index" },
  { symbol: "^NSEMDCP50", name: "Nifty Midcap 50", exchange: "INDEX", category: "index" },
  { symbol: "^CRSLDX", name: "Nifty 500", exchange: "INDEX", category: "index" },
  { symbol: "^CNXPHARMA", name: "Nifty Pharma", exchange: "INDEX", category: "index" },


  // COMMODITIES
  { symbol: "GC=F", name: "Gold Futures", exchange: "COMEX", category: "commodity" },
  { symbol: "SI=F", name: "Silver Futures", exchange: "COMEX", category: "commodity" },
  { symbol: "CL=F", name: "Crude Oil Futures", exchange: "NYMEX", category: "commodity" },
  { symbol: "HG=F", name: "Copper Futures", exchange: "COMEX", category: "commodity" },
  { symbol: "PL=F", name: "Platinum Futures", exchange: "NYMEX", category: "commodity" },
  
  // POPULAR ETFs - US
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", exchange: "ARCA", category: "etf" },
  { symbol: "OEF", name: "iShares S&P 100 ETF", exchange: "ARCA", category: "etf" },
  { symbol: "MDY", name: "SPDR S&P MidCap 400 ETF Trust", exchange: "ARCA", category: "etf" },
  { symbol: "IJR", name: "iShares Core S&P Small-Cap ETF", exchange: "ARCA", category: "etf" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", exchange: "NASDAQ", category: "etf" },
  { symbol: "VTI", name: "Vanguard Total Stock Market ETF", exchange: "ARCA", category: "etf" },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", exchange: "ARCA", category: "etf" },
  { symbol: "ARKK", name: "ARK Innovation ETF", exchange: "ARCA", category: "etf" },
  { symbol: "GLD", name: "SPDR Gold Shares", exchange: "ARCA", category: "etf" },
  { symbol: "SLV", name: "iShares Silver Trust", exchange: "ARCA", category: "etf" },
  
  // POPULAR ETFs - INDIA
  { symbol: "NIFTYBEES.NS", name: "Nippon India ETF Nifty BEES", exchange: "NSE", category: "etf" },
  { symbol: "JUNIORBEES.NS", name: "Nippon India ETF Junior BEES", exchange: "NSE", category: "etf" },
  { symbol: "BANKBEES.NS", name: "Nippon India ETF Bank BEES", exchange: "NSE", category: "etf" },
  { symbol: "GOLDBEES.NS", name: "Nippon India ETF Gold BEES", exchange: "NSE", category: "etf" },
  { symbol: "SILVERBEES.NS", name: "Nippon India ETF Silver BEES", exchange: "NSE", category: "etf" },
  { symbol: "ICICINIFTY.NS", name: "ICICI Prudential Nifty 50 ETF", exchange: "NSE", category: "etf" },
  { symbol: "SETFNIF50.NS", name: "SBI ETF Nifty 50", exchange: "NSE", category: "etf" }
];
