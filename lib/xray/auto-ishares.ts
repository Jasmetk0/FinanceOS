/**
 * Verified public iShares UCITS holdings feeds, matched by ISIN (never ticker).
 * Trading 212 provides owned instruments/ISIN; the issuer publishes underlying
 * constituents independently. No third-party key or dynamic untrusted URL.
 *
 * Sources are explicitly allowlisted: never use arbitrary user-supplied URLs.
 */
import { parseDelimited } from "./import.ts";
import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";

export interface IssuerFeed {
  isin: string;
  name: string;
  productId: string;
  url: string;
}

export const ISHARES_FEEDS: readonly IssuerFeed[] = [
  { isin: "IE00B5BMR087", name: "iShares Core S&P 500 UCITS ETF (SXR8/CSPX)", productId: "253743",
    url: "https://www.ishares.com/uk/individual/en/products/253743/ishares-core-s-p-500-ucits-etf/latest-holdings.csv" },
  { isin: "IE00B4L5Y983", name: "iShares Core MSCI World UCITS ETF (IWDA/EUNL)", productId: "251882",
    url: "https://www.ishares.com/uk/professionals/en/products/251882/ishares-core-msci-world-ucits-etf/latest-holdings.csv" },
  { isin: "IE00B6R52259", name: "iShares MSCI ACWI UCITS ETF (SSAC/IUSQ)", productId: "251850",
    url: "https://www.ishares.com/uk/individual/en/products/251850/ishares-msci-all-country-world-ucits-etf/latest-holdings.csv" },
  { isin: "IE00BKM4GZ66", name: "iShares Core MSCI EM IMI UCITS ETF (EIMI/IS3N)", productId: "264659",
    url: "https://www.ishares.com/uk/individual/en/products/264659/ishares-core-msci-em-imi-ucits-etf/latest-holdings.csv" },
];

const ISIN_FEEDS = new Map(ISHARES_FEEDS.map(f => [f.isin,f]));

export function issuerFeedForIsin(isin: string | null | undefined): IssuerFeed | null {
  return ISIN_FEEDS.get((isin ?? "").trim().toUpperCase()) ?? null;
}

function parseDate(date: string): string {
  const m = /^(\d{1,2})\/([A-Za-z]{3,9})\/(\d{4})$/.exec(date.trim());
  if (!m) throw new RangeError("iShares neposkytuje datum holdings ve známém formátu.");
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const month = months.indexOf(m[2].toLowerCase().slice(0,3)) + 1;
  const day = Number(m[1]);
  if (month < 1 || day < 1 || day > 31) throw new RangeError("Neplatné datum složení ETF.");
  const out = m[3] + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
  const check = new Date(out + "T00:00:00Z");
  if (!Number.isFinite(check.valueOf()) || check.toISOString().slice(0,10) !== out) {
    throw new RangeError("Neplatné datum složení fondu.");
  }
  return out;
}

function marketNumber(text: string) {
  const v = text.replaceAll(",","").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(v)) throw new RangeError("Neplatná tržní hodnota podkladu: " + text);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new RangeError("Číslo podkladu je mimo rozsah.");
  return n;
}

export function parseIsharesHoldingsCsv(csv: string, feed: IssuerFeed, ownedSymbol: string): XRayConstituent[] {
  if (!csv || new TextEncoder().encode(csv).length > 8 * 1024 * 1024) {
    throw new RangeError("iShares CSV je prázdné nebo větší než 8 MB.");
  }
  const parsed = parseDelimited(csv.replace(/^\uFEFF/,""),",");
  if (parsed.length < 3 || parsed.length > 25_000 ||
      parsed[0][0].trim().toLowerCase() !== "fund holdings as of") {
    throw new RangeError("Neplatný iShares holdings soubor.");
  }
  const asOf = parseDate(parsed[0][1] ?? "");
  const names = parsed[1].map(name => name.trim().toLowerCase());
  const required = ["ticker","name","asset class","market value","exchange","location"];
  const indices = required.map(name => names.indexOf(name));
  if (indices.some(idx => idx < 0)) throw new RangeError("iShares změnil formát sloupců. Rozklad se nepoužije.");
  const [tickerIdx,nameIdx,classIdx,valueIdx,exchangeIdx,locationIdx] = indices;
  type Pending = { ticker:string; name:string; kind:"stock"|"other"; value:number; exchange:string; location:string; index:number };
  const pending: Pending[] = [];
  for (let i = 2; i < parsed.length; i++) {
    const f = parsed[i];
    // The public CSV's trailing disclaimers are not constituents: fail closed
    // on any nonempty row with a mismatched structure.
    if (f.length !== names.length) throw new RangeError("Neznámý/poškozený řádek iShares CSV: "+(i+1));
    const kind = f[classIdx].trim().toLowerCase() === "equity" && !/\b(ETF|ISHARES)\b/i.test(f[nameIdx]) ? "stock" : "other";
    const name = f[nameIdx].trim();
    const ticker = f[tickerIdx].trim().toUpperCase();
    const value = marketNumber(f[valueIdx]);
    if (!name || !ticker) throw new RangeError("iShares podklad nemá název nebo ticker na řádku "+(i+1));
    pending.push({ticker,name,kind,value,exchange:f[exchangeIdx].trim(),location:f[locationIdx].trim(),index:i});
  }
  if (pending.length < 10) throw new RangeError("Příliš málo podkladů pro kompletní iShares ETF.");
  const positive = pending.reduce((sum,r) => sum + Math.max(0,r.value),0);
  const negative = pending.reduce((sum,r) => sum + Math.max(0,-r.value),0);
  if (!(positive > 0) || negative / positive > 0.001) {
    throw new RangeError("Fond má významné záporné expozice; bez derivátového modelu je nerozkládáme.");
  }

  // iShares rounds the published Weight (%) to 2 decimals; exact Market
  // Value lets us preserve securities that are shown as 0.00% in the feed.
  // Denominator is total positive market value; small negatives are disclosed
  // as a limitation, NOT converted into positive stocks.
  const bySymbol = new Map<string,Set<string>>();
  for (const row of pending) {
    if (row.kind !== "stock") continue;
    if (!bySymbol.has(row.ticker)) bySymbol.set(row.ticker,new Set());
    bySymbol.get(row.ticker)?.add(row.name.toUpperCase());
  }

  const source = "iShares official holdings (" + feed.productId + ", positive market value; " + asOf + ")";
  const combined = new Map<string,XRayConstituent>();
  for (const row of pending) {
    if (row.value <= 0) continue;
    const conflict = row.kind === "stock" && (bySymbol.get(row.ticker)?.size ?? 0) > 1;
    // Ambiguous cross-market ticker must not be mistaken for a US security.
    // Keep a distinct identity even if it prevents merging with direct stock.
    const symbol = row.kind === "other" ? "OTHER-" + row.index :
      conflict ? row.ticker + "@" + row.exchange.replace(/\s+/g,"-").slice(0,30) : row.ticker;
    const id = row.kind + "|" + symbol + "|" + (conflict ? row.name : "");
    const previous = combined.get(id);
    const weightPct = 100 * row.value / positive;
    if (previous) previous.weightPct += weightPct;
    else combined.set(id,{
      fundSymbol: ownedSymbol, fundIsin: feed.isin, securitySymbol: symbol,
      securityIsin: null, securityName:row.name, weightPct,
      kind:row.kind, asOf, source,
    });
  }
  const rows=[...combined.values()];
  // Round-off can produce a negligible difference from exactly 100. If any
  // single row exceeds 100 or combined weights exceed by more than 1e-7,
  // underlying validation correctly rejects the feed.
  validateXRayConstituents(rows);
  return rows;
}

type FetchLike = (url:string, init?:RequestInit) => Promise<Response>;
interface FeedCache { rows:XRayConstituent[]; expiresAt:number; fetchedAt:string }
const CACHE = new Map<string,FeedCache>();
const TTL_MS = 12 * 60 * 60 * 1000;

export async function fetchIsharesHoldings(
  feed: IssuerFeed, symbol: string, force = false, fetchImpl: FetchLike = fetch,
): Promise<{rows:XRayConstituent[];fetchedAt:string;cached:boolean;sourceUrl:string}> {
  if (!ISHARES_FEEDS.some(f => f.isin === feed.isin && f.url === feed.url)) {
    throw new RangeError("Neautorizovaný zdroj ETF.");
  }
  const now = Date.now();
  const cached = CACHE.get(feed.isin);
  if (!force && cached && cached.expiresAt > now) {
    return { rows:cached.rows.map(r=>({...r,fundSymbol:symbol})),
      fetchedAt:cached.fetchedAt,cached:true,sourceUrl:feed.url };
  }
  const response = await fetchImpl(feed.url,{
    signal:AbortSignal.timeout(15_000),
    headers:{"Accept":"text/csv,text/plain;q=0.9","User-Agent":"FinanceOS-Portfolio-XRay/1.0"},
    redirect:"follow",
    cache:"no-store",
  });
  if (!response.ok) throw new Error("HTTP "+response.status+" při čtení iShares složení");
  if (response.url && new URL(response.url).hostname !== "www.ishares.com") {
    throw new Error("Zdroj složení přesměroval mimo oficiální doménu iShares.");
  }
  const bytes = response.headers.get("content-length");
  if (bytes && Number(bytes) > 8 * 1024 * 1024) throw new RangeError("Soubor emitenta je větší než 8 MB.");
  const text = await response.text();
  const rows = parseIsharesHoldingsCsv(text,feed,symbol);
  const fetchedAt = new Date().toISOString();
  CACHE.set(feed.isin,{rows,expiresAt:Date.now()+TTL_MS,fetchedAt});
  return {rows,fetchedAt,cached:false,sourceUrl:feed.url};
}
