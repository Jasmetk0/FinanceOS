import { getDb } from "@/lib/server/db";
import type { XRayHolding } from "@/lib/xray/engine";

/**
 * Read-only provider-backed holdings. No guessed prices, no copying provider
 * credentials or finance data to source control.
 */
export function getXRayHoldings(): XRayHolding[] {
  const db = getDb();
  return db.prepare(
    "SELECT h.id, a.symbol, a.name, a.asset_class, a.isin, a.canonical_key, " +
    "h.quantity, h.market_value_czk, h.updated_at, ac.name AS account_name, ac.provider " +
    "FROM holdings h JOIN assets a ON a.id = h.asset_id " +
    "JOIN accounts ac ON ac.id = h.account_id " +
    "WHERE a.asset_class IN ('stock','etf','crypto') AND h.market_value_czk > 0 " +
    "ORDER BY h.market_value_czk DESC"
  ).all().map((row) => ({
    id: String(row.id),
    symbol: String(row.symbol || ""),
    name: String(row.name || row.symbol || ""),
    assetClass: String(row.asset_class),
    isin: row.isin ? String(row.isin) : null,
    canonicalKey: row.canonical_key ? String(row.canonical_key) : null,
    quantity: Number(row.quantity),
    valueCzk: Number(row.market_value_czk),
    provider: String(row.provider),
    accountName: String(row.account_name),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  }));
}
