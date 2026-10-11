import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("reports pass backend annual data to the new responsive client explorer", () => {
  const page = read("app/reports/page.tsx");
  const explorer = read("components/annual-reports-explorer.tsx");
  assert.ok(page.includes("const data = getAnnualReports()"));
  assert.ok(page.includes("<AnnualReportsExplorer data={data} />"));
  assert.ok(explorer.includes("data.reports"));
  assert.ok(explorer.includes("data.years"));
  assert.ok(explorer.includes("grid gap-3 sm:grid-cols-2 xl:grid-cols-3"));
  assert.ok(explorer.includes("finance-data-table"));
});

test("report filtering uses year and provider as view-only filters and adds known rows", () => {
  const explorer = read("components/annual-reports-explorer.tsx");
  assert.ok(explorer.includes('year === "all" || row.year === Number(year)'));
  assert.ok(explorer.includes('provider === "all" || row.provider === provider'));
  assert.ok(explorer.includes("rows.reduce((sum, row) => sum + row.interestCzk, 0)"));
  assert.ok(explorer.includes("rows.reduce((sum, row) => sum + row.dividendsCzk, 0)"));
  assert.ok(explorer.includes("rows.reduce((sum, row) => sum + row.transactionCount, 0)"));
  assert.ok(explorer.includes("missingCzkCount"));
  assert.ok(explorer.includes("transakcí ve vybraném výběru nemá hodnotu v Kč"));
  assert.ok(!explorer.includes("fetch("));
});

test("report export retains the complete route and does not imply filtered export", () => {
  const page = read("app/reports/page.tsx");
  const explorer = read("components/annual-reports-explorer.tsx");
  assert.ok(page.includes('href="/api/export/annual-report"'));
  assert.ok(page.includes("kompletního reportu"));
  assert.ok(explorer.includes("Export CSV nahoře vždy obsahuje kompletní roční report"));
  assert.ok(page.includes("Celkové příjmy z prodejů nejsou stejné jako realizovaný zisk."));
});

test("plan has interactive sliders, progress, unsaved changes and an undo button", () => {
  const plan = read("components/plan-editor.tsx");
  for (const token of [
    'type="range"', 'type="number"', "const validSum = Math.abs(sum - 100) <= 0.05",
    "const dirty =", "setSavedTargets({ ...targets })", "setSavedMonthly(monthlyValue)",
    "setTargets({ ...savedTargets })", "setMonthlyContribution(String(savedMonthly || \"\"))",
    'aria-live="polite"', "Neuložené změny", "Vrátit neuložené změny",
  ]) assert.ok(plan.includes(token), "Missing plan UX " + token);
  assert.ok(plan.includes('fetch("/api/plan"'));
  assert.ok(plan.includes("monthlyContributionCzk: monthlyValue"));
  assert.ok(plan.includes("router.refresh()"));
});

test("plan starts unchanged and cannot auto-impose a preset allocation", () => {
  const editor = read("components/plan-editor.tsx");
  assert.ok(editor.includes("copyTargets(initialTargets)"));
  assert.ok(editor.includes("initialMonthlyContributionCzk"));
  assert.ok(editor.includes("if (busy || !dirty || !validMonthly) return;"));
  assert.ok(editor.includes("Math.max(0, Math.min(100, next))"));
  assert.ok(!editor.includes("setTargets({ etf:"));
});

test("history deep linking only points to actual section anchors", () => {
  const page = read("app/history/page.tsx");
  for (const target of ["flows", "chart", "reconstruction", "prices", "import", "coverage"]) {
    assert.ok(page.includes('href: "#history-' + target + '"'));
    assert.ok(page.includes('id="history-' + target + '"'));
  }
  assert.ok(page.includes("Rychlé sekce historie"));
});
