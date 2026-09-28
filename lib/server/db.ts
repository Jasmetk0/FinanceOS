import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "@/lib/server/paths";

const globalDb = globalThis as typeof globalThis & {
  __financeOsDb?: DatabaseSync;
};

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => String(row.name) === column);
}

function initialize(db: DatabaseSync) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      provider TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'live',
      credentials_enc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT NOT NULL,
      cash_value REAL NOT NULL DEFAULT 0,
      invested_value REAL NOT NULL DEFAULT 0,
      total_value REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      unrealized_pnl REAL NOT NULL DEFAULT 0,
      cash_value_czk REAL NOT NULL DEFAULT 0,
      invested_value_czk REAL NOT NULL DEFAULT 0,
      total_value_czk REAL NOT NULL DEFAULT 0,
      realized_pnl_czk REAL NOT NULL DEFAULT 0,
      unrealized_pnl_czk REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      raw_json TEXT,
      UNIQUE(provider, external_id)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      raw_json TEXT,
      UNIQUE(provider, external_id)
    );

    CREATE TABLE IF NOT EXISTS holdings (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      quantity REAL NOT NULL DEFAULT 0,
      average_price REAL,
      current_price REAL,
      currency TEXT NOT NULL,
      market_value REAL NOT NULL DEFAULT 0,
      market_value_czk REAL NOT NULL DEFAULT 0,
      unrealized_pnl REAL,
      unrealized_pnl_czk REAL,
      updated_at TEXT NOT NULL,
      raw_json TEXT,
      UNIQUE(account_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      amount_czk REAL,
      asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
      quantity REAL,
      price REAL,
      fee REAL,
      note TEXT,
      raw_json TEXT,
      UNIQUE(provider, external_id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      recorded_at TEXT NOT NULL,
      total_value_czk REAL NOT NULL,
      cash_value_czk REAL NOT NULL,
      invested_value_czk REAL NOT NULL,
      UNIQUE(account_id, recorded_at)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_occurred
      ON transactions(occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_holdings_account
      ON holdings(account_id);

    CREATE INDEX IF NOT EXISTS idx_snapshots_recorded
      ON snapshots(recorded_at ASC);
  `);

  if (!hasColumn(db, "transactions", "category")) {
    db.exec("ALTER TABLE transactions ADD COLUMN category TEXT;");
  }
  if (!hasColumn(db, "transactions", "source_label")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source_label TEXT;");
  }
}

export function getDb(): DatabaseSync {
  if (!globalDb.__financeOsDb) {
    const db = new DatabaseSync(getDatabasePath());
    initialize(db);
    globalDb.__financeOsDb = db;
  }

  return globalDb.__financeOsDb;
}
