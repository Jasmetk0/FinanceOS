import { getDb } from "@/lib/server/db";
import {
  marketIndexById,
  normalizeMarketSelection,
  parseMarketIndexChart,
} from "@/lib/shared/market-index-benchmarks.mjs";

const PROVIDER = "market_indices";
const SOURCE = "Yahoo Finance · daily close (neoficiální)";
const SUCCESS_TTL = 12 * 60 * 60 * 1000;
const FAILURE_TTL = 30 * 60 * 1000;
const PENDING_TTL = 90 * 1000;

export type IndexPricePoint = { date: string; close: number };
export type MarketIndexRow = {
  id: string; name: string; ticker: string; region: string;
  currency: string; basis: "price" | "performance"; note: string;
  points: IndexPricePoint[];
  lastUpdated: string | null;
  source: string;
  warning: string | null;
};
type CachedHistory = {
  version: 1; ticker: string; currency: string;
  updatedAt: string; points: Array<[string, number]>;
};

function readState(key: string): string | null {
  const row = getDb().prepare(
    "SELECT value FROM provider_sync_state WHERE provider = ? AND key = ?",
  ).get(PROVIDER, key);
  return row ? String(row.value) : null;
}

function writeState(key: string, value: string) {
  getDb().prepare(
    "INSERT INTO provider_sync_state(provider, key, value, updated_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(provider, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(PROVIDER, key, value, new Date().toISOString());
}

function readCache(index: { id: string; ticker: string; currency: string }) {
  const raw = readState("history:" + index.id);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedHistory;
    if (parsed.version !== 1 || parsed.ticker !== index.ticker ||
      parsed.currency !== index.currency || !Array.isArray(parsed.points) ||
      parsed.points.length > 4000) return null;
    const points: IndexPricePoint[] = [];
    let previous = "";
    for (const tuple of parsed.points) {
      if (!Array.isArray(tuple) || tuple.length !== 2) return null;
      const [date, close] = tuple;
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date <= previous || !Number.isFinite(close) || close <= 0) return null;
      previous = date;
      points.push({ date, close });
    }
    return points.length ? { points, lastUpdated: parsed.updatedAt } : null;
  } catch {
    return null;
  }
}

async function fetchMarketIndex(index: { id: string; ticker: string; currency: string }): Promise<string | null> {
  const stateKey = "sync:" + index.id;
  const [status, lastAt] = String(readState(stateKey) || "").split("|");
  const last = Date.parse(lastAt || "");
  const ttl = status === "ok" ? SUCCESS_TTL : status === "pending" ? PENDING_TTL : FAILURE_TTL;

  if (process.env.FINANCEOS_EXTERNAL_PRICE_FETCH === "off") {
    return "Externí dotazy na tržní data jsou vypnuté (FINANCEOS_EXTERNAL_PRICE_FETCH=off).";
  }
  if (Number.isFinite(last) && last <= Date.now() && Date.now() - last < ttl) {
    if (status === "failed") return "Poslední aktualizace selhala. Používají se případná uložená data.";
    if (status === "pending") return "Cenová data se načítají v jiném požadavku.";
    return null;
  }

  const now = new Date().toISOString();
  writeState(stateKey, "pending|" + now);
  try {
    // Unofficial endpoint; NEVER send portfolio positions, API keys or wallet data.
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(index.ticker) + "?range=10y&interval=1d";
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "FinanceOS/0.1 personal benchmark chart" },
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json() as {
      chart?: { result?: unknown[]; error?: { description?: string } };
    };
    const result = payload.chart?.result?.[0];
    if (!result) throw new Error(payload.chart?.error?.description || "Zdroj nevrátil historii.");
    const points = parseMarketIndexChart(result, index) as IndexPricePoint[];
    // The feed is daily, but may return an in-progress day's quote. Keep
    // the source close without claiming a realtime or completed session.
    if (!points.length) throw new Error("Zdroj nevrátil ani jeden platný kurz.");
    const completedAt = new Date().toISOString();
    const cached: CachedHistory = {
      version: 1, ticker: index.ticker, currency: index.currency,
      updatedAt: completedAt, points: points.map(point => [point.date, point.close]),
    };
    writeState("history:" + index.id, JSON.stringify(cached));
    writeState(stateKey, "ok|" + completedAt);
    return null;
  } catch (error) {
    writeState(stateKey, "failed|" + new Date().toISOString());
    const reason = error instanceof Error ? error.message : "neznámá chyba";
    return "Indexový zdroj není právě dostupný (" + reason + "). Případná starší data zůstávají viditelná.";
  }
}

export async function getMarketIndexRows(idsInput: unknown): Promise<MarketIndexRow[]> {
  const ids = normalizeMarketSelection(idsInput);
  return Promise.all(ids.map(async (id: string) => {
    const index = marketIndexById(id);
    if (!index) throw new Error("Neznámý index.");
    const warning = await fetchMarketIndex(index);
    const snapshot = readCache(index);
    return {
      ...index, basis: index.basis as "price" | "performance",
      points: snapshot?.points || [],
      lastUpdated: snapshot?.lastUpdated || null,
      source: SOURCE,
      warning,
    };
  }));
}
