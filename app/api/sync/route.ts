import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { syncAll, syncProvider } from "@/lib/server/sync";
import type { ProviderId } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    let provider: ProviderId | null = null;
    const text = await request.text();
    if (text.trim()) {
      const body = JSON.parse(text) as Record<string, unknown>;
      const raw = String(body.provider || "");
      if (raw) provider = raw as ProviderId;
    }

    const results = provider ? [await syncProvider(provider)] : await syncAll();
    const ok = results.every((result) => result.ok);

    return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
