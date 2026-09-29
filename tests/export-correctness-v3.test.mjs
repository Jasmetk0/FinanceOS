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
  assert.ok(card.includes('action.includes("cashback")'));
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


test("Trading 212 cashback reversals preserve their sign and do not double-count performance", () => {
  const card = source("lib/server/trading212-card.ts");
  const analytics = source("lib/server/analytics.ts");
  assert.ok(
    card.includes(
      'classification.category === "card_cashback"\n        ? money.amount',
    ),
  );
  assert.ok(card.includes('enrichmentOnly'));
  assert.ok(
    card.includes(
      'flowScope: enrichmentOnly\n        ? "not_applicable"\n        : classification.flowScope',
    ),
  );
  assert.ok(analytics.includes("item.cashbackCzk += amount"));
  assert.equal(
    card.includes(
      "SUM(CASE WHEN category = 'card_cashback' THEN ABS(COALESCE(amount_czk, 0))",
    ),
    false,
  );
});

test("Trading 212 card export cadence minimizes notifications with a bounded fallback", () => {
  const card = source("lib/server/trading212-card.ts");
  assert.ok(card.includes("const REFRESH_MS = 7 * 24 * 60 * 60 * 1000"));
  assert.ok(card.includes("timeTo: nowIso"));
  assert.ok(card.includes("FALLBACK_HISTORY_WINDOW_MS"));
  assert.ok(card.includes('message.includes("(400)")'));
  assert.ok(card.includes('"requested-fallback-window"'));
});


test("provider sync state survives full backup and restore", () => {
  const exportSource = source("lib/server/export.ts");
  const restore = source("lib/server/restore.ts");
  assert.ok(exportSource.includes("providerSyncState"));
  assert.ok(exportSource.includes("FROM provider_sync_state"));
  assert.ok(restore.includes("rows(backup.providerSyncState)"));
  assert.ok(restore.includes("INSERT INTO provider_sync_state"));
});


test("stored-data repair is non-recursive and repairs T212 FX conversions", () => {
  const db = source("lib/server/db.ts");
  assert.equal(
    db.includes("export function repairStoredData(db: DatabaseSync) {\n  repairStoredData(db);\n}"),
    false,
  );
  assert.ok(db.includes("repairTrading212CashSemantics(db)"));
  assert.ok(db.includes("category = 'currency_conversion'"));
  assert.ok(db.includes("UPPER(a.currency) != UPPER(b.currency)"));
});

test("Trading 212 provider applies cash semantic repair before card enrichment", () => {
  const t212 = source("lib/server/integrations/trading212.ts");
  const repairIndex = t212.indexOf("repairTrading212CashSemantics(getDb())");
  const cardIndex = t212.indexOf("syncTrading212CardHistory({");
  assert.ok(repairIndex >= 0);
  assert.ok(cardIndex > repairIndex);
});


test("Trading 212 export enrichment backs off repeated provider errors", () => {
  const card = source("lib/server/trading212-card.ts");
  assert.ok(card.includes('const RETRY_AFTER_KEY = "card_export_retry_after"'));
  assert.ok(card.includes("const ERROR_BACKOFF_MS = 60 * 60 * 1000"));
  assert.ok(card.includes('status: "backoff" as const'));
  assert.ok(card.includes("retryAfter: getState(RETRY_AFTER_KEY)"));
});
