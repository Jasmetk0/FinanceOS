import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import {
  importHistoricalPrices,
  type HistoricalPriceRow,
} from "@/lib/server/historical-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as {
      assetId?: unknown;
      defaultCurrency?: unknown;
      source?: unknown;
      rows?: unknown;
    };

    const rows = Array.isArray(body.rows)
      ? (body.rows as HistoricalPriceRow[])
      : [];

    const result = await importHistoricalPrices({
      assetId: String(body.assetId || ""),
      defaultCurrency: String(body.defaultCurrency || ""),
      source: String(body.source || "CSV import"),
      rows,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
