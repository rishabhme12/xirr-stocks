function choosePurchasePrice(monthlyRows, desiredDay) {
  const atOrAfter = monthlyRows.find((row) => {
    const day = Number(row.date.slice(8, 10));
    return day >= desiredDay;
  });
  return atOrAfter || monthlyRows[monthlyRows.length - 1];
}

function monthKeyFromIso(isoDate) {
  return isoDate.slice(0, 7);
}

/** Merge pre-Yahoo rows + Yahoo daily INR-per-USD; Yahoo overwrites on duplicate dates. */
export function mergeInrPerUsdDaily(preYahooDaily, yahooDaily) {
  const byDate = new Map();
  for (const row of preYahooDaily) {
    if (Number.isFinite(row.close)) {
      byDate.set(row.date, row.close);
    }
  }
  for (const row of yahooDaily) {
    if (Number.isFinite(row.close)) {
      byDate.set(row.date, row.close);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, close]) => ({ date, close }));
}

function groupFxByMonth(dailyPrices) {
  const byMonth = new Map();
  for (const row of dailyPrices) {
    const key = monthKeyFromIso(row.date);
    if (!byMonth.has(key)) {
      byMonth.set(key, []);
    }
    byMonth.get(key).push(row);
  }
  return byMonth;
}

/** INR per 1 USD on the given calendar date (same purchase-day logic as equities). */
export function resolveInrPerUsdForDate(mergedDaily, isoDate, purchaseDay) {
  const key = monthKeyFromIso(isoDate);
  const byMonth = groupFxByMonth(mergedDaily);
  const rows = byMonth.get(key);
  if (!rows?.length) {
    return null;
  }
  const row = choosePurchasePrice(rows, purchaseDay);
  return row.close;
}

/**
 * INR per USD on the valuation snapshot date (exact bar if present, else last trading day
 * in that month on or before the valuation calendar day).
 */
export function resolveInrPerUsdForValuationDate(mergedDaily, valuationIsoDate) {
  const exact = mergedDaily.find((r) => r.date === valuationIsoDate);
  if (exact && Number.isFinite(exact.close)) {
    return exact.close;
  }
  const prefix = valuationIsoDate.slice(0, 7);
  const day = Number(valuationIsoDate.slice(8, 10));
  const monthRows = mergedDaily.filter((r) => r.date.startsWith(prefix));
  if (!monthRows.length) {
    return null;
  }
  const sorted = [...monthRows].sort((a, b) => a.date.localeCompare(b.date));
  let best = null;
  for (const row of sorted) {
    const d = Number(row.date.slice(8, 10));
    if (d <= day && Number.isFinite(row.close)) {
      best = row.close;
    }
  }
  if (best !== null) {
    return best;
  }
  const last = sorted[sorted.length - 1];
  return Number.isFinite(last?.close) ? last.close : null;
}

/** Calendar day immediately before `isoDate` (YYYY-MM-DD). */
export function dayBeforeIsoDate(isoDate) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
