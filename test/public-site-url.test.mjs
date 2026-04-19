import test from "node:test";
import assert from "node:assert/strict";
import { applyPublicSiteUrlPlaceholders, getPublicBaseUrl } from "../src/lib/public-site-url.mjs";

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

test("applyPublicSiteUrlPlaceholders replaces token for canonical / OG / JSON-LD", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://example.com";
  try {
    const html =
      '<link rel="canonical" href="__PUBLIC_BASE_URL__/" />' +
      '<meta property="og:url" content="__PUBLIC_BASE_URL__/" />' +
      '"url": "__PUBLIC_BASE_URL__/"';
    const out = applyPublicSiteUrlPlaceholders(html, { headers: {} });
    assert.ok(!out.includes("__PUBLIC_BASE_URL__"));
    assert.equal(
      out,
      '<link rel="canonical" href="https://example.com/" />' +
        '<meta property="og:url" content="https://example.com/" />' +
        '"url": "https://example.com/"',
    );
  } finally {
    if (prev === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = prev;
    }
  }
});
