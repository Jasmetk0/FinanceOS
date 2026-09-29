import { getDb } from "@/lib/server/db";
import { toCzk } from "@/lib/server/fx";
import {
  recordSnapshot,
  upsertAccount,
} from "@/lib/server/repository";

const EXTERNAL_ID = "spending-pot:manual";

export async function saveTrading212SpendingPot(input: {
  value: number;
  currency: string;
}) {
  const value = Number(input.value);
  const currency = input.currency.trim().toUpperCase() || "CZK";

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Spending pot balance must be a valid non-negative number.");
  }

  const valueCzk = await toCzk(value, currency);

  const id = upsertAccount({
    provider: "trading212",
    externalId: EXTERNAL_ID,
    name: "Trading 212 Spending pot",
    type: "cash",
    currency,
    cashValue: value,
    investedValue: 0,
    totalValue: value,
    realizedPnl: 0,
    unrealizedPnl: 0,
    cashValueCzk: valueCzk,
    investedValueCzk: 0,
    totalValueCzk: valueCzk,
    realizedPnlCzk: 0,
    unrealizedPnlCzk: 0,
    raw: {
      manualAuxiliaryBalance: true,
      source: "Trading 212 card spending pot",
      publicApiAvailable: false,
    },
  });

  recordSnapshot(id);
  return getTrading212SpendingPot();
}

export function getTrading212SpendingPot() {
  const row = getDb()
    .prepare(
      "SELECT id, external_id, name, currency, cash_value, cash_value_czk, " +
        "total_value, total_value_czk, updated_at " +
        "FROM accounts WHERE provider = 'trading212' AND external_id = ?",
    )
    .get(EXTERNAL_ID);

  if (!row) return null;

  return {
    id: String(row.id),
    externalId: String(row.external_id),
    name: String(row.name),
    currency: String(row.currency),
    value: Number(row.total_value),
    valueCzk: Number(row.total_value_czk),
    updatedAt: String(row.updated_at),
  };
}

export function deleteTrading212SpendingPot() {
  getDb()
    .prepare(
      "DELETE FROM accounts WHERE provider = 'trading212' AND external_id = ?",
    )
    .run(EXTERNAL_ID);
}
