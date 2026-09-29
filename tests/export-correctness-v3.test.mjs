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


test("Trading 212 card enrichment keeps official CSV as the merchant-detail authority", () => {
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
  assert.match(
    card,
    /classification\.category === "card_cashback"[\s\S]{0,80}\? money\.amount/,
  );
  assert.ok(card.includes("enrichmentOnly"));
  assert.match(
    card,
    /flowScope:\s*enrichmentOnly[\s\S]{0,80}\? "not_applicable"[\s\S]{0,80}: classification\.flowScope/,
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


test("Trading 212 card parser accepts the current Time (UTC) export header", () => {
  const card = source("lib/server/trading212-card.ts");
  assert.ok(card.includes('"Time (UTC)"'));
  assert.ok(card.includes('replace(/\\uFFFD(?=:\\d{2}$)/, "+00")'));
  assert.ok(card.includes('"Currency (Total)"'));
});


test("Trading 212 cashback is external reward capital, not investment return", () => {
  const card = source("lib/server/trading212-card.ts");
  const analytics = source("lib/server/analytics.ts");
  const performancePage = source("app/performance/page.tsx");

  const cashbackStart = card.indexOf('if (action.includes("cashback"))');
  const cashbackEnd = card.indexOf('if (action === "deposit")', cashbackStart);
  const cashbackBlock = card.slice(cashbackStart, cashbackEnd);
  assert.ok(cashbackStart >= 0);
  assert.ok(cashbackEnd > cashbackStart);
  assert.ok(cashbackBlock.includes('flowScope: "external"'));
  assert.ok(cashbackBlock.includes('category: "card_cashback"'));
  assert.ok(analytics.includes("externalRewardsCzk"));
  assert.ok(analytics.includes("performanceExternalCapitalCzk"));
  assert.match(
    analytics,
    /performanceExternalCapitalCzk\s*=\s*netContributedCzk\s*\+\s*totals\.externalRewardsCzk/,
  );
  assert.ok(performancePage.includes('label="Externí odměny"'));
});


test("unmatched Trading 212 rich-export rows stay enrichment-only and idempotent", () => {
  const card = source("lib/server/trading212-card.ts");
  assert.ok(card.includes('const enrichmentOnly = true'));
  assert.ok(card.includes('.get("cash:" + id)'));
  assert.equal(card.includes('"card-export:" + id, "cash:" + id'), false);
  assert.equal(card.includes('IN (?, ?) LIMIT 1'), false);
});


test("Trading 212 deposit fallback requires repeated provider cashback signature", () => {
  const db = source("lib/server/db.ts");
  assert.ok(db.includes("matchedDates.length < 3"));
  assert.ok(db.includes("previousWithdrawals * 0.015"));
  assert.ok(db.includes("kind = 'income'"));
  assert.ok(db.includes("category = 'card_cashback'"));
  assert.ok(db.includes("category = 'external_deposit'"));
  assert.ok(
    db.includes("Trading 212 card cashback · inferred"),
  );
});

test("confirmed Trading 212 card evidence reconciles residual cash as Spending Pot", () => {
  const db = source("lib/server/db.ts");
  assert.ok(
    db.includes(
      'confidence: "confirmed_by_card_cashback_signature"',
    ),
  );
  assert.ok(db.includes("unclassified_value_czk = 0"));
  assert.ok(db.includes("reconciliation_status = 'reconciled'"));
});

test("Trading 212 rich export backs off 429 rate limits for a full day", () => {
  const card = source("lib/server/trading212-card.ts");
  assert.ok(
    card.includes(
      "const RATE_LIMIT_BACKOFF_MS = 24 * 60 * 60 * 1000",
    ),
  );
  assert.ok(card.includes('message.includes("(429)")'));
  assert.ok(card.includes('message.includes("TooManyRequests")'));
  assert.ok(card.includes("retryDelayMs(message)"));
});

test("Phantom is a watch-only live provider using public Solana address only", () => {
  const domain = source("lib/domain.ts");
  const connections = source("app/api/connections/route.ts");
  const manager = source("components/connections-manager.tsx");
  const sync = source("lib/server/sync.ts");
  const phantom = source("lib/server/integrations/phantom.ts");

  assert.ok(domain.includes('| "phantom"'));
  assert.ok(connections.includes("validatePhantom"));
  assert.ok(connections.includes('"solana-mainnet"'));
  assert.ok(manager.includes("Veřejná Solana adresa"));
  assert.ok(manager.includes("seed phrase"));
  assert.ok(sync.includes('case "phantom"'));
  assert.ok(phantom.includes('"getBalance"'));
  assert.ok(phantom.includes('"getTokenAccountsByOwner"'));
  assert.ok(phantom.includes("TOKEN_2022_PROGRAM"));
});

test("Phantom and Kraken wallet transfers are linked in both directions", () => {
  const phantom = source("lib/server/integrations/phantom.ts");
  assert.ok(phantom.includes("wallet_transfer_out_unclassified"));
  assert.ok(phantom.includes("wallet_transfer_in_unclassified"));
  assert.ok(phantom.includes('"to_phantom" | "from_phantom"'));
  assert.ok(phantom.includes("candidate.quantity > 0"));
  assert.ok(phantom.includes("candidate.quantity < 0"));
  assert.ok(phantom.includes('"Phantom → Kraken"'));
  assert.ok(phantom.includes('"Kraken → Phantom"'));
});

test("Kraken ledger asset upserts preserve canonical identity", () => {
  const kraken = source("lib/server/integrations/kraken.ts");
  const ledgerStart = kraken.indexOf("for (const [ledgerId, ledger] of ledgers)");
  const ledgerEnd = kraken.indexOf("reclassifyLegacyKrakenWalletFlows", ledgerStart);
  const ledgerBlock = kraken.slice(ledgerStart, ledgerEnd);
  assert.ok(ledgerStart >= 0);
  assert.ok(ledgerEnd > ledgerStart);
  assert.ok(ledgerBlock.includes("canonicalCryptoIdentity(currency, rawAsset)"));
  assert.ok(ledgerBlock.includes("canonicalKey:"));
  assert.ok(ledgerBlock.includes("listingSymbol: identity.listingSymbol"));
});

test("exports include Phantom identity and coverage without exposing wallet address", () => {
  const exportSource = source("lib/server/export.ts");
  const aiContext = source("lib/server/ai-context.ts");
  const phantom = source("lib/server/integrations/phantom.ts");
  assert.ok(exportSource.includes('"phantom"'));
  assert.ok(aiContext.includes("getPhantomStatus"));
  assert.ok(aiContext.includes("phantom,"));
  assert.ok(phantom.includes("unpricedTokenCount"));
  assert.equal(phantom.includes("return {\n    address,"), false);
});
