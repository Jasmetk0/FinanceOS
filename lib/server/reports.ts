import { getDb } from "@/lib/server/db";

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface AnnualProviderReport {
  year: number;
  provider: string;
  dividendsCzk: number;
  interestCzk: number;
  incomeCzk: number;
  giftsCzk: number;
  salesCzk: number;
  purchasesCzk: number;
  feesCzk: number;
  withholdingTaxCzk: number;
  depositsCzk: number;
  withdrawalsCzk: number;
  principalInvestedCzk: number;
  principalReturnedCzk: number;
  offerReservedCzk: number;
  offerReleasedCzk: number;
  transactionCount: number;
  missingCzkCount: number;
}

export function getAnnualReports() {
  const db = getDb();

  const rows = db
    .prepare(
      "SELECT provider, kind, occurred_at, amount_czk, quantity, category FROM transactions ORDER BY occurred_at ASC",
    )
    .all();

  const byKey = new Map<string, AnnualProviderReport>();

  for (const row of rows) {
    const occurredAt = String(row.occurred_at);
    const year = Number(occurredAt.slice(0, 4));
    if (!Number.isInteger(year) || year < 1900 || year > 9999) continue;

    const provider = String(row.provider);
    const key = year + ":" + provider;
    const report =
      byKey.get(key) ??
      {
        year,
        provider,
        dividendsCzk: 0,
        interestCzk: 0,
        incomeCzk: 0,
        giftsCzk: 0,
        salesCzk: 0,
        purchasesCzk: 0,
        feesCzk: 0,
        withholdingTaxCzk: 0,
        depositsCzk: 0,
        withdrawalsCzk: 0,
        principalInvestedCzk: 0,
        principalReturnedCzk: 0,
        offerReservedCzk: 0,
        offerReleasedCzk: 0,
        transactionCount: 0,
        missingCzkCount: 0,
      };

    report.transactionCount += 1;

    if (row.amount_czk === null || row.amount_czk === undefined) {
      report.missingCzkCount += 1;
      byKey.set(key, report);
      continue;
    }

    const amount = num(row.amount_czk);
    const kind = String(row.kind);

    if (kind === "dividend") report.dividendsCzk += Math.max(0, amount);
    if (kind === "interest") report.interestCzk += Math.max(0, amount);
    if (kind === "income") report.incomeCzk += Math.max(0, amount);
    if (kind === "gift") report.giftsCzk += Math.max(0, amount);
    if (kind === "sell") report.salesCzk += Math.abs(amount);
    if (kind === "buy") report.purchasesCzk += Math.abs(amount);
    if (kind === "fee" && String(row.category || "") === "withholding_tax") {
      report.withholdingTaxCzk += Math.abs(amount);
    } else if (kind === "fee") {
      report.feesCzk += Math.abs(amount);
    }
    if (kind === "deposit") report.depositsCzk += Math.abs(amount);
    if (kind === "withdrawal") report.withdrawalsCzk += Math.abs(amount);

    const quantity =
      row.quantity === null || row.quantity === undefined
        ? null
        : num(row.quantity);
    const category = row.category ? String(row.category) : "";

    if (kind === "transfer" && quantity !== null && amount < 0) {
      report.principalInvestedCzk += Math.abs(amount);
    }
    if (kind === "transfer" && quantity !== null && amount > 0) {
      report.principalReturnedCzk += Math.abs(amount);
    }
    if (provider === "investown" && category === "Nabídka ke koupi") {
      report.offerReservedCzk += Math.abs(amount);
    }
    if (provider === "investown" && category === "Vrácení nabídky") {
      report.offerReleasedCzk += Math.abs(amount);
    }

    byKey.set(key, report);
  }

  const reports = [...byKey.values()].sort(
    (a, b) => b.year - a.year || a.provider.localeCompare(b.provider),
  );

  const years = [...new Set(reports.map((item) => item.year))].sort(
    (a, b) => b - a,
  );

  const totalsByYear = years.map((year) => {
    const items = reports.filter((item) => item.year === year);
    return items.reduce(
      (acc, item) => {
        acc.dividendsCzk += item.dividendsCzk;
        acc.interestCzk += item.interestCzk;
        acc.incomeCzk += item.incomeCzk;
        acc.giftsCzk += item.giftsCzk;
        acc.salesCzk += item.salesCzk;
        acc.purchasesCzk += item.purchasesCzk;
        acc.feesCzk += item.feesCzk;
        acc.withholdingTaxCzk += item.withholdingTaxCzk;
        acc.depositsCzk += item.depositsCzk;
        acc.withdrawalsCzk += item.withdrawalsCzk;
        acc.principalInvestedCzk += item.principalInvestedCzk;
        acc.principalReturnedCzk += item.principalReturnedCzk;
        acc.offerReservedCzk += item.offerReservedCzk;
        acc.offerReleasedCzk += item.offerReleasedCzk;
        acc.transactionCount += item.transactionCount;
        acc.missingCzkCount += item.missingCzkCount;
        return acc;
      },
      {
        year,
        dividendsCzk: 0,
        interestCzk: 0,
        incomeCzk: 0,
        giftsCzk: 0,
        salesCzk: 0,
        purchasesCzk: 0,
        feesCzk: 0,
        withholdingTaxCzk: 0,
        depositsCzk: 0,
        withdrawalsCzk: 0,
        principalInvestedCzk: 0,
        principalReturnedCzk: 0,
        offerReservedCzk: 0,
        offerReleasedCzk: 0,
        transactionCount: 0,
        missingCzkCount: 0,
      },
    );
  });

  return {
    years,
    reports,
    totalsByYear,
  };
}
