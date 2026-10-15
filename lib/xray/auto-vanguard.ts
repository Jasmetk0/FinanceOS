/**
 * Vanguard EU UCITS GPX holdings connector for VWCE/VWRA/VWRP and VALL/VGLA/VALU.
 *
 * One allowlisted ISIN -> one fixed Vanguard EU portId. No user-supplied URL,
 * query or credentials. All pages must be accounted for before any exposure
 * is returned. If the issuer changes its schema, fail closed.
 *
 * The public EU GPX interface is not a contractual stable API. All use is
 * best effort, with source/date visible in the X-Ray dashboard.
 */
import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";
import { normalizedSedol } from "./security-identity.ts";

export const VWCE_ISIN = "IE00BK5BQT80";
export const VALL_ISIN = "IE000VAHT5T0";
export const VANGUARD_EU_PRODUCT_ID = "9679";
export const VANGUARD_VALL_PORT_ID = "E161";
export interface VanguardFeed {
  isin:string;
  productId:string;
  fundName:string;
  namePattern:RegExp;
}
export const VANGUARD_FEEDS: readonly VanguardFeed[]=[
  {isin:VWCE_ISIN,productId:VANGUARD_EU_PRODUCT_ID,
    fundName:"Vanguard FTSE All-World UCITS ETF",namePattern:/FTSE\s+All.World/i},
  {isin:VALL_ISIN,productId:VANGUARD_VALL_PORT_ID,
    fundName:"Vanguard FTSE Global All-Cap UCITS ETF",namePattern:/FTSE\s+Global\s+All.Cap/i},
];
const FEED_BY_ISIN=new Map(VANGUARD_FEEDS.map(f=>[f.isin,f]));
export function vanguardFeedForIsin(isin:string|null|undefined):VanguardFeed|null{
  return FEED_BY_ISIN.get((isin??"").trim().toUpperCase())??null;
}
export const VANGUARD_EU_GRAPHQL_URL = "https://www.ie.vanguard/gpx/graphql";
const VANGUARD_CONSUMER = "ie0";
const MAX_PAGES = 12;
const PAGE_SIZE = 1500;
const MAX_ROWS = 12_000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_WEIGHT_PCT = 100.15;
const MIN_TOTAL_WEIGHT_PCT = 90;
const CACHE_MS = 12 * 60 * 60 * 1000;

// The public GPX totalHoldings counts ALL security types, including
// CT.SPOT contracts. Filtering by known types returns fewer rows than
// totalHoldings and creates a false "complete" snapshot. Request every
// category, verify every page and conservatively net non-equity exposures.
const MAX_NEGATIVE_OTHER_PCT = 2;

const HOLDINGS_QUERY = [
  "query FinanceOsVanguardHoldings($portIds: [String!], $securityTypes: [String!], $lastItemKey: String) {",
  "  funds(portIds: $portIds) { profile { fundFullName fundCurrency } }",
  "  borHoldings(portIds: $portIds) {",
  "    holdings(limit: 1500, securityTypes: $securityTypes, lastItemKey: $lastItemKey) {",
  "      items { issuerName securityLongDescription marketValuePercentage sedol1 ticker securityType effectiveDate }",
  "      totalHoldings lastItemKey",
  "    }",
  "  }",
  "}",
].join("\n");

type JsonRecord = Record<string, unknown>;
export function record(value: unknown): JsonRecord | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}
function arr(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function parseWeight(value: unknown): number {
  const n = typeof value === "number" ? value :
    typeof value === "string" && value.trim() ? Number(value.replace(/,/g,"").replace(/%/g,"")) : NaN;
  if (!Number.isFinite(n) || n < -100 || n > 100) {
    throw new RangeError("Vanguard vrátil neplatnou váhu podkladového aktiva.");
  }
  return n;
}
function realDate(raw: string): string | null {
  const v=raw.trim();
  const iso=/^(\d{4}-\d{2}-\d{2})(?:T[\d:.+-Z]+)?$/.exec(v)?.[1];
  const dmy=/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{4})$/.exec(v);
  const months=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const formatted = iso ?? (dmy ?
    dmy[3]+"-"+String(months.indexOf(dmy[2].toLowerCase().slice(0,3))+1).padStart(2,"0")+"-"+dmy[1].padStart(2,"0") : "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return null;
  const date=new Date(formatted+"T00:00:00Z");
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===formatted?formatted:null;
}

export interface VanguardPage {
  items: JsonRecord[];
  total: number;
  cursor: string | null;
  name: string;
}
export function parseVanguardPage(payload: unknown, feed: VanguardFeed=VANGUARD_FEEDS[0]): VanguardPage {
  const root=record(payload);
  const errors=arr(root?.errors);
  if (errors?.length) {
    throw new RangeError("Vanguard GraphQL ohlásil chybu místo úplných dat fondu.");
  }
  const data=record(root?.data);
  const funds=arr(data?.funds);
  const portfolios=arr(data?.borHoldings);
  if (funds?.length!==1 || portfolios?.length!==1) {
    throw new RangeError("Vanguard nevrátil právě jeden požadovaný fond.");
  }
  const profile=record(record(funds[0])?.profile);
  const name=string(profile?.fundFullName)??"";
  if (!VANGUARD_FEEDS.some(f=>f.isin===feed.isin&&f.productId===feed.productId) ||
      !feed.namePattern.test(name)) {
    throw new RangeError("Vrácený fond neodpovídá Vanguard FTSE All-World ETF.");
  }
  const holdings=record(record(portfolios[0])?.holdings);
  const items=arr(holdings?.items);
  const total=holdings?.totalHoldings;
  const cursor=holdings?.lastItemKey;
  if (!items || items.length > PAGE_SIZE || !Number.isInteger(total) ||
      (total as number) < 1000 || (total as number) > MAX_ROWS ||
      (cursor!==null && cursor!==undefined && typeof cursor!=="string")) {
    throw new RangeError("Vanguard vrátil neplatný počet podkladů nebo stránkování.");
  }
  if (items.some(item=>!record(item))) throw new RangeError("Poškozený podklad ve Vanguard odpovědi.");
  return {
    name,
    items:items as JsonRecord[],
    total:total as number,
    cursor:string(cursor)??null,
  };
}

export interface VanguardParsed {
  rows:XRayConstituent[];
  asOf:string;
  count:number;
  coveragePct:number;
  unmappedPct:number;
}

function isEquityType(value:string):boolean {
  return ["EQ.DRCPT","EQ.FSH","EQ.PREF","EQ.PSH","EQ.REIT","EQ.STOCK"].includes(value);
}

/**
 * The Vanguard EU GraphQL feed exposes SEDOL, not reliable ISIN for each
 * security. Prefer ticker@SEDOL as a unique identity, to avoid silently
 * merging same-symbol companies or distinct share classes across markets.
 * Until a trustworthy SEDOL-to-ISIN map exists, direct brokerage securities
 * may remain separate; correctness is more important than fake merging.
 */
export function parseVanguardHoldings(
  pages:VanguardPage[],symbol:string,feed:VanguardFeed=VANGUARD_FEEDS[0],
): VanguardParsed {
  if (!VANGUARD_FEEDS.some(f=>f.isin===feed.isin&&f.productId===feed.productId) ||
      !pages.every(p=>feed.namePattern.test(p.name)))
    throw new RangeError("Vanguard snapshot se neshoduje s požadovaným ISIN fondu.");
  if (!pages.length || pages.length>MAX_PAGES) throw new RangeError("Chybí úplné stránkování Vanguard.");
  const all=pages.flatMap(p=>p.items);
  const expected=pages[0].total;
  if (pages.some(p=>p.total!==expected||p.name!==pages[0].name)||
      all.length!==expected||all.length<1500||all.length>MAX_ROWS ||
      pages.at(-1)?.cursor) {
    throw new RangeError("Vanguard nevrátil všechny podklady fondu; rozklad se nepoužije.");
  }

  const dates=new Set<string>();
  const rows=new Map<string,XRayConstituent>();
  let stockWeight=0;
  let netOther=0;
  let negativeOther=0;
  for(let i=0;i<all.length;i++) {
    const r=all[i],weight=parseWeight(r.marketValuePercentage);
    const name=string(r.securityLongDescription)??string(r.issuerName);
    const type=string(r.securityType)?.toUpperCase()??"";
    const ticker=string(r.ticker)?.toUpperCase()??"";
    const sedol=string(r.sedol1)?.toUpperCase()??"";
    const dateRaw=string(r.effectiveDate);
    const date=dateRaw?realDate(dateRaw):null;
    if (!name || !type || !date) {
      throw new RangeError("Vanguard podklad nemá ověřitelný název, typ nebo datum: řádek "+(i+1));
    }
    dates.add(date);
    if (dates.size>1)throw new RangeError("Vanguard smíchal různá data podkladových pozic.");
    const kind=isEquityType(type) && /^[0-9A-Z]{7}$/.test(sedol) ? "stock" : "other";
    // GPX includes small short FX/cash contracts (e.g. CT.SPOT) whose
    // negative weights offset POSITIVE cash. The X-Ray calculation has
    // nonnegative buckets; net these only against other/non-equity,
    // NEVER against underlying equities or by increasing their weights.
    if (kind==="other") {
      netOther+=weight;
      if(weight<0)negativeOther+=-weight;
      continue;
    }
    if(weight<0)throw new RangeError("Vanguard vrátil zápornou akciovou expozici.");
    stockWeight+=weight;
    const identity="SEDOL-"+sedol;
    const displayTicker=ticker && /^[A-Z0-9.^-]{1,24}$/.test(ticker) ? ticker+"@"+sedol : identity;
    const key=identity+"|"+type;
    if (weight===0) continue;
    const previous=rows.get(key);
    if (previous) {
      if(previous.securityName!==name||previous.kind!==kind) {
        throw new RangeError("Jedna Vanguard identita označuje více rozdílných společností.");
      }
      previous.weightPct+=weight;
    } else rows.set(key,{
      fundSymbol:symbol,fundIsin:feed.isin,securitySymbol:kind==="stock"?displayTicker:identity,
      securityIsin:null,securitySedol:kind==="stock"?normalizedSedol(sedol):null,
      securityName:name,weightPct:weight,
      kind,asOf:date,source:"Vanguard EU official GPX holdings; "+date,
    });
  }
  // Small offsetting FX/contract positions can safely reduce the
  // non-equity cash bucket; material short exposure needs a different
  // signed-notional model, so never silently normalize it into equities.
  if(negativeOther>MAX_NEGATIVE_OTHER_PCT || netOther< -0.02) {
    throw new RangeError("Vanguard má významné záporné neakciové expozice: "+
      negativeOther.toFixed(3)+" %.");
  }
  const weightSum=stockWeight+Math.max(0,netOther);
  if (dates.size!==1 ||weightSum<MIN_TOTAL_WEIGHT_PCT||weightSum>MAX_TOTAL_WEIGHT_PCT) {
    throw new RangeError("Vanguard složení je neúplné nebo jeho váhy přesahují 100 % ("+weightSum.toFixed(3)+" %).");
  }
  if(netOther>0)rows.set("OTHER-NET",{
    fundSymbol:symbol,fundIsin:feed.isin,securitySymbol:"OTHER-NET",
    securityIsin:null,securitySedol:null,
    securityName:"Net non-equity assets, cash and FX contracts",
    weightPct:netOther,kind:"other",asOf:[...dates][0],
    source:"Vanguard EU official GPX holdings; "+[...dates][0],
  });
  // Minor rounding must not increase the accounted asset value above 100%.
  // Preserve exact weights when <100 so the balance stays explicitly unmapped.
  if (weightSum>100) for(const row of rows.values())row.weightPct*=100/weightSum;
  const result=[...rows.values()];
  validateXRayConstituents(result);
  const coverage=result.reduce((sum,r)=>sum+(r.kind==="stock"?r.weightPct:0),0);
  return {rows:result,asOf:[...dates][0],count:all.length,
    coveragePct:coverage,unmappedPct:100-coverage};
}

type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
interface CacheItem {
  rows:XRayConstituent[];
  fetchedAt:string;
  expiresAt:number;
}
const cached=new Map<string,CacheItem>();

export async function fetchVanguardHoldings(
  feed:VanguardFeed,symbol:string,force=false,fetchImpl:FetchLike=fetch,
):Promise<{rows:XRayConstituent[];asOf:string;fetchedAt:string;cached:boolean;sourceUrl:string}>{
  if(!VANGUARD_FEEDS.some(f=>f.isin===feed.isin&&f.productId===feed.productId&&f.fundName===feed.fundName))
    throw new RangeError("Neautorizovaný Vanguard fond.");
  const now=Date.now();
  const available=cached.get(feed.isin);
  if(!force&&available&&available.expiresAt>now) return {
    rows:available.rows.map(r=>({...r,fundSymbol:symbol})),
    asOf:available.rows[0].asOf,
    fetchedAt:available.fetchedAt,cached:true,
    sourceUrl:VANGUARD_EU_GRAPHQL_URL,
  };
  const pages:VanguardPage[]=[];
  const cursors=new Set<string>();
  let cursor:string|null=null;
  for(let index=0;index<MAX_PAGES;index++) {
    const response=await fetchImpl(VANGUARD_EU_GRAPHQL_URL,{
      method:"POST",signal:AbortSignal.timeout(30_000),redirect:"error",cache:"no-store",
      headers:{"Accept":"application/json","Content-Type":"application/json","X-Consumer-ID":VANGUARD_CONSUMER},
      body:JSON.stringify({query:HOLDINGS_QUERY,variables:{
        portIds:[feed.productId],securityTypes:null,lastItemKey:cursor,
      }}),
    });
    if(!response.ok)throw new Error("Vanguard GPX HTTP "+response.status);
    if(response.url&&new URL(response.url).hostname!=="www.ie.vanguard")
      throw new RangeError("Vanguard odpověděl z neočekávané domény.");
    const length=Number(response.headers.get("content-length"));
    if(length>MAX_BYTES)throw new RangeError("Vanguard stránka podkladů je příliš velká.");
    const body=await response.text();
    if(new TextEncoder().encode(body).length>MAX_BYTES)
      throw new RangeError("Vanguard stránka podkladů překročila limit.");
    let json:unknown;
    try {json=JSON.parse(body);}catch {throw new RangeError("Vanguard vrátil neplatný JSON.");}
    const page=parseVanguardPage(json,feed);
    pages.push(page);
    if(!page.cursor)break;
    if(cursors.has(page.cursor)||page.cursor===cursor)
      throw new RangeError("Vanguard vrátil cyklické stránkování.");
    cursors.add(page.cursor);
    cursor=page.cursor;
  }
  const parsed=parseVanguardHoldings(pages,symbol,feed);
  const fetchedAt=new Date().toISOString();
  cached.set(feed.isin,{rows:parsed.rows,fetchedAt,expiresAt:Date.now()+CACHE_MS});
  return {rows:parsed.rows,asOf:parsed.asOf,fetchedAt,cached:false,
    sourceUrl:VANGUARD_EU_GRAPHQL_URL};
}

/** Backward-compatible VWCE entrypoint; cache isolation is strictly per fund ISIN. */
export function fetchVwceHoldings(symbol:string,force=false,fetchImpl:FetchLike=fetch){
  return fetchVanguardHoldings(VANGUARD_FEEDS[0],symbol,force,fetchImpl);
}
/** Vanguard FTSE Global All-Cap (VALL/VGLA/VALU), verified portId E161. */
export function fetchVallHoldings(symbol:string,force=false,fetchImpl:FetchLike=fetch){
  return fetchVanguardHoldings(VANGUARD_FEEDS[1],symbol,force,fetchImpl);
}
