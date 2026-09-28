import type { ProviderId } from "@/lib/domain";
import {
  listConnections,
  markConnectionError,
  markConnectionSynced,
  markConnectionSyncing,
} from "@/lib/server/repository";
import { syncTrading212 } from "@/lib/server/integrations/trading212";
import { syncKraken } from "@/lib/server/integrations/kraken";

export interface SyncResult {
  provider: ProviderId;
  ok: boolean;
  detail?: unknown;
  error?: string;
}

const globalSync = globalThis as typeof globalThis & {
  __financeOsSyncs?: Map<ProviderId, Promise<SyncResult>>;
};

function syncMap(): Map<ProviderId, Promise<SyncResult>> {
  if (!globalSync.__financeOsSyncs) {
    globalSync.__financeOsSyncs = new Map();
  }
  return globalSync.__financeOsSyncs;
}

async function performSync(provider: ProviderId): Promise<SyncResult> {
  markConnectionSyncing(provider);

  try {
    let detail: unknown;

    switch (provider) {
      case "trading212":
        detail = await syncTrading212();
        break;
      case "kraken":
        detail = await syncKraken();
        break;
      default:
        throw new Error(
          `Provider ${provider} does not support automatic sync yet.`,
        );
    }

    markConnectionSynced(provider);
    return { provider, ok: true, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markConnectionError(provider, message);
    return { provider, ok: false, error: message };
  }
}

export async function syncProvider(provider: ProviderId): Promise<SyncResult> {
  const running = syncMap().get(provider);
  if (running) return running;

  const promise = performSync(provider).finally(() => {
    syncMap().delete(provider);
  });
  syncMap().set(provider, promise);
  return promise;
}

export async function syncAll(): Promise<SyncResult[]> {
  const providers = listConnections()
    .map((connection) => connection.provider)
    .filter(
      (provider): provider is Extract<ProviderId, "trading212" | "kraken"> =>
        provider === "trading212" || provider === "kraken",
    );

  const results: SyncResult[] = [];
  // Providers remain sequential to keep API rate limits and local resource use predictable.
  for (const provider of providers) {
    results.push(await syncProvider(provider));
  }
  return results;
}
