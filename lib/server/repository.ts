import crypto from "node:crypto";
import { getDb } from "@/lib/server/db";
import { decryptJson, encryptJson } from "@/lib/server/crypto";
import type { ProviderId, TransactionKind } from "@/lib/domain";

export interface ConnectionSecret<T = Record<string, string>> {
  provider: ProviderId;
  label: string;
  environment: string;
  credentials: T;
}

export interface ConnectionSafe {
  provider: ProviderId;
  label: string;
  environment: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface AccountInput {
  provider: ProviderId;
  externalId: string;
  name: string;
  type: string;
  currency: string;
  cashValue: number;
  investedValue: number;
  totalValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  cashValueCzk: number;
  investedValueCzk: number;
  totalValueCzk: number;
  realizedPnlCzk: number;
  unrealizedPnlCzk: number;
  raw?: unknown;
}

export interface AssetInput {
  provider: ProviderId;
  externalId: string;
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
  raw?: unknown;
}

export interface HoldingInput {
  accountId: string;
  assetId: string;
  quantity: number;
  averagePrice: number | null;
  currentPrice: number | null;
  currency: string;
  marketValue: number;
  marketValueCzk: number;
  unrealizedPnl: number | null;
  unrealizedPnlCzk: number | null;
  raw?: unknown;
}

export interface TransactionInput {
  provider: ProviderId;
  accountId: string;
  externalId: string;
  kind: TransactionKind;
  occurredAt: string;
  currency: string;
  amount: number;
  amountCzk: number | null;
  assetId?: string | null;
  quantity?: number | null;
  price?: number | null;
  fee?: number | null;
  note?: string | null;
  category?: string | null;
  sourceLabel?: string | null;
  raw?: unknown;
}

function stableId(prefix: string, value: string): string {
  const digest = crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function now() {
  return new Date().toISOString();
}

export function accountId(provider: ProviderId, externalId: string) {
  return stableId("acct", `${provider}:${externalId}`);
}

export function assetId(provider: ProviderId, externalId: string) {
  return stableId("asset", `${provider}:${externalId}`);
}

export function transactionId(provider: ProviderId, externalId: string) {
  return stableId("tx", `${provider}:${externalId}`);
}

export function saveConnection<T extends object>(
  provider: ProviderId,
  label: string,
  environment: string,
  credentials: T,
) {
  const db = getDb();
  const timestamp = now();
  const encrypted = encryptJson(credentials);

  db.prepare(`
    INSERT INTO connections(
      provider, label, environment, credentials_enc, status,
      last_synced_at, last_error, created_at, updated_at
    )
    VALUES(?, ?, ?, ?, 'connected', NULL, NULL, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      label = excluded.label,
      environment = excluded.environment,
      credentials_enc = excluded.credentials_enc,
      status = 'connected',
      last_error = NULL,
      updated_at = excluded.updated_at
  `).run(provider, label, environment, encrypted, timestamp, timestamp);
}

export function getConnectionSecret<T extends object>(
  provider: ProviderId,
): ConnectionSecret<T> | null {
  const row = getDb()
    .prepare("SELECT provider, label, environment, credentials_enc FROM connections WHERE provider = ?")
    .get(provider);

  if (!row) return null;

  return {
    provider: String(row.provider) as ProviderId,
    label: String(row.label),
    environment: String(row.environment),
    credentials: decryptJson<T>(String(row.credentials_enc)),
  };
}

export function listConnections(): ConnectionSafe[] {
  return getDb()
    .prepare(`
      SELECT provider, label, environment, status, last_synced_at, last_error
      FROM connections
      ORDER BY provider
    `)
    .all()
    .map((row) => ({
      provider: String(row.provider) as ProviderId,
      label: String(row.label),
      environment: String(row.environment),
      status: String(row.status),
      lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
      lastError: row.last_error ? String(row.last_error) : null,
    }));
}

export function removeConnection(provider: ProviderId) {
  getDb().prepare("DELETE FROM connections WHERE provider = ?").run(provider);
}

export function markConnectionSyncing(provider: ProviderId) {
  getDb()
    .prepare("UPDATE connections SET status = 'syncing', last_error = NULL, updated_at = ? WHERE provider = ?")
    .run(now(), provider);
}

export function markConnectionSynced(provider: ProviderId) {
  const timestamp = now();
  getDb()
    .prepare(`
      UPDATE connections
      SET status = 'connected', last_synced_at = ?, last_error = NULL, updated_at = ?
      WHERE provider = ?
    `)
    .run(timestamp, timestamp, provider);
}

export function markConnectionError(provider: ProviderId, error: string) {
  getDb()
    .prepare(`
      UPDATE connections
      SET status = 'error', last_error = ?, updated_at = ?
      WHERE provider = ?
    `)
    .run(error.slice(0, 1000), now(), provider);
}

export function upsertAccount(input: AccountInput): string {
  const id = accountId(input.provider, input.externalId);
  getDb()
    .prepare(`
      INSERT INTO accounts(
        id, provider, external_id, name, type, currency,
        cash_value, invested_value, total_value, realized_pnl, unrealized_pnl,
        cash_value_czk, invested_value_czk, total_value_czk,
        realized_pnl_czk, unrealized_pnl_czk, updated_at, raw_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, external_id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        currency = excluded.currency,
        cash_value = excluded.cash_value,
        invested_value = excluded.invested_value,
        total_value = excluded.total_value,
        realized_pnl = excluded.realized_pnl,
        unrealized_pnl = excluded.unrealized_pnl,
        cash_value_czk = excluded.cash_value_czk,
        invested_value_czk = excluded.invested_value_czk,
        total_value_czk = excluded.total_value_czk,
        realized_pnl_czk = excluded.realized_pnl_czk,
        unrealized_pnl_czk = excluded.unrealized_pnl_czk,
        updated_at = excluded.updated_at,
        raw_json = excluded.raw_json
    `)
    .run(
      id,
      input.provider,
      input.externalId,
      input.name,
      input.type,
      input.currency,
      input.cashValue,
      input.investedValue,
      input.totalValue,
      input.realizedPnl,
      input.unrealizedPnl,
      input.cashValueCzk,
      input.investedValueCzk,
      input.totalValueCzk,
      input.realizedPnlCzk,
      input.unrealizedPnlCzk,
      now(),
      input.raw === undefined ? null : JSON.stringify(input.raw),
    );

  return id;
}

export function upsertAsset(input: AssetInput): string {
  const id = assetId(input.provider, input.externalId);
  getDb()
    .prepare(`
      INSERT INTO assets(id, provider, external_id, symbol, name, asset_class, currency, raw_json)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, external_id) DO UPDATE SET
        symbol = excluded.symbol,
        name = excluded.name,
        asset_class = excluded.asset_class,
        currency = excluded.currency,
        raw_json = excluded.raw_json
    `)
    .run(
      id,
      input.provider,
      input.externalId,
      input.symbol,
      input.name,
      input.assetClass,
      input.currency,
      input.raw === undefined ? null : JSON.stringify(input.raw),
    );
  return id;
}

export function replaceHoldings(accountIdValue: string, holdings: HoldingInput[]) {
  const db = getDb();
  db.prepare("DELETE FROM holdings WHERE account_id = ?").run(accountIdValue);

  const insert = db.prepare(`
    INSERT INTO holdings(
      id, account_id, asset_id, quantity, average_price, current_price,
      currency, market_value, market_value_czk, unrealized_pnl,
      unrealized_pnl_czk, updated_at, raw_json
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const holding of holdings) {
    const id = stableId("holding", `${holding.accountId}:${holding.assetId}`);
    insert.run(
      id,
      holding.accountId,
      holding.assetId,
      holding.quantity,
      holding.averagePrice,
      holding.currentPrice,
      holding.currency,
      holding.marketValue,
      holding.marketValueCzk,
      holding.unrealizedPnl,
      holding.unrealizedPnlCzk,
      now(),
      holding.raw === undefined ? null : JSON.stringify(holding.raw),
    );
  }
}

export function upsertTransaction(input: TransactionInput) {
  const id = transactionId(input.provider, input.externalId);
  getDb()
    .prepare(`
      INSERT INTO transactions(
        id, provider, account_id, external_id, kind, occurred_at, currency,
        amount, amount_czk, asset_id, quantity, price, fee, note,
        category, source_label, raw_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, external_id) DO UPDATE SET
        account_id = excluded.account_id,
        kind = excluded.kind,
        occurred_at = excluded.occurred_at,
        currency = excluded.currency,
        amount = excluded.amount,
        amount_czk = excluded.amount_czk,
        asset_id = excluded.asset_id,
        quantity = excluded.quantity,
        price = excluded.price,
        fee = excluded.fee,
        note = excluded.note,
        category = excluded.category,
        source_label = excluded.source_label,
        raw_json = excluded.raw_json
    `)
    .run(
      id,
      input.provider,
      input.accountId,
      input.externalId,
      input.kind,
      input.occurredAt,
      input.currency,
      input.amount,
      input.amountCzk,
      input.assetId ?? null,
      input.quantity ?? null,
      input.price ?? null,
      input.fee ?? null,
      input.note ?? null,
      input.category ?? null,
      input.sourceLabel ?? null,
      input.raw === undefined ? null : JSON.stringify(input.raw),
    );
}

export function recordSnapshot(accountIdValue: string) {
  const account = getDb()
    .prepare(`
      SELECT total_value_czk, cash_value_czk, invested_value_czk
      FROM accounts WHERE id = ?
    `)
    .get(accountIdValue);
  if (!account) return;

  const date = new Date().toISOString().slice(0, 10);
  getDb()
    .prepare(`
      INSERT INTO snapshots(account_id, recorded_at, total_value_czk, cash_value_czk, invested_value_czk)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(account_id, recorded_at) DO UPDATE SET
        total_value_czk = excluded.total_value_czk,
        cash_value_czk = excluded.cash_value_czk,
        invested_value_czk = excluded.invested_value_czk
    `)
    .run(
      accountIdValue,
      date,
      Number(account.total_value_czk),
      Number(account.cash_value_czk),
      Number(account.invested_value_czk),
    );
}

export function ensureManualAccount(): string {
  const id = accountId("manual", "main");
  const existing = getDb().prepare("SELECT id FROM accounts WHERE id = ?").get(id);
  if (!existing) {
    upsertAccount({
      provider: "manual",
      externalId: "main",
      name: "Manual",
      type: "manual",
      currency: "CZK",
      cashValue: 0,
      investedValue: 0,
      totalValue: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      cashValueCzk: 0,
      investedValueCzk: 0,
      totalValueCzk: 0,
      realizedPnlCzk: 0,
      unrealizedPnlCzk: 0,
    });
  }
  return id;
}
