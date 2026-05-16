const YAHOO_USER_AGENT = (
  process.env.YAHOO_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
).trim();

let yahooSession = null;
let lastSessionFetch = 0;
const SESSION_TTL = 30 * 60 * 1000;

function readSetCookieHeader(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }
  const raw = response.headers.get("set-cookie");
  if (!raw) {
    return "";
  }
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
}

/** Yahoo crumb + cookies for screener / quoteSummary (unofficial API). */
export async function getYahooSession() {
  const now = Date.now();
  if (yahooSession && now - lastSessionFetch < SESSION_TTL) {
    return yahooSession;
  }

  try {
    const cookieRes = await fetch("https://fc.yahoo.com", {
      redirect: "follow",
      headers: { "User-Agent": YAHOO_USER_AGENT },
    });
    const cookies = readSetCookieHeader(cookieRes);
    if (!cookies) {
      return null;
    }

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": YAHOO_USER_AGENT, Cookie: cookies },
    });
    if (!crumbRes.ok) {
      return null;
    }
    const crumb = await crumbRes.text();
    if (crumb && crumb.length > 3) {
      yahooSession = { crumb, cookies };
      lastSessionFetch = now;
      return yahooSession;
    }
  } catch (e) {
    console.error("[getYahooSession] Handshake failed:", e.message);
  }
  return null;
}

export { YAHOO_USER_AGENT };
