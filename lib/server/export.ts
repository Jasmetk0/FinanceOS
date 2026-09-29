import { getDb } from "@/lib/server/db";
import { listConnections } from "@/lib/server/repository";

export function buildExport() {
  const db = getDb();
  const connections = listConnections();
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

  const connectionErrors = connections
    .filter((connection) => connection.status === "error")
    .map((connection) => ({
      provider: connection.provider,
      error: connection.lastError,
    }));

  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    schemaVersion: 2,
    dataHealth: {
      reconciliation,
      missingTransactionCzk,
      unclassifiedFlows,
      historicalPriceRows: assetPrices.length,
      connectionErrors,
      counts: {
        accounts: accounts.length,
        assets: assets.length,
        holdings: holdings.length,
        transactions: transactions.length,
        snapshots: snapshots.length,
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
