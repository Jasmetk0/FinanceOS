import crypto from "node:crypto";
import type { TransactionKind } from "@/lib/domain";
import {
  ensureManualAccount,
  recordSnapshot,
  upsertAccount,
  upsertTransaction,
} from "@/lib/server/repository";
import { getDb } from "@/lib/server/db";
import { maybeToCzk } from "@/lib/server/fx";

const allowedKinds = new Set<TransactionKind>([
  "income",
  "expense",
  "gift",
  "deposit",
  "withdrawal",
  "interest",
  "fee",
  "adjustment",
]);

function recalculateManualAccount(accountIdValue: string) {
  recalculateManualAccount(accountIdValue);
}

export function deleteManualTransaction(id: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT id, account_id, provider FROM transactions WHERE id = ?")
    .get(id);

  if (!row) {
    throw new Error("Transaction was not found.");
  }
  if (String(row.provider) !== "manual") {
    throw new Error("Only manual transactions can be deleted.");
  }

  const accountIdValue = String(row.account_id);
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  recalculateManualAccount(accountIdValue);
}

export async function addManualTransaction(input: {
  kind: string;
  amount: number;
  currency: string;
  occurredAt: string;
  note?: string;
  category?: string;
  sourceLabel?: string;
}) {
  const kind = input.kind as TransactionKind;
  if (!allowedKinds.has(kind)) {
    throw new Error("Unsupported manual transaction type.");
  }
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new Error("Amount must be a non-zero number.");
  }

  const accountIdValue = ensureManualAccount();
  const currency = input.currency.trim().toUpperCase() || "CZK";
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("Invalid transaction date.");
  }

  let amount = input.amount;
  if (["expense", "withdrawal", "fee"].includes(kind)) {
    amount = -Math.abs(amount);
  } else if (["income", "gift", "deposit", "interest"].includes(kind)) {
    amount = Math.abs(amount);
  }

  const amountCzk = await maybeToCzk(amount, currency, occurredAt);
  const externalId = `manual:${crypto.randomUUID()}`;

  upsertTransaction({
    provider: "manual",
    accountId: accountIdValue,
    externalId,
    kind,
    occurredAt: occurredAt.toISOString(),
    currency,
    amount,
    amountCzk,
    note: input.note?.trim() || null,
    category: input.category?.trim() || null,
    sourceLabel: input.sourceLabel?.trim() || null,
  });

  const totalRow = getDb()
    .prepare(`
      SELECT COALESCE(SUM(amount_czk), 0) AS total
      FROM transactions
      WHERE account_id = ?
    `)
    .get(accountIdValue);
  const totalCzk = Number(totalRow?.total ?? 0);

  upsertAccount({
    provider: "manual",
    externalId: "main",
    name: "Manual",
    type: "manual",
    currency: "CZK",
    cashValue: totalCzk,
    investedValue: 0,
    totalValue: totalCzk,
    realizedPnl: 0,
    unrealizedPnl: 0,
    cashValueCzk: totalCzk,
    investedValueCzk: 0,
    totalValueCzk: totalCzk,
    realizedPnlCzk: 0,
    unrealizedPnlCzk: 0,
  });

  recordSnapshot(accountIdValue);
}
