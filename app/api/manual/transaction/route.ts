import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { addManualTransaction } from "@/lib/server/manual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    await addManualTransaction({
      kind: String(body.kind || ""),
      amount: Number(body.amount),
      currency: String(body.currency || "CZK"),
      occurredAt: String(body.occurredAt || new Date().toISOString()),
      note: body.note ? String(body.note) : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
