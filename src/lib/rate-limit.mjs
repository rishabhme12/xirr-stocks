/**
 * Fixed-window rate limiter keyed by string (e.g. client IP).
 * Env: RATE_LIMIT_WINDOW_MS (default 60000), RATE_LIMIT_MAX (default 150).
 * Set RATE_LIMIT_MAX=0 to disable limiting.
 */

const buckets = new Map();

function windowConfig() {
  const windowMs = Math.max(
    1000,
    Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10) || 60000,
  );
  const rawMax = Number.parseInt(process.env.RATE_LIMIT_MAX || "150", 10);
  const max = Number.isFinite(rawMax) ? Math.max(0, rawMax) : 150;
  return { windowMs, max };
}

/**
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
 */
export function rateLimitAllow(key) {
  const { windowMs, max } = windowConfig();
  if (max === 0) {
    return { ok: true };
  }

  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { ok: true };
  }

  if (bucket.count >= max) {
    const elapsed = now - bucket.windowStart;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
    return { ok: false, retryAfterSec };
  }

  bucket.count += 1;
  return { ok: true };
}
