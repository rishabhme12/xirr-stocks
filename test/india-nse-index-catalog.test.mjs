import test from "node:test";
import assert from "node:assert/strict";
import {
  __testables,
  buildIndiaNseIndexCatalog,
  searchIndiaIndexCatalog,
  lookupIndiaIndexCatalogEntry,
} from "../src/lib/india-nse-index-catalog.mjs";

const SAMPLE_NSE = [
  { index: "NIFTY 50", indexSymbol: "NIFTY 50" },
  { index: "NIFTY SMALLCAP 100", indexSymbol: "NIFTY SMLCAP 100" },
  { index: "NIFTY SMALLCAP 250", indexSymbol: "NIFTY SMLCAP 250" },
  { index: "NIFTY MIDCAP 50", indexSymbol: "NIFTY MIDCAP 50" },
];

const SAMPLE_YAHOO = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^CNXSC", name: "NIFTY SMLCAP 100" },
  { symbol: "^NSEMDCP50", name: "NIFTY MIDCAP 50" },
];

test("buildIndiaNseIndexCatalog links Yahoo symbols and generates fallback caret codes", () => {
  const catalog = buildIndiaNseIndexCatalog(SAMPLE_NSE, SAMPLE_YAHOO);
  const bySymbol = new Map(catalog.map((e) => [e.symbol, e]));
  assert.ok(bySymbol.has("^NSEI"));
  assert.ok(bySymbol.has("^CNXSC"));
  assert.equal(bySymbol.get("^NIFTYSMLCAP250")?.nseIndexType, "NIFTY SMALLCAP 250");
  assert.equal(bySymbol.get("^NSEMDCP50")?.yahooChartSymbol, "^NSEMDCP50");
});

test("searchIndiaIndexCatalog matches small and NIFTYSMLCAP250", () => {
  const catalog = buildIndiaNseIndexCatalog(SAMPLE_NSE, SAMPLE_YAHOO);
  const small = searchIndiaIndexCatalog(catalog, "small", 10);
  assert.ok(small.some((e) => e.nseIndexType === "NIFTY SMALLCAP 250"));
  assert.ok(small.some((e) => e.nseIndexType === "NIFTY SMALLCAP 100"));
  const exact = lookupIndiaIndexCatalogEntry(catalog, "NIFTYSMLCAP250");
  assert.equal(exact?.symbol, "^NIFTYSMLCAP250");
});
