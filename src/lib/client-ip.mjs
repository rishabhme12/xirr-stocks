/**
 * Client IP for rate limiting behind Railway / other reverse proxies.
 * Prefer X-Forwarded-For (first hop), then X-Real-IP, then the socket address.
 */
export function getClientIp(request) {
  const xff = request.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0];
    if (first) {
      return first.trim();
    }
  }
  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return realIp.trim();
  }
  return request.socket?.remoteAddress || "unknown";
}
