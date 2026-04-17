/**
 * Parse monthly EXINUS CSV (e.g. observation_date,EXINUS columns).
 * INR per 1 USD per month.
 */
export function parseExinusMonthlyCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("observation_date")) {
      continue;
    }
    const comma = trimmed.indexOf(",");
    if (comma === -1) {
      continue;
    }
    const date = trimmed.slice(0, comma).trim();
    const close = Number(trimmed.slice(comma + 1).trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close)) {
      continue;
    }
    rows.push({ date, close });
  }
  return rows;
}

/** Keep rows in [effectiveStartMonth, yahooFirstMonth) — monthly keys YYYY-MM. */
export function filterExinusRowsForPreYahooGap(rows, effectiveStartMonth, yahooFirstDate) {
  const yahooMonth = yahooFirstDate.slice(0, 7);
  return rows.filter((r) => {
    const m = r.date.slice(0, 7);
    return m >= effectiveStartMonth && m < yahooMonth;
  });
}
