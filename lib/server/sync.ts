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

export async function syncProvider(provider: ProviderId): Promise<SyncResult> {
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
        throw new Error(`Provider ${provider} does not support automatic sync yet.`);
    }

    markConnectionSynced(provider);
    return { provider, ok: true, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markConnectionError(provider, message);
    return { provider, ok: false, error: message };
  }
}

export async function syncAll(): Promise<SyncResult[]> {
  const providers = listConnections()
    .map((connection) => connection.provider)
    .filter(
      (provider): provider is Extract<ProviderId, "trading212" | "kraken"> =>
        provider === "trading212" || provider === "kraken",
    );

  const results: SyncResult[] = [];
  // Keep provider sync sequential so local CPU/network usage and API rate limits stay predictable.
  for (const provider of providers) {
    results.push(await syncProvider(provider));
  }
  return results;
}
