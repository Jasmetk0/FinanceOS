import crypto from "node:crypto";
import type { TransactionKind } from "@/lib/domain";
import { getDb } from "@/lib/server/db";
import { maybeToCzk, toCzk } from "@/lib/server/fx";
import {
  replaceHoldings,
  upsertAccount,
  upsertAsset,
  upsertTransaction,
} from "@/lib/server/repository";

export interface MintosImportRow {
  externalId?: string;
  occurredAt: string;
  amount: number;
  balance?: number | null;
  currency: string;
  description?: string;
  type?: string;
  sourceFile?: string;
  sourceIndex?: number;
}

export interface MintosImportInput {
  accountCurrency?: string;
  currentValue?: number | null;
  cashValue?: number | null;
  rows: MintosImportRow[];
  replaceExisting?: boolean;
  sourceFormat?: "mintos-native-cs" | "mapped";
}

export interface MintosImportStatus {
  mode: string;
  updatedAt: string;
  currentValueCzk: number;
  cashValueCzk: number;
  investedValueCzk: number;
  realizedPnlCzk: number;
  transactions: number;
  assets: number;
  activeAssets: number;
  firstAt: string | null;
  lastAt: string | null;
  lifetimeComplete: boolean;
  continuityOk: boolean;
  openingCash: number | null;
  closingCash: number | null;
  grossInterestCzk: number;
  withholdingTaxCzk: number;
  feesCzk: number;
  cashbackCzk: number;
  typeCounts: Array<{ type: string; count: number }>;
  unknownTypes: string[];
}

const NATIVE_HEADERS = [
  "Date",
  "ID transakce:",
  "Detaily",
  "Obrat",
  "Balance",
  "Měna",
  "Typ platby",
] as const;

const EXACT_KIND: Record<string, TransactionKind> = {
  "Vklady": "deposit",
  "Výběry": "withdrawal",
  "Výběr": "withdrawal",
  "Obdržený úrok": "interest",
  "Úrok obdržený při odkupu úvěru": "interest",
  "Zpožděné výnos z úroku při odkoupení zpět": "interest",
  "Obdržené poplatky z prodlení": "interest",
  "Úrok obdržený z plateb ve zpracování": "interest",
  "Cashback bonus": "income",
  "Srážková daň": "fee",
  "Mintos Core fee": "fee",
  "Poplatek za neaktivitu": "fee",
  "Investice": "transfer",
  "Transakce na Sekundárním trhu": "transfer",
  "Obdržená jistina": "transfer",
  "Jistina obdržená při odkupu úvěru": "transfer",
  "Převod do investic do dluhopisů": "transfer",
  "Převod z investic do dluhopisů": "transfer",
};

const PRINCIPAL_MOVEMENT_TYPES = new Set([
  "Investice",
  "Transakce na Sekundárním trhu",
  "Obdržená jistina",
  "Jistina obdržená při odkupu úvěru",
  "Převod do investic do dluhopisů",
  "Převod z investic do dluhopisů",
]);

function normalized(value: string | undefined) {
  return (value || "").trim();
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function finiteOptional(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? Number(value)
    : null;
}

function classifyMintos(row: MintosImportRow): TransactionKind {
  const exact = EXACT_KIND[normalized(row.type)];
  if (exact) return exact;

  const text = [row.type, row.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    text.includes("vklad") ||
    text.includes("deposit") ||
    text.includes("incoming payment")
  ) {
    return "deposit";
  }
  if (text.includes("výběr") || text.includes("vyber") || text.includes("withdraw")) {
    return "withdrawal";
  }
  if (
    text.includes("úrok") ||
    text.includes("urok") ||
    text.includes("interest") ||
    text.includes("coupon") ||
    text.includes("yield") ||
    text.includes("poplatky z prodlení")
  ) {
    return "interest";
  }
  if (
    text.includes("srážková daň") ||
    text.includes("srazkova dan") ||
    text.includes("fee") ||
    text.includes("commission") ||
    text.includes("poplatek")
  ) {
    return "fee";
  }
  if (
    text.includes("cashback") ||
    text.includes("bonus") ||
    text.includes("campaign")
  ) {
    return "income";
  }
  if (
    text.includes("investice") ||
    text.includes("sekundár") ||
    text.includes("sekundar") ||
    text.includes("jistina") ||
    text.includes("odkup") ||
    text.includes("dluhopis") ||
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

function flowScope(kind: TransactionKind) {
  if (kind === "deposit" || kind === "withdrawal") return "external" as const;
  if (kind === "transfer") return "internal" as const;
  return "not_applicable" as const;
}

function categoryFor(row: MintosImportRow) {
  const type = normalized(row.type);
  if (type === "Srážková daň") return "withholding_tax";
  if (type === "Mintos Core fee") return "mintos_core_fee";
  if (type === "Poplatek za neaktivitu") return "inactivity_fee";
  if (type === "Cashback bonus") return "cashback_bonus";
  return type || null;
}

function stableRowBase(row: MintosImportRow): string {
  if (row.externalId?.trim()) return "external:" + row.externalId.trim();

  const payload = JSON.stringify({
    occurredAt: row.occurredAt,
    amount: row.amount,
    balance: row.balance ?? null,
    currency: row.currency,
    description: row.description || "",
    type: row.type || "",
  });
  return (
    "hash:" +
    crypto.createHash("sha256").update(payload).digest("hex").slice(0, 40)
  );
}

function extractIsin(description: string | undefined) {
  return normalized(description).match(/ISIN:\s*([A-Z0-9]+)/i)?.[1]?.toUpperCase() || "";
}

function extractLoan(description: string | undefined) {
  return normalized(description).match(/Půjčka\s+([^)]+)/i)?.[1]?.trim() || "";
}

function isBond(description: string | undefined) {
  return /\(Dluhopis\)/i.test(normalized(description));
}

function principalDelta(row: MintosImportRow) {
  if (!PRINCIPAL_MOVEMENT_TYPES.has(normalized(row.type))) return 0;
  // Mintos statement turnover is wallet cash movement. Principal exposure
  // moves in the exact opposite direction: cash out -> principal in,
  // cash back -> principal out. This also handles future positive secondary
  // market sales without special-casing the sign.
  return -Number(row.amount);
}

function dateOnly(row: MintosImportRow) {
  const source = normalized(row.occurredAt);
  const match = source.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  return new Date(row.occurredAt).toISOString().slice(0, 10);
}

function statementContinuity(rows: MintosImportRow[]) {
  if (!rows.length) {
    return {
      checked: false,
      ok: true,
      openingCash: null as number | null,
      closingCash: null as number | null,
      firstBreakIndex: null as number | null,
      maxDifference: 0,
    };
  }

  let previous: number | null = null;
  let openingCash: number | null = null;
  let closingCash: number | null = null;
  let firstBreakIndex: number | null = null;
  let maxDifference = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const amount = Number(row.amount);
    const balance = finiteOptional(row.balance);

    if (balance === null || !Number.isFinite(amount)) {
      return {
        checked: false,
        ok: false,
        openingCash: null,
        closingCash: null,
        firstBreakIndex: index,
        maxDifference: Number.POSITIVE_INFINITY,
      };
    }

    if (previous === null) {
      openingCash = balance - amount;
    } else {
      const difference = balance - (previous + amount);
      maxDifference = Math.max(maxDifference, Math.abs(difference));
      if (Math.abs(difference) > 1e-8 && firstBreakIndex === null) {
        firstBreakIndex = index;
      }
    }

    previous = balance;
    closingCash = balance;
  }

  return {
    checked: true,
    ok: firstBreakIndex === null,
    openingCash,
    closingCash,
    firstBreakIndex,
    maxDifference,
  };
}

async function fxFactors(rows: MintosImportRow[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    const currency = normalized(row.currency).toUpperCase();
    const date = dateOnly(row);
    if (currency && date) keys.add(currency + "|" + date);
  }

  const map = new Map<string, number | null>();
  for (const key of keys) {
    const [currency, date] = key.split("|");
    map.set(key, await maybeToCzk(1, currency, date));
  }
  return map;
}

function amountToCzk(
  amount: number,
  currency: string,
  date: string,
  factors: Map<string, number | null>,
) {
  const factor = factors.get(currency.toUpperCase() + "|" + date);
  return factor === null || factor === undefined ? null : amount * factor;
}

export function getMintosImportStatus(): MintosImportStatus | null {
  const db = getDb();
  const account = db
    .prepare(
      "SELECT total_value_czk, cash_value_czk, invested_value_czk, " +
        "realized_pnl_czk, updated_at, raw_json " +
        "FROM accounts WHERE provider = 'mintos' LIMIT 1",
    )
    .get();

  if (!account) return null;

  const stats = db
    .prepare(
      "SELECT COUNT(*) AS count, MIN(occurred_at) AS first_at, " +
        "MAX(occurred_at) AS last_at " +
        "FROM transactions WHERE provider = 'mintos'",
    )
    .get();
  const assets = db
    .prepare(
      "SELECT COUNT(*) AS count FROM assets WHERE provider = 'mintos'",
    )
    .get();
  const active = db
    .prepare(
      "SELECT COUNT(*) AS count FROM holdings h " +
        "JOIN accounts a ON a.id = h.account_id " +
        "WHERE a.provider = 'mintos' AND h.market_value_czk > 0.005",
    )
    .get();
  const typeCounts = db
    .prepare(
      "SELECT COALESCE(NULLIF(json_extract(raw_json, '$.type'), ''), category, 'Unknown') AS type, " +
        "COUNT(*) AS count FROM transactions WHERE provider = 'mintos' " +
        "GROUP BY type ORDER BY count DESC, type ASC",
    )
    .all()
    .map((row) => ({
      type: String(row.type),
      count: num(row.count),
    }));

  let raw: Record<string, unknown> = {};
  try {
    raw = account.raw_json
      ? (JSON.parse(String(account.raw_json)) as Record<string, unknown>)
      : {};
  } catch {
    raw = {};
  }

  return {
    mode: typeof raw.importMode === "string" ? raw.importMode : "unknown",
    updatedAt: String(account.updated_at),
    currentValueCzk: num(account.total_value_czk),
    cashValueCzk: num(account.cash_value_czk),
    investedValueCzk: num(account.invested_value_czk),
    realizedPnlCzk: num(account.realized_pnl_czk),
    transactions: num(stats?.count),
    assets: num(assets?.count),
    activeAssets: num(active?.count),
    firstAt: stats?.first_at ? String(stats.first_at) : null,
    lastAt: stats?.last_at ? String(stats.last_at) : null,
    lifetimeComplete: raw.lifetimeComplete === true,
    continuityOk: raw.continuityOk !== false,
    openingCash:
      typeof raw.openingCash === "number" ? raw.openingCash : null,
    closingCash:
      typeof raw.closingCash === "number" ? raw.closingCash : null,
    grossInterestCzk: num(raw.grossInterestCzk),
    withholdingTaxCzk: num(raw.withholdingTaxCzk),
    feesCzk: num(raw.feesCzk),
    cashbackCzk: num(raw.cashbackCzk),
    typeCounts,
    unknownTypes: Array.isArray(raw.unknownTypes)
      ? raw.unknownTypes.map(String)
      : [],
  };
}

export async function importMintos(input: MintosImportInput) {
  const accountCurrency =
    input.accountCurrency?.trim().toUpperCase() || "EUR";
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const native = input.sourceFormat === "mintos-native-cs";
  const replaceExisting = input.replaceExisting !== false;

  if (rows.length > 100_000) {
    throw new Error("A single Mintos import is limited to 100,000 rows.");
  }

  const prepared: Array<{
    row: MintosImportRow;
    amount: number;
    balance: number | null;
    currency: string;
    occurredIso: string;
    kind: TransactionKind;
    principalDelta: number;
    isin: string;
    loan: string;
    bond: boolean;
  }> = [];
  const unknownTypes = new Set<string>();
  const typeCounts = new Map<string, number>();
  const seenExternalIds = new Set<string>();

  for (const row of rows) {
    const amount = Number(row.amount);
    const balance = finiteOptional(row.balance);
    const currency = normalized(row.currency || accountCurrency).toUpperCase();
    const occurredAt = new Date(row.occurredAt);
    const type = normalized(row.type) || "Unknown";

    if (
      !Number.isFinite(amount) ||
      !currency ||
      Number.isNaN(occurredAt.getTime())
    ) {
      if (native) {
        throw new Error(
          "Native Mintos statement contains a row that could not be parsed. Nothing was imported.",
        );
      }
      continue;
    }

    const externalId = row.externalId?.trim();
    if (externalId) {
      if (seenExternalIds.has(externalId)) continue;
      seenExternalIds.add(externalId);
    }

    const kind = classifyMintos(row);
    if (!EXACT_KIND[type] && native) unknownTypes.add(type);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

    prepared.push({
      row,
      amount,
      balance,
      currency,
      occurredIso: occurredAt.toISOString(),
      kind,
      principalDelta: principalDelta(row),
      isin: extractIsin(row.description),
      loan: extractLoan(row.description),
      bond: isBond(row.description),
    });
  }

  if (!prepared.length) {
    const currentValue = finiteOptional(input.currentValue);
    const cashValue = finiteOptional(input.cashValue);
    if (currentValue === null || cashValue === null) {
      throw new Error(
        "Upload Mintos statements or provide both current total value and current cash.",
      );
    }
    if (currentValue < 0 || cashValue < 0 || cashValue > currentValue) {
      throw new Error("Mintos balance values are inconsistent.");
    }

    const investedValue = currentValue - cashValue;
    const [cashCzk, investedCzk, totalCzk] = await Promise.all([
      toCzk(cashValue, accountCurrency),
      toCzk(investedValue, accountCurrency),
      toCzk(currentValue, accountCurrency),
    ]);

    const accountId = upsertAccount({
      provider: "mintos",
      externalId: "main",
      name: "Mintos",
      type: "p2p",
      currency: accountCurrency,
      cashValue,
      investedValue,
      totalValue: currentValue,
      realizedPnl: 0,
      unrealizedPnl: 0,
      cashValueCzk: cashCzk,
      investedValueCzk: investedCzk,
      totalValueCzk: totalCzk,
      realizedPnlCzk: 0,
      unrealizedPnlCzk: 0,
      reconciliationStatus: "unknown",
      raw: {
        imported: true,
        importMode: "balance-only",
        lifetimeComplete: false,
        continuityOk: true,
      },
    });

    return {
      accountId,
      imported: 0,
      totalRows: 0,
      sourceFormat: "balance-only",
    };
  }

  const nativeRows = prepared.map((item) => item.row);
  if (native) {
    const nativeCurrencies = [
      ...new Set(prepared.map((item) => item.currency)),
    ];
    if (nativeCurrencies.length !== 1) {
      throw new Error(
        "A native Mintos statement set must contain exactly one account currency. Import separate currency accounts independently.",
      );
    }
    if (nativeCurrencies[0] !== accountCurrency) {
      throw new Error(
        "Mintos statement currency is " +
          nativeCurrencies[0] +
          ", but Account currency is " +
          accountCurrency +
          ".",
      );
    }
  }

  const continuity = native ? statementContinuity(nativeRows) : null;
  if (native && (!continuity?.checked || !continuity.ok)) {
    throw new Error(
      "Mintos statement balance chain is broken. The files may be incomplete, overlapped in the wrong order or edited. Nothing was imported.",
    );
  }

  const openingCash = continuity?.openingCash ?? null;
  const lifetimeComplete =
    native &&
    openingCash !== null &&
    Math.abs(openingCash) <= 1e-8;

  const project = new Map<
    string,
    {
      isin: string;
      principal: number;
      totalInvested: number;
      totalReturned: number;
      interest: number;
      bond: boolean;
      loans: Set<string>;
    }
  >();

  let grossInterest = 0;
  let withholdingTax = 0;
  let fees = 0;
  let cashback = 0;
  let realizedPnl = 0;

  for (const item of prepared) {
    const type = normalized(item.row.type);

    if (item.kind === "interest") {
      grossInterest += Math.max(0, item.amount);
      realizedPnl += item.amount;
    }
    if (item.kind === "income") {
      cashback += Math.max(0, item.amount);
      realizedPnl += item.amount;
    }
    if (item.kind === "fee") {
      if (type === "Srážková daň") {
        withholdingTax += Math.abs(item.amount);
      } else {
        fees += Math.abs(item.amount);
      }
      realizedPnl += item.amount;
    }

    if (!item.isin) continue;

    const state = project.get(item.isin) ?? {
      isin: item.isin,
      principal: 0,
      totalInvested: 0,
      totalReturned: 0,
      interest: 0,
      bond: item.bond,
      loans: new Set<string>(),
    };

    if (item.loan) state.loans.add(item.loan);
    state.bond ||= item.bond;

    if (item.principalDelta > 0) {
      state.principal += item.principalDelta;
      state.totalInvested += item.principalDelta;
    } else if (item.principalDelta < 0) {
      const returned = Math.abs(item.principalDelta);
      state.principal -= returned;
      state.totalReturned += returned;
    }

    if (item.kind === "interest") {
      state.interest += Math.max(0, item.amount);
    }

    if (Math.abs(state.principal) <= 1e-8) state.principal = 0;
    project.set(item.isin, state);
  }

  const negativeAssets = [...project.values()]
    .filter((item) => item.principal < -1e-7)
    .map((item) => item.isin);

  if (native && lifetimeComplete && negativeAssets.length) {
    throw new Error(
      "Mintos lifetime statement produced negative principal for: " +
        negativeAssets.slice(0, 10).join(", ") +
        ". Nothing was imported.",
    );
  }

  const derivedPrincipal = [...project.values()].reduce(
    (sum, item) => sum + Math.max(0, item.principal),
    0,
  );
  const derivedCash =
    continuity?.closingCash ??
    finiteOptional(prepared.at(-1)?.balance) ??
    0;
  const derivedBookTotal = derivedCash + derivedPrincipal;

  const overrideCash = finiteOptional(input.cashValue);
  const overrideTotal = finiteOptional(input.currentValue);

  if (!lifetimeComplete && overrideTotal === null) {
    throw new Error(
      "The uploaded Mintos statement starts with a non-zero opening balance, so it is not a full lifetime history. Provide Current total value or add the older statement files.",
    );
  }

  const cashValue = overrideCash ?? derivedCash;
  const totalValue =
    overrideTotal ?? (lifetimeComplete ? derivedBookTotal : cashValue);
  const investedValue = totalValue - cashValue;

  if (
    cashValue < -1e-8 ||
    totalValue < -1e-8 ||
    investedValue < -1e-8
  ) {
    throw new Error("Mintos current values are inconsistent.");
  }

  const factors = await fxFactors(nativeRows);
  const [cashValueCzk, investedValueCzk, totalValueCzk, realizedPnlCzk] =
    await Promise.all([
      toCzk(cashValue, accountCurrency),
      toCzk(investedValue, accountCurrency),
      toCzk(totalValue, accountCurrency),
      toCzk(realizedPnl, accountCurrency),
    ]);

  let grossInterestCzk = 0;
  let withholdingTaxCzk = 0;
  let feesCzk = 0;
  let cashbackCzk = 0;

  const preparedCzk = prepared.map((item) => {
    const date = dateOnly(item.row);
    const amountCzk = amountToCzk(
      item.amount,
      item.currency,
      date,
      factors,
    );

    if (amountCzk !== null) {
      const type = normalized(item.row.type);
      if (item.kind === "interest") {
        grossInterestCzk += Math.max(0, amountCzk);
      } else if (item.kind === "income") {
        cashbackCzk += Math.max(0, amountCzk);
      } else if (item.kind === "fee") {
        if (type === "Srážková daň") {
          withholdingTaxCzk += Math.abs(amountCzk);
        } else {
          feesCzk += Math.abs(amountCzk);
        }
      }
    }

    return { ...item, amountCzk, date };
  });

  const db = getDb();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const accountId = upsertAccount({
      provider: "mintos",
      externalId: "main",
      name: "Mintos",
      type: "p2p",
      currency: accountCurrency,
      cashValue,
      investedValue,
      totalValue,
      realizedPnl,
      unrealizedPnl: 0,
      cashValueCzk,
      investedValueCzk,
      totalValueCzk,
      realizedPnlCzk,
      unrealizedPnlCzk: 0,
      reconciliationDifference:
        lifetimeComplete && overrideTotal === null
          ? totalValue - derivedBookTotal
          : 0,
      reconciliationStatus:
        lifetimeComplete && overrideTotal === null
          ? "reconciled"
          : "unknown",
      raw: {
        imported: true,
        importMode: input.sourceFormat || "mapped",
        statementFiles: [
          ...new Set(
            prepared
              .map((item) => normalized(item.row.sourceFile))
              .filter(Boolean),
          ),
        ],
        statementRows: prepared.length,
        statementFirstAt: prepared[0]?.occurredIso ?? null,
        statementLastAt: prepared.at(-1)?.occurredIso ?? null,
        lifetimeComplete,
        continuityOk: continuity?.ok ?? null,
        openingCash: continuity?.openingCash ?? null,
        closingCash: continuity?.closingCash ?? null,
        derivedPrincipal,
        derivedBookTotal,
        grossInterest,
        grossInterestCzk,
        withholdingTax,
        withholdingTaxCzk,
        fees,
        feesCzk,
        cashback,
        cashbackCzk,
        unknownTypes: [...unknownTypes].sort(),
      },
    });

    if (replaceExisting) {
      db.prepare("DELETE FROM transactions WHERE provider = 'mintos'").run();
      db.prepare("DELETE FROM holdings WHERE account_id = ?").run(accountId);
      db.prepare("DELETE FROM snapshots WHERE account_id = ?").run(accountId);
      db.prepare("DELETE FROM assets WHERE provider = 'mintos'").run();
    }

    const assetIds = new Map<string, string>();
    for (const state of project.values()) {
      const assetId = upsertAsset({
        provider: "mintos",
        externalId: "isin:" + state.isin,
        symbol: state.isin,
        name: state.bond
          ? "Mintos bond " + state.isin
          : "Mintos Notes " + state.isin,
        assetClass: state.bond ? "bond" : "p2p",
        currency: accountCurrency,
        raw: {
          isin: state.isin,
          bond: state.bond,
          loanCount: state.loans.size,
          totalInvested: state.totalInvested,
          totalReturned: state.totalReturned,
          receivedInterest: state.interest,
          currentPrincipal: Math.max(0, state.principal),
          imported: true,
        },
      });
      assetIds.set(state.isin, assetId);
    }

    const duplicateOrdinals = new Map<string, number>();
    for (const item of preparedCzk) {
      const base = stableRowBase(item.row);
      const ordinal = duplicateOrdinals.get(base) ?? 0;
      duplicateOrdinals.set(base, ordinal + 1);
      const stableId = base.startsWith("external:")
        ? base
        : base + ":" + String(ordinal);
      const quantity =
        Math.abs(item.principalDelta) > 1e-12
          ? item.principalDelta
          : null;

      upsertTransaction({
        provider: "mintos",
        accountId,
        externalId: "statement:" + stableId,
        kind: item.kind,
        occurredAt: item.occurredIso,
        currency: item.currency,
        amount: item.amount,
        amountCzk: item.amountCzk,
        assetId: item.isin ? assetIds.get(item.isin) ?? null : null,
        quantity,
        price: quantity === null ? null : 1,
        note:
          [item.row.type, item.row.description].filter(Boolean).join(" · ") ||
          "Mintos",
        category: categoryFor(item.row),
        sourceLabel: "Mintos",
        flowScope: flowScope(item.kind),
        raw: {
          ...item.row,
          financeOsClassification: item.kind,
          financeOsPrincipalDelta: item.principalDelta,
          financeOsIsin: item.isin || null,
          financeOsLoan: item.loan || null,
        },
      });
    }

    const holdings = [...project.values()]
      .filter((item) => item.principal > 0.005)
      .map((item) => {
        const assetId = assetIds.get(item.isin);
        if (!assetId) throw new Error("Mintos asset creation failed.");

        const currentPrincipal = Math.max(0, item.principal);
        const marketValueCzk =
          amountToCzk(
            currentPrincipal,
            accountCurrency,
            dateOnly(prepared.at(-1)!.row),
            factors,
          ) ?? 0;

        return {
          accountId,
          assetId,
          quantity: currentPrincipal,
          averagePrice: 1,
          currentPrice: 1,
          currency: accountCurrency,
          marketValue: currentPrincipal,
          marketValueCzk,
          unrealizedPnl: 0,
          unrealizedPnlCzk: 0,
          raw: {
            bookValue: true,
            principal: currentPrincipal,
            totalInvested: item.totalInvested,
            totalReturned: item.totalReturned,
            receivedInterest: item.interest,
            loanCount: item.loans.size,
            bond: item.bond,
          },
        };
      });

    replaceHoldings(accountId, holdings);

    if (native && lifetimeComplete) {
      let runningPrincipal = 0;
      const daily = new Map<
        string,
        { cash: number; invested: number; total: number }
      >();

      for (const item of preparedCzk) {
        runningPrincipal += item.principalDelta;
        if (Math.abs(runningPrincipal) <= 1e-8) runningPrincipal = 0;
        const cash = item.balance ?? 0;
        const invested = Math.max(0, runningPrincipal);
        daily.set(item.date, {
          cash,
          invested,
          total: cash + invested,
        });
      }

      const insertSnapshot = db.prepare(
        "INSERT INTO snapshots(account_id, recorded_at, total_value_czk, cash_value_czk, invested_value_czk) " +
          "VALUES(?, ?, ?, ?, ?) " +
          "ON CONFLICT(account_id, recorded_at) DO UPDATE SET " +
          "total_value_czk = excluded.total_value_czk, " +
          "cash_value_czk = excluded.cash_value_czk, " +
          "invested_value_czk = excluded.invested_value_czk",
      );

      for (const [date, snapshot] of daily) {
        const factor = factors.get(accountCurrency + "|" + date);
        if (factor === null || factor === undefined) continue;
        insertSnapshot.run(
          accountId,
          date,
          snapshot.total * factor,
          snapshot.cash * factor,
          snapshot.invested * factor,
        );
      }

      const today = new Date().toISOString().slice(0, 10);
      insertSnapshot.run(
        accountId,
        today,
        totalValueCzk,
        cashValueCzk,
        investedValueCzk,
      );
    }

    db.exec("COMMIT;");

    return {
      accountId,
      imported: prepared.length,
      totalRows: rows.length,
      sourceFormat: input.sourceFormat || "mapped",
      derived: {
        lifetimeComplete,
        continuityOk: continuity?.ok ?? null,
        openingCash: continuity?.openingCash ?? null,
        closingCash: continuity?.closingCash ?? null,
        principal: derivedPrincipal,
        bookTotal: derivedBookTotal,
        activeAssets: holdings.length,
        allAssets: project.size,
        grossInterest,
        withholdingTax,
        fees,
        cashback,
        realizedPnl,
      },
      effective: {
        cashValue,
        investedValue,
        totalValue,
        cashValueCzk,
        investedValueCzk,
        totalValueCzk,
        realizedPnlCzk,
      },
      coverage: {
        firstAt: prepared[0]?.occurredIso ?? null,
        lastAt: prepared.at(-1)?.occurredIso ?? null,
        typeCounts: Object.fromEntries(
          [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
        ),
        unknownTypes: [...unknownTypes].sort(),
      },
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Preserve original import error.
    }
    throw error;
  }
}

export { NATIVE_HEADERS };
