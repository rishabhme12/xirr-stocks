import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataRoot = path.join(__dirname, "../../data");

/** https://datahub.io/core/gold-prices/ — monthly USD/troy oz, Date = first of month. */
export const DATAHUB_GOLD_CSV_URL = "https://datahub.io/core/gold-prices/_r/-/data/monthly-processed.csv";

export function lastDayOfUtcMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Datahub gold-prices: `Date,Price` with ISO dates (monthly).
 * @returns {Array<{ month: string, date: string, close: number }>}
 */
export function parseDatahubDatePriceCsv(text) {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return [];
  }
  let start = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^date\s*,\s*price/i.test(lines[i]) || /^\d{4}-\d{2}-\d{2}\s*,/.test(lines[i])) {
      start = /^date/i.test(lines[i]) ? i + 1 : i;
      break;
    }
  }
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    if (parts.length < 2) {
      continue;
    }
    const dateRaw = parts[0].trim();
    const closeRaw = parts[1].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      continue;
    }
    const close = Number(closeRaw);
    if (!Number.isFinite(close)) {
      continue;
    }
    const month = dateRaw.slice(0, 7);
    out.push({ month, date: lastDayOfUtcMonth(month), close });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Investing.com-style export: first column `DD-MM-YYYY`, second column Price.
 * @returns {Array<{ month: string, date: string, close: number }>}
 */
export function parseQuotedDmyPriceCsv(text) {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return [];
  }
  const out = [];
  const start = /^"date"/i.test(lines[0]) ? 1 : 0;
  for (let i = start; i < lines.length; i += 1) {
    const m = lines[i].match(/^"(\d{2})-(\d{2})-(\d{4})","([\d.]+)"/);
    if (!m) {
      continue;
    }
    const [, dd, mm, yyyy, priceStr] = m;
    const month = `${yyyy}-${mm}`;
    const close = Number(priceStr);
    if (!Number.isFinite(close)) {
      continue;
    }
    out.push({ month, date: lastDayOfUtcMonth(month), close });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

async function tryReadFirstExisting(paths) {
  for (const p of paths) {
    try {
      const text = await readFile(p, "utf8");
      return { text, path: p };
    } catch (err) {
      if (!err || err.code !== "ENOENT") {
        throw err;
      }
    }
  }
  return null;
}

function filterFromMinMonth(rows, minYm) {
  return rows.filter((r) => r.month >= minYm);
}

/**
 * Gold: Datahub CSV in `data/` (see filenames). Optional fetch if missing.
 */
export async function loadGoldMonthlyRowsFromDataDir(minMonth, { fetchIfMissing = true } = {}) {
  const candidates = [
    path.join(dataRoot, "gold-monthly-datahub.csv"),
    path.join(dataRoot, "monthly-processed.csv"),
  ];
  let got = await tryReadFirstExisting(candidates);
  if (!got && fetchIfMissing) {
    const response = await fetch(DATAHUB_GOLD_CSV_URL, {
      headers: { "User-Agent": "xirr-stocks/1.0 metal-monthly-files" },
    });
    if (!response.ok) {
      return [];
    }
    const text = await response.text();
    got = { text, path: DATAHUB_GOLD_CSV_URL };
  }
  if (!got) {
    return [];
  }
  return filterFromMinMonth(parseDatahubDatePriceCsv(got.text), minMonth);
}

/**
 * Silver: Datahub-style `Date,Price` or Investing XAG export under `data/`.
 */
function parseSilverMonthlyText(text) {
  const head = text
    .split(/\n/)
    .find((l) => l.trim().length > 0)
    ?.trim()
    .toLowerCase();
  if (head && head.startsWith('"date"') && text.includes('"') && /\d{2}-\d{2}-\d{4}/.test(text)) {
    return parseQuotedDmyPriceCsv(text);
  }
  return parseDatahubDatePriceCsv(text);
}

export async function loadSilverMonthlyRowsFromDataDir(minMonth) {
  const candidates = [
    path.join(dataRoot, "silver-monthly-datahub.csv"),
    path.join(dataRoot, "silver-monthly.csv"),
    path.join(dataRoot, "XAG_USD Historical Data.csv"),
  ];
  const got = await tryReadFirstExisting(candidates);
  if (!got) {
    return [];
  }
  const rows = parseSilverMonthlyText(got.text);
  return filterFromMinMonth(rows, minMonth);
}
