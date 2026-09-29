import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import {
  deleteTrading212SpendingPot,
  getTrading212SpendingPot,
  saveTrading212SpendingPot,
} from "@/lib/server/trading212-auxiliary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  return NextResponse.json({
    spendingPot: getTrading212SpendingPot(),
  });
}

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const spendingPot = await saveTrading212SpendingPot({
      value: Number(body.value),
      currency: String(body.currency || "CZK"),
    });

    return NextResponse.json({ ok: true, spendingPot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  deleteTrading212SpendingPot();
  return NextResponse.json({ ok: true, spendingPot: null });
}
