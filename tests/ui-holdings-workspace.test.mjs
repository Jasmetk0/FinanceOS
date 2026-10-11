import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("investment explorer preserves server holdings and navigates to actual position details", () => {
  const page = source("app/investments/page.tsx");
  const explorer = source("components/holdings-explorer.tsx");
  assert.ok(page.includes("const dashboard = getDashboardData()"));
  assert.ok(page.includes("const holdings = dashboard.holdings"));
  assert.ok(page.includes("<HoldingsExplorer holdings={holdings} />"));
  assert.ok(explorer.includes('"/investments/" + encodeURIComponent(holding.symbol)'));
  assert.ok(explorer.includes("holding.id"));
  assert.ok(explorer.includes("holding.accountName"));
  assert.ok(explorer.includes("providerLabel(holding.provider)"));
});

test("investor filters and sorts without changing persisted financial records", () => {
  const explorer = source("components/holdings-explorer.tsx");
  for (const value of [
    "setQuery", "setProvider", "setAssetClass", "setPerformance", "setSort",
    '"value-desc"', '"value-asc"', '"pnl-desc"', '"pnl-asc"', '"name"',
    '"positive"', '"negative"', '"unknown"',
  ]) assert.ok(explorer.includes(value), "Missing investment filter or sort: " + value);
  assert.ok(explorer.includes("holdings.filter((item) =>"));
  assert.ok(explorer.includes(".sort((a, b) =>"));
  assert.ok(!explorer.includes('fetch('), "Filtering is strictly client-side");
  assert.ok(!explorer.includes("router.refresh("));
});

test("unknown profit is never displayed as zero and remains last when sorting by P/L", () => {
  const explorer = source("components/holdings-explorer.tsx");
  assert.ok(explorer.includes('if (a.pnlCzk === null && b.pnlCzk !== null) return 1;'));
  assert.ok(explorer.includes('if (b.pnlCzk === null && a.pnlCzk !== null) return -1;'));
  assert.ok(explorer.includes('if (value === null || !Number.isFinite(value)) return "—";'));
  assert.ok(explorer.includes('item.pnlCzk !== null'));
  assert.ok(source("app/investments/page.tsx").includes('unavailablePnl > 0'));
});

test("long holding portfolios paginate, adapt to phones and permit private viewing", () => {
  const explorer = source("components/holdings-explorer.tsx");
  assert.ok(explorer.includes("PAGE_SIZE = 30"));
  assert.ok(explorer.includes("filtered.slice(0, visibleCount)"));
  assert.ok(explorer.includes("setVisibleCount((previous) => previous + PAGE_SIZE)"));
  assert.ok(explorer.includes("grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"));
  assert.ok(explorer.includes("md:hidden"));
  assert.ok(explorer.includes("finance-data-table"));
  assert.ok(explorer.includes("aria-pressed={hidden}"));
  assert.ok(explorer.includes('hidden ? "••••••"'));
});

test("command palette works with keyboard and keeps focus inside dialogs", () => {
  const shell = source("components/app-shell.tsx");
  for (const token of [
    "ArrowDown", "ArrowUp", '"Enter"', 'role="combobox"', 'role="listbox"',
    'role="option"', "aria-activedescendant", 'aria-selected={index === activeSearchIndex}',
    "chooseSearchResult(", "router.push(href)", "trapKeyboard", '"Tab"',
  ]) assert.ok(shell.includes(token), "Missing keyboard control " + token);
});

test("dashboard shows a compact preview, not the full transaction history", () => {
  const page = source("app/page.tsx");
  assert.ok(page.includes("data.accounts.slice(0, 5)"));
  assert.ok(page.includes("data.recentTransactions.slice(0, 6)"));
  assert.ok(page.includes("data.accounts.length > 5"));
  assert.ok(page.includes('href="/transactions"'));
});
