import test from "node:test";
import assert from "node:assert/strict";
import { getClientIp } from "../src/lib/client-ip.mjs";

test("getClientIp uses last X-Forwarded-For hop by default (trust one proxy)", () => {
  const prev = process.env.TRUSTED_PROXY_HOPS;
  delete process.env.TRUSTED_PROXY_HOPS;
  const req = {
    headers: { "x-forwarded-for": "10.0.0.1, 203.0.113.5" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(getClientIp(req), "203.0.113.5");
  if (prev === undefined) {
    delete process.env.TRUSTED_PROXY_HOPS;
  } else {
    process.env.TRUSTED_PROXY_HOPS = prev;
  }
});

test("getClientIp respects TRUSTED_PROXY_HOPS", () => {
  const prev = process.env.TRUSTED_PROXY_HOPS;
  process.env.TRUSTED_PROXY_HOPS = "2";
  const req = {
    headers: { "x-forwarded-for": "a, b, c" },
    socket: {},
  };
  assert.equal(getClientIp(req), "b");
  process.env.TRUSTED_PROXY_HOPS = prev;
  if (prev === undefined) {
    delete process.env.TRUSTED_PROXY_HOPS;
  }
});

test("getClientIp falls back to socket when no forwarded headers", () => {
  const req = { headers: {}, socket: { remoteAddress: "192.168.1.1" } };
  assert.equal(getClientIp(req), "192.168.1.1");
});
