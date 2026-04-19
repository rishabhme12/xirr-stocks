/**
 * Client IP for rate limiting behind Railway / other reverse proxies.
 *
 * X-Forwarded-For is a comma chain; the leftmost value is trivially spoofable when
 * proxies append. We take the Nth IP from the right (default N=1) so a single
 * trusted edge that appends the real client yields the correct address.
 *
 * Env: TRUSTED_PROXY_HOPS (default 1) — number of proxies at the edge that each
 * add one hop to the chain (1 = use the last IP in the list).
 */

function pickForwardedClientIp(xff, hops) {
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const h = Math.max(1, Math.min(hops, parts.length));
  const idx = parts.length - h;
  return parts[idx];
}

export function getClientIp(request) {
  const xff = request.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const rawHops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS || "1", 10);
    const hops = Number.isFinite(rawHops) && rawHops > 0 ? rawHops : 1;
    const ip = pickForwardedClientIp(xff, hops);
    if (ip) {
      return ip;
    }
  }
  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return realIp.trim();
  }
  return request.socket?.remoteAddress || "unknown";
}
