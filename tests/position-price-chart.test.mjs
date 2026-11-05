import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  eligibleTradeMarker,
  chartExecutionTimestamp,
  describeTradeCzk,
  exchangeDate,
  isExactClockTime,
  tradeCalendarDate,
  overlayTradePrice,
  parseYahooDailyChart,
  previousClose,
  yahooTickerForAsset,
} from "../lib/shared/position-price-chart.mjs";

function source(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("historical quote mapping is exchange-specific and rejects ticker guesses", () => {
  const base = { provider: "trading212", assetClass: "stock", currency: "USD", symbol: "AMD", listingSymbol: "AMD" };
  assert.equal(yahooTickerForAsset({ ...base, externalId: "AMD_US_EQ" }), "AMD");
  assert.equal(yahooTickerForAsset({ ...base, externalId: "AMD_DE_EQ", currency: "EUR" }), "AMD.DE");
  assert.equal(yahooTickerForAsset({ ...base, externalId: "AMD_XX_EQ" }), null);
  assert.equal(yahooTickerForAsset({ ...base, externalId: "AMD_US_EQ", listingSymbol: "INTC" }), null);
  assert.equal(yahooTickerForAsset({ ...base, provider: "manual", externalId: "AMD" }), null);
  assert.equal(yahooTickerForAsset({ ...base, assetClass: "p2p" }), null);
});

test("crypto uses only a known USD pair, never a guessed Solana token identity", () => {
  const base = { provider: "kraken", assetClass: "crypto", symbol: "BTC", currency: "USD" };
  assert.equal(yahooTickerForAsset(base), "BTC-USD");
  assert.equal(yahooTickerForAsset({ ...base, symbol: "SOL" }), "SOL-USD");
  assert.equal(yahooTickerForAsset({ ...base, symbol: "COIN_MINT_123" }), null);
  assert.equal(yahooTickerForAsset({ ...base, currency: "EUR" }), "BTC-EUR");
  assert.equal(yahooTickerForAsset({ ...base, currency: "BTC" }), "BTC-USD");
});

test("Yahoo parser filters invalid daily closes but preserves daily raw close (not adjusted close)", () => {
  const values = parseYahooDailyChart({
    meta: { currency: "USD" },
    timestamp: [1720051200, 1720137600, 1720224000, 1720310400],
    indicators: {
      quote: [{ close: [101, null, 99, 0] }],
      adjclose: [{ adjclose: [50, 50, 49, 50] }],
    },
  }, "USD");
  assert.deepEqual(values, [
    { date: "2024-07-04", close: 101 },
    { date: "2024-07-06", close: 99 },
  ]);
  assert.throws(() => parseYahooDailyChart({
    meta: { currency: "EUR" }, timestamp: [1720051200], indicators: { quote: [{ close: [10] }] },
  }, "USD"), /měnu/);
});

test("GBp and GBP never share chart axes because the difference is 100x", () => {
  const sample = { meta: { currency: "GBp" }, timestamp: [1720051200], indicators: { quote: [{ close: [240] }] } };
  assert.deepEqual(parseYahooDailyChart(sample, "GBX"), [{ date: "2024-07-04", close: 240 }]);
  assert.throws(() => parseYahooDailyChart(sample, "GBP"), /měnu/);
});


test("exchange dates follow local market sessions, including the previous UTC day", () => {
  // Sydney opens on Monday while UTC may still show Sunday night.
  assert.equal(exchangeDate("2026-11-01T23:30:00.000Z", "Australia/Sydney"), "2026-11-02");
  assert.equal(exchangeDate("2026-11-01T23:30:00.000Z", "America/New_York"), "2026-11-01");
  assert.equal(exchangeDate("2026-11-01T23:30:00.000Z"), "2026-11-01");
  assert.throws(() => exchangeDate("not-a-date", "UTC"), /timestamp/);
  assert.throws(() => exchangeDate("2026-11-01T12:00:00Z", "Mars/Unknown"));
});

test("quote series uses the exchange timezone and rejects a redirected instrument", () => {
  const source = {
    meta: { currency: "AUD", symbol: "BHP.AX", exchangeTimezoneName: "Australia/Sydney" },
    timestamp: [1793575800],
    indicators: { quote: [{ close: [40.25] }] },
  };
  assert.deepEqual(parseYahooDailyChart(source, "AUD", "BHP.AX"), [
    { date: "2026-11-02", close: 40.25 },
  ]);
  assert.throws(() => parseYahooDailyChart(source, "AUD", "CBA.AX"), /jiný instrument/);
});

test("the prior valid close is used for markers: never a future quote or a month-old quote", () => {
  const prices = [
    { date: "2026-10-30", close: 100 },
    { date: "2026-11-02", close: 102 },
    { date: "2026-11-10", close: 120 },
  ];
  assert.equal(previousClose(prices, "2026-11-01"), 100);
  assert.equal(previousClose(prices, "2026-11-02"), 102);
  assert.equal(previousClose(prices, "2026-10-29"), null);
  assert.equal(previousClose(prices, "2026-11-09"), null);
  assert.equal(previousClose(prices, "2026-12-15"), null);
});

test("execution quote currency and split plausibility prevent false chart placement", () => {
  assert.deepEqual(overlayTradePrice({price: 102, priceCurrency: "USD"}, 100, "USD"),
    {chartPrice: 102, usedTradePrice: true});
  assert.deepEqual(overlayTradePrice({price: 100, priceCurrency: "EUR"}, 100, "USD"),
    {chartPrice: 100, usedTradePrice: false});
  assert.deepEqual(overlayTradePrice({price: 1000, priceCurrency: "USD"}, 100, "USD"),
    {chartPrice: 100, usedTradePrice: false});
  assert.deepEqual(overlayTradePrice({price: null, priceCurrency: "USD"}, 100, "USD"),
    {chartPrice: 100, usedTradePrice: false});
  assert.deepEqual(overlayTradePrice({price: 0, priceCurrency: "USD"}, 100, "USD"),
    {chartPrice: 100, usedTradePrice: false});
});

test("US class share ticker is translated to Yahoo class syntax without affecting exchanges", () => {
  assert.equal(yahooTickerForAsset({
    provider: "trading212", assetClass: "stock", currency: "USD",
    externalId: "BRK.B_US_EQ", listingSymbol: "BRK.B", symbol: "BRK.B",
  }), "BRK-B");
});

test("markers only represent genuine buy/sell orders with a valid timestamp", () => {
  assert.equal(eligibleTradeMarker({ kind: "buy", occurredAt: "2024-01-09T15:00:00Z" }), true);
  assert.equal(eligibleTradeMarker({ kind: "sell", occurredAt: "2024-01-09T15:00:00Z" }), true);
  assert.equal(eligibleTradeMarker({ kind: "transfer", occurredAt: "2024-01-09T15:00:00Z" }), false);
  assert.equal(eligibleTradeMarker({ kind: "buy", occurredAt: "bad" }), false);
});


test("native CZK cash is recorded; non-CZK CZK totals are only historical ČNB conversions", () => {
  assert.deepEqual(describeTradeCzk({amount:-4250.25, amountCurrency:"CZK", amountCzk:-4250.25}),
    {value:4250.25, quality:"recorded"});
  assert.deepEqual(describeTradeCzk({amount:-100, amountCurrency:"USD", amountCzk:-2119.56}),
    {value:2119.56, quality:"cnb-converted"});
  assert.deepEqual(describeTradeCzk({amount:450, amountCurrency:"EUR", amountCzk:null}),
    {value:null, quality:"unavailable"});
  assert.deepEqual(describeTradeCzk({amount:null, amountCurrency:"CZK", amountCzk:null}),
    {value:null, quality:"unavailable"});
  assert.deepEqual(describeTradeCzk({amount:0, amountCurrency:"CZK", amountCzk:0}),
    {value:null, quality:"unavailable"});
});

test("execution position follows exchange local clock without decoration or false timezone precision", () => {
  const at="2026-11-01T23:30:00.000Z";
  const aussie=chartExecutionTimestamp(at, "Australia/Sydney");
  assert.equal(new Date(aussie).toISOString(), "2026-11-02T10:30:00.000Z");
  const american=chartExecutionTimestamp(at, "America/New_York");
  assert.equal(new Date(american).toISOString(), "2026-11-01T18:30:00.000Z");
  assert.equal(chartExecutionTimestamp("bad"), null);
  assert.equal(isExactClockTime(at), true);
  assert.equal(isExactClockTime("2026-11-02"), false);
  assert.equal(isExactClockTime("2026-11-02T14:30:00"), false);
  assert.equal(new Date(chartExecutionTimestamp("2026-11-02", "UTC")).toISOString(), "2026-11-02T12:00:00.000Z");
  // A no-timezone source event MUST NOT turn into the previous calendar day
  // when FinanceOS happens to run in a different timezone.
  assert.equal(tradeCalendarDate("2026-11-02", "America/Los_Angeles"), "2026-11-02");
  assert.equal(tradeCalendarDate("2026-11-02T00:30:00", "America/Los_Angeles"), "2026-11-02");
  assert.equal(new Date(chartExecutionTimestamp("2026-11-02T00:30:00", "America/Los_Angeles")).toISOString(), "2026-11-02T00:30:00.000Z");
  assert.equal(tradeCalendarDate("2026-11-02T00:30:00Z", "America/Los_Angeles"), "2026-11-01");
  assert.equal(isExactClockTime("2026-11-02T00:30:00+0100"), true);
});

test("trade cards expose original movements, CZK provenance, and real marker hover events", () => {
  const sourceServer=source("lib/server/position-price-history.ts");
  const chart=source("components/position-price-chart.tsx");
  for (const field of ["t.amount", "t.amount_czk", "t.fee", "t.external_id", "t.source_label"]) {
    assert.ok(sourceServer.includes(field), "Chart server must read "+field);
  }
  assert.ok(sourceServer.includes("exchangeTimezone"));
  assert.ok(chart.includes("onPointerEnter"), "Hover must show a card, not only require click");
  assert.ok(chart.includes('role="tooltip"'));
  assert.ok(chart.includes("TradeInfoCard"));
  assert.ok(chart.includes("describeTradeCzk"));
  assert.ok(chart.includes("onFocus"), "Keyboard focus shows the same trade detail");
  assert.ok(chart.includes("usedTradePrice"), "Only comparable source prices belong on the price axis");
  assert.ok(chart.includes("chartExecutionTimestamp"), "Never add arbitrary x-offset collision jitter");
  assert.ok(chart.includes("Cenová historie chybí. Zobrazujeme proto pouze časovou osu"), "Trades must remain visible with no market prices.");
  assert.ok(chart.includes("onPointerLeave"), "Hover tooltip must disappear when leaving the marker");
  assert.equal(chart.includes("(collision % 5 - 2) * 5"), false);
});

test("position chart is mounted on existing asset page and its quotes cannot silently replace CSV prices", () => {
  const page = source("app/investments/[symbol]/page.tsx");
  const backend = source("lib/server/position-price-history.ts");
  const chart = source("components/position-price-chart.tsx");
  assert.ok(page.includes('id="price-chart"'));
  assert.ok(page.includes("getPositionPriceChart("));
  assert.ok(page.includes("<PositionPriceChart data={priceChart} />"));
  assert.ok(backend.includes("WHERE asset_prices.source = ?"), "Unofficial prices may update only their own prior rows.");
  assert.ok(backend.includes("t.kind IN ('buy', 'sell')"), "Only executed trade events should appear.");
  assert.ok(backend.includes("WHERE t.asset_id = ?"), "Don't mix orders between assets with the same display symbol.");
  assert.ok(backend.includes("held_quote_currency"), "Use the actual crypto holding quote currency.");
  assert.ok(chart.includes("selectedTradeId"));
  assert.ok(chart.includes("setRange"));
  assert.ok(chart.includes("showTrades"));
  assert.ok(chart.includes("model.unplaced"));
  assert.ok(chart.includes('href="/history#history-import"'));
});
