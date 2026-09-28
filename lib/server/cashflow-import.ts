import crypto from "node:crypto";
import { ensureManualAccount, upsertTransaction } from "@/lib/server/repository";
import { maybeToCzk } from "@/lib/server/fx";

export interface CashFlowImportRow {
  externalId?: string;
  occurredAt: string;
  amount: number;
  currency: string;
  description?: string;
  category?: string;
  sourceLabel?: string;
  kind?: string;
}

function stableBase(row: CashFlowImportRow): string {
  if (row.externalId?.trim()) {
    return "external:" + row.externalId.trim();
  }

  const payload = JSON.stringify({
    occurredAt: row.occurredAt,
    amount: row.amount,
    currency: row.currency,
    description: row.description || "",
    category: row.category || "",
    sourceLabel: row.sourceLabel || "",
  });

  return (
    "hash:" +
    crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32)
  );
}

const ALLOWED_KINDS = new Set([
  "income",
  "expense",
  "gift",
  "deposit",
  "withdrawal",
  "interest",
  "fee",
  "transfer",
  "adjustment",
]);

function normalizeKind(value: unknown): string | null {
  const kind = String(value || "").trim().toLowerCase();
  return ALLOWED_KINDS.has(kind) ? kind : null;
}

export async function importCashFlow(input: {
  defaultCurrency?: string;
  positiveKind?: string;
  negativeKind?: string;
  rows: CashFlowImportRow[];
}) {
  if (!Array.isArray(input.rows)) {
    throw new Error("Cash-flow rows must be an array.");
  }
  if (input.rows.length === 0) {
    throw new Error("No cash-flow rows were provided.");
  }
  if (input.rows.length > 50_000) {
    throw new Error("A single cash-flow import is limited to 50,000 rows.");
  }

  const accountId = ensureManualAccount();
  const defaultCurrency =
    input.defaultCurrency?.trim().toUpperCase() || "CZK";
  const positiveKind = normalizeKind(input.positiveKind) || "income";
  const negativeKind = normalizeKind(input.negativeKind) || "expense";
  const duplicateOrdinals = new Map<string, number>();
  let imported = 0;
  let skipped = 0;

  for (const row of input.rows) {
    const amount = Number(row.amount);
    const currency = String(row.currency || defaultCurrency)
      .trim()
      .toUpperCase();
    const occurred = new Date(row.occurredAt);

    if (
      !Number.isFinite(amount) ||
      amount === 0 ||
      !currency ||
      Number.isNaN(occurred.getTime())
    ) {
      skipped += 1;
      continue;
    }

    const occurredAt = occurred.toISOString();
    const amountCzk = await maybeToCzk(amount, currency, occurredAt);
    const kind =
      normalizeKind(row.kind) ||
      (amount > 0 ? positiveKind : negativeKind);
    const base = stableBase({
      ...row,
      occurredAt,
      amount,
      currency,
    });
    const ordinal = duplicateOrdinals.get(base) ?? 0;
    duplicateOrdinals.set(base, ordinal + 1);
    const stableId = base.startsWith("external:")
      ? base
      : base + ":" + String(ordinal);

    upsertTransaction({
      provider: "manual",
      accountId,
      externalId: "cashflow-import:" + stableId,
      kind,
      occurredAt,
      currency,
      amount,
      amountCzk,
      note: row.description?.trim() || null,
      category: row.category?.trim() || null,
      sourceLabel: row.sourceLabel?.trim() || "CSV import",
      raw: {
        imported: true,
        importType: "cashflow",
      },
    });

    imported += 1;
  }

  return {
    imported,
    skipped,
    totalRows: input.rows.length,
  };
}
