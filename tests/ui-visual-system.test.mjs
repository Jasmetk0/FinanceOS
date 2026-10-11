import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("visual system supplies semantic surfaces, accessible focus and reduced motion", () => {
  const css = file("app/globals.css");
  for (const token of [
    "--accent:", "--danger:", "--warning:", "--muted:",
    ".finance-stat", ".finance-surface", ".finance-account-card",
    ".finance-data-table", ".finance-field", ".finance-chart",
    ".finance-transaction-table", ".finance-quick-link",
  ]) assert.ok(css.includes(token), "Missing design-system token or primitive: " + token);
  assert.ok(css.includes(":focus-visible"));
  assert.ok(css.includes("prefers-reduced-motion: reduce"));
});

test("summary keeps honest null values and treats featured wealth as a visual variant", () => {
  const ui = file("components/ui.tsx");
  assert.ok(ui.includes('featured = false'));
  assert.ok(ui.includes('value !== null && Number.isFinite(value)'));
  assert.ok(ui.includes('"—"'));
  const page = file("app/page.tsx");
  assert.ok(page.includes('label="Celkový majetek"'));
  assert.ok(page.includes("          featured"));
  assert.ok(page.includes('account.dataFreshness.status === "stale"'));
  assert.ok(page.includes('Math.abs(data.summary.unclassifiedCzk) > 0.01'));
});

test("accounts retain provider provenance and independently shown cash/investment values", () => {
  const page = file("app/accounts/page.tsx");
  const explorer = file("components/accounts-explorer.tsx");
  assert.ok(page.includes("<AccountsExplorer accounts={accounts} />"));
  assert.ok(page.includes("<ManualBalancesManager"));
  for (const token of [
    "providerColor(account.provider)",
    "providerLabel(account.provider)",
    "account.totalValueCzk",
    "account.cashValueCzk",
    "account.investedValueCzk",
    "<DataFreshnessBadge",
    "account.dataFreshness",
    "account.updatedAt",
  ]) assert.ok(explorer.includes(token), "Missing account field " + token);
});

test("holdings render in both responsive and tabular views without hiding unknown P/L", () => {
  const page = file("app/investments/page.tsx");
  const explorer = file("components/holdings-explorer.tsx");
  assert.ok(page.includes("const holdings = dashboard.holdings"));
  assert.ok(page.includes("<HoldingsExplorer holdings={holdings} />"));
  assert.ok(explorer.includes("md:hidden"));
  assert.ok(explorer.includes("finance-data-table"));
  assert.ok(explorer.includes('"—"'));
  assert.ok(explorer.includes('item.pnlCzk !== null'));
});

test("transaction filtering stays on the client and mobile rows retain all nine fields", () => {
  const table = file("components/transactions-table.tsx");
  assert.ok(table.includes("transactions.filter("));
  for (const name of ["Datum", "Položka", "Účet", "Typ", "Kategorie", "Tok", "Množství", "Částka", "Akce"])
    assert.ok(table.includes('data-label="' + name + '"'), "Missing responsive label " + name);
  assert.ok(table.includes('tx.flowScope === "unclassified"'));
  assert.ok(table.includes('aria-live="polite"'));
  assert.ok(table.includes("deleteManual(tx.id)"));
});

test("chart retains provenance and external-only contribution computation", () => {
  const chart = file("components/portfolio-history-chart.tsx");
  assert.ok(chart.includes("return data.contributedCzk;"));
  assert.ok(chart.includes("point.coverage.performanceComplete !== false"));
  assert.ok(chart.includes("finance-chart-canvas"));
  assert.ok(chart.includes("aria-pressed={metric === value}"));
});
