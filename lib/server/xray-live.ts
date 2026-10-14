import { listConnections } from "@/lib/server/repository";
import { getXRayHoldings } from "@/lib/server/xray";
import { calculateXRayFreshness } from "@/lib/xray/freshness";

export function getXRayLiveSnapshot() {
  const holdings = getXRayHoldings();
  const connections = listConnections()
    .filter((c) => ["trading212", "kraken", "phantom"].includes(c.provider))
    .map((c) => ({
      provider: c.provider,
      status: c.status,
      lastSyncedAt: c.lastSyncedAt,
      lastError: c.lastError,
    }));
  return {
    holdings,
    freshness: calculateXRayFreshness(connections, holdings.map((h) => h.updatedAt)),
  };
}
