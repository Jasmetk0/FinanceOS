import crypto from "node:crypto";
import type { TransactionKind } from "@/lib/domain";
import { maybeToCzk, toCzk } from "@/lib/server/fx";
import {
  recordSnapshot,
  upsertAccount,
  upsertTransaction,
} from "@/lib/server/repository";

export interface MintosImportRow {
  externalId?: string;
  occurredAt: string;
  amount: number;
  currency: string;
  description?: string;
  type?: string;
  sourceIndex?: number;
}

function classifyMintos(row: MintosImportRow): TransactionKind {
  const text = `${row.type || ""} ${row.description || ""}`.toLowerCase();

  if (text.includes("deposit") || text.includes("incoming payment")) return "deposit";
  if (text.includes("withdraw")) return "withdrawal";
  if (
    text.includes("interest") ||
    text.includes("coupon") ||
    text.includes("yield")
  ) {
    return "interest";
  }
  if (text.includes("fee") || text.includes("commission")) return "fee";
  if (
    text.includes("cashback") ||
    text.includes("bonus") ||
    text.includes("campaign")
  ) {
    return "income";
  }
  if (
    text.includes("investment") ||
    text.includes("purchase") ||
    text.includes("principal") ||
    text.includes("repayment") ||
    text.includes("redemption")
  ) {
    return "transfer";
  }

  return "adjustment";
}

function stableRowBase(row: MintosImportRow): string {
  if (row.externalId?.trim()) return "external:" + row.externalId.trim();

  const payload = JSON.stringify({
    occurredAt: row.occurredAt,
    amount: row.amount,
    currency: row.currency,
    description: row.description || "",
    type: row.type || "",
  });
  return "hash:" +
    crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export async function importMintos(input: {
  accountCurrency: string;
  currentValue: number;
  cashValue: number;
  rows: MintosImportRow[];
}) {
  const accountCurrency = input.accountCurrency.trim().toUpperCase() || "EUR";
  if (!Number.isFinite(input.currentValue) || input.currentValue < 0) {
    throw new Error("Mintos current value must be zero or positive.");
  }
  if (!Number.isFinite(input.cashValue) || input.cashValue < 0) {
    throw new Error("Mintos cash value must be zero or positive.");
  }
  if (input.cashValue > input.currentValue) {
    throw new Error("Mintos cash value cannot exceed total current value.");
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("No Mintos rows were provided.");
  }
  if (input.rows.length > 20_000) {
    throw new Error("A single Mintos import is limited to 20,000 rows.");
  }

  const investedValue = input.currentValue - input.cashValue;
  const [cashValueCzk, investedValueCzk, totalValueCzk] = await Promise.all([
    toCzk(input.cashValue, accountCurrency),
    toCzk(investedValue, accountCurrency),
    toCzk(input.currentValue, accountCurrency),
  ]);

  const accountId = upsertAccount({
    provider: "mintos",
    externalId: "main",
    name: "Mintos",
    type: "p2p",
    currency: accountCurrency,
    cashValue: input.cashValue,
    investedValue,
    totalValue: input.currentValue,
    realizedPnl: 0,
    unrealizedPnl: 0,
    cashValueCzk,
    investedValueCzk,
    totalValueCzk,
    realizedPnlCzk: 0,
    unrealizedPnlCzk: 0,
    raw: { imported: true },
  });

  let imported = 0;
  let skipped = 0;
  const duplicateOrdinals = new Map<string, number>();

  for (const row of input.rows) {
    const amount = Number(row.amount);
    const currency = String(row.currency || accountCurrency).trim().toUpperCase();
    const occurredAt = new Date(row.occurredAt);

    if (
      !Number.isFinite(amount) ||
      !currency ||
      Number.isNaN(occurredAt.getTime())
    ) {
      skipped += 1;
      continue;
    }

    const occurredIso = occurredAt.toISOString();
    const amountCzk = await maybeToCzk(amount, currency, occurredIso);
    const kind = classifyMintos(row);
    const base = stableRowBase(row);
    const ordinal = duplicateOrdinals.get(base) ?? 0;
    duplicateOrdinals.set(base, ordinal + 1);
    const stableId = base.startsWith("external:")
      ? base
      : base + ":" + String(ordinal);

    upsertTransaction({
      provider: "mintos",
      accountId,
      externalId: "statement:" + stableId,
      kind,
      occurredAt: occurredIso,
      currency,
      amount,
      amountCzk,
      note: [row.type, row.description].filter(Boolean).join(" · ") || "Mintos",
      raw: row,
    });
    imported += 1;
  }

  recordSnapshot(accountId);

  return {
    accountId,
    imported,
    skipped,
    totalRows: input.rows.length,
  };
}
