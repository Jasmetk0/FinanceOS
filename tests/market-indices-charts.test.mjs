import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MARKET_INDICES, DEFAULT_MARKET_INDICES,
  normalizeMarketSelection, marketIndexById,
  parseMarketIndexChart, indexPeriodStart,
  buildMarketIndexComparison,
} from "../lib/shared/market-index-benchmarks.mjs";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("index catalog distinguishes genuine benchmarks from tradable ETFs and Nasdaq variants", () => {
  const tickers = new Set();
  const ids = new Set();
  assert.equal(MARKET_INDICES.length, 10);
  for (const row of MARKET_INDICES) {
    assert.ok(row.id && row.name && row.currency && row.note);
    assert.equal(ids.has(row.id), false);
    assert.equal(tickers.has(row.ticker), false);
    ids.add(row.id); tickers.add(row.ticker);
  }
  assert.equal(marketIndexById("ftseallworld").ticker, "AW01.FGI");
  assert.equal(marketIndexById("sp500").ticker, "^GSPC");
  assert.equal(marketIndexById("nasdaq100").ticker, "^NDX");
  assert.equal(marketIndexById("nasdaqcomposite").ticker, "^IXIC");
  assert.equal(marketIndexById("dax").basis, "performance");
  assert.equal(MARKET_INDICES.some(row => row.ticker === "VWCE" || row.ticker === "QQQ"), false);
});

test("unsafe identifiers cannot cause arbitrary Yahoo market history fetches", () => {
  assert.deepEqual(normalizeMarketSelection(null), DEFAULT_MARKET_INDICES);
  assert.deepEqual(normalizeMarketSelection("../../secrets"), DEFAULT_MARKET_INDICES);
  assert.deepEqual(normalizeMarketSelection("sp500,sp500,unsafe,nasdaq100"), ["sp500","nasdaq100"]);
  assert.deepEqual(normalizeMarketSelection(["ftseallworld","dax","sp500","nikkei225","ftse100"]), [
    "ftseallworld","dax","sp500","nikkei225",
  ]);
  assert.equal(marketIndexById("QQQ"), null);
});

test("index chart data requires expected ticker, currency and valid session closes", () => {
  const index = marketIndexById("sp500");
  const t = Date.parse("2026-11-02T21:00:00.000Z") / 1000;
  const result = {
    meta: { symbol: "^GSPC", currency: "USD", exchangeTimezoneName: "America/New_York" },
    timestamp: [t, t+86400],
    indicators: {quote: [{close: [7050.2, null]}]},
  };
  assert.deepEqual(parseMarketIndexChart(result,index), [{date:"2026-11-02", close:7050.2}]);
  assert.throws(() => parseMarketIndexChart({...result, meta:{...result.meta, currency:"EUR"}}, index), /měnu/);
  assert.throws(() => parseMarketIndexChart({...result, meta:{...result.meta, symbol:"^NDX"}}, index), /jiný instrument/);
  assert.throws(() => parseMarketIndexChart(result, {id:"sp500",ticker:"QQQ",currency:"USD"}), /identita/);
});

test("index comparison uses both common start and common end without forward-filling", () => {
  const left = {id:"sp500",name:"S&P 500",ticker:"^GSPC",currency:"USD",basis:"price",
    points:[{date:"2026-11-01",close:10},{date:"2026-11-02",close:20},{date:"2026-11-03",close:30}]};
  const right = {id:"nasdaq100",name:"Nasdaq-100",ticker:"^NDX",currency:"USD",basis:"price",
    points:[{date:"2026-11-02",close:5},{date:"2026-11-03",close:10},{date:"2026-11-04",close:15}]};
  const result = buildMarketIndexComparison([left,right], "2026-11-01");
  assert.deepEqual(result.dates, ["2026-11-02","2026-11-03"]);
  assert.deepEqual(result.lines.map(row => row.values), [[100,150],[100,200]]);
  assert.deepEqual(result.lines.map(row => row.returnPct), [50,100]);
  assert.equal(result.lines[0].baseline,20);
  assert.equal(result.lines[1].baseline,5);
  const unmatched = buildMarketIndexComparison([left,right],"2026-11-04");
  assert.equal(unmatched.lines.length,0);
  assert.match(unmatched.reason,/společné/);
});

test("missing benchmark is omitted from chart without fabricating quote levels", () => {
  const good = {id:"sp500",name:"S&P 500",ticker:"^GSPC",currency:"USD",basis:"price",
    points:[{date:"2026-11-01",close:100},{date:"2026-11-02",close:101}]};
  const unknown = {id:"ftseallworld",name:"FTSE",ticker:"AW01.FGI",currency:"USD",basis:"price",points:[]};
  const result = buildMarketIndexComparison([good,unknown],"0000-01-01");
  assert.deepEqual(result.lines.map(line=>line.id), ["sp500"]);
  assert.equal(result.lines[0].returnPct,1);
  assert.equal(buildMarketIndexComparison([unknown],"0000-01-01").lines.length,0);
});

test("periods are relative to the supplied as-of date and never to a live clock", () => {
  const now="2026-11-05";
  assert.equal(indexPeriodStart("MAX",now), "0000-01-01");
  assert.equal(indexPeriodStart("1M",now), "2026-10-05");
  assert.equal(indexPeriodStart("3M",now), "2026-08-05");
  assert.equal(indexPeriodStart("1R",now), "2025-11-05");
  assert.equal(indexPeriodStart("3R",now), "2023-11-05");
  assert.equal(indexPeriodStart("5R",now), "2021-11-05");
});

test("index charts use isolated state storage and do not touch portfolio holdings", () => {
  const server=source("lib/server/market-index-history.ts");
  const ui=source("components/market-index-explorer.tsx");
  const page=source("app/indices/page.tsx");
  const shell=source("components/app-shell.tsx");
  const investments=source("app/investments/page.tsx");
  assert.ok(server.includes('const PROVIDER = "market_indices"'));
  assert.ok(server.includes('FINANCEOS_EXTERNAL_PRICE_FETCH'));
  assert.ok(server.includes("parseMarketIndexChart(result, index)"));
  assert.ok(server.includes("index.ticker") && server.includes("encodeURIComponent"));
  assert.equal(server.includes("INSERT INTO transactions"),false);
  assert.equal(server.includes("INSERT INTO holdings"),false);
  assert.equal(server.includes("asset_prices"),false);
  assert.ok(ui.includes("buildMarketIndexComparison"));
  assert.ok(ui.includes("onPointerMove") || ui.includes("onChartPointer"));
  assert.ok(ui.includes('type="range"'));
  assert.ok(page.includes("getMarketIndexRows"));
  assert.ok(shell.includes('href: "/indices"'));
  assert.ok(investments.includes('href="/indices"'));
});
