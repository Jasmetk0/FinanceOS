import { getAnnualReports } from "@/lib/server/reports";
import { localOnly } from "@/lib/server/local-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[;"\r\n]/.test(text)
    ? '"' + text.replace(/"/g, '""') + '"'
    : text;
}

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  const data = getAnnualReports();
  const headers = [
    "year",
    "provider",
    "interest_czk",
    "dividends_czk",
    "other_income_czk",
    "gifts_czk",
    "sales_proceeds_czk",
    "purchases_czk",
    "fees_czk",
    "withholding_tax_czk",
    "deposits_czk",
    "withdrawals_czk",
    "principal_invested_czk",
    "principal_returned_czk",
    "offer_reserved_czk",
    "offer_released_czk",
    "transaction_count",
    "missing_czk_count",
  ];

  const lines = [
    headers.join(";"),
    ...data.reports.map((row) =>
      [
        row.year,
        row.provider,
        row.interestCzk,
        row.dividendsCzk,
        row.incomeCzk,
        row.giftsCzk,
        row.salesCzk,
        row.purchasesCzk,
        row.feesCzk,
        row.withholdingTaxCzk,
        row.depositsCzk,
        row.withdrawalsCzk,
        row.principalInvestedCzk,
        row.principalReturnedCzk,
        row.offerReservedCzk,
        row.offerReleasedCzk,
        row.transactionCount,
        row.missingCzkCount,
      ]
        .map(cell)
        .join(";"),
    ),
  ];

  const date = new Date().toISOString().slice(0, 10);

  return new Response("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="financeos-annual-report-' + date + '.csv"',
      "Cache-Control": "no-store",
    },
  });
}
