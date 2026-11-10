import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { getAgeGoalSettings, saveAgeGoalSettings } from "@/lib/server/age-goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  return NextResponse.json({ settings: getAgeGoalSettings() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      throw new RangeError("Neplatný požadavek.");
    }
    const input = body as Record<string, unknown>;
    if (!Object.hasOwn(input, "birthDate") || !Object.hasOwn(input, "targetAge") ||
        !Object.hasOwn(input, "targetMonthlyIncomeCzk") || !Object.hasOwn(input, "withdrawalRatePct")) {
      throw new RangeError("Při uložení musí být uvedeno datum i cílový věk.");
    }
    if ((input.birthDate !== null && typeof input.birthDate !== "string") ||
        (input.targetAge !== null && typeof input.targetAge !== "number") ||
        (input.targetMonthlyIncomeCzk !== null && typeof input.targetMonthlyIncomeCzk !== "number") ||
        (input.withdrawalRatePct !== null && typeof input.withdrawalRatePct !== "number")) {
      throw new RangeError("Neplatný typ data narození nebo cílového věku.");
    }
    const settings = saveAgeGoalSettings({
      birthDate: input.birthDate as string | null,
      targetAge: input.targetAge as number | null,
      targetMonthlyIncomeCzk: input.targetMonthlyIncomeCzk as number | null,
      withdrawalRatePct: input.withdrawalRatePct as number | null,
    });
    return NextResponse.json({ ok: true, settings }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Nastavení se nepodařilo uložit.",
    }, { status: 400 });
  }
}
