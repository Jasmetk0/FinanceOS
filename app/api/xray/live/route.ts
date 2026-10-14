import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { syncAll } from "@/lib/server/sync";
import { getXRayLiveSnapshot } from "@/lib/server/xray-live";
import { XRAY_AUTO_REFRESH_MS, XRAY_MANUAL_COOLDOWN_MS } from "@/lib/xray/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const globalState = globalThis as typeof globalThis & {
  __financeOsXrayRefresh?: {
    startedAt: number;
    running?: Promise<{
      results: Array<{ provider: string; ok: boolean; error?: string }>;
    }>;
  };
};
function sharedState() {
  globalState.__financeOsXrayRefresh ??= { startedAt: 0 };
  return globalState.__financeOsXrayRefresh;
}

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  try {
    return NextResponse.json(getXRayLiveSnapshot(), { headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers });
  }
}

/**
 * Refetch existing connected read-only provider accounts (Trading 212,
 * Kraken, Phantom) using the *existing encrypted local credentials*.
 * Auto refresh has a 15-minute server-side cooldown to protect rate limits.
 * Manual refresh has a 30-second cooldown to prevent accidental repeated hits.
 */
export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = await request.text();
    const parsed: unknown = body ? JSON.parse(body) : {};
    const mode = parsed && typeof parsed === "object" && !Array.isArray(parsed) ?
      (parsed as Record<string, unknown>).mode : null;
    if (mode !== "auto" && mode !== "manual") {
      return NextResponse.json({ error: "Neplatný režim synchronizace." }, { status: 400, headers });
    }

    const snapshot = getXRayLiveSnapshot();
    if (!snapshot.freshness.connections.length) {
      return NextResponse.json({ snapshot, attempted: false, reason: "no_connected_api" }, { headers });
    }
    const now = Date.now();
    const state = sharedState();

    // Join an already-running update instead of racing two provider syncs.
    if (state.running) {
      const current = await state.running;
      return NextResponse.json({
        snapshot: getXRayLiveSnapshot(), attempted: true,
        results: current.results, shared: true,
      }, { headers });
    }

    const cooldown = mode === "auto" ? XRAY_AUTO_REFRESH_MS : XRAY_MANUAL_COOLDOWN_MS;
    if (mode === "auto" && snapshot.freshness.status === "current") {
      return NextResponse.json({ snapshot, attempted: false, reason: "already_current" }, { headers });
    }
    if (now - state.startedAt < cooldown) {
      return NextResponse.json({ snapshot, attempted: false, reason: "rate_limited" }, { headers });
    }

    state.startedAt = now;
    const running = syncAll().then((results) => ({
      // Never return credentials, raw brokerage payloads or transaction data.
      results: results.map((r) => ({
        provider: r.provider, ok: r.ok, ...(r.error ? { error: r.error } : {}),
      })),
    }));
    state.running = running;
    try {
      const answer = await running;
      return NextResponse.json({
        snapshot: getXRayLiveSnapshot(), attempted: true,
        results: answer.results,
      }, { status: answer.results.every((r) => r.ok) ? 200 : 207, headers });
    } finally {
      if (state.running === running) state.running = undefined;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers });
  }
}
