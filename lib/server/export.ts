import { getDb } from "@/lib/server/db";
import { listConnections } from "@/lib/server/repository";
import { getTrading212CardStatus } from "@/lib/server/trading212-card";

export function buildExport() {
  const db = getDb();
  const connections = listConnections();
  const trading212Card = getTrading212CardStatus();
  const accounts = db
    .prepare("SELECT * FROM accounts ORDER BY provider, name")
    .all();
  const assets = db
    .prepare("SELECT * FROM assets ORDER BY provider, symbol")
    .all();
  const holdings = db
    .prepare("SELECT * FROM holdings ORDER BY account_id, id")
    .all();
  const transactions = db
    .prepare("SELECT * FROM transactions ORDER BY occurred_at ASC")
    .all();
  const snapshots = db
    .prepare("SELECT * FROM snapshots ORDER BY recorded_at ASC")
    .all();
  const assetPrices = db
    .prepare("SELECT * FROM asset_prices ORDER BY asset_id, price_date ASC")
    .all();
  const providerSyncState = db
    .prepare("SELECT * FROM provider_sync_state ORDER BY provider, key")
    .all();

  const reconciliation = accounts.reduce<Record<string, number>>(
    (acc, row) => {
      const status = String(row.reconciliation_status || "unknown");
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const missingTransactionCzk = transactions.reduce(
    (count, row) =>
      row.amount_czk === null || row.amount_czk === undefined
        ? count + 1
        : count,
    0,
  );

  const unclassifiedFlows = transactions.reduce(
    (count, row) =>
      String(row.flow_scope || "legacy") === "unclassified"
        ? count + 1
        : count,
    0,
  );

  const legacyFlows = transactions.reduce(
    (count, row) =>
      String(row.flow_scope || "legacy") === "legacy"
        ? count + 1
        : count,
    0,
  );

  const connectionErrors = connections
    .filter((connection) => connection.status === "error")
    .map((connection) => ({
      provider: connection.provider,
      error: connection.lastError,
    }));

  const pnlCoverage = accounts.reduce<Record<string, number>>((acc, row) => {
    if (!["brokerage", "crypto", "p2p"].includes(String(row.type))) return acc;
    const realized = String(row.realized_pnl_status || "unknown");
    const unrealized = String(row.unrealized_pnl_status || "unknown");
    const key = realized + "/" + unrealized;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const canonicalEligible = assets.filter((row) =>
    ["trading212", "kraken", "mintos"].includes(String(row.provider)),
  );
  const canonicalIdentity = {
    withCanonicalKey: assets.filter((row) => Boolean(row.canonical_key)).length,
    withIsin: assets.filter((row) => Boolean(row.isin)).length,
    total: assets.length,
    eligible: canonicalEligible.length,
    eligibleWithCanonicalKey: canonicalEligible.filter((row) =>
      Boolean(row.canonical_key),
    ).length,
  };

  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    schemaVersion: 2,
    dataHealth: {
      reconciliation,
      missingTransactionCzk,
      unclassifiedFlows,
      legacyFlows,
      historicalPriceRows: assetPrices.length,
      connectionErrors,
      pnlCoverage,
      canonicalIdentity,
      trading212Card,
      counts: {
        accounts: accounts.length,
        assets: assets.length,
        holdings: holdings.length,
        transactions: transactions.length,
        snapshots: snapshots.length,
        providerSyncState: providerSyncState.length,
      },
      note:
        "Unknown/unclassified values are intentionally preserved instead of being coerced to zero or guessed.",
    },
    connections,
    accounts,
    assets,
    holdings,
    transactions,
    snapshots,
    assetPrices,
    providerSyncState,
    planTargets: db
      .prepare("SELECT * FROM plan_targets ORDER BY asset_class ASC")
      .all(),
    planSettings: db
      .prepare("SELECT * FROM plan_settings ORDER BY key ASC")
      .all(),
    investmentJournal: db
      .prepare("SELECT * FROM investment_journal ORDER BY created_at ASC")
      .all(),
  };
}
