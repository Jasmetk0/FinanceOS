import crypto from "node:crypto";
import type { TransactionKind } from "@/lib/domain";
import { maybeToCzk, toCzk } from "@/lib/server/fx";
import {
  recordSnapshot,
  upsertAccount,
  upsertAsset,
  upsertTransaction,
} from "@/lib/server/repository";

export interface InvestownImportRow {
  externalId?: string;
  occurredAt: string;
  amount: number;
  currency?: string;
  type?: string;
  description?: string;
  projectName?: string;
  projectType?: string;
}

function classifyInvestown(row: InvestownImportRow): TransactionKind {
  const text = [
    row.type,
    row.description,
    row.projectType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    text.includes("vklad") ||
    text.includes("dobití") ||
    text.includes("dobiti") ||
    text.includes("příchozí platba") ||
    text.includes("prichozi platba") ||
    text.includes("deposit")
  ) {
    return "deposit";
  }

  if (
    text.includes("výběr") ||
    text.includes("vyber") ||
    text.includes("withdraw")
  ) {
    return "withdrawal";
  }

  if (
    text.includes("výnos") ||
    text.includes("vynos") ||
    text.includes("úrok") ||
    text.includes("urok") ||
    text.includes("interest")
  ) {
    return "interest";
  }

  if (
    text.includes("poplatek") ||
    text.includes("fee") ||
    text.includes("commission")
  ) {
    return "fee";
  }

  if (
    text.includes("bonus") ||
    text.includes("odměna") ||
    text.includes("odmena") ||
    text.includes("cashback") ||
    text.includes("referral")
  ) {
    return "income";
  }

  if (
    text.includes("investice") ||
    text.includes("investování") ||
    text.includes("investovani") ||
    text.includes("nákup") ||
    text.includes("nakup") ||
    text.includes("prodej") ||
    text.includes("tržiště") ||
    text.includes("trziste") ||
    text.includes("vrácení jistiny") ||
    text.includes("vraceni jistiny") ||
    text.includes("splacení jistiny") ||
    text.includes("splaceni jistiny") ||
    text.includes("principal") ||
    text.includes("repayment") ||
    text.includes("investment")
  ) {
    return "transfer";
  }

  return "adjustment";
}

function stableBase(row: InvestownImportRow): string {
  if (row.externalId?.trim()) {
    return "external:" + row.externalId.trim();
  }

  const payload = JSON.stringify({
    occurredAt: row.occurredAt,
    amount: row.amount,
    currency: row.currency || "CZK",
    type: row.type || "",
    description: row.description || "",
    projectName: row.projectName || "",
    projectType: row.projectType || "",
  });

  return (
    "hash:" +
    crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32)
  );
}

export async function importInvestown(input: {
  accountCurrency?: string;
  currentValue: number;
  walletCash?: number;
  rows: InvestownImportRow[];
}) {
  const accountCurrency =
    input.accountCurrency?.trim().toUpperCase() || "CZK";
  const currentValue = Number(input.currentValue);
  const walletCash = Number(input.walletCash || 0);

  if (!Number.isFinite(currentValue) || currentValue < 0) {
    throw new Error("Investown current value must be zero or positive.");
  }

  if (!Number.isFinite(walletCash) || walletCash < 0) {
    throw new Error("Investown wallet cash must be zero or positive.");
  }

  if (walletCash > currentValue) {
    throw new Error("Investown wallet cash cannot exceed total current value.");
  }

  if (!Array.isArray(input.rows)) {
    throw new Error("Investown rows must be an array.");
  }

  if (input.rows.length > 50_000) {
    throw new Error("A single Investown import is limited to 50,000 rows.");
  }

  const investedValue = currentValue - walletCash;
  const [cashValueCzk, investedValueCzk, totalValueCzk] = await Promise.all([
    toCzk(walletCash, accountCurrency),
    toCzk(investedValue, accountCurrency),
    toCzk(currentValue, accountCurrency),
  ]);

  const accountId = upsertAccount({
    provider: "investown",
    externalId: "main",
    name: "Investown",
    type: "p2p",
    currency: accountCurrency,
    cashValue: walletCash,
    investedValue,
    totalValue: currentValue,
    realizedPnl: 0,
    unrealizedPnl: 0,
    cashValueCzk,
    investedValueCzk,
    totalValueCzk,
    realizedPnlCzk: 0,
    unrealizedPnlCzk: 0,
    raw: {
      imported: true,
      importMode: "statement-and-balance",
    },
  });

  let imported = 0;
  let skipped = 0;
  const duplicateOrdinals = new Map<string, number>();

  for (const row of input.rows) {
    const amount = Number(row.amount);
    const currency = String(row.currency || accountCurrency)
      .trim()
      .toUpperCase();
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
    const kind = classifyInvestown(row);
    const base = stableBase(row);
    const ordinal = duplicateOrdinals.get(base) ?? 0;
    duplicateOrdinals.set(base, ordinal + 1);
    const stableId = base.startsWith("external:")
      ? base
      : base + ":" + String(ordinal);

    let assetIdValue: string | null = null;
    const projectName = row.projectName?.trim();

    if (projectName) {
      assetIdValue = upsertAsset({
        provider: "investown",
        externalId: "project:" + projectName,
        symbol: projectName,
        name: projectName,
        assetClass: "p2p",
        currency,
        raw: {
          projectType: row.projectType || null,
          imported: true,
        },
      });
    }

    upsertTransaction({
      provider: "investown",
      accountId,
      externalId: "statement:" + stableId,
      kind,
      occurredAt: occurredIso,
      currency,
      amount,
      amountCzk,
      assetId: assetIdValue,
      note:
        [row.type, row.projectName, row.description]
          .filter(Boolean)
          .join(" · ") || "Investown",
      category: row.projectType?.trim() || null,
      sourceLabel: "Investown",
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
