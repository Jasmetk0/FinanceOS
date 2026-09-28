import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { importMintos, type MintosImportRow } from "@/lib/server/mintos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as {
      accountCurrency?: unknown;
      currentValue?: unknown;
      cashValue?: unknown;
      rows?: unknown;
    };

    const rows = Array.isArray(body.rows)
      ? (body.rows as MintosImportRow[])
      : [];

    const result = await importMintos({
      accountCurrency: String(body.accountCurrency || "EUR"),
      currentValue: Number(body.currentValue),
      cashValue: Number(body.cashValue || 0),
      rows,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
