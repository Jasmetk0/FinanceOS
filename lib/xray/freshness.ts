/**
 * Portfolio X-Ray freshness describes the locally stored provider snapshot,
 * NOT a streaming market quote. Keep this separate from the issuer as-of date.
 */
export type XRayLiveStatus = "current" | "stale" | "error" | "disconnected";

export interface XRayConnectionStatus {
  provider: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface XRayFreshness {
  status: XRayLiveStatus;
  checkedAt: string;
  oldestPositionUpdateAt: string | null;
  newestPositionUpdateAt: string | null;
  positionsCount: number;
  connections: XRayConnectionStatus[];
}

export const XRAY_AUTO_REFRESH_MS = 15 * 60 * 1000;
export const XRAY_MANUAL_COOLDOWN_MS = 30 * 1000;

export function dateMillis(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== "string") return null;
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : null;
}

export function classifyLiveStatus(
  connections: XRayConnectionStatus[], nowMs: number,
  maxAgeMs = XRAY_AUTO_REFRESH_MS,
): XRayLiveStatus {
  if (!connections.length) return "disconnected";
  if (connections.some((c) => c.status === "error")) return "error";
  if (connections.some((c) => c.status !== "connected")) return "stale";
  if (connections.some((c) => {
    const value = dateMillis(c.lastSyncedAt);
    return value === null || value > nowMs || nowMs - value >= maxAgeMs;
  })) return "stale";
  return "current";
}

export function calculateXRayFreshness(
  connections: XRayConnectionStatus[],
  holdingDates: Array<string | null | undefined>, nowMs: number = Date.now(),
): XRayFreshness {
  if (!Number.isFinite(nowMs)) throw new RangeError("Neplatný čas kontroly aktuálnosti.");
  const time = holdingDates.map(dateMillis).filter((v): v is number => v !== null);
  return {
    status: classifyLiveStatus(connections, nowMs),
    checkedAt: new Date(nowMs).toISOString(),
    oldestPositionUpdateAt: time.length ? new Date(Math.min(...time)).toISOString() : null,
    newestPositionUpdateAt: time.length ? new Date(Math.max(...time)).toISOString() : null,
    positionsCount: holdingDates.length,
    connections,
  };
}

export function shouldStartAutoSync(snapshot: XRayFreshness, lastAttemptMs: number | null, nowMs: number): boolean {
  if (snapshot.status === "current" || snapshot.status === "disconnected") return false;
  if (lastAttemptMs !== null && Number.isFinite(lastAttemptMs) &&
      lastAttemptMs <= nowMs && nowMs-lastAttemptMs < XRAY_AUTO_REFRESH_MS) return false;
  return snapshot.connections.length > 0;
}
