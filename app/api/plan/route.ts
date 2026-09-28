import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { getPlanData, savePlan } from "@/lib/server/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  return NextResponse.json({ plan: getPlanData() });
}

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as {
      targets?: Record<string, unknown>;
      monthlyContributionCzk?: unknown;
    };

    savePlan({
      targets: body.targets ?? {},
      monthlyContributionCzk: Number(body.monthlyContributionCzk ?? 0),
    });

    return NextResponse.json({ ok: true, plan: getPlanData() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
