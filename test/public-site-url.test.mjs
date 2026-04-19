import test from "node:test";
import assert from "node:assert/strict";
import { getPublicBaseUrl } from "../src/lib/public-site-url.mjs";

test("getPublicBaseUrl trims PUBLIC_BASE_URL and strips trailing slash", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://example.com/";
  try {
    assert.equal(getPublicBaseUrl({ headers: {} }), "https://example.com");
  } finally {
    if (prev === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = prev;
    }
  }
});

test("getPublicBaseUrl falls back to Host when PUBLIC_BASE_URL unset", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
  try {
    const req = {
      headers: { host: "app.example.org" },
      socket: {},
    };
    assert.equal(getPublicBaseUrl(req), "http://app.example.org");
  } finally {
    if (prev !== undefined) {
      process.env.PUBLIC_BASE_URL = prev;
    }
  }
});
