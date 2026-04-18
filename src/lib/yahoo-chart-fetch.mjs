/**
 * Yahoo Finance chart API rate-limits burst traffic. Space requests out, honour
 * Retry-After on 429, retry transient HTTP + network errors, and **time out** hung requests
 * so the UI never waits indefinitely.
 *
 * After exhausting retries on `query1`, a single pass on `query2` may succeed when Yahoo
 * rate-limits by hostname.
 */
import { logDebug, logInfo, logWarn } from "./logger.mjs";

let lastYahooChartEnd = 0;
/** Tuning: `YAHOO_MIN_GAP_MS`, `YAHOO_MAX_ATTEMPTS`, `YAHOO_FAST_429`, `YAHOO_FETCH_TIMEOUT_MS` */
const MIN_GAP_MS = Math.min(5000, Math.max(200, Number(process.env.YAHOO_MIN_GAP_MS) || 550));
const MAX_ATTEMPTS = Math.min(12, Math.max(1, Number(process.env.YAHOO_MAX_ATTEMPTS) || 4));
/** Default on: stop hammering one host on 429; set YAHOO_FAST_429=0 to use long backoff retries. */
const FAST_429 =
  process.env.YAHOO_FAST_429 !== "0" && process.env.YAHOO_FAST_429 !== "false";
/** Per-attempt ceiling so a stuck socket cannot block forever (ms). */
const FETCH_TIMEOUT_MS = Math.min(120_000, Math.max(5000, Number(process.env.YAHOO_FETCH_TIMEOUT_MS) || 22_000));

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** @returns {AbortSignal} */
function createTimeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** @param {Response} response */
function retryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) {
    return null;
  }
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) {
    return Math.min(sec * 1000, 60_000);
  }
  return null;
}

/** Swap query1 ↔ query2 so we can fail over after 429. */
function alternateYahooChartHost(urlStr) {
  if (urlStr.includes("query1.finance.yahoo.com")) {
    return urlStr.replace("https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com");
  }
  if (urlStr.includes("query2.finance.yahoo.com")) {
    return urlStr.replace("https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com");
  }
  return urlStr;
}

/** Best-effort symbol for logs (chart path segment before `?`). */
function chartSymbolForLog(urlStr) {
  try {
    const q = urlStr.indexOf("?");
    const base = q === -1 ? urlStr : urlStr.slice(0, q);
    const idx = base.indexOf("/chart/");
    if (idx === -1) {
      return "?";
    }
    return decodeURIComponent(base.slice(idx + 7));
  } catch {
    return "?";
  }
}

/**
 * @param {string} url Full chart API URL
 * @param {{ alternateHostTried?: boolean }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchYahooChartResponse(url, options = {}) {
  const alternateHostTried = options.alternateHostTried === true;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 xirr-stocks/1.0",
    Accept: "application/json",
  };

  let lastResponse = /** @type {Response | null} */ (null);
  let lastError = /** @type {unknown} */ (null);
  const sym = chartSymbolForLog(url);

  if (!alternateHostTried) {
    try {
      logInfo("yahoo-chart", "chart fetch", { symbol: sym, host: new URL(url).hostname });
    } catch {
      logInfo("yahoo-chart", "chart fetch", { symbol: sym });
    }
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const now = Date.now();
    const wait = Math.max(0, MIN_GAP_MS - (now - lastYahooChartEnd));
    if (wait > 0) {
      await sleep(wait);
    }

    try {
      const t0 = Date.now();
      const response = await fetch(url, {
        headers,
        signal: createTimeoutSignal(FETCH_TIMEOUT_MS),
      });
      const elapsedMs = Date.now() - t0;
      lastYahooChartEnd = Date.now();
      lastResponse = response;

      logDebug("yahoo-chart", "fetch done", {
        symbol: sym,
        attempt: attempt + 1,
        status: response.status,
        ok: response.ok,
        ms: elapsedMs,
      });

      if (response.ok) {
        return response;
      }

      const status = response.status;
      if (status === 429 && FAST_429) {
        logWarn("yahoo-chart", "YAHOO_FAST_429: no multi-retry backoff on this host; trying alternate next", {
          symbol: sym,
          attempt: attempt + 1,
        });
        break;
      }
      const retryableHttp = [400, 429, 502, 503, 504].includes(status);
      if (!retryableHttp || attempt === MAX_ATTEMPTS - 1) {
        break;
      }

      let delay = 350 * 2 ** attempt;
      if (status === 429) {
        const ra = retryAfterMs(response);
        delay = ra ?? Math.min(5000 + attempt * 3500, 45_000);
        delay += Math.floor(Math.random() * 800);
      }

      logWarn("yahoo-chart", "retrying after HTTP error", {
        symbol: sym,
        status,
        nextDelayMs: delay,
        attempt: attempt + 1,
      });

      await sleep(delay);
    } catch (err) {
      lastError = err;
      lastYahooChartEnd = Date.now();
      const isAbort =
        err &&
        typeof err === "object" &&
        "name" in err &&
        /** @type {{ name?: string }} */ (err).name === "AbortError";
      const message = err instanceof Error ? err.message : String(err);
      logWarn("yahoo-chart", "fetch threw", {
        symbol: sym,
        attempt: attempt + 1,
        isAbort,
        message,
      });
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new Error(
          isAbort
            ? `Yahoo Finance chart request timed out after ${FETCH_TIMEOUT_MS / 1000}s (no response).`
            : message.includes("fetch")
              ? `Yahoo Finance chart request failed after retries (${message}).`
              : `Yahoo Finance chart failed: ${message}`,
        );
      }
      await sleep(isAbort ? 1000 * (attempt + 1) : 450 * 2 ** attempt);
    }
  }

  if (lastResponse?.status === 429 && !alternateHostTried) {
    const altUrl = alternateYahooChartHost(url);
    if (altUrl !== url) {
      logWarn("yahoo-chart", "429 after query1/2 retries: full retry on alternate Yahoo host", {
        symbol: sym,
        nextHost: altUrl.includes("query2") ? "query2" : "query1",
      });
      return fetchYahooChartResponse(altUrl, { alternateHostTried: true });
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Yahoo Finance chart request failed with no response.");
}
