import crypto from "node:crypto";
import { getDb } from "@/lib/server/db";
import { toCzk } from "@/lib/server/fx";
import {
  recordSnapshot,
  upsertAccount,
} from "@/lib/server/repository";

export type ManualBalanceKind = "cash" | "asset" | "liability";

function normalizeKind(value: string): ManualBalanceKind {
  if (value === "cash" || value === "asset" || value === "liability") {
    return value;
  }
  throw new Error("Manual balance kind must be cash, asset, or liability.");
}

export async function saveManualBalance(input: {
  externalId?: string;
  name: string;
  kind: string;
  value: number;
  currency: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Balance name is required.");

  const kind = normalizeKind(input.kind);
  const currency = input.currency.trim().toUpperCase() || "CZK";
  const absoluteValue = Math.abs(Number(input.value));

  if (!Number.isFinite(absoluteValue)) {
    throw new Error("Balance value must be a valid number.");
  }

  const externalId =
    input.externalId?.trim() || `balance:${crypto.randomUUID()}`;
  if (!externalId.startsWith("balance:")) {
    throw new Error("Invalid manual balance identifier.");
  }

  const signedValue = kind === "liability" ? -absoluteValue : absoluteValue;
  const signedValueCzk = await toCzk(signedValue, currency);
  const accountType =
    kind === "cash" ? "cash" : kind === "liability" ? "liability" : "asset";

  const id = upsertAccount({
    provider: "manual",
    externalId,
    name,
    type: accountType,
    currency,
    cashValue: kind === "cash" ? signedValue : 0,
    investedValue: 0,
    totalValue: signedValue,
    realizedPnl: 0,
    unrealizedPnl: 0,
    realizedPnlStatus: "not_applicable",
    unrealizedPnlStatus: "not_applicable",
    cashValueCzk: kind === "cash" ? signedValueCzk : 0,
    investedValueCzk: 0,
    totalValueCzk: signedValueCzk,
    realizedPnlCzk: 0,
    unrealizedPnlCzk: 0,
    raw: {
      manualBalance: true,
      kind,
    },
  });

  recordSnapshot(id);
  return id;
}

export function listManualBalances() {
  return getDb()
    .prepare(`
      SELECT
        id, external_id, name, type, currency,
        total_value, total_value_czk, updated_at
      FROM accounts
      WHERE provider = 'manual'
        AND external_id LIKE 'balance:%'
      ORDER BY
        CASE type
          WHEN 'cash' THEN 1
          WHEN 'asset' THEN 2
          WHEN 'liability' THEN 3
          ELSE 4
        END,
        name ASC
    `)
    .all()
    .map((row) => ({
      id: String(row.id),
      externalId: String(row.external_id),
      name: String(row.name),
      kind:
        String(row.type) === "liability"
          ? "liability"
          : String(row.type) === "cash"
            ? "cash"
            : "asset",
      currency: String(row.currency),
      value: Number(row.total_value),
      valueCzk: Number(row.total_value_czk),
      updatedAt: String(row.updated_at),
    }));
}

export function deleteManualBalance(externalId: string) {
  if (!externalId.startsWith("balance:")) {
    throw new Error("Invalid manual balance identifier.");
  }

  const result = getDb()
    .prepare(
      "DELETE FROM accounts WHERE provider = 'manual' AND external_id = ?",
    )
    .run(externalId);

  if (!result.changes) {
    throw new Error("Manual balance was not found.");
  }
}
