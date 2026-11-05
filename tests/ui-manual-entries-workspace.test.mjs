import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("manual transactions are entered in Czech with the existing audited kinds", () => {
  const form = source("components/manual-transaction-form.tsx");
  const server = source("lib/server/manual.ts");
  for (const kind of ["income", "gift", "expense", "interest", "deposit", "withdrawal", "fee", "adjustment"]) {
    assert.ok(form.includes('value: "' + kind + '"'), "Form does not expose " + kind);
    assert.ok(server.includes('"' + kind + '"'), "Backend no longer supports " + kind);
  }
  assert.ok(form.includes("Tento záznam nemění aktuální bankovní zůstatek"));
  assert.ok(form.includes("Pro přesuny mezi vlastními účty toto pole nepoužívej"));
  assert.ok(form.includes('fetch("/api/manual/transaction"'));
  assert.ok(form.includes("occurredAt: occurredAt.toISOString()"));
  assert.ok(server.includes("cashValue: 0"));
  assert.ok(server.includes("totalValue: 0"));
});

test("manual transaction form rejects invalid entries and prevents duplicate requests", () => {
  const form = source("components/manual-transaction-form.tsx");
  for (const part of [
    "const inFlight = useRef(false)",
    "if (inFlight.current) return",
    "inFlight.current = true",
    "inFlight.current = false",
    "Number.isFinite(amount)",
    "amount === 0",
    'kind !== "adjustment" && amount < 0',
    '/^[A-Z]{3}$/.test(currency)',
    "Number.isNaN(occurredAt.getTime())",
    "setBusy(true)",
    'aria-busy={busy}',
    'role={messageKind === "error" ? "alert" : "status"}',
  ]) assert.ok(form.includes(part), "Missing validation or request lock: " + part);
  assert.ok(form.includes("disabled={busy}"));
});

test("manual balance UI reflects backend liability sign and protects write operations", () => {
  const form = source("components/manual-balances-manager.tsx");
  const backend = source("lib/server/manual-balance.ts");
  assert.ok(form.includes("Zadej hodnotu vždy kladně"));
  assert.ok(form.includes("Závazek FinanceOS automaticky odečte"));
  assert.ok(backend.includes('kind === "liability" ? -absoluteValue : absoluteValue'));
  assert.ok(form.includes("if (inFlight.current) return"));
  assert.ok(form.includes("inFlight.current = true"));
  assert.ok(form.includes("inFlight.current = false"));
  assert.ok(form.includes("!Number.isFinite(value) || value < 0"));
  assert.ok(form.includes('fetch("/api/manual/balance"'));
  assert.ok(form.includes("method: \"DELETE\""));
  assert.ok(form.includes("disabled={busy}"));
  assert.ok(form.includes('role={messageKind === "error" ? "alert" : "status"}'));
  assert.ok(form.includes("finance-account-card min-w-0 p-3.5"));
});

test("cash-flow CSV keeps mapped provider rows and requires approval to omit invalid rows", () => {
  const importer = source("components/cashflow-csv-importer.tsx");
  const route = source("app/api/import/cashflow/route.ts");
  assert.ok(importer.includes("const mappedRows = csv.rows"));
  assert.ok(importer.includes("const rows = mappedRows.filter("));
  assert.ok(importer.includes("row.amount !== 0"));
  assert.ok(importer.includes("const omittedRows = mappedRows.length - rows.length"));
  assert.ok(importer.includes("omittedRows > 0 && !window.confirm("));
  assert.ok(importer.includes("Zkontroluj mapování sloupců a problematické řádky"));
  assert.ok(importer.includes('fetch("/api/import/cashflow"'));
  assert.ok(importer.includes("positiveKind,"));
  assert.ok(importer.includes("negativeKind,"));
  assert.ok(importer.includes("rows,"));
  assert.ok(route.includes("positiveKind"));
  assert.ok(route.includes("negativeKind"));
});

test("CSV importer disallows double submissions and shows reading/success/error feedback", () => {
  const importer = source("components/cashflow-csv-importer.tsx");
  for (const part of [
    "const inFlight = useRef(false)",
    "if (inFlight.current || reading) return",
    "inFlight.current = true",
    "inFlight.current = false",
    "setReading(true)",
    "setReading(false)",
    "messageKind",
    'aria-live="polite"',
    'aria-busy={busy || reading}',
    "disabled={!csv || busy || reading}",
  ]) assert.ok(importer.includes(part), "Missing import feedback/guard: " + part);
});
