import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import {
  deleteManualBalance,
  listManualBalances,
  saveManualBalance,
} from "@/lib/server/manual-balance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  return NextResponse.json({ balances: listManualBalances() });
}

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    await saveManualBalance({
      externalId: body.externalId ? String(body.externalId) : undefined,
      name: String(body.name || ""),
      kind: String(body.kind || "cash"),
      value: Number(body.value),
      currency: String(body.currency || "CZK"),
    });

    return NextResponse.json({
      ok: true,
      balances: listManualBalances(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const externalId = String(body.externalId || "");
    deleteManualBalance(externalId);

    return NextResponse.json({
      ok: true,
      balances: listManualBalances(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
