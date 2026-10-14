import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";

export interface IssuerFundStatus {
  isin: string;
  symbol: string;
  status: "ok" | "error" | "unsupported";
  asOf?: string;
  fetchedAt?: string;
  cached?: boolean;
  holdings?: number;
  sourceUrl?: string;
  error?: string;
}

export const ISSUER_FRESH_DAYS = 3;
export const ISSUER_OLD_DAYS = 7;

export function issuerKey(isin: string | null | undefined) {
  return (isin ?? "").trim().toUpperCase();
}

function validDay(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(day + "T00:00:00.000Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day ? ms : null;
}

export function classifyIssuerDate(
  day: string | null | undefined, nowMs: number,
): { state: "fresh" | "aging" | "stale" | "unknown" | "future"; ageDays: number | null } {
  if (!Number.isFinite(nowMs)) throw new RangeError("Neplatný čas kontroly.");
  const time = validDay(day ?? "");
  if (time === null) return { state: "unknown", ageDays: null };
  const nowDay = Math.floor(nowMs / 86_400_000) * 86_400_000;
  const days = Math.round((nowDay - time) / 86_400_000);
  if (days < -1) return { state: "future", ageDays: days };
  if (days <= ISSUER_FRESH_DAYS) return { state: "fresh", ageDays: Math.max(0, days) };
  return { state: days <= ISSUER_OLD_DAYS ? "aging" : "stale", ageDays: days };
}

export interface ReconciledIssuerRows {
  rows: XRayConstituent[];
  retainedIsins: string[];
}

/**
 * A failed vendor refresh MUST NOT erase previously validated holdings.
 * Conversely, a successful refresh must replace the whole fund atomically,
 * never mix different dates/issuer snapshots for the same ISIN.
 *
 * Only still-held, explicitly reported fund ISINs survive. A sold fund does
 * not remain indefinitely cached as if it were held.
 */
export function reconcileIssuerRows(
  previous: XRayConstituent[],
  incoming: XRayConstituent[],
  funds: IssuerFundStatus[],
): ReconciledIssuerRows {
  validateXRayConstituents(previous);
  validateXRayConstituents(incoming);
  if (!Array.isArray(funds) || funds.length > 200) throw new RangeError("Neplatný seznam ETF zdrojů.");
  const statuses = new Map<string, IssuerFundStatus>();
  for (const item of funds) {
    const key = issuerKey(item?.isin);
    if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(key) || statuses.has(key) ||
        !["ok","error","unsupported"].includes(item.status)) {
      throw new RangeError("Duplicitní nebo chybný zdroj ETF.");
    }
    statuses.set(key, item);
  }
  const next = new Map<string,XRayConstituent[]>();
  for (const row of incoming) {
    const key = issuerKey(row.fundIsin);
    const source = statuses.get(key);
    if (!source || source.status !== "ok") throw new RangeError("Podklad bez úspěšně ověřeného ETF zdroje.");
    if (source.asOf && source.asOf !== row.asOf) throw new RangeError("Nesouhlasí datum emitenta a podkladu.");
    const group = next.get(key) ?? [];
    group.push(row);
    next.set(key, group);
  }
  const backup = new Map<string,XRayConstituent[]>();
  for (const row of previous) {
    const key = issuerKey(row.fundIsin);
    if (!key) continue;
    const group=backup.get(key) ?? [];
    group.push(row);
    backup.set(key,group);
  }
  const output: XRayConstituent[] = [];
  const retainedIsins: string[] = [];
  for (const [key, fund] of statuses) {
    if (fund.status === "ok") {
      const rows = next.get(key);
      if (!rows?.length) throw new RangeError("Zdroj ohlásil úspěch, ale nevrátil žádné podklady.");
      const seenDates = new Set(rows.map(r=>r.asOf));
      if (seenDates.size !== 1) throw new RangeError("Zdroj obsahuje více dat složení.");
      output.push(...rows);
    } else {
      const rows = backup.get(key);
      if (rows?.length) {
        output.push(...rows);
        retainedIsins.push(key);
      }
    }
  }
  validateXRayConstituents(output);
  return { rows: output, retainedIsins };
}
