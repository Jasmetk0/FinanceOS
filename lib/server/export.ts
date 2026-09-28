import { getDb } from "@/lib/server/db";
import { listConnections } from "@/lib/server/repository";

export function buildExport() {
  const db = getDb();

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    connections: listConnections(),
    accounts: db.prepare("SELECT * FROM accounts ORDER BY provider, name").all(),
    assets: db.prepare("SELECT * FROM assets ORDER BY provider, symbol").all(),
    holdings: db.prepare("SELECT * FROM holdings ORDER BY account_id, id").all(),
    transactions: db
      .prepare("SELECT * FROM transactions ORDER BY occurred_at ASC")
      .all(),
    snapshots: db
      .prepare("SELECT * FROM snapshots ORDER BY recorded_at ASC")
      .all(),
    assetPrices: db
      .prepare("SELECT * FROM asset_prices ORDER BY asset_id, price_date ASC")
      .all(),
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
