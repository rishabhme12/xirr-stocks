/**
 * Baseline security headers for HTTP responses (Railway terminates TLS upstream).
 */
export function baseSecurityHeaders(request) {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (request.headers["x-forwarded-proto"] === "https") {
    headers["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains";
  }
  return headers;
}
