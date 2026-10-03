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

test("P2P provider estimate tail stays visible in provider color", () => {
  const chart = source("components/portfolio-history-chart.tsx");

  assert.ok(chart.includes("providerData &&"));
  assert.ok(chart.includes("displayProviders.includes(statementEstimateProvider)"));
  assert.ok(chart.includes("colors[statementEstimateProvider]"));
  assert.ok(chart.includes("providerColor(statementEstimateProvider)"));
  assert.ok(chart.includes('strokeWidth="2.4"'));
  assert.ok(chart.includes('strokeLinecap="round"'));
});

test("Mintos gets the same step chart and dashed estimate tail as Investown", () => {
  const chart = source("components/portfolio-history-chart.tsx");

  assert.ok(chart.includes('data.providers[0] === "mintos"'));
  assert.ok(chart.includes('provider === "investown" || provider === "mintos"'));
  assert.ok(chart.includes("statementEstimateProvider"));
  assert.ok(chart.includes("strokeDasharray=\"7 6\""));
});

test("P2P referral and campaign rewards stay separate from percentage return", () => {
  const investown = source("lib/server/investown.ts");
  const mintos = source("lib/server/mintos.ts");
  const analytics = source("lib/server/analytics.ts");
  const table = source("components/account-daily-history-table.tsx");

  assert.ok(investown.includes('"referral_reward"'));
  assert.ok(investown.includes('"campaign_reward"'));
  assert.ok(investown.includes('"external_reward"'));
  assert.ok(investown.includes("investmentPnlCzk"));
  assert.ok(mintos.includes('"referral_reward"'));
  assert.ok(mintos.includes('"campaign_reward"'));
  assert.ok(mintos.includes('"external_reward"'));
  assert.ok(analytics.includes("isExternalRewardCategory"));
  assert.ok(analytics.includes("!isExternalRewardCategory(category)"));
  assert.ok(table.includes(">Odměny<"));
});

test("P2P charts extend stale imports as a dashed unchanged estimate", () => {
  const chart = source("components/portfolio-history-chart.tsx");

  assert.ok(chart.includes("const estimateEndDate"));
  assert.ok(chart.includes("const estimateSourcePoint"));
  assert.ok(chart.includes('strokeDasharray="7 6"'));
  assert.ok(chart.includes("odhad do"));
  assert.ok(chart.includes("Přerušovaná část je odhad"));
  assert.ok(chart.includes("metricValue(metric, estimateSourcePoint.total)"));
  assert.ok(chart.includes("estimateSourcePoint.total.contributedCzk"));
});

test("Investown and Mintos charts use step paths instead of diagonal interpolation", () => {
  const chart = source("components/portfolio-history-chart.tsx");

  assert.ok(chart.includes('mode: "linear" | "step" = "linear"'));
  assert.ok(chart.includes('if (mode === "step")'));
  assert.ok(chart.includes('provider === "investown" || provider === "mintos"'));
  assert.ok(chart.includes('statementStepProvider ? "step" : "linear"'));
});

test("Investown daily accounting uses statement-local dates, not UTC dates", () => {
  const analytics = source("lib/server/analytics.ts");
  const dailyTable = source("components/account-daily-history-table.tsx");
  const accountPage = source("app/accounts/[id]/page.tsx");

  assert.ok(analytics.includes("function transactionAccountingDate"));
  assert.ok(analytics.includes('provider === "investown"'));
  assert.ok(analytics.includes("raw.sourceDate"));
  assert.ok(analytics.includes("transactionAccountingDate(row)"));
  assert.ok(dailyTable.includes('provider === "investown"'));
  assert.ok(dailyTable.includes('"Investown"'));
  assert.ok(accountPage.includes("provider={detail.provider}"));
});

test("Investown daily snapshots persist separate investment P/L and external rewards", () => {
  const investown = source("lib/server/investown.ts");
  const analytics = source("lib/server/analytics.ts");

  assert.ok(investown.includes("runningInvestmentPnl"));
  assert.ok(investown.includes("runningExternalRewards"));
  assert.ok(investown.includes("runningTotalGain"));
  assert.ok(investown.includes("financeOsInvestownHistory"));
  assert.ok(investown.includes("realizedPnlCzk: snapshot.investmentPnl"));
  assert.ok(investown.includes("externalRewardsCzk: snapshot.externalRewards"));
  assert.ok(investown.includes("totalGainCzk: snapshot.totalGain"));
  assert.ok(analytics.includes('provider === "investown"'));
  assert.ok(analytics.includes("financeOsInvestownHistory"));
  assert.ok(analytics.includes("const investmentPnl = Number(investownHistory.investmentPnlCzk)"));
  assert.ok(analytics.includes("const explicitRewards = Number(investownHistory.externalRewardsCzk)"));
  assert.ok(analytics.includes("explicitProfit / capitalAttributed"));
  assert.equal(
    analytics.includes("explicitProfit /\n                    (ownContribution + transferAttribution)"),
    false,
  );
});

test("Investown realized P/L is investment-only while external rewards stay separate", () => {
  const semantics = source("lib/investown-semantics.mjs");
  const investown = source("lib/server/investown.ts");
  const db = source("lib/server/db.ts");
  const analytics = source("lib/server/analytics.ts");

  assert.ok(semantics.includes('"Smluvní pokuta z prodlení": "interest"'));
  assert.ok(semantics.includes('"Zákonný úrok z prodlení": "interest"'));
  assert.ok(semantics.includes('"Odměna": "income"'));
  assert.ok(semantics.includes("investmentPnlCzk"));
  assert.ok(semantics.includes("externalRewardsCzk"));
  assert.ok(semantics.includes("totalGainCzk"));

  assert.ok(investown.includes("derivedInvestmentPnl"));
  assert.ok(investown.includes("derivedExternalRewards"));
  assert.ok(investown.includes("derivedTotalGain"));
  assert.ok(investown.includes("const derivedRealizedPnl = derivedInvestmentPnl"));
  assert.ok(investown.includes("realizedPnl: derivedRealizedPnl"));
  assert.ok(investown.includes("realizedPnlCzk: derivedRealizedPnl"));

  assert.ok(analytics.includes("'referral_reward'"));
  assert.ok(analytics.includes("'campaign_reward'"));
  assert.ok(analytics.includes("isExternalRewardCategory"));

  assert.ok(db.includes("function repairInvestownRealizedPnl"));
  assert.ok(db.includes("external_rewards_czk"));
  assert.ok(db.includes("investment_income_czk"));
  assert.ok(db.includes("derivedInvestmentPnl"));
  assert.ok(db.includes("derivedExternalRewards"));
  assert.ok(db.includes("repairInvestownRealizedPnl(db)"));
});

test("legacy Investown classification audit is repaired with current semantics", () => {
  const db = source("lib/server/db.ts");

  assert.ok(db.includes("function repairInvestownClassificationAudit"));
  assert.ok(db.includes("classifyInvestownKind"));
  assert.ok(db.includes("investownIncomeCategory"));
  assert.ok(db.includes("unknownTypes"));
  assert.ok(db.includes('"unclassified"'));
  assert.ok(db.includes('String(row.kind) === "adjustment"'));
  assert.ok(db.includes("const requiresPortfolioRebuild"));
  assert.ok(db.includes('classified === "transfer"'));
  assert.ok(db.includes("financeOsClassification: classified"));
  assert.ok(db.includes("repairInvestownClassificationAudit(db)"));
});

test("legacy Investown snapshots are repaired to investment-only P/L", () => {
  const db = source("lib/server/db.ts");

  assert.ok(db.includes("function repairInvestownSnapshotPerformance"));
  assert.ok(db.includes("raw.sourceDate"));
  assert.ok(db.includes("isPerformanceExternalRewardCategory"));
  assert.ok(db.includes("investmentPnlCzk"));
  assert.ok(db.includes("externalRewardsCzk"));
  assert.ok(db.includes("totalGainCzk"));
  assert.ok(db.includes("repairInvestownSnapshotPerformance(db)"));
});

test("unknown Investown transaction types block performance instead of being guessed", () => {
  const investown = source("lib/server/investown.ts");
  const analytics = source("lib/server/analytics.ts");
  const history = source("app/history/page.tsx");

  assert.ok(investown.includes('item.kind === "adjustment"'));
  assert.ok(investown.includes('? "unclassified"'));
  assert.ok(investown.includes("const nativeAccountingComplete"));
  assert.ok(investown.includes("unknownTypes.size === 0"));

  assert.ok(
    analytics.includes(
      "t.kind IN ('deposit', 'withdrawal', 'transfer', 'adjustment')",
    ),
  );
  assert.ok(
    analytics.includes(
      "kind IN ('deposit', 'withdrawal', 'adjustment')",
    ),
  );
  assert.ok(analytics.includes("performanceGapRows"));
  assert.ok(analytics.includes("transactionAccountingDate(row)"));
  assert.ok(analytics.includes("unresolvedAdjustmentCount"));
  assert.ok(history.includes("unresolvedAdjustmentCount"));
  assert.ok(history.includes("blokuje P/L a výnos"));
});

test("Investown native imports are previewed before destructive statement reconciliation", () => {
  const investown = source("lib/server/investown.ts");
  const importer = source("components/investown-importer.tsx");
  const route = source("app/api/import/investown/route.ts");

  assert.ok(investown.includes("dryRun?: boolean"));
  assert.ok(investown.includes("allowAuthoritativeRemovals?: boolean"));
  assert.ok(investown.includes("confirmationToken?: string"));
  assert.ok(investown.includes("const previewToken = crypto"));
  assert.ok(investown.includes("if (input.dryRun)"));
  assert.ok(investown.includes("input.confirmationToken !== previewToken"));
  assert.ok(investown.includes("if (removedTransactions > 0)"));
  assert.ok(importer.includes("Preview změn před importem"));
  assert.ok(importer.includes("Potvrdit a provést import"));
  assert.ok(importer.includes("pendingPreview.previewToken"));
  assert.ok(importer.includes("dryRun"));
  assert.ok(route.includes("allowAuthoritativeRemovals"));
  assert.ok(route.includes("confirmationToken"));
  assert.ok(route.includes("replaceExisting: body.replaceExisting === true"));
  assert.equal(route.includes("replaceExisting: body.replaceExisting !== false"), false);
});

test("full native Investown statements remove rows deleted by the provider", () => {
  const investown = source("lib/server/investown.ts");
  const importer = source("components/investown-importer.tsx");

  assert.ok(investown.includes("const authoritativeNativeSnapshot"));
  assert.ok(investown.includes('input.sourceFormat === "investown-native"'));
  assert.ok(investown.includes("incomingFirstAt <= existingFirstAt"));
  assert.ok(investown.includes("incomingLastAt >= existingLastAt"));
  assert.ok(investown.includes("removedTransactions += remainder.length"));
  assert.ok(investown.includes("lastImportRemovedTransactions: removedTransactions"));
  assert.ok(investown.includes("lastImportAuthoritativeSnapshot: authoritativeNativeSnapshot"));
  assert.ok(importer.includes("removedTransactions: number"));
  assert.ok(importer.includes("historických řádků odstraněno podle novějšího plného výpisu"));
});

test("Investown imports are cumulative and deduplicated", () => {
  const investown = source("lib/server/investown.ts");
  const importer = source("components/investown-importer.tsx");

  assert.ok(investown.includes("const hardReplace = input.replaceExisting === true"));
  assert.ok(investown.includes("existingPrepared"));
  assert.ok(investown.includes("incomingByBase"));
  assert.ok(investown.includes("newTransactions"));
  assert.ok(investown.includes("matchedTransactions"));
  assert.ok(investown.includes("prepared.push(...incoming)"));
  assert.ok(
    investown.includes(
      'db.prepare("DELETE FROM transactions WHERE provider = \'investown\'").run()',
    ),
  );
  assert.ok(importer.includes("replaceExisting: false"));
  assert.ok(importer.includes("už známých"));
  assert.ok(
    importer.includes(
      "Každý import nejdřív proběhne jako read-only preview",
    ),
  );
  assert.ok(importer.includes("autoritativní verzi historie"));
  assert.ok(importer.includes("po výslovném druhém"));
});

test("Investown statement history is never carried past source coverage", () => {
  const investown = source("lib/server/investown.ts");
  const analytics = source("lib/server/analytics.ts");
  const performance = source("app/performance/page.tsx");

  assert.ok(
    investown.includes(
      "A native statement only proves values through its own newest row",
    ),
  );
  assert.ok(
    investown.includes("if (overrideCash !== null || overrideTotal !== null)"),
  );
  assert.equal(
    investown.includes("Always make today's snapshot match"),
    false,
  );

  assert.ok(investown.includes("previousStatementLastAt"));
  assert.ok(investown.includes("previousLastAt: previousStatementLastAt"));
  assert.ok(analytics.includes("valueThroughDate"));
  assert.ok(analytics.includes("date <= item.valueThroughDate"));
  assert.ok(analytics.includes("const valueIsCurrent"));
  assert.ok(
    analytics.includes(
      "unclassifiedFlowCount === 0 && totals.staleValuationCount === 0",
    ),
  );
  assert.ok(performance.includes("nemá hodnotu"));
  assert.ok(performance.includes("DataFreshnessBadge"));
});

test("all account surfaces expose provider-aware data freshness", () => {
  const analytics = source("lib/server/analytics.ts");
  const accounts = source("app/accounts/page.tsx");
  const dashboard = source("app/page.tsx");
  const performance = source("app/performance/page.tsx");
  const badge = source("components/data-freshness-badge.tsx");
  const mintos = source("lib/server/mintos.ts");

  assert.ok(analytics.includes("function accountDataFreshness"));
  assert.ok(analytics.includes('provider === "trading212"'));
  assert.ok(analytics.includes('provider === "kraken"'));
  assert.ok(analytics.includes('provider === "phantom"'));
  assert.ok(analytics.includes('provider === "manual"'));
  assert.ok(analytics.includes("statementLastAt"));
  assert.ok(analytics.includes("missingSince: nextIsoDate(coverageThrough)"));
  assert.ok(analytics.includes("dataFreshness: accountDataFreshness(row)"));
  assert.ok(analytics.includes("dataFreshness: freshness"));

  assert.ok(accounts.includes("DataFreshnessBadge"));
  assert.ok(dashboard.includes("DataFreshnessBadge"));
  assert.ok(performance.includes("DataFreshnessBadge"));
  assert.ok(badge.includes("Chybí od "));
  assert.ok(badge.includes("Aktuální"));
  assert.ok(badge.includes("Aktuálnost neznámá"));

  assert.ok(mintos.includes('balanceMode: "manual-override"'));
  assert.ok(mintos.includes('"derived-from-full-statement"'));
  assert.ok(
    mintos.includes("if (overrideCash !== null || overrideTotal !== null)"),
  );
});

test("Trading 212 sync reconstructs provenance-aware daily history", () => {
  const db = source("lib/server/db.ts");
  const repository = source("lib/server/repository.ts");
  const trading212 = source("lib/server/integrations/trading212.ts");
  const history = source("lib/server/trading212-history.ts");
  const analytics = source("lib/server/analytics.ts");
  const detail = source("app/accounts/[id]/page.tsx");
  const dailyTable = source("components/account-daily-history-table.tsx");

  assert.ok(db.includes("source TEXT NOT NULL DEFAULT 'provider'"));
  assert.ok(db.includes("quality TEXT NOT NULL DEFAULT 'verified'"));
  assert.ok(repository.includes("'provider', 'verified'"));
  assert.ok(trading212.includes("syncTrading212DailyHistory"));
  assert.ok(trading212.includes("dailyHistory"));
  assert.ok(trading212.includes("HISTORY_PAGE_BUDGET"));
  assert.ok(trading212.includes("history_complete:"));
  assert.ok(trading212.includes("history_cursor:"));

  assert.ok(history.includes("Yahoo Finance chart"));
  assert.ok(history.includes("maybeToCzk"));
  assert.ok(history.includes("openingCashResidualCzk"));
  assert.ok(history.includes("openingCashAnchoredToCurrentProviderBalance"));
  assert.ok(history.includes("const cashHistoryComplete = transactionHistoryComplete"));
  assert.ok(history.includes("quantityMismatchAssets"));
  assert.ok(history.includes("transactionHistoryComplete"));
  assert.ok(history.includes("source = 'reconstructed'"));
  assert.ok(history.includes("snapshots.source = 'provider'"));

  assert.ok(analytics.includes("s.quality AS snapshot_quality"));
  assert.ok(analytics.includes("item.partial"));
  assert.ok(analytics.includes("latestByAccount.delete(item.accountId)"));
  assert.ok(analytics.includes("dailyHistory"));
  assert.ok(analytics.includes('const snapshotComplete = snapshotQuality !== "partial"'));
  assert.ok(analytics.includes("valuationCovered ="));
  assert.ok(analytics.includes("performanceComplete,"));
  assert.ok(analytics.includes("reconstructedSnapshotCount"));
  assert.ok(analytics.includes("provider = 'trading212'"));
  assert.ok(analytics.includes('kind === "transfer"'));
  assert.ok(analytics.includes('String(row.provider) === "trading212"'));
  assert.ok(
    source("components/portfolio-history-chart.tsx").includes(
      "Historie vkladů/výběrů není ještě kompletní",
    ),
  );
  assert.ok(detail.includes("Denní historie účtu"));
  assert.ok(detail.includes("Denní rekonstrukce Trading 212"));
  assert.ok(dailyTable.includes("Vklad"));
  assert.ok(dailyTable.includes("Výběr"));
  assert.ok(dailyTable.includes("Výnosy"));
  assert.ok(dailyTable.includes("Poplatky"));
  assert.ok(dailyTable.includes("P/L"));
});

test("account cards link to rich account detail pages", () => {
  const analytics = source("lib/server/analytics.ts");
  const accounts = source("app/accounts/page.tsx");
  const dashboard = source("app/page.tsx");
  const detail = source("app/accounts/[id]/page.tsx");

  assert.ok(analytics.includes("export function getAccountDetail"));
  assert.ok(analytics.includes("WHERE h.account_id = ?"));
  assert.ok(analytics.includes("WHERE t.account_id = ?"));
  assert.ok(analytics.includes("transactionKinds"));
  assert.ok(analytics.includes("sourceMetadata"));
  assert.ok(analytics.includes("chartPoints"));

  assert.ok(accounts.includes('href={"/accounts/" + encodeURIComponent(account.id)}'));
  assert.ok(dashboard.includes('href={"/accounts/" + encodeURIComponent(account.id)}'));
  assert.ok(detail.includes("PortfolioHistoryChart"));
  assert.ok(detail.includes("DataFreshnessBadge"));
  assert.ok(detail.includes("TransactionsTable"));
  assert.ok(detail.includes("Aktuální pozice"));
  assert.ok(detail.includes("Datové pokrytí"));
  assert.ok(detail.includes("Struktura transakcí"));
});

test("performance is blocked by unresolved flows or stale valuations", () => {
  const analytics = source("lib/server/analytics.ts");
  assert.ok(
    analytics.includes(
      "unclassifiedFlowCount === 0 && totals.staleValuationCount === 0",
    ),
  );
  assert.ok(analytics.includes("knownUnclassifiedFlowCzk"));
  assert.ok(analytics.includes("accountPerformanceComplete"));
  assert.ok(analytics.includes("valueIsCurrent"));
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

test("Trading 212 detail always exposes API diagnostics and provider P/L fallback", () => {
  const t212 = source("lib/server/integrations/trading212.ts");
  const analytics = source("lib/server/analytics.ts");
  const detail = source("app/accounts/[id]/page.tsx");

  assert.ok(t212.includes("financeOsApiReadCoverage: apiReadCoverage"));
  assert.ok(analytics.includes("trading212SyncState"));
  assert.ok(detail.includes("Trading 212 API pokrytí"));
  assert.ok(detail.includes("Full export"));
  assert.ok(detail.includes("P/L pozic"));
  assert.ok(detail.includes("Provider P/L pozic; celkový zisk čeká na úplné cash-flow"));
});

test("Trading 212 sync exploits the full useful read-only API surface", () => {
  const card = source("lib/server/trading212-card.ts");
  const t212 = source("lib/server/integrations/trading212.ts");

  assert.ok(card.includes("includeDividends: true"));
  assert.ok(card.includes("includeInterest: true"));
  assert.ok(card.includes("includeOrders: true"));
  assert.ok(card.includes("includeTransactions: true"));
  assert.ok(card.includes("full_export_action_inventory"));
  assert.ok(card.includes('"internal_transfer:cfd"'));
  assert.ok(card.includes('action.includes("to cfd")'));
  assert.ok(card.includes('action.includes("from cfd")'));
  assert.ok(card.includes('["transfer", "deposit", "withdrawal"]'));

  assert.ok(t212.includes('"/equity/account/summary"'));
  assert.ok(t212.includes('"/equity/positions"'));
  assert.ok(t212.includes('"/equity/metadata/instruments"'));
  assert.ok(t212.includes('"/equity/metadata/exchanges"'));
  assert.ok(t212.includes('"/equity/orders"'));
  assert.ok(t212.includes('"/equity/pies"'));
  assert.ok(t212.includes("financeOsApiReadCoverage"));
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
  const analytics = source("lib/server/analytics.ts");
  assert.ok(card.includes('const enrichmentOnly = true'));
  assert.ok(card.includes('.get("cash:" + id)'));
  assert.equal(card.includes('"card-export:" + id, "cash:" + id'), false);
  assert.equal(card.includes('IN (?, ?) LIMIT 1'), false);
  assert.ok(analytics.includes("t.flow_scope = 'external'"));
  assert.ok(analytics.includes("OR t.provider IN ('investown', 'mintos')"));
  assert.ok(analytics.includes("flow_scope = 'external'"));
  assert.ok(analytics.includes("OR provider IN ('investown', 'mintos')"));
});


test("Trading 212 deposit fallback requires repeated provider cashback signature", () => {
  const db = source("lib/server/db.ts");
  assert.ok(db.includes("matchedDates.length < 3"));
  assert.ok(db.includes("previousWithdrawals * 0.015"));
  assert.ok(db.includes("kind = 'income'"));
  assert.ok(db.includes("category = 'card_cashback'"));
  assert.ok(db.includes("category = 'external_deposit'"));
  assert.ok(db.includes("ambiguousCardEraIds"));
  assert.ok(db.includes("date >= firstCardDate"));
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


test("Phantom sync never overwrites canonical identity or pretends PnL is available", () => {
  const phantom = source("lib/server/integrations/phantom.ts");
  assert.ok(
    (phantom.match(/realizedPnlStatus: "unavailable"/g) || []).length >= 2,
  );
  assert.ok(
    (phantom.match(/unrealizedPnlStatus: "unavailable"/g) || []).length >= 2,
  );
  const linkStart = phantom.indexOf("function linkKrakenTransfers");
  const syncStart = phantom.indexOf("export async function syncPhantom", linkStart);
  const linkBlock = phantom.slice(linkStart, syncStart);
  assert.ok(linkBlock.includes("canonicalCryptoIdentity(symbol, symbol)"));
  assert.ok(linkBlock.includes("canonicalKey: identity.canonicalKey"));
});


test("T212 fallback marks only cashback-proven withdrawal days as card spend", () => {
  const db = source("lib/server/db.ts");
  assert.ok(db.includes("category = 'card_spend:inferred'"));
  assert.ok(db.includes("for (const cashbackDate of matchedDates)"));
  assert.ok(
    db.includes("markCardSpend.run(accountId, previousUtcDate(cashbackDate))"),
  );
  assert.ok(
    db.includes("COALESCE(raw_json, '') NOT LIKE '%financeOsCardExport%'"),
  );
});

test("T212 UI distinguishes validated fallback from merchant-rich export", () => {
  const card = source("lib/server/trading212-card.ts");
  const cashFlow = source("app/cash-flow/page.tsx");
  const connections = source("app/connections/page.tsx");
  assert.ok(card.includes('"validated_public_history"'));
  assert.ok(card.includes("inferredCashbackCount"));
  assert.ok(cashFlow.includes("provider-history fallbacku"));
  assert.ok(connections.includes("Ověřený fallback z cash historie"));
});


test("Phantom chain scan skips Kraken transfers already linked by destination metadata", () => {
  const phantom = source("lib/server/integrations/phantom.ts");
  const matcherStart = phantom.indexOf("async function matchKrakenTransfersFromChain");
  const matcherEnd = phantom.indexOf("function phantomAssetExternalId", matcherStart);
  const matcher = phantom.slice(matcherStart, matcherEnd);
  assert.ok(matcher.includes("unlinkedKrakenTransfers().filter"));
  assert.ok(matcher.includes("!matchesAddress(item.counterpartyRef, address)"));
  assert.ok(matcher.includes("!matchesAddress(destinationFromRaw(item.rawJson), address)"));
});


test("history chart keeps user deposits, rewards and P/L capital distinct", () => {
  const analytics = source("lib/server/analytics.ts");
  const chart = source("components/portfolio-history-chart.tsx");
  const historyPage = source("app/history/page.tsx");

  assert.ok(analytics.includes("externalRewardsCzk"));
  assert.ok(analytics.includes("capitalAttributedCzk"));
  assert.ok(analytics.includes("totalOwnContribution"));
  assert.ok(analytics.includes("totalExternalRewards"));
  assert.ok(chart.includes("Čistý vlastní kapitál"));
  assert.ok(chart.includes("Kapitál pro P/L"));
  assert.ok(historyPage.includes("Historie vkladů, výběrů a externích odměn"));
  assert.ok(historyPage.includes("Čistý vlastní kapitál"));
});


test("transaction history exposes flow scope and capital audit filters", () => {
  const analytics = source("lib/server/analytics.ts");
  const table = source("components/transactions-table.tsx");

  assert.ok(analytics.includes("t.flow_scope"));
  assert.ok(analytics.includes("t.transfer_value_czk"));
  assert.ok(table.includes('flow === "own_capital"'));
  assert.ok(table.includes('flow === "rewards"'));
  assert.ok(table.includes('flow === "internal"'));
  assert.ok(table.includes('flow === "unresolved"'));
  assert.ok(table.includes("transferValueCzk"));
});

test("History page exposes unresolved flow gaps instead of folding them into deposits", () => {
  const analytics = source("lib/server/analytics.ts");
  const history = source("app/history/page.tsx");
  assert.ok(analytics.includes("unresolvedCashFlowCount"));
  assert.ok(analytics.includes("unresolvedWalletTransferCount"));
  assert.ok(history.includes("Část historie ještě není bezpečně klasifikovaná"));
});


test("Kraken resync preserves owned Phantom links and wallet lot movements", () => {
  const kraken = source("lib/server/integrations/kraken.ts");
  assert.ok(kraken.includes("ownedWalletLink"));
  assert.ok(kraken.includes('currentCounterparty.startsWith("phantom:")'));
  assert.ok(kraken.includes('"wallet_transfer_out_owned"'));
  assert.ok(kraken.includes('"wallet_transfer_in_owned"'));
  assert.ok(kraken.includes('category.startsWith("wallet_transfer_out_")'));
  assert.ok(kraken.includes('category.startsWith("wallet_transfer_in_")'));
  assert.ok(kraken.includes("t.transfer_value_czk"));
});

test("Connections shows privacy-safe Phantom valuation and Kraken-link coverage", () => {
  const page = source("app/connections/page.tsx");
  assert.ok(page.includes("getPhantomStatus"));
  assert.ok(page.includes("Phantom watch-only coverage"));
  assert.ok(page.includes("matchedKrakenTransfers"));
  assert.ok(page.includes("unpricedTokenCount"));
  assert.equal(page.includes("phantomStatus.address"), false);
});


test("History separates 212 Card spend and refunds from ordinary withdrawals", () => {
  const analytics = source("lib/server/analytics.ts");
  const history = source("app/history/page.tsx");
  assert.ok(analytics.includes("cardSpendCzk"));
  assert.ok(analytics.includes("cardRefundsCzk"));
  assert.ok(analytics.includes('category.startsWith("card_spend:")'));
  assert.ok(analytics.includes('category.startsWith("card_refund:")'));
  assert.ok(history.includes("Čistá útrata 212 Card"));
  assert.ok(history.includes("Card refundy"));
});
