import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "@/lib/server/paths";
import {
  canonicalCryptoIdentity,
  canonicalSecurityIdentity,
} from "@/lib/shared/finance-normalization.mjs";

const globalDb = globalThis as typeof globalThis & {
  __financeOsDb?: DatabaseSync;
};

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => String(row.name) === column);
}


function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function backfillLegacyFlowScopes(db: DatabaseSync) {
  // Old exports predate explicit flow_scope. Bring them in line with the
  // provider semantics used by current sync/import code instead of silently
  // excluding them from performance analytics.
  db.exec(`
    UPDATE transactions
    SET
      flow_scope = CASE
        WHEN kind = 'deposit' THEN 'external'
        WHEN kind = 'withdrawal' THEN 'unclassified'
        WHEN kind = 'transfer' THEN 'internal'
        ELSE 'not_applicable'
      END,
      category = CASE
        WHEN category IS NOT NULL AND category != '' THEN category
        WHEN kind = 'deposit' THEN 'external_deposit'
        WHEN kind = 'withdrawal' THEN 'cash_out_unclassified'
        WHEN kind = 'transfer' THEN 'internal_transfer'
        ELSE category
      END
    WHERE provider = 'trading212'
      AND flow_scope = 'legacy';

    UPDATE transactions
    SET flow_scope = CASE
      WHEN kind IN ('deposit', 'withdrawal') THEN 'external'
      WHEN kind = 'transfer' THEN 'internal'
      ELSE 'not_applicable'
    END
    WHERE provider = 'investown'
      AND flow_scope = 'legacy';

    UPDATE transactions
    SET flow_scope = 'not_applicable'
    WHERE provider = 'kraken'
      AND flow_scope = 'legacy'
      AND kind IN ('buy', 'sell', 'dividend', 'interest', 'fee', 'adjustment');

    UPDATE transactions
    SET flow_scope = 'not_applicable'
    WHERE provider = 'manual'
      AND flow_scope = 'legacy';
  `);
}

function backfillAccountCoverage(db: DatabaseSync) {
  const investownRows = db
    .prepare(
      "SELECT id, raw_json, realized_pnl_status, unrealized_pnl_status " +
        "FROM accounts WHERE provider = 'investown'",
    )
    .all();

  const update = db.prepare(
    "UPDATE accounts SET realized_pnl_status = ?, unrealized_pnl_status = ? WHERE id = ?",
  );

  for (const row of investownRows) {
    const raw = parseJsonObject(row.raw_json);
    const isCompleteNativeStatement =
      raw.importMode === "investown-native" &&
      raw.balanceMode === "derived-from-full-statement";

    if (!isCompleteNativeStatement) continue;

    const realized =
      String(row.realized_pnl_status || "unknown") === "unknown"
        ? "available"
        : String(row.realized_pnl_status);
    const unrealized =
      String(row.unrealized_pnl_status || "unknown") === "unknown"
        ? "not_applicable"
        : String(row.unrealized_pnl_status);

    update.run(realized, unrealized, String(row.id));
  }
}

function backfillCanonicalAssets(db: DatabaseSync) {
  const rows = db
    .prepare(
      "SELECT id, provider, external_id, symbol, asset_class, isin, raw_json " +
        "FROM assets WHERE provider IN ('trading212', 'kraken')",
    )
    .all();

  const update = db.prepare(
    "UPDATE assets SET symbol = ?, canonical_key = ?, isin = ?, listing_symbol = ? WHERE id = ?",
  );

  for (const row of rows) {
    const provider = String(row.provider);
    const raw = parseJsonObject(row.raw_json);

    if (provider === "trading212") {
      const rawIsin =
        typeof raw.isin === "string" && raw.isin
          ? raw.isin
          : row.isin
            ? String(row.isin)
            : "";
      const shortName =
        typeof raw.shortName === "string" ? raw.shortName : "";
      const identity = canonicalSecurityIdentity(
        String(row.external_id),
        rawIsin,
        shortName,
      );
      update.run(
        identity.canonicalSymbol,
        identity.canonicalKey,
        identity.isin,
        identity.listingSymbol,
        String(row.id),
      );
      continue;
    }

    const symbol = String(row.symbol || "").toUpperCase();
    if (!symbol) continue;
    const identity = canonicalCryptoIdentity(
      symbol,
      String(row.external_id || symbol),
    );
    update.run(
      identity.canonicalSymbol,
      String(row.asset_class) === "cash"
        ? "currency:" + identity.canonicalSymbol
        : identity.canonicalKey,
      null,
      identity.listingSymbol,
      String(row.id),
    );
  }
}

export function repairStoredData(db: DatabaseSync) {
  repairStoredData(db);
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
      realized_pnl_status TEXT NOT NULL DEFAULT 'unknown',
      unrealized_pnl_status TEXT NOT NULL DEFAULT 'unknown',
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
      canonical_key TEXT,
      isin TEXT,
      listing_symbol TEXT,
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
      category TEXT,
      source_label TEXT,
      flow_scope TEXT NOT NULL DEFAULT 'legacy',
      counterparty_ref TEXT,
      transfer_value_czk REAL,
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

    CREATE INDEX IF NOT EXISTS idx_transactions_account_occurred
      ON transactions(account_id, occurred_at ASC);

    CREATE INDEX IF NOT EXISTS idx_holdings_account
      ON holdings(account_id);

    CREATE INDEX IF NOT EXISTS idx_snapshots_recorded
      ON snapshots(recorded_at ASC);

    CREATE INDEX IF NOT EXISTS idx_snapshots_account_recorded
      ON snapshots(account_id, recorded_at ASC);

    CREATE TABLE IF NOT EXISTS plan_targets (
      asset_class TEXT PRIMARY KEY,
      target_pct REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investment_journal (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      title TEXT NOT NULL,
      thesis TEXT NOT NULL,
      created_at TEXT NOT NULL,
      review_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_investment_journal_created
      ON investment_journal(created_at DESC);

    CREATE TABLE IF NOT EXISTS asset_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      price_date TEXT NOT NULL,
      close REAL NOT NULL,
      currency TEXT NOT NULL,
      close_czk REAL,
      source TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      UNIQUE(asset_id, price_date)
    );

    CREATE INDEX IF NOT EXISTS idx_asset_prices_asset_date
      ON asset_prices(asset_id, price_date ASC);

    CREATE TABLE IF NOT EXISTS provider_sync_locks (
      provider TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  if (!hasColumn(db, "accounts", "realized_pnl_status")) {
    db.exec("ALTER TABLE accounts ADD COLUMN realized_pnl_status TEXT NOT NULL DEFAULT 'unknown';");
  }
  if (!hasColumn(db, "accounts", "unrealized_pnl_status")) {
    db.exec("ALTER TABLE accounts ADD COLUMN unrealized_pnl_status TEXT NOT NULL DEFAULT 'unknown';");
  }
  if (!hasColumn(db, "assets", "canonical_key")) {
    db.exec("ALTER TABLE assets ADD COLUMN canonical_key TEXT;");
  }
  if (!hasColumn(db, "assets", "isin")) {
    db.exec("ALTER TABLE assets ADD COLUMN isin TEXT;");
  }
  if (!hasColumn(db, "assets", "listing_symbol")) {
    db.exec("ALTER TABLE assets ADD COLUMN listing_symbol TEXT;");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_assets_canonical_key ON assets(canonical_key);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_assets_isin ON assets(isin);");

  if (!hasColumn(db, "accounts", "unclassified_value")) {
    db.exec("ALTER TABLE accounts ADD COLUMN unclassified_value REAL NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "accounts", "unclassified_value_czk")) {
    db.exec("ALTER TABLE accounts ADD COLUMN unclassified_value_czk REAL NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "accounts", "reconciliation_difference")) {
    db.exec("ALTER TABLE accounts ADD COLUMN reconciliation_difference REAL NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "accounts", "reconciliation_status")) {
    db.exec(
      "ALTER TABLE accounts ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'unknown';",
    );
  }

  if (!hasColumn(db, "transactions", "category")) {
    db.exec("ALTER TABLE transactions ADD COLUMN category TEXT;");
  }
  if (!hasColumn(db, "transactions", "source_label")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source_label TEXT;");
  }
  if (!hasColumn(db, "transactions", "flow_scope")) {
    db.exec(
      "ALTER TABLE transactions ADD COLUMN flow_scope TEXT NOT NULL DEFAULT 'legacy';",
    );
  }
  if (!hasColumn(db, "transactions", "counterparty_ref")) {
    db.exec("ALTER TABLE transactions ADD COLUMN counterparty_ref TEXT;");
  }
  if (!hasColumn(db, "transactions", "transfer_value_czk")) {
    db.exec("ALTER TABLE transactions ADD COLUMN transfer_value_czk REAL;");
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_transactions_account_kind_scope " +
      "ON transactions(account_id, kind, flow_scope, occurred_at ASC);",
  );

  backfillLegacyFlowScopes(db);
  backfillAccountCoverage(db);
  backfillCanonicalAssets(db);
}

export function getDb(): DatabaseSync {
  if (!globalDb.__financeOsDb) {
    const db = new DatabaseSync(getDatabasePath());
    initialize(db);
    globalDb.__financeOsDb = db;
  }

  return globalDb.__financeOsDb;
}
