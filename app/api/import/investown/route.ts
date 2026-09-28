import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import {
  importInvestown,
  type InvestownImportRow,
} from "@/lib/server/investown";

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
      walletCash?: unknown;
      rows?: unknown;
    };

    const rows = Array.isArray(body.rows)
      ? (body.rows as InvestownImportRow[])
      : [];

    const result = await importInvestown({
      accountCurrency: String(body.accountCurrency || "CZK"),
      currentValue: Number(body.currentValue),
      walletCash: Number(body.walletCash || 0),
      rows,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
