import { getDb } from "@/lib/server/db";
import { localOnly } from "@/lib/server/local-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n;]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  const rows = getDb()
    .prepare(`
      SELECT
        t.occurred_at,
        t.provider,
        ac.name AS account_name,
        t.kind,
        COALESCE(a.symbol, '') AS symbol,
        COALESCE(a.name, '') AS asset_name,
        t.quantity,
        t.price,
        t.currency,
        t.amount,
        t.amount_czk,
        t.fee,
        t.category,
        t.source_label,
        t.note,
        t.external_id
      FROM transactions t
      JOIN accounts ac ON ac.id = t.account_id
      LEFT JOIN assets a ON a.id = t.asset_id
      ORDER BY t.occurred_at ASC
    `)
    .all();

  const headers = [
    "occurred_at",
    "provider",
    "account",
    "kind",
    "symbol",
    "asset_name",
    "quantity",
    "price",
    "currency",
    "amount",
    "amount_czk",
    "fee",
    "category",
    "source",
    "note",
    "external_id",
  ];

  const lines = [
    headers.join(";"),
    ...rows.map((row) =>
      [
        row.occurred_at,
        row.provider,
        row.account_name,
        row.kind,
        row.symbol,
        row.asset_name,
        row.quantity,
        row.price,
        row.currency,
        row.amount,
        row.amount_czk,
        row.fee,
        row.category,
        row.source_label,
        row.note,
        row.external_id,
      ]
        .map(csvCell)
        .join(";"),
    ),
  ];

  const date = new Date().toISOString().slice(0, 10);
  return new Response("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="financeos-transactions-' + date + '.csv"',
      "Cache-Control": "no-store",
    },
  });
}
