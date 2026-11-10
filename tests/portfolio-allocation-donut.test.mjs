import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getPortfolioAllocationViews,
  compactAllocationSlices,
  allocationCoverage,
} from "../lib/portfolio-allocation.mjs";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("portfolio allocation groups positions by asset identity across platforms", () => {
  const input = {
    allocation: [
      { label: "stock", valueCzk: 90_000 },
      { label: "etf", valueCzk: 60_000 },
      { label: "crypto", valueCzk: 20_000 },
      { label: "cash", valueCzk: 10_000 },
    ],
    accounts: [
      { provider: "trading212", valueCzk: 120_000 },
      { provider: "kraken", valueCzk: 35_000 },
      { provider: "trading212", valueCzk: 25_000 },
    ],
    holdings: [
      { assetId: "a-amd", symbol: "AMD", name: "AMD", assetClass: "stock", valueCzk: 40_000 },
      { assetId: "a-amd", symbol: "AMD", name: "AMD", assetClass: "stock", valueCzk: 35_000 },
      { assetId: "a-etf", symbol: "VWCE", name: "Vanguard", assetClass: "etf", valueCzk: 60_000 },
      { assetId: "a-btc", symbol: "BTC", name: "Bitcoin", assetClass: "crypto", valueCzk: 20_000 },
    ],
  };
  const views = getPortfolioAllocationViews(input);
  assert.equal(views.positions.length, 3);
  assert.equal(views.positions[0].label, "AMD");
  assert.equal(views.positions[0].amountCzk, 75_000);
  assert.equal(views.positions[1].amountCzk, 60_000);
  assert.equal(views.positions[0].href, "/investments/AMD?asset=a-amd");
  assert.equal(views.platforms.find(v => v.id === "trading212").amountCzk, 145_000);
  assert.equal(views.classes.reduce((a, v) => a + v.amountCzk, 0), 180_000);
  assert.equal(views.positions.reduce((a, v) => a + v.amountCzk, 0), 155_000);
});

test("grouping small slices preserves full denominator and every smaller value", () => {
  const many = Array.from({ length: 32 }, (_, i) => ({
    id: "p" + i,
    label: "P" + i,
    amountCzk: i + 1,
  }));
  const slices = compactAllocationSlices(many, 7);
  assert.equal(slices.length, 7);
  assert.equal(slices.at(-1).id, "__other__");
  assert.equal(slices.at(-1).groupedCount, 26);
  assert.equal(slices.reduce((sum, item) => sum + item.amountCzk, 0), 528);
  assert.deepEqual(compactAllocationSlices(many.slice(0, 3), 7)
    .map(v => v.amountCzk), [3, 2, 1]);
});

test("negative and nonfinite exposures never make negative donuts or fake shares", () => {
  const input = {
    allocation: [
      { label: "stock", valueCzk: 200 },
      { label: "negative", valueCzk: -25 },
      { label: "bad", valueCzk: NaN },
    ],
    accounts: [
      { provider: "cash", valueCzk: -15 },
      { provider: "broker", valueCzk: 200 },
    ],
    holdings: [
      { assetId: "a", symbol: "A", assetClass: "stock", valueCzk: 200 },
      { assetId: "b", symbol: "B", assetClass: "stock", valueCzk: -50 },
    ],
  };
  const views = getPortfolioAllocationViews(input);
  assert.equal(views.classes.length, 1);
  assert.equal(views.positions.length, 1);
  assert.equal(views.platforms.length, 1);
  assert.equal(allocationCoverage(views.classes, 175).differenceCzk, 25);
  assert.equal(allocationCoverage(views.classes, 175).mismatch, true);
  assert.equal(allocationCoverage(views.classes, 200).mismatch, false);
  assert.equal(compactAllocationSlices([], 9).length, 0);
});

test("allocation graph is visible on dashboard and investments, and links X-Ray for ETF look-through", () => {
  const dashboard = source("app/page.tsx");
  const investments = source("app/investments/page.tsx");
  const chart = source("components/portfolio-allocation-chart.tsx");
  assert.ok(dashboard.includes("<PortfolioAllocationChart"));
  assert.ok(dashboard.includes('title="Rozložení portfolia"'));
  assert.ok(investments.includes('<PortfolioAllocationChart'));
  assert.ok(investments.includes('id="allocation-chart"') === false);
  assert.ok(chart.includes('id="allocation-chart"'));
  assert.ok(chart.includes('["classes", "Třídy aktiv"]'));
  assert.ok(chart.includes('["platforms", "Platformy"]'));
  assert.ok(chart.includes('["positions", "Pozice"]'));
  assert.ok(chart.includes('href="/xray"'));
  assert.ok(chart.includes("getPortfolioAllocationViews"));
  assert.ok(chart.includes("compactAllocationSlices"));
  assert.ok(chart.includes('aria-pressed={selectedId === item.id}'));
  assert.ok(chart.includes('title={label}'));
});
