import crypto from "node:crypto";
import type { TransactionKind } from "@/lib/domain";
import {
  classifyInvestownKind,
  investownIncomeCategory,
  investownInterestBucket,
  investownInvestedPrincipalDelta,
  investownPrincipalDelta,
  investownReservationDelta,
  investownReturnedPrincipalDelta,
  summarizeInvestownPerformance,
} from "@/lib/investown-semantics.mjs";
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
  dryRun?: boolean;
  allowAuthoritativeRemovals?: boolean;
  confirmationToken?: string;
}

export interface InvestownImportStatus {
  mode: string;
  updatedAt: string;
  currentValueCzk: number;
  walletCashCzk: number;
  investedValueCzk: number;
  realizedYieldCzk: number;
  ordinaryYieldCzk: number;
  bonusYieldCzk: number;
  penaltyYieldCzk: number;
  otherYieldCzk: number;
  investmentPnlCzk: number;
  externalRewardsCzk: number;
  totalGainCzk: number;
  realizedProfitCzk: number;
  transactions: number;
  projects: number;
  activeProjects: number;
  firstAt: string | null;
  lastAt: string | null;
  unknownTypes: number;
  accountingComplete: boolean;
  reconciliationStatus: string;
  reconciliationDifferenceCzk: number;
  typeCounts: Array<{ type: string; count: number }>;
}

export function getInvestownImportStatus(): InvestownImportStatus | null {
  const db = getDb();
  const account = db
    .prepare(
      "SELECT total_value_czk, cash_value_czk, invested_value_czk, " +
        "realized_pnl_czk, reconciliation_status, reconciliation_difference, " +
        "updated_at, raw_json " +
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

  let typeCounts = db
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
  let unknownTypeCount = Number(transactionStats?.unknown) || 0;

  let mode = "unknown";
  let realizedYieldCzk = Number(account.realized_pnl_czk) || 0;
  let ordinaryYieldCzk = 0;
  let bonusYieldCzk = 0;
  let penaltyYieldCzk = 0;
  let otherYieldCzk = 0;
  let investmentPnlCzk = Number(account.realized_pnl_czk) || 0;
  let externalRewardsCzk = 0;
  let totalGainCzk = Number(account.realized_pnl_czk) || 0;
  try {
    const raw = account.raw_json
      ? (JSON.parse(String(account.raw_json)) as Record<string, unknown>)
      : {};
    if (typeof raw.importMode === "string") mode = raw.importMode;

    if (
      raw.typeCounts &&
      typeof raw.typeCounts === "object" &&
      !Array.isArray(raw.typeCounts)
    ) {
      typeCounts = Object.entries(raw.typeCounts as Record<string, unknown>)
        .map(([type, count]) => ({
          type,
          count: Number(count) || 0,
        }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    }
    if (Array.isArray(raw.unknownTypes)) {
      unknownTypeCount = raw.unknownTypes.length;
    }

    const storedYield = Number(raw.derivedInterest);
    if (Number.isFinite(storedYield)) realizedYieldCzk = storedYield;
    const storedOrdinaryYield = Number(raw.derivedOrdinaryYield);
    if (Number.isFinite(storedOrdinaryYield)) ordinaryYieldCzk = storedOrdinaryYield;
    const storedBonusYield = Number(raw.derivedBonusYield);
    if (Number.isFinite(storedBonusYield)) bonusYieldCzk = storedBonusYield;
    const storedPenaltyYield = Number(raw.derivedPenaltyYield);
    if (Number.isFinite(storedPenaltyYield)) penaltyYieldCzk = storedPenaltyYield;
    const storedOtherYield = Number(raw.derivedOtherYield);
    if (Number.isFinite(storedOtherYield)) otherYieldCzk = storedOtherYield;

    const storedInvestmentPnl = Number(raw.derivedInvestmentPnl);
    if (Number.isFinite(storedInvestmentPnl)) {
      investmentPnlCzk = storedInvestmentPnl;
    } else {
      // Backward compatibility: older FinanceOS builds stored referral/promo
      // rewards inside derivedRealizedPnl. Their derivedInterest/derivedFees
      // fields still let us recover the true investment-only P/L.
      const storedFees = Number(raw.derivedFees);
      if (Number.isFinite(storedYield)) {
        investmentPnlCzk =
          storedYield - (Number.isFinite(storedFees) ? storedFees : 0);
      }
    }

    const storedRewards = Number(
      raw.derivedExternalRewards ?? raw.derivedOtherIncome,
    );
    if (Number.isFinite(storedRewards)) {
      externalRewardsCzk = storedRewards;
    }

    const storedTotalGain = Number(raw.derivedTotalGain);
    if (Number.isFinite(storedTotalGain)) {
      totalGainCzk = storedTotalGain;
    } else {
      totalGainCzk = investmentPnlCzk + externalRewardsCzk;
    }
  } catch {
    mode = "invalid metadata";
  }

  const realizedProfitCzk = totalGainCzk;

  const reconciliationStatus = String(
    account.reconciliation_status || "unknown",
  );
  const reconciliationDifferenceCzk =
    Number(account.reconciliation_difference) || 0;
  const accountingComplete =
    reconciliationStatus === "reconciled" && unknownTypeCount === 0;

  return {
    mode,
    updatedAt: String(account.updated_at),
    currentValueCzk: Number(account.total_value_czk) || 0,
    walletCashCzk: Number(account.cash_value_czk) || 0,
    investedValueCzk: Number(account.invested_value_czk) || 0,
    realizedYieldCzk,
    ordinaryYieldCzk,
    bonusYieldCzk,
    penaltyYieldCzk,
    otherYieldCzk,
    investmentPnlCzk,
    externalRewardsCzk,
    totalGainCzk,
    realizedProfitCzk,
    transactions: Number(transactionStats?.count) || 0,
    projects: Number(projectStats?.count) || 0,
    activeProjects: Number(activeStats?.count) || 0,
    firstAt: transactionStats?.first_at ? String(transactionStats.first_at) : null,
    lastAt: transactionStats?.last_at ? String(transactionStats.last_at) : null,
    unknownTypes: unknownTypeCount,
    accountingComplete,
    reconciliationStatus,
    reconciliationDifferenceCzk,
    typeCounts,
  };
}

function normalize(value: string | undefined) {
  return (value || "").trim();
}

function classifyInvestown(row: InvestownImportRow): TransactionKind {
  return classifyInvestownKind(row) as TransactionKind;
}

function principalDelta(row: InvestownImportRow) {
  return investownPrincipalDelta(row);
}

function reservationDelta(row: InvestownImportRow) {
  return investownReservationDelta(row);
}

function stableBase(row: InvestownImportRow): string {
  if (row.externalId?.trim()) return "external:" + row.externalId.trim();

  const parsedDate = new Date(row.occurredAt);
  const occurredAt = Number.isNaN(parsedDate.getTime())
    ? normalize(row.occurredAt)
    : parsedDate.toISOString();

  // Identity is based on the economic transaction, not export formatting.
  // sourceDate/timezone are deliberately excluded so an overlapping export
  // with different date formatting still deduplicates correctly.
  const payload = JSON.stringify({
    occurredAt,
    amount: Number(row.amount),
    currency: normalize(row.currency || "CZK").toUpperCase(),
    type: normalize(row.type),
    loanName: normalize(row.loanName),
    projectName: normalize(row.projectName),
    projectType: normalize(row.projectType),
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

type PreparedInvestownRow = {
  row: InvestownImportRow;
  amount: number;
  currency: string;
  occurredIso: string;
  amountCzk: number | null;
  kind: TransactionKind;
  principalDelta: number;
  reservationDelta: number;
};

function readStoredInvestownRow(
  stored: Record<string, unknown>,
): PreparedInvestownRow | null {
  let raw: Record<string, unknown> = {};
  try {
    raw = stored.raw_json
      ? (JSON.parse(String(stored.raw_json)) as Record<string, unknown>)
      : {};
  } catch {
    raw = {};
  }

  const amount = Number(stored.amount);
  const occurredIso = String(stored.occurred_at || "");
  const currency = String(stored.currency || "CZK").toUpperCase();
  if (!Number.isFinite(amount) || !occurredIso || !currency) return null;

  const row: InvestownImportRow = {
    externalId:
      typeof raw.externalId === "string" ? raw.externalId : undefined,
    occurredAt:
      typeof raw.occurredAt === "string" ? raw.occurredAt : occurredIso,
    sourceDate:
      typeof raw.sourceDate === "string" ? raw.sourceDate : occurredIso,
    timezone:
      typeof raw.timezone === "string" ? raw.timezone : undefined,
    amount:
      Number.isFinite(Number(raw.amount)) ? Number(raw.amount) : amount,
    currency:
      typeof raw.currency === "string" ? raw.currency : currency,
    type: typeof raw.type === "string" ? raw.type : String(stored.category || ""),
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    loanName:
      typeof raw.loanName === "string" ? raw.loanName : undefined,
    projectName:
      typeof raw.projectName === "string" ? raw.projectName : undefined,
    projectUrl:
      typeof raw.projectUrl === "string" ? raw.projectUrl : undefined,
    projectType:
      typeof raw.projectType === "string" ? raw.projectType : undefined,
  };

  return {
    row,
    amount,
    currency,
    occurredIso,
    amountCzk:
      stored.amount_czk === null || stored.amount_czk === undefined
        ? null
        : Number(stored.amount_czk),
    kind: classifyInvestown(row),
    principalDelta: principalDelta(row),
    reservationDelta: reservationDelta(row),
  };
}

export async function importInvestown(input: InvestownImportInput) {
  const accountCurrency = input.accountCurrency?.trim().toUpperCase() || "CZK";

  if (!Array.isArray(input.rows)) throw new Error("Investown rows must be an array.");
  if (!input.rows.length) throw new Error("Investown import does not contain any data rows.");
  if (input.rows.length > 50_000) {
    throw new Error("A single Investown import is limited to 50,000 rows.");
  }

  const incomingPrepared: PreparedInvestownRow[] = [];

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
    if (kind === "adjustment") {
      unknownTypes.add(type);
    }

    incomingPrepared.push({
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

  if (!incomingPrepared.length) {
    throw new Error("No valid Investown rows were found.");
  }

  if (
    input.sourceFormat === "investown-native" &&
    incomingPrepared.length !== input.rows.length
  ) {
    throw new Error(
      "Native Investown CSV contains " +
        String(input.rows.length - incomingPrepared.length) +
        " row(s) that could not be parsed. Nothing was imported.",
    );
  }

  incomingPrepared.sort(
    (a, b) =>
      new Date(a.occurredIso).getTime() - new Date(b.occurredIso).getTime(),
  );

  const db = getDb();
  const hardReplace = input.replaceExisting === true;
  const existingPrepared = hardReplace
    ? []
    : db
        .prepare(
          "SELECT occurred_at, currency, amount, amount_czk, category, raw_json " +
            "FROM transactions WHERE provider = 'investown' ORDER BY occurred_at ASC, external_id ASC",
        )
        .all()
        .map((row) => readStoredInvestownRow(row))
        .filter((row): row is PreparedInvestownRow => row !== null);

  const incomingFirstAt = incomingPrepared[0]?.occurredIso ?? null;
  const incomingLastAt = incomingPrepared.at(-1)?.occurredIso ?? null;
  const existingFirstAt = existingPrepared[0]?.occurredIso ?? null;
  const existingLastAt = existingPrepared.at(-1)?.occurredIso ?? null;

  // Investown native CSV exports are provider snapshots of statement history.
  // When a new file covers at least the same time span as the stored history,
  // it is authoritative for that span. Investown may later remove/correct old
  // penalty/late-interest rows; retaining rows absent from the newer full
  // statement creates phantom cash and P/L. A genuinely partial/newer-period
  // import still merges cumulatively and cannot erase older history.
  const authoritativeNativeSnapshot =
    input.sourceFormat === "investown-native" &&
    !hardReplace &&
    existingPrepared.length > 0 &&
    incomingFirstAt !== null &&
    incomingLastAt !== null &&
    existingFirstAt !== null &&
    existingLastAt !== null &&
    incomingFirstAt <= existingFirstAt &&
    incomingLastAt >= existingLastAt;

  const existingByBase = new Map<string, PreparedInvestownRow[]>();
  for (const item of existingPrepared) {
    const base = stableBase(item.row);
    const group = existingByBase.get(base) ?? [];
    group.push(item);
    existingByBase.set(base, group);
  }

  const incomingByBase = new Map<string, PreparedInvestownRow[]>();
  for (const item of incomingPrepared) {
    const base = stableBase(item.row);
    const group = incomingByBase.get(base) ?? [];
    group.push(item);
    incomingByBase.set(base, group);
  }

  const prepared: PreparedInvestownRow[] = [];
  let newTransactions = 0;
  let matchedTransactions = 0;
  let removedTransactions = 0;
  const allBases = new Set([
    ...existingByBase.keys(),
    ...incomingByBase.keys(),
  ]);

  for (const base of allBases) {
    const existing = existingByBase.get(base) ?? [];
    const incoming = incomingByBase.get(base) ?? [];
    const overlap = Math.min(existing.length, incoming.length);
    matchedTransactions += overlap;
    newTransactions += Math.max(0, incoming.length - existing.length);

    // New import data wins for overlapping rows so improved classification or
    // normalization is applied without duplicating the transaction.
    //
    // For a newer full native statement, absence is meaningful: rows that were
    // present in an older provider export but disappeared from the current
    // full-history export must be removed. For partial imports we preserve the
    // stored remainder so incremental uploads stay cumulative.
    prepared.push(...incoming);
    if (existing.length > incoming.length) {
      const remainder = existing.slice(incoming.length);
      if (authoritativeNativeSnapshot) {
        removedTransactions += remainder.length;
      } else {
        prepared.push(...remainder);
      }
    }
  }

  prepared.sort(
    (a, b) =>
      new Date(a.occurredIso).getTime() - new Date(b.occurredIso).getTime() ||
      stableBase(a.row).localeCompare(stableBase(b.row)),
  );

  // Coverage/type diagnostics describe the cumulative Investown history, not
  // just the newest file.
  typeCounts.clear();
  unknownTypes.clear();
  for (const item of prepared) {
    const type = normalize(item.row.type) || "Unknown";
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    if (item.kind === "adjustment") {
      unknownTypes.add(type);
    }
  }

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
    ordinaryYield: number;
    bonusYield: number;
    penaltyYield: number;
    otherYield: number;
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
      ordinaryYield: 0,
      bonusYield: 0,
      penaltyYield: 0,
      otherYield: 0,
      reserved: 0,
    };

    project.principal += item.principalDelta;
    project.invested += investownInvestedPrincipalDelta(item.row);
    project.returned += investownReturnedPrincipalDelta(item.row);

    if (item.kind === "interest" && item.amountCzk !== null) {
      // Preserve the provider sign so a future yield/penalty correction or
      // reversal cannot silently overstate lifetime project income.
      const bucket = investownInterestBucket(item.row.type);
      project.interest += item.amountCzk;
      if (bucket === "ordinary") {
        project.ordinaryYield += item.amountCzk;
      } else if (bucket === "bonus") {
        project.bonusYield += item.amountCzk;
      } else if (bucket === "penalty") {
        project.penaltyYield += item.amountCzk;
      } else {
        project.otherYield += item.amountCzk;
      }
    }

    if (item.reservationDelta !== 0) {
      project.reserved += item.reservationDelta;
    }

    if (project.principal < 0 && project.principal > -0.02) project.principal = 0;
    if (project.invested < 0 && project.invested > -0.02) project.invested = 0;
    if (project.returned < 0 && project.returned > -0.02) project.returned = 0;
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
  const performanceSummary = summarizeInvestownPerformance(
    prepared.map((item) => ({
      kind: item.kind,
      amountCzk: item.amountCzk,
      category:
        item.kind === "income"
          ? investownIncomeCategory(item.row)
          : normalize(item.row.type),
    })),
  );
  const yieldBreakdown = prepared.reduce(
    (acc, item) => {
      if (item.kind !== "interest" || item.amountCzk === null) return acc;
      const bucket = investownInterestBucket(item.row.type);
      acc[bucket] += item.amountCzk;
      return acc;
    },
    { ordinary: 0, bonus: 0, penalty: 0, other: 0 },
  );
  const derivedInterest = performanceSummary.interestCzk;
  const derivedOrdinaryYield = yieldBreakdown.ordinary;
  const derivedBonusYield = yieldBreakdown.bonus;
  const derivedPenaltyYield = yieldBreakdown.penalty;
  const derivedOtherYield = yieldBreakdown.other;
  const derivedExternalRewards = performanceSummary.externalRewardsCzk;
  const derivedOtherInvestmentIncome =
    performanceSummary.otherInvestmentIncomeCzk;
  const derivedOtherIncome =
    derivedExternalRewards + derivedOtherInvestmentIncome;
  const derivedFees = performanceSummary.feesCzk;
  const derivedInvestmentPnl = performanceSummary.investmentPnlCzk;
  const derivedTotalGain = performanceSummary.totalGainCzk;
  // Canonical account realized P/L means investment performance. Referral,
  // campaign and other external rewards are reported separately.
  const derivedRealizedPnl = derivedInvestmentPnl;

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

  const nativeDerivedStatement =
    input.sourceFormat === "investown-native" &&
    overrideCash === null &&
    overrideTotal === null;

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

  const missingCzkRows = prepared.filter(
    (item) => item.amountCzk === null,
  ).length;
  const derivedOwnerCapitalCzk = prepared.reduce((sum, item) => {
    if (item.amountCzk === null) return sum;
    if (item.kind === "deposit" || item.kind === "withdrawal") {
      // Native statement amounts already carry the economic sign. Preserving
      // it makes deposit/withdrawal corrections reconcile automatically.
      return sum + item.amountCzk;
    }
    return sum;
  }, 0);
  const accountingExpectedValueCzk =
    derivedOwnerCapitalCzk + derivedTotalGain;
  const accountingDifferenceCzk =
    nativeDerivedStatement &&
    accountCurrency === "CZK" &&
    missingCzkRows === 0
      ? totalValueCzk - accountingExpectedValueCzk
      : null;
  const accountingIdentityOk =
    accountingDifferenceCzk === null ||
    Math.abs(accountingDifferenceCzk) <= 0.05;
  const nativeAccountingComplete =
    nativeDerivedStatement &&
    unknownTypes.size === 0 &&
    missingCzkRows === 0 &&
    accountingIdentityOk;

  // All asynchronous currency work is complete before opening the SQLite
  // transaction. The import itself is atomic: a failed row cannot leave a
  // half-replaced Investown portfolio behind.
  const statementFirstDate = prepared[0]
    ? statementDate(prepared[0].row, prepared[0].occurredIso)
    : null;
  const statementLastDate = prepared.at(-1)
    ? statementDate(prepared.at(-1)!.row, prepared.at(-1)!.occurredIso)
    : null;
  const statementLastAt = prepared[prepared.length - 1]?.occurredIso || null;
  const previousAccount = db
    .prepare(
      "SELECT total_value_czk, cash_value_czk, realized_pnl_czk, raw_json " +
        "FROM accounts WHERE provider = 'investown' AND external_id = 'main' LIMIT 1",
    )
    .get();

  let previousStatementLastAt: string | null = null;
  let previousInvestmentPnlCzk = previousAccount
    ? Number(previousAccount.realized_pnl_czk) || 0
    : 0;
  let previousExternalRewardsCzk = 0;
  if (input.sourceFormat === "investown-native" && previousAccount?.raw_json) {
    try {
      const raw = JSON.parse(
        String(previousAccount.raw_json),
      ) as Record<string, unknown>;
      if (typeof raw.statementLastAt === "string") {
        previousStatementLastAt = raw.statementLastAt;
      }
      const storedInvestmentPnl = Number(raw.derivedInvestmentPnl);
      if (Number.isFinite(storedInvestmentPnl)) {
        previousInvestmentPnlCzk = storedInvestmentPnl;
      } else {
        const storedInterest = Number(raw.derivedInterest);
        const storedFees = Number(raw.derivedFees);
        if (Number.isFinite(storedInterest)) {
          previousInvestmentPnlCzk =
            storedInterest - (Number.isFinite(storedFees) ? storedFees : 0);
        }
      }
      const storedRewards = Number(
        raw.derivedExternalRewards ?? raw.derivedOtherIncome,
      );
      if (Number.isFinite(storedRewards)) {
        previousExternalRewardsCzk = storedRewards;
      }
    } catch {
      // Invalid legacy metadata must never block a fresh import.
    }
  }

  const projectedActiveProjects = [...projects.values()].filter(
    (project) => project.principal > 0.005 || project.reserved > 0.005,
  ).length;
  const previewToken = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        prepared: prepared.map((item) => ({
          identity: stableBase(item.row),
          occurredIso: item.occurredIso,
          amount: item.amount,
          amountCzk: item.amountCzk,
          kind: item.kind,
          principalDelta: item.principalDelta,
          reservationDelta: item.reservationDelta,
        })),
        removedTransactions,
        authoritativeNativeSnapshot,
        previousStatementLastAt,
        effective: {
          cashValueCzk,
          investedValueCzk,
          totalValueCzk,
        },
        accounting: {
          derivedOwnerCapitalCzk,
          derivedInvestmentPnl,
          derivedExternalRewards,
          derivedTotalGain,
          derivedOrdinaryYield,
          derivedBonusYield,
          derivedPenaltyYield,
          derivedOtherYield,
          accountingExpectedValueCzk,
          accountingDifferenceCzk,
          missingCzkRows,
        },
      }),
    )
    .digest("hex");

  const projectedResult = {
    previewToken,
    imported: incomingPrepared.length,
    newTransactions,
    matchedTransactions,
    removedTransactions,
    authoritativeNativeSnapshot,
    storedTransactions: prepared.length,
    skipped: input.rows.length - incomingPrepared.length,
    totalRows: input.rows.length,
    sourceFormat: input.sourceFormat || "mapped",
    derived: {
      walletCashCzk: derivedWallet,
      investedPrincipalCzk: derivedPrincipal,
      reservedOffersCzk: derivedReserved,
      receivedInterestCzk: derivedInterest,
      ordinaryYieldCzk: derivedOrdinaryYield,
      bonusYieldCzk: derivedBonusYield,
      penaltyYieldCzk: derivedPenaltyYield,
      otherYieldCzk: derivedOtherYield,
      otherInvestmentIncomeCzk: derivedOtherInvestmentIncome,
      externalRewardsCzk: derivedExternalRewards,
      otherIncomeCzk: derivedOtherIncome,
      feesCzk: derivedFees,
      investmentPnlCzk: derivedInvestmentPnl,
      totalGainCzk: derivedTotalGain,
      realizedPnlCzk: derivedInvestmentPnl,
      totalValueCzk: derivedWallet + derivedInvested,
      activeProjects: projectedActiveProjects,
      allProjects: projects.size,
    },
    reconciliation: {
      checked:
        nativeDerivedStatement &&
        accountCurrency === "CZK" &&
        missingCzkRows === 0,
      ownerCapitalCzk: derivedOwnerCapitalCzk,
      expectedValueCzk: accountingExpectedValueCzk,
      differenceCzk: accountingDifferenceCzk,
      ok: nativeAccountingComplete,
      missingCzkRows,
    },
    effective: {
      walletCashCzk: cashValueCzk,
      investedValueCzk,
      totalValueCzk,
    },
    diff: {
      transactions:
        prepared.length - existingPrepared.length,
      totalValueCzk:
        totalValueCzk -
        (previousAccount ? Number(previousAccount.total_value_czk) || 0 : 0),
      walletCashCzk:
        cashValueCzk -
        (previousAccount ? Number(previousAccount.cash_value_czk) || 0 : 0),
      investmentPnlCzk:
        derivedInvestmentPnl - previousInvestmentPnlCzk,
      externalRewardsCzk:
        derivedExternalRewards - previousExternalRewardsCzk,
    },
    coverage: {
      firstAt: prepared[0]?.occurredIso || null,
      firstDate: statementFirstDate,
      lastAt: statementLastAt,
      lastDate: statementLastDate,
      previousLastAt: previousStatementLastAt,
      advanced:
        previousStatementLastAt === null ||
        (statementLastAt !== null &&
          statementLastAt > previousStatementLastAt),
      typeCounts: Object.fromEntries(
        [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
      ),
      unknownTypes: [...unknownTypes].sort(),
      negativePrincipalProjects,
      negativeReservationProjects,
    },
  };

  if (input.dryRun) {
    return {
      accountId: null,
      dryRun: true,
      ...projectedResult,
    };
  }

  if (!input.confirmationToken || input.confirmationToken !== previewToken) {
    throw new Error(
      "Investown import vyžaduje potvrzení přesného aktuálního preview. Proveď nejdřív kontrolu a potom potvrď stejný náhled.",
    );
  }

  if (
    nativeDerivedStatement &&
    accountCurrency === "CZK" &&
    missingCzkRows === 0 &&
    unknownTypes.size === 0 &&
    accountingDifferenceCzk !== null &&
    Math.abs(accountingDifferenceCzk) > 0.05
  ) {
    throw new Error(
      "Investown účetní kontrola nesedí o " +
        accountingDifferenceCzk.toLocaleString("cs-CZ", {
          maximumFractionDigits: 2,
        }) +
        " Kč. Import nebyl proveden, protože hodnota účtu neodpovídá " +
        "vlastním vkladům/výběrům + investičnímu P/L + externím odměnám.",
    );
  }

  if (removedTransactions > 0) {
    if (input.allowAuthoritativeRemovals !== true) {
      throw new Error(
        "Novější plný Investown výpis by odstranil " +
          removedTransactions.toLocaleString("cs-CZ") +
          " dříve uložených řádků. Nejprve proveď preview a změnu výslovně potvrď.",
      );
    }
    if (!input.confirmationToken || input.confirmationToken !== previewToken) {
      throw new Error(
        "Odstranění historických Investown řádků vyžaduje potvrzení přesného aktuálního preview.",
      );
    }
  }

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
    realizedPnl: derivedRealizedPnl,
    unrealizedPnl: 0,
    realizedPnlStatus: nativeAccountingComplete ? "available" : "partial",
    unrealizedPnlStatus: "not_applicable",
    reconciliationDifference: accountingDifferenceCzk ?? 0,
    reconciliationStatus: nativeAccountingComplete
      ? "reconciled"
      : nativeDerivedStatement
        ? "warning"
        : "unknown",
    cashValueCzk,
    investedValueCzk,
    totalValueCzk,
    realizedPnlCzk: derivedRealizedPnl,
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
      derivedOrdinaryYield,
      derivedBonusYield,
      derivedPenaltyYield,
      derivedOtherYield,
      derivedOtherInvestmentIncome,
      derivedExternalRewards,
      derivedOtherIncome,
      derivedFees,
      derivedInvestmentPnl,
      derivedTotalGain,
      derivedRealizedPnl,
      statementRows: prepared.length,
      typeCounts: Object.fromEntries(
        [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
      ),
      unknownTypes: [...unknownTypes].sort(),
      negativePrincipalProjects,
      negativeReservationProjects,
      accountingComplete: nativeAccountingComplete,
      accountingReconciliation: {
        checked:
          nativeDerivedStatement &&
          accountCurrency === "CZK" &&
          missingCzkRows === 0,
        ownerCapitalCzk: derivedOwnerCapitalCzk,
        expectedValueCzk: accountingExpectedValueCzk,
        differenceCzk: accountingDifferenceCzk,
        missingCzkRows,
      },
      lastImportRows: incomingPrepared.length,
      lastImportNewTransactions: newTransactions,
      lastImportMatchedTransactions: matchedTransactions,
      lastImportRemovedTransactions: removedTransactions,
      lastImportAuthoritativeSnapshot: authoritativeNativeSnapshot,
      statementFirstAt: prepared[0]?.occurredIso || null,
      statementFirstDate,
      statementLastAt,
      statementLastDate,
    },
  });

  // We loaded the cumulative history before opening the write transaction.
  // Rebuild Investown's derived storage atomically from that canonical set.
  // This keeps old history, removes duplicates/legacy IDs and lets improved
  // classification be applied to already-known rows.
  db.prepare("DELETE FROM transactions WHERE provider = 'investown'").run();
  db.prepare("DELETE FROM holdings WHERE account_id = ?").run(accountId);
  db.prepare("DELETE FROM snapshots WHERE account_id = ?").run(accountId);
  db.prepare("DELETE FROM assets WHERE provider = 'investown'").run();

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
        ordinaryYieldCzk: project.ordinaryYield,
        bonusYieldCzk: project.bonusYield,
        penaltyYieldCzk: project.penaltyYield,
        otherYieldCzk: project.otherYield,
        reservedOfferCzk: Math.max(0, project.reserved),
        imported: true,
      },
    });
    assetIds.set(project.externalId, assetIdValue);
  }

  const duplicateOrdinals = new Map<string, number>();
  let storedTransactions = 0;

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
      category:
        item.kind === "income"
          ? investownIncomeCategory(row)
          : normalize(row.type) || normalize(row.projectType) || null,
      sourceLabel: normalize(row.projectType)
        ? "Investown · " + normalize(row.projectType)
        : "Investown",
      flowScope:
        item.kind === "deposit" || item.kind === "withdrawal"
          ? "external"
          : item.kind === "transfer"
            ? "internal"
            : item.kind === "adjustment"
              ? "unclassified"
              : "not_applicable",
      raw: {
        ...row,
        originalTimezone: row.timezone || null,
        financeOsClassification: item.kind,
        financeOsPrincipalDelta: item.principalDelta,
        financeOsReservationDelta: item.reservationDelta,
      },
    });
    storedTransactions += 1;
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
          ordinaryYieldCzk: project.ordinaryYield,
          bonusYieldCzk: project.bonusYield,
          penaltyYieldCzk: project.penaltyYield,
          otherYieldCzk: project.otherYield,
          loanName: project.loanName || null,
          projectUrl: project.url || null,
          projectType: project.projectType || null,
        },
      };
    });

  replaceHoldings(accountId, holdings);

  if (input.sourceFormat === "investown-native") {
    let runningWallet = 0;
    let runningPrincipal = 0;
    let runningReserved = 0;
    let runningTotalGain = 0;
    let runningInvestmentPnl = 0;
    let runningInterest = 0;
    let runningExternalRewards = 0;
    let runningOtherIncome = 0;
    let runningFees = 0;
    const snapshots = new Map<
      string,
      {
        cash: number;
        invested: number;
        total: number;
        investmentPnl: number;
        externalRewards: number;
        totalGain: number;
        interest: number;
        otherIncome: number;
        fees: number;
      }
    >();

    for (const item of prepared) {
      const amountCzk = item.amountCzk ?? 0;
      runningWallet += amountCzk;
      runningPrincipal += item.principalDelta;
      runningReserved += item.reservationDelta;

      if (item.kind === "interest") {
        runningInterest += amountCzk;
        runningInvestmentPnl += amountCzk;
        runningTotalGain += amountCzk;
      } else if (item.kind === "income") {
        const category = investownIncomeCategory(item.row);
        runningOtherIncome += amountCzk;
        if (
          category === "external_reward" ||
          category === "referral_reward" ||
          category === "campaign_reward"
        ) {
          runningExternalRewards += amountCzk;
        } else {
          runningInvestmentPnl += amountCzk;
        }
        runningTotalGain += amountCzk;
      } else if (item.kind === "fee") {
        const feeCost = -amountCzk;
        runningFees += feeCost;
        runningInvestmentPnl += amountCzk;
        runningTotalGain += amountCzk;
      }

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
        investmentPnl: runningInvestmentPnl,
        externalRewards: runningExternalRewards,
        totalGain: runningTotalGain,
        interest: runningInterest,
        otherIncome: runningOtherIncome,
        fees: runningFees,
      });
    }

    const insertSnapshot = db.prepare(
      "INSERT INTO snapshots(account_id, recorded_at, total_value_czk, cash_value_czk, invested_value_czk, raw_json) " +
      "VALUES(?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(account_id, recorded_at) DO UPDATE SET " +
      "total_value_czk = excluded.total_value_czk, " +
      "cash_value_czk = excluded.cash_value_czk, " +
      "invested_value_czk = excluded.invested_value_czk, " +
      "raw_json = excluded.raw_json"
    );

    for (const [date, snapshot] of snapshots) {
      insertSnapshot.run(
        accountId,
        date,
        snapshot.total,
        snapshot.cash,
        snapshot.invested,
        JSON.stringify({
          financeOsInvestownHistory: {
            realizedPnlCzk: snapshot.investmentPnl,
            investmentPnlCzk: snapshot.investmentPnl,
            externalRewardsCzk: snapshot.externalRewards,
            totalGainCzk: snapshot.totalGain,
            interestCzk: snapshot.interest,
            otherIncomeCzk: snapshot.otherIncome,
            feesCzk: snapshot.fees,
          },
        }),
      );
    }

    // A native statement only proves values through its own newest row.
    // Do not manufacture a "today" snapshot from older statement data: that
    // would make stale Investown history look current. A manual current-balance
    // override is explicitly point-in-time, so only that case may add today.
    if (overrideCash !== null || overrideTotal !== null) {
      const today = new Date().toISOString().slice(0, 10);
      insertSnapshot.run(
        accountId,
        today,
        totalValueCzk,
        cashValueCzk,
        investedValueCzk,
        JSON.stringify({
          financeOsInvestownHistory: {
            realizedPnlCzk: derivedInvestmentPnl,
            investmentPnlCzk: derivedInvestmentPnl,
            externalRewardsCzk: derivedExternalRewards,
            totalGainCzk: derivedTotalGain,
            interestCzk: derivedInterest,
            otherIncomeCzk: derivedOtherIncome,
            feesCzk: derivedFees,
          },
        }),
      );
    }
  } else {
    recordSnapshot(accountId);
  }

    const result = {
      accountId,
      dryRun: false,
      ...projectedResult,
      // The write path should agree with the preview exactly.
      storedTransactions,
      derived: {
        ...projectedResult.derived,
        activeProjects: holdings.length,
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
