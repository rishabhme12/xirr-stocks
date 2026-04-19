/**
 * Fixed-window rate limiter keyed by string (e.g. client IP).
 * Env: RATE_LIMIT_WINDOW_MS (default 60000), RATE_LIMIT_MAX (default 150).
 * Set RATE_LIMIT_MAX=0 to disable limiting.
 *
 * Buckets are pruned on a timer and bounded by RATE_LIMIT_MAX_KEYS to avoid
 * unbounded memory growth when keys are high-cardinality.
 */

const buckets = new Map();

const STALE_AFTER_MULT = 2;

let pruneTimer = null;

function windowConfig() {
  const windowMs = Math.max(
    1000,
    Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10) || 60000,
  );
  const rawMax = Number.parseInt(process.env.RATE_LIMIT_MAX || "150", 10);
  const max = Number.isFinite(rawMax) ? Math.max(0, rawMax) : 150;
  const rawKeyCap = Number.parseInt(process.env.RATE_LIMIT_MAX_KEYS || "50000", 10);
  const maxKeys = Number.isFinite(rawKeyCap) ? Math.max(100, rawKeyCap) : 50000;
  return { windowMs, max, maxKeys };
}

function ensurePruneTimer(windowMs) {
  if (pruneTimer !== null) {
    return;
  }
  const intervalMs = Math.min(60000, Math.max(5000, windowMs));
  pruneTimer = setInterval(() => pruneStaleBuckets(), intervalMs);
  if (typeof pruneTimer.unref === "function") {
    pruneTimer.unref();
  }
}

function pruneStaleBuckets() {
  const { windowMs, maxKeys } = windowConfig();
  const now = Date.now();
  const staleAfter = windowMs * STALE_AFTER_MULT;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastSeen > staleAfter) {
      buckets.delete(key);
    }
  }
  if (buckets.size <= maxKeys) {
    return;
  }
  /** Evict least-recently-seen keys until under the cap. */
  const entries = [...buckets.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  let i = 0;
  while (buckets.size > maxKeys && i < entries.length) {
    buckets.delete(entries[i][0]);
    i += 1;
  }
}

/**
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
 */
export function rateLimitAllow(key) {
  const { windowMs, max, maxKeys } = windowConfig();
  if (max === 0) {
    return { ok: true };
  }

  ensurePruneTimer(windowMs);

  const now = Date.now();

  if (buckets.size >= maxKeys && !buckets.has(key)) {
    pruneStaleBuckets();
  }

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1, lastSeen: now });
    return { ok: true };
  }

  bucket.lastSeen = now;

  if (bucket.count >= max) {
    const elapsed = now - bucket.windowStart;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
    return { ok: false, retryAfterSec };
  }

  bucket.count += 1;
  return { ok: true };
}
