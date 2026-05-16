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
