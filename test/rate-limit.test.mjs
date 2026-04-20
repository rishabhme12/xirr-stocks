import test from "node:test";
import assert from "node:assert/strict";
import { rateLimitAllow } from "../src/lib/rate-limit.mjs";

test("rateLimitAllow allows under max and blocks after max in window", () => {
  const prev = { ...process.env };
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  process.env.RATE_LIMIT_MAX = "3";

  assert.equal(rateLimitAllow("ip-a").ok, true);
  assert.equal(rateLimitAllow("ip-a").ok, true);
  assert.equal(rateLimitAllow("ip-a").ok, true);
  const fourth = rateLimitAllow("ip-a");
  assert.equal(fourth.ok, false);
  assert.ok("retryAfterSec" in fourth && fourth.retryAfterSec >= 1);

  assert.equal(rateLimitAllow("ip-b").ok, true);

  process.env.RATE_LIMIT_WINDOW_MS = prev.RATE_LIMIT_WINDOW_MS;
  process.env.RATE_LIMIT_MAX = prev.RATE_LIMIT_MAX;
  if (prev.RATE_LIMIT_WINDOW_MS === undefined) {
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
  if (prev.RATE_LIMIT_MAX === undefined) {
    delete process.env.RATE_LIMIT_MAX;
  }
});

test("rateLimitAllow disabled when RATE_LIMIT_MAX=0", () => {
  const prev = process.env.RATE_LIMIT_MAX;
  process.env.RATE_LIMIT_MAX = "0";
  for (let i = 0; i < 5; i += 1) {
    assert.equal(rateLimitAllow("ip-z").ok, true);
  }
  process.env.RATE_LIMIT_MAX = prev;
  if (prev === undefined) {
    delete process.env.RATE_LIMIT_MAX;
  }
});
