import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import {
  importCashFlow,
  type CashFlowImportRow,
} from "@/lib/server/cashflow-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as {
      defaultCurrency?: unknown;
      rows?: unknown;
    };

    const rows = Array.isArray(body.rows)
      ? (body.rows as CashFlowImportRow[])
      : [];

    const result = await importCashFlow({
      defaultCurrency: String(body.defaultCurrency || "CZK"),
      rows,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
