const NSE_EQUITY_CSV = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const UA = (process.env.YAHOO_USER_AGENT || "Mozilla/5.0 xirr-stocks/1.0").trim();

/**
 * NSE format: SYMBOL,NAME,SERIES,DATE,PAID_UP,MARKET_LOT,ISIN,FACE; NAME may contain commas.
 * @param {string} line
 * @returns {{ symbol: string; name: string; series: string; isin: string } | null}
 */
export function parseNseEquityLine(line) {
  const parts = line.split(",");
  if (parts.length < 8) {
    return null;
  }
  const symbol = parts[0].trim();
  if (!/^[A-Z0-9][A-Z0-9&-]*$/i.test(symbol)) {
    return null;
  }
  const face = parts[parts.length - 1].trim();
  const isin = parts[parts.length - 2].trim();
  const series = parts[parts.length - 6].trim();
  const name = parts
    .slice(1, -6)
    .join(",")
    .trim();
  if (!name || !/^INE/i.test(isin) || !/^\d+$/.test(face)) {
    return null;
  }
  return { symbol: symbol.toUpperCase(), name, series, isin: isin.toUpperCase() };
}

/** @returns {Promise<Array<{ symbol: string; name: string; exchange: string; isin: string; category: string }>>} */
export async function fetchNseIndiaEquityTickers() {
  const text = await fetch(NSE_EQUITY_CSV, {
    headers: { "User-Agent": UA, Accept: "text/csv" },
  }).then((r) => {
    if (!r.ok) {
      throw new Error(`NSE EQUITY_L request failed: ${r.status} ${r.statusText}`);
    }
    return r.text();
  });

  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0];
  if (!/SYMBOL.*ISIN/i.test(header)) {
    throw new Error("Unexpected NSE header row.");
  }

  const rows = [];
  const seen = new Set();
  for (const line of lines.slice(1)) {
    const row = parseNseEquityLine(line);
    if (!row) {
      continue;
    }
    if (seen.has(row.symbol)) {
      continue;
    }
    seen.add(row.symbol);
    rows.push({
      symbol: `${row.symbol}.NS`,
      name: row.name,
      exchange: "NSE",
      isin: row.isin,
      category: "stock",
    });
  }

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol, "en"));
  return rows;
}

const INDIA_ETF_NAME = /\b(ETF|BEES|Exchange Traded Fund)\b/i;

/** ETFs listed on NSE (name heuristic; Yahoo screener has no India ETF universe). */
export function extractIndiaEtfRowsFromEquities(equityRows) {
  return equityRows
    .filter((r) => INDIA_ETF_NAME.test(r.name))
    .map((r) => ({ ...r, category: "etf" }));
}
