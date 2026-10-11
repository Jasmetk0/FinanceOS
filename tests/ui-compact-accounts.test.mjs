import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("account cards fit three across at desktop widths and collapse responsively", () => {
  const explorer = source("components/accounts-explorer.tsx");
  assert.ok(explorer.includes("grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"));
  assert.ok(explorer.includes('view === "grid"'));
  assert.ok(explorer.includes('view === "list"'));
  assert.ok(explorer.includes("finance-account-card"));
  assert.equal(explorer.includes("lg:grid-cols-2"), false);
});

test("account search, filtering and sorting operate only on view state", () => {
  const explorer = source("components/accounts-explorer.tsx");
  assert.ok(explorer.includes("useMemo("));
  assert.ok(explorer.includes(".filter((account) =>"));
  assert.ok(explorer.includes(".sort((a, b) =>"));
  for (const key of ["query", "provider", "freshness", "sort", "view", "hideValues"]) {
    assert.ok(explorer.includes("set" + key[0].toUpperCase() + key.slice(1)), "Missing state setter: " + key);
  }
  for (const choice of ["value-desc", "value-asc", "name", "updated", "current", "stale", "other"]) {
    assert.ok(explorer.includes('"' + choice + '"'), "Missing sorting or filter value " + choice);
  }
  assert.equal(explorer.includes('fetch('), false, "Filtering must not modify a backend account");
  assert.equal(explorer.includes('router.refresh('), false);
});

test("amount privacy toggle does not mutate values or change underlying computations", () => {
  const explorer = source("components/accounts-explorer.tsx");
  assert.ok(explorer.includes('setHideValues((old) => !old)'));
  assert.ok(explorer.includes('aria-pressed={hideValues}'));
  assert.ok(explorer.includes('hideValues ? "••••••" : money(value)'));
  assert.ok(explorer.includes("account.totalValueCzk"));
  assert.ok(explorer.includes("account.cashValueCzk"));
  assert.ok(explorer.includes("account.investedValueCzk"));
});

test("cards retain click-through, freshness provenance and accessible empty state", () => {
  const explorer = source("components/accounts-explorer.tsx");
  assert.ok(explorer.includes('href={link}'));
  assert.ok(explorer.includes('encodeURIComponent(account.id)'));
  assert.ok(explorer.includes("<DataFreshnessBadge"));
  assert.ok(explorer.includes('aria-live="polite"'));
  assert.ok(explorer.includes("Žádný účet neodpovídá výběru"));
  assert.ok(explorer.includes("Zobrazit všechny účty"));
  const page = source("app/accounts/page.tsx");
  assert.ok(page.includes("<AccountsExplorer accounts={accounts} />"));
  assert.ok(page.includes("<ManualBalancesManager"));
});

test("shared statistic cards remain compact without hiding explanatory provenance", () => {
  const css = source("app/globals.css");
  const ui = source("components/ui.tsx");
  assert.ok(css.includes("min-height: 130px;"));
  assert.ok(ui.includes("hint ||"));
  assert.ok(ui.includes("value !== null && Number.isFinite(value)"));
});
