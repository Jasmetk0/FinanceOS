import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("fresh transaction schema contains modern flow columns before indexed use", () => {
  const db = source("lib/server/db.ts");
  const createStart = db.indexOf("CREATE TABLE IF NOT EXISTS transactions");
  const createEnd = db.indexOf("CREATE TABLE IF NOT EXISTS snapshots", createStart);
  const schema = db.slice(createStart, createEnd);
  assert.ok(schema.includes("flow_scope TEXT NOT NULL DEFAULT 'legacy'"));
  assert.ok(schema.includes("transfer_value_czk REAL"));
});

test("legacy Trading 212 cash history is migrated conservatively", () => {
  const db = source("lib/server/db.ts");
  assert.ok(db.includes("WHEN kind = 'deposit' THEN 'unclassified'"));
  assert.ok(db.includes("WHEN kind = 'withdrawal' THEN 'external'"));
  assert.ok(db.includes("WHEN kind = 'transfer' THEN 'internal'"));
  assert.ok(db.includes("WHERE provider = 'trading212'"));
});

test("native Investown statement restores explicit PnL coverage", () => {
  const db = source("lib/server/db.ts");
  assert.ok(db.includes('raw.importMode === "investown-native"'));
  assert.ok(db.includes('raw.balanceMode === "derived-from-full-statement"'));
  assert.ok(db.includes('"not_applicable"'));
});

test("performance is blocked by any unresolved investment flow", () => {
  const analytics = source("lib/server/analytics.ts");
  assert.ok(analytics.includes("const portfolioPerformanceComplete = unclassifiedFlowCount === 0"));
  assert.ok(analytics.includes("knownUnclassifiedFlowCzk"));
  assert.ok(analytics.includes("accountPerformanceComplete"));
});

test("restore immediately reapplies stored-data repairs", () => {
  const restore = source("lib/server/restore.ts");
  assert.ok(restore.includes("repairStoredData"));
  assert.ok(restore.includes("repairStoredData(db);"));
});

test("export exposes remaining legacy-flow debt", () => {
  const exportSource = source("lib/server/export.ts");
  assert.ok(exportSource.includes("legacyFlows"));
  assert.ok(exportSource.includes("eligibleWithCanonicalKey"));
});


test("Trading 212 card enrichment uses official CSV export state instead of guessing cashback", () => {
  const card = source("lib/server/trading212-card.ts");
  assert.ok(card.includes("/equity/history/exports"));
  assert.ok(card.includes('"card debit"'));
  assert.ok(card.includes('"spending cashback"'));
  assert.ok(card.includes('"card credit"'));
  assert.ok(card.includes('"Merchant name"'));
  assert.ok(card.includes('"Merchant category"'));
  assert.ok(card.includes("card_cashback"));
});

test("Trading 212 Spending Pot is reconciled inside provider total without double counting", () => {
  const t212 = source("lib/server/integrations/trading212.ts");
  assert.ok(t212.includes("source: \"provider_total_residual\""));
  assert.ok(t212.includes("confidence: \"confirmed_by_card_history\""));
  assert.ok(t212.includes("external_id = 'spending-pot:manual'"));
  const db = source("lib/server/db.ts");
  assert.ok(db.includes("CREATE TABLE IF NOT EXISTS provider_sync_state"));
});
