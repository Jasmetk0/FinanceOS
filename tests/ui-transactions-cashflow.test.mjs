import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("transactions keep every provider row in memory but display a bounded window", () => {
  const tx = source("components/transactions-table.tsx");
  assert.ok(tx.includes("const PAGE_SIZE = 60"));
  assert.ok(tx.includes("const visible = filtered.slice(0, visibleCount)"));
  assert.ok(tx.includes("visible.map((tx) =>"));
  assert.ok(tx.includes("setVisibleCount((count) => count + PAGE_SIZE)"));
  assert.ok(tx.includes("Zobrazit dalších"));
  assert.ok(tx.includes("transactions.filter("));
  assert.ok(tx.includes("deleteManual(tx.id)"));
});

test("transaction date filters use provider source date rather than viewer timezone", () => {
  const tx = source("components/transactions-table.tsx");
  assert.ok(tx.includes("tx.occurredAt.slice(0, 10)"));
  assert.ok(tx.includes("sourceDate < dateFrom"));
  assert.ok(tx.includes("sourceDate > dateTo"));
  assert.ok(tx.includes('type="date"'));
  assert.ok(tx.includes("max={dateTo || undefined}"));
  assert.ok(tx.includes("min={dateFrom || undefined}"));
  assert.ok(tx.includes("resetVisible()"));
});

test("sorting CZK values never treats missing conversions as zero", () => {
  const tx = source("components/transactions-table.tsx");
  assert.ok(tx.includes('if (a.amountCzk === null && b.amountCzk !== null) return 1'));
  assert.ok(tx.includes('if (b.amountCzk === null && a.amountCzk !== null) return -1'));
  assert.ok(tx.includes('Math.abs(b.amountCzk ?? 0) - Math.abs(a.amountCzk ?? 0)'));
  assert.ok(tx.includes('Math.abs(a.amountCzk ?? 0) - Math.abs(b.amountCzk ?? 0)'));
  assert.ok(tx.includes("missingFxCount"));
  assert.ok(tx.includes("unresolvedCount"));
  assert.ok(tx.includes('flow === "own_capital"'));
  assert.ok(tx.includes('flow === "rewards"'));
  assert.ok(tx.includes('flow === "internal"'));
  assert.ok(tx.includes('flow === "unresolved"'));
  assert.ok(tx.includes('tx.flowScope === "unclassified"'));
});

test("transaction privacy mode masks displayed amounts without mutating financial values", () => {
  const tx = source("components/transactions-table.tsx");
  assert.ok(tx.includes('aria-pressed={hideValues}'));
  assert.ok(tx.includes('hideValues ? "••••••"'));
  assert.ok(tx.includes("tx.amountCzk === null"));
  assert.ok(tx.includes("tx.transferValueCzk"));
  assert.ok(tx.includes('role="alert"'));
  assert.ok(!tx.includes("window.alert("));
});

test("monthly cash flow explorer shows scoped rows and preserves actual monthly inputs", () => {
  const page = source("app/cash-flow/page.tsx");
  const monthly = source("components/monthly-cash-flow-explorer.tsx");
  assert.ok(page.includes("<MonthlyCashFlowExplorer months={data.months} />"));
  assert.ok(monthly.includes("months.slice(-count).sort("));
  assert.ok(monthly.includes("item.incomeCzk + item.giftsCzk + item.interestCzk + item.cashbackCzk"));
  assert.ok(monthly.includes("item.netCzk"));
  assert.ok(monthly.includes("item.savingsRate === null ?"));
  assert.ok(monthly.includes("aria-pressed={hideValues}"));
  assert.ok(monthly.includes("Zobrazení měsíčních peněžních toků"));
  assert.ok(monthly.includes("Interní převody mezi vlastními platformami se do tohoto souhrnu nepočítají."));
  assert.ok(!monthly.includes("fetch("));
});

test("cash flow chart includes cashback in both bar heights and explanatory tooltip", () => {
  const chart = source("components/interactive-cash-flow-chart.tsx");
  assert.ok(chart.includes("item.incomeCzk + item.giftsCzk + item.interestCzk + (item.cashbackCzk ?? 0)"));
  assert.ok(chart.includes("hover.incomeCzk + hover.giftsCzk + hover.interestCzk + (hover.cashbackCzk ?? 0)"));
  assert.ok(chart.includes('label="Cashback v příjmech"'));
  assert.ok(chart.includes("externí odměna, ne vlastní investiční vklad"));
  assert.ok(chart.includes('aria-pressed={period === value}'));
  assert.ok(chart.includes("aria-label={item.month +"));
});

test("cash flow does not present unavailable savings-rate math as 0%", () => {
  const page = source("app/cash-flow/page.tsx");
  assert.ok(page.includes('label="Míra úspor"'));
  assert.ok(page.includes("value={data.totals.savingsRate}"));
  assert.ok(page.includes("data.totals.savingsRate === null ? undefined"));
  assert.ok(!page.includes("value={data.totals.savingsRate ?? 0}"));
});
