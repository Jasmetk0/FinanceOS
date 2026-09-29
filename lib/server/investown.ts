import crypto from "node:crypto";
import type { TransactionKind } from "@/lib/domain";
import { getDb } from "@/lib/server/db";
import { maybeToCzk, toCzk } from "@/lib/server/fx";
import {
  recordSnapshot,
  replaceHoldings,
  upsertAccount,
  upsertAsset,
  upsertTransaction,
} from "@/lib/server/repository";

export interface InvestownImportRow {
  externalId?: string;
  occurredAt: string;
  sourceDate?: string;
  timezone?: string;
  amount: number;
  currency?: string;
  type?: string;
  description?: string;
  loanName?: string;
  projectName?: string;
  projectUrl?: string;
  projectType?: string;
}

export interface InvestownImportInput {
  accountCurrency?: string;
  currentValue?: number | null;
  walletCash?: number | null;
  rows: InvestownImportRow[];
  replaceExisting?: boolean;
  sourceFormat?: "investown-native" | "mapped";
}

export interface InvestownImportStatus {
  mode: string;
  updatedAt: string;
  currentValueCzk: number;
  walletCashCzk: number;
  investedValueCzk: number;
  realizedYieldCzk: number;
  transactions: number;
  projects: number;
  activeProjects: number;
  firstAt: string | null;
  lastAt: string | null;
  unknownTypes: number;
  typeCounts: Array<{ type: string; count: number }>;
}

export function getInvestownImportStatus(): InvestownImportStatus | null {
  const db = getDb();
  const account = db
    .prepare(
      "SELECT total_value_czk, cash_value_czk, invested_value_czk, " +
        "realized_pnl_czk, updated_at, raw_json " +
        "FROM accounts WHERE provider = 'investown' LIMIT 1",
    )
    .get();

  if (!account) return null;

  const transactionStats = db
    .prepare(
      "SELECT COUNT(*) AS count, " +
        "SUM(CASE WHEN kind = 'adjustment' THEN 1 ELSE 0 END) AS unknown, " +
        "MIN(occurred_at) AS first_at, MAX(occurred_at) AS last_at " +
        "FROM transactions WHERE provider = 'investown'",
    )
    .get();
  const projectStats = db
    .prepare(
      "SELECT COUNT(*) AS count FROM assets " +
        "WHERE provider = 'investown' AND asset_class = 'p2p'",
    )
    .get();
  const activeStats = db
    .prepare(
      "SELECT COUNT(*) AS count FROM holdings h " +
        "JOIN accounts a ON a.id = h.account_id " +
        "WHERE a.provider = 'investown' AND h.market_value_czk > 0.005",
    )
    .get();

  const typeCounts = db
    .prepare(
      "SELECT COALESCE(NULLIF(category, ''), 'Unknown') AS type, COUNT(*) AS count " +
        "FROM transactions WHERE provider = 'investown' " +
        "GROUP BY type ORDER BY count DESC, type ASC",
    )
    .all()
    .map((row) => ({
      type: String(row.type),
      count: Number(row.count) || 0,
    }));

  let mode = "unknown";
  try {
    const raw = account.raw_json
      ? (JSON.parse(String(account.raw_json)) as Record<string, unknown>)
      : {};
    if (typeof raw.importMode === "string") mode = raw.importMode;
  } catch {
    mode = "invalid metadata";
  }

  return {
    mode,
    updatedAt: String(account.updated_at),
    currentValueCzk: Number(account.total_value_czk) || 0,
    walletCashCzk: Number(account.cash_value_czk) || 0,
    investedValueCzk: Number(account.invested_value_czk) || 0,
    realizedYieldCzk: Number(account.realized_pnl_czk) || 0,
    transactions: Number(transactionStats?.count) || 0,
    projects: Number(projectStats?.count) || 0,
    activeProjects: Number(activeStats?.count) || 0,
    firstAt: transactionStats?.first_at ? String(transactionStats.first_at) : null,
    lastAt: transactionStats?.last_at ? String(transactionStats.last_at) : null,
    unknownTypes: Number(transactionStats?.unknown) || 0,
    typeCounts,
  };
}

const EXACT_TYPE_MAP: Record<string, TransactionKind> = {
  "Vklad peněz": "deposit",
  "Výběr peněz": "withdrawal",
  "Výnos": "interest",
  "Částečný výnos": "interest",
  "Bonusový výnos": "interest",
  "Smluvní pokuta": "interest",
  "Zákonné úroky z prodlení": "interest",
  "Odměna": "income",
  "Investice": "transfer",
  "Autoinvestice": "transfer",
  "Nabídka ke koupi": "transfer",
  "Vrácení nabídky": "transfer",
  "Splacení jistiny": "transfer",
  "Částečné splacení jistiny": "transfer",
  "Odstoupení": "transfer",
};

const PRINCIPAL_IN_TYPES = new Set(["Investice", "Autoinvestice"]);
const PRINCIPAL_OUT_TYPES = new Set([
  "Splacení jistiny",
  "Částečné splacení jistiny",
  "Odstoupení",
]);

const OFFER_LOCK_TYPES = new Set(["Nabídka ke koupi"]);
const OFFER_UNLOCK_TYPES = new Set(["Vrácení nabídky"]);

function normalize(value: string | undefined) {
  return (value || "").trim();
}

function classifyInvestown(row: InvestownImportRow): TransactionKind {
  const exact = EXACT_TYPE_MAP[normalize(row.type)];
  if (exact) return exact;

  const text = [row.type, row.description, row.projectType]
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
  ) return "deposit";

  if (
    text.includes("výběr") ||
    text.includes("vyber") ||
    text.includes("withdraw")
  ) return "withdrawal";

  if (
    text.includes("výnos") ||
    text.includes("vynos") ||
    text.includes("úrok") ||
    text.includes("urok") ||
    text.includes("pokuta") ||
    text.includes("interest")
  ) return "interest";

  if (
    text.includes("poplatek") ||
    text.includes("fee") ||
    text.includes("commission")
  ) return "fee";

  if (
    text.includes("bonus") ||
    text.includes("odměna") ||
    text.includes("odmena") ||
    text.includes("cashback") ||
    text.includes("referral")
  ) return "income";

  if (
    text.includes("investice") ||
    text.includes("investování") ||
    text.includes("investovani") ||
    text.includes("nákup") ||
    text.includes("nakup") ||
    text.includes("nabídka") ||
    text.includes("nabidka") ||
    text.includes("prodej") ||
    text.includes("tržiště") ||
    text.includes("trziste") ||
    text.includes("jistiny") ||
    text.includes("odstoupení") ||
    text.includes("odstoupeni") ||
    text.includes("principal") ||
    text.includes("repayment") ||
    text.includes("investment")
  ) return "transfer";

  return "adjustment";
}

function stableBase(row: InvestownImportRow): string {
  if (row.externalId?.trim()) return "external:" + row.externalId.trim();

  const payload = JSON.stringify({
    occurredAt: row.occurredAt,
    sourceDate: row.sourceDate || "",
    timezone: row.timezone || "",
    amount: row.amount,
    currency: row.currency || "CZK",
    type: row.type || "",
    description: row.description || "",
    loanName: row.loanName || "",
    projectName: row.projectName || "",
    projectUrl: row.projectUrl || "",
    projectType: row.projectType || "",
  });

  return "hash:" + crypto.createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

function projectExternalId(row: InvestownImportRow) {
  const url = normalize(row.projectUrl);
  if (url) return "project-url:" + url;
  return "project:" + [normalize(row.loanName), normalize(row.projectName)]
    .filter(Boolean)
    .join("|");
}

function principalDelta(row: InvestownImportRow) {
  const type = normalize(row.type);
  const amount = Math.abs(Number(row.amount));
  if (PRINCIPAL_IN_TYPES.has(type)) return amount;
  if (PRINCIPAL_OUT_TYPES.has(type)) return -amount;
  return 0;
}

function reservationDelta(row: InvestownImportRow) {
  const type = normalize(row.type);
  const amount = Math.abs(Number(row.amount));
  if (OFFER_LOCK_TYPES.has(type)) return amount;
  if (OFFER_UNLOCK_TYPES.has(type)) return -amount;
  return 0;
}

function transactionQuantity(row: InvestownImportRow) {
  const delta = principalDelta(row);
  return delta === 0 ? null : delta;
}

function finiteOptional(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? Number(value)
    : null;
}

function statementDate(row: InvestownImportRow, occurredIso: string) {
  const original = normalize(row.sourceDate || row.occurredAt);
  const match = original.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || occurredIso.slice(0, 10);
}

export async function importInvestown(input: InvestownImportInput) {
  const accountCurrency = input.accountCurrency?.trim().toUpperCase() || "CZK";

  if (!Array.isArray(input.rows)) throw new Error("Investown rows must be an array.");
  if (!input.rows.length) throw new Error("Investown import does not contain any data rows.");
  if (input.rows.length > 50_000) {
    throw new Error("A single Investown import is limited to 50,000 rows.");
  }

  const prepared: Array<{
    row: InvestownImportRow;
    amount: number;
    currency: string;
    occurredIso: string;
    amountCzk: number | null;
    kind: TransactionKind;
    principalDelta: number;
    reservationDelta: number;
  }> = [];

  const typeCounts = new Map<string, number>();
  const unknownTypes = new Set<string>();

  for (const row of input.rows) {
    const amount = Number(row.amount);
    const currency = String(row.currency || accountCurrency).trim().toUpperCase();
    const occurredAt = new Date(row.occurredAt);

    if (!Number.isFinite(amount) || !currency || Number.isNaN(occurredAt.getTime())) {
      continue;
    }

    const occurredIso = occurredAt.toISOString();
    const amountCzk = await maybeToCzk(amount, currency, occurredIso);
    const kind = classifyInvestown(row);
    const type = normalize(row.type) || "Unknown";

    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    if (
      !EXACT_TYPE_MAP[type] &&
      (input.sourceFormat === "investown-native" || kind === "adjustment")
    ) {
      unknownTypes.add(type);
    }

    prepared.push({
      row,
      amount,
      currency,
      occurredIso,
      amountCzk,
      kind,
      principalDelta: principalDelta(row),
      reservationDelta: reservationDelta(row),
    });
  }

  if (!prepared.length) throw new Error("No valid Investown rows were found.");

  if (
    input.sourceFormat === "investown-native" &&
    prepared.length !== input.rows.length
  ) {
    throw new Error(
      "Native Investown CSV contains " +
        String(input.rows.length - prepared.length) +
        " row(s) that could not be parsed. Nothing was imported.",
    );
  }

  prepared.sort(
    (a, b) =>
      new Date(a.occurredIso).getTime() - new Date(b.occurredIso).getTime(),
  );

  const projects = new Map<string, {
    externalId: string;
    name: string;
    loanName: string;
    url: string;
    projectType: string;
    currency: string;
    principal: number;
    invested: number;
    returned: number;
    interest: number;
    reserved: number;
  }>();

  let derivedWallet = 0;

  for (const item of prepared) {
    if (item.amountCzk !== null) derivedWallet += item.amountCzk;

    const projectName = normalize(item.row.projectName);
    if (!projectName) continue;

    const externalId = projectExternalId(item.row);
    const project = projects.get(externalId) ?? {
      externalId,
      name: projectName,
      loanName: normalize(item.row.loanName),
      url: normalize(item.row.projectUrl),
      projectType: normalize(item.row.projectType),
      currency: item.currency,
      principal: 0,
      invested: 0,
      returned: 0,
      interest: 0,
      reserved: 0,
    };

    if (item.principalDelta > 0) {
      project.principal += item.principalDelta;
      project.invested += item.principalDelta;
    } else if (item.principalDelta < 0) {
      const returned = Math.abs(item.principalDelta);
      project.principal -= returned;
      project.returned += returned;
    }

    if (item.kind === "interest" && item.amountCzk !== null) {
      project.interest += Math.max(0, item.amountCzk);
    }

    if (item.reservationDelta !== 0) {
      project.reserved += item.reservationDelta;
    }

    if (project.principal < 0 && project.principal > -0.02) project.principal = 0;
    if (project.reserved < 0 && project.reserved > -0.02) project.reserved = 0;
    projects.set(externalId, project);
  }

  const negativePrincipalProjects = [...projects.values()]
    .filter((project) => project.principal < -0.02)
    .map((project) => project.name)
    .sort();
  const negativeReservationProjects = [...projects.values()]
    .filter((project) => project.reserved < -0.02)
    .map((project) => project.name)
    .sort();

  const derivedPrincipal = [...projects.values()].reduce(
    (sum, project) => sum + Math.max(0, project.principal),
    0,
  );
  const derivedReserved = [...projects.values()].reduce(
    (sum, project) => sum + Math.max(0, project.reserved),
    0,
  );
  const derivedInvested = derivedPrincipal + derivedReserved;
  const derivedInterest = prepared.reduce(
    (sum, item) =>
      item.kind === "interest" && item.amountCzk !== null
        ? sum + Math.max(0, item.amountCzk)
        : sum,
    0,
  );

  const overrideCash = finiteOptional(input.walletCash);
  const overrideTotal = finiteOptional(input.currentValue);

  if (
    input.sourceFormat === "investown-native" &&
    overrideCash === null &&
    overrideTotal === null &&
    (negativePrincipalProjects.length > 0 ||
      negativeReservationProjects.length > 0)
  ) {
    throw new Error(
      "Investown statement cannot be reconstructed as a complete history. " +
        "Some projects return more principal/reservations than the file contains. " +
        "Export the full account history or use the current-balance override.",
    );
  }

  const walletCash = overrideCash ?? derivedWallet;
  const totalValue = overrideTotal ?? Math.max(0, walletCash + derivedInvested);
  const investedValue = Math.max(0, totalValue - walletCash);

  if (walletCash < -0.02) {
    throw new Error(
      "Derived Investown wallet balance is negative. The statement may be incomplete; set a current wallet override.",
    );
  }
  if (totalValue < -0.02) throw new Error("Investown current value cannot be negative.");
  if (walletCash - totalValue > 0.02) {
    throw new Error("Investown wallet cash cannot exceed total current value.");
  }

  const [cashValueCzk, investedValueCzk, totalValueCzk] = await Promise.all([
    toCzk(Math.max(0, walletCash), accountCurrency),
    toCzk(investedValue, accountCurrency),
    toCzk(totalValue, accountCurrency),
  ]);

  // All asynchronous currency work is complete before opening the SQLite
  // transaction. The import itself is atomic: a failed row cannot leave a
  // half-replaced Investown portfolio behind.
  const db = getDb();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const accountId = upsertAccount({
    provider: "investown",
    externalId: "main",
    name: "Investown",
    type: "p2p",
    currency: accountCurrency,
    cashValue: Math.max(0, walletCash),
    investedValue,
    totalValue,
    realizedPnl: derivedInterest,
    unrealizedPnl: 0,
    cashValueCzk,
    investedValueCzk,
    totalValueCzk,
    realizedPnlCzk: derivedInterest,
    unrealizedPnlCzk: 0,
    raw: {
      imported: true,
      importMode: input.sourceFormat || "mapped",
      balanceMode:
        overrideCash !== null || overrideTotal !== null
          ? "manual-override"
          : "derived-from-full-statement",
      derivedWallet,
      derivedPrincipal,
      derivedReserved,
      derivedInvested,
      derivedInterest,
      statementRows: prepared.length,
      statementFirstAt: prepared[0]?.occurredIso || null,
      statementLastAt: prepared[prepared.length - 1]?.occurredIso || null,
    },
  });

    const replaceExisting = input.replaceExisting !== false;
  if (replaceExisting) {
    db.prepare("DELETE FROM transactions WHERE provider = 'investown'").run();
    db.prepare("DELETE FROM holdings WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM snapshots WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM assets WHERE provider = 'investown'").run();
  }

  const assetIds = new Map<string, string>();
  for (const project of projects.values()) {
    const assetIdValue = upsertAsset({
      provider: "investown",
      externalId: project.externalId,
      symbol: project.name,
      name: project.name,
      assetClass: "p2p",
      currency: project.currency || accountCurrency,
      raw: {
        loanName: project.loanName || null,
        projectUrl: project.url || null,
        projectType: project.projectType || null,
        investedPrincipal: project.invested,
        returnedPrincipal: project.returned,
        receivedInterestCzk: project.interest,
        reservedOfferCzk: Math.max(0, project.reserved),
        imported: true,
      },
    });
    assetIds.set(project.externalId, assetIdValue);
  }

  const duplicateOrdinals = new Map<string, number>();
  let imported = 0;

  for (const item of prepared) {
    const row = item.row;
    const base = stableBase(row);
    const ordinal = duplicateOrdinals.get(base) ?? 0;
    duplicateOrdinals.set(base, ordinal + 1);
    const stableId = base.startsWith("external:") ? base : base + ":" + String(ordinal);

    const projectKey = normalize(row.projectName) ? projectExternalId(row) : "";
    const assetIdValue = projectKey ? assetIds.get(projectKey) ?? null : null;
    const quantity = transactionQuantity(row);

    upsertTransaction({
      provider: "investown",
      accountId,
      externalId: "statement:" + stableId,
      kind: item.kind,
      occurredAt: item.occurredIso,
      currency: item.currency,
      amount: item.amount,
      amountCzk: item.amountCzk,
      assetId: assetIdValue,
      quantity,
      price: quantity === null ? null : 1,
      note: [row.type, row.loanName, row.projectName, row.description]
        .filter(Boolean)
        .join(" · ") || "Investown",
      category: normalize(row.type) || normalize(row.projectType) || null,
      sourceLabel: normalize(row.projectType)
        ? "Investown · " + normalize(row.projectType)
        : "Investown",
      flowScope:
        item.kind === "deposit" || item.kind === "withdrawal"
          ? "external"
          : item.kind === "transfer"
            ? "internal"
            : "not_applicable",
      raw: {
        ...row,
        originalTimezone: row.timezone || null,
        financeOsClassification: item.kind,
        financeOsPrincipalDelta: item.principalDelta,
        financeOsReservationDelta: item.reservationDelta,
      },
    });
    imported += 1;
  }

  const holdings = [...projects.values()]
    .filter(
      (project) =>
        project.principal > 0.005 || project.reserved > 0.005,
    )
    .map((project) => {
      const assetIdValue = assetIds.get(project.externalId);
      if (!assetIdValue) throw new Error("Investown project asset was not created.");

      return {
        accountId,
        assetId: assetIdValue,
        quantity: Math.max(0, project.principal + project.reserved),
        averagePrice: 1,
        currentPrice: 1,
        currency: accountCurrency,
        marketValue: Math.max(0, project.principal + project.reserved),
        marketValueCzk: Math.max(0, project.principal + project.reserved),
        unrealizedPnl: 0,
        unrealizedPnlCzk: 0,
        raw: {
          principal: project.principal,
          reservedOfferCzk: Math.max(0, project.reserved),
          investedPrincipal: project.invested,
          returnedPrincipal: project.returned,
          receivedInterestCzk: project.interest,
          loanName: project.loanName || null,
          projectUrl: project.url || null,
          projectType: project.projectType || null,
        },
      };
    });

  replaceHoldings(accountId, holdings);

  if (replaceExisting && input.sourceFormat === "investown-native") {
    let runningWallet = 0;
    let runningPrincipal = 0;
    let runningReserved = 0;
    const snapshots = new Map<string, { cash: number; invested: number; total: number }>();

    for (const item of prepared) {
      runningWallet += item.amountCzk ?? 0;
      runningPrincipal += item.principalDelta;
      runningReserved += item.reservationDelta;
      if (runningPrincipal < 0 && runningPrincipal > -0.02) runningPrincipal = 0;
      if (runningReserved < 0 && runningReserved > -0.02) runningReserved = 0;

      const date = statementDate(item.row, item.occurredIso);
      snapshots.set(date, {
        cash: Math.max(0, runningWallet),
        invested: Math.max(0, runningPrincipal + runningReserved),
        total: Math.max(
          0,
          runningWallet + runningPrincipal + runningReserved,
        ),
      });
    }

    const insertSnapshot = db.prepare(
      "INSERT INTO snapshots(account_id, recorded_at, total_value_czk, cash_value_czk, invested_value_czk) " +
      "VALUES(?, ?, ?, ?, ?) " +
      "ON CONFLICT(account_id, recorded_at) DO UPDATE SET " +
      "total_value_czk = excluded.total_value_czk, " +
      "cash_value_czk = excluded.cash_value_czk, " +
      "invested_value_czk = excluded.invested_value_czk"
    );

    for (const [date, snapshot] of snapshots) {
      insertSnapshot.run(accountId, date, snapshot.total, snapshot.cash, snapshot.invested);
    }

    const today = new Date().toISOString().slice(0, 10);
    // Always make today's snapshot match the effective current account value.
    // This also lets a manual balance override correct an incomplete statement
    // whose newest row happens to be dated today.
    insertSnapshot.run(
      accountId,
      today,
      totalValueCzk,
      cashValueCzk,
      investedValueCzk,
    );
  } else {
    recordSnapshot(accountId);
  }

    const result = {
      accountId,
      imported,
      skipped: input.rows.length - prepared.length,
      totalRows: input.rows.length,
      sourceFormat: input.sourceFormat || "mapped",
      derived: {
        walletCashCzk: derivedWallet,
        investedPrincipalCzk: derivedPrincipal,
        reservedOffersCzk: derivedReserved,
        receivedInterestCzk: derivedInterest,
        totalValueCzk: derivedWallet + derivedInvested,
        activeProjects: holdings.length,
        allProjects: projects.size,
      },
      effective: {
        walletCashCzk: cashValueCzk,
        investedValueCzk,
        totalValueCzk,
      },
      coverage: {
        firstAt: prepared[0]?.occurredIso || null,
        lastAt: prepared[prepared.length - 1]?.occurredIso || null,
        typeCounts: Object.fromEntries(
          [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
        ),
        unknownTypes: [...unknownTypes].sort(),
        negativePrincipalProjects,
        negativeReservationProjects,
      },
    };

    db.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Preserve the original import error if rollback itself fails.
    }
    throw error;
  }
}
