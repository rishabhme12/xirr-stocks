/** Yahoo caret indices by home market (caret alone is not enough to infer region). */
export const US_INDEX_SYMBOLS = new Set(["^GSPC", "^IXIC", "^DJI", "^NYA", "^RUT"]);
export const INDIA_INDEX_SYMBOLS = new Set([
  "^NSEI",
  "^BSESN",
  "^NSEBANK",
  "^CNXIT",
  "^CNXMIDCAP",
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

/** Human-readable NSE index names (Yahoo/screener often return only the caret symbol). */
export const INDIA_INDEX_DISPLAY_NAMES = {
  "^NSEI": "Nifty 50",
  "^BSESN": "S&P BSE Sensex",
  "^NSEBANK": "Nifty Bank",
  "^CNXIT": "Nifty IT",
  "^CNXMIDCAP": "Nifty Midcap 50",
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
};

export function normalizeSearchKey(text) {
  return String(text || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
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
    if (INDIA_INDEX_SYMBOLS.has(sym)) {
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
  { symbol: "^IXIC", name: "Nasdaq Composite", exchange: "INDEX", category: "index" },
  { symbol: "^DJI", name: "Dow Jones Industrial Average", exchange: "INDEX", category: "index" },
  { symbol: "^NYA", name: "NYSE Composite", exchange: "INDEX", category: "index" },
  { symbol: "^RUT", name: "Russell 2000", exchange: "INDEX", category: "index" },
  
  // INDICES - INDIA
  { symbol: "^NSEI", name: "Nifty 50", exchange: "INDEX", category: "index" },
  { symbol: "^BSESN", name: "S&P BSE SENSEX", exchange: "INDEX", category: "index" },
  { symbol: "^NSEBANK", name: "Nifty Bank", exchange: "INDEX", category: "index" },
  { symbol: "^CNXIT", name: "Nifty IT", exchange: "INDEX", category: "index" },
  { symbol: "^CNXMIDCAP", name: "Nifty Midcap 50", exchange: "INDEX", category: "index" },
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
