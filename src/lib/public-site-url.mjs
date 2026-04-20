/**
 * Canonical public site URL for links, sitemap, and meta tags.
 * Prefer PUBLIC_BASE_URL (https://your-domain.com, no trailing slash); else derive from request (Railway forwards Host / X-Forwarded-*).
 */

/**
 * @param {import("node:http").IncomingMessage} request
 * @returns {string} Origin-like base URL without trailing slash
 */
export function getPublicBaseUrl(request) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) {
    return fromEnv;
  }

  const rawHost = (request.headers["x-forwarded-host"] || request.headers.host || "")
    .toString()
    .split(",")[0]
    .trim();
  const proto =
    request.headers["x-forwarded-proto"] === "https" ? "https" : request.socket?.encrypted ? "https" : "http";

  if (!rawHost) {
    const fallbackPort = process.env.PORT || "3000";
    return `http://127.0.0.1:${fallbackPort}`;
  }

  return `${proto}://${rawHost}`;
}

const PUBLIC_BASE_PLACEHOLDER = "__PUBLIC_BASE_URL__";

/**
 * Replace `__PUBLIC_BASE_URL__` in HTML (canonical, Open Graph, JSON-LD).
 * @param {string} html
 * @param {import("node:http").IncomingMessage} request
 * @returns {string}
 */
export function applyPublicSiteUrlPlaceholders(html, request) {
  if (!html.includes(PUBLIC_BASE_PLACEHOLDER)) {
    return html;
  }
  return html.replaceAll(PUBLIC_BASE_PLACEHOLDER, getPublicBaseUrl(request));
}
