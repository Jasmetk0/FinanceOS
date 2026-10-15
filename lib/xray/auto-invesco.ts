/**
 * Invesco EQQQ UCITS (Dist/Acc) full holdings from a PUBLIC third-party
 * archival service. This is NOT the official Invesco transport endpoint.
 *
 * Rebalix exposes issuer-declared monthly holdings as XLSX and a dated
 * public product page. No key, cookies, broker holdings, or user data.
 * Fail closed if either identity, schema, date or accounting cannot be
 * independently validated. Never relabel this as a live issuer feed.
 */
import { parseXlsxGrid } from "./xlsx-grid.ts";
import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";

export interface InvescoArchiveFeed {
  isin: string;
  name: string;
  url: string;
  pageUrl: string;
}
const ROOT = "https://rebalix.com";
const FEED_IDS = [
  {isin:"IE0032077012",name:"Invesco EQQQ Nasdaq-100 UCITS ETF Dist (EQQQ)"},
  {isin:"IE00BFZXGZ54",name:"Invesco EQQQ Nasdaq-100 UCITS ETF Acc (EQAC)"},
] as const;
export const INVESCO_ARCHIVE_FEEDS: readonly InvescoArchiveFeed[] = FEED_IDS.map(item=>({
  ...item,
  url:ROOT+"/api/etf/composizione?isin="+item.isin+"&lang=en",
  pageUrl:ROOT+"/en/etf/"+item.isin,
}));
const BY_ISIN=new Map(INVESCO_ARCHIVE_FEEDS.map(f=>[f.isin,f]));
export function invescoArchiveForIsin(isin:string|null|undefined):InvescoArchiveFeed|null {
  return BY_ISIN.get((isin??"").trim().toUpperCase())??null;
}

const months=["january","february","march","april","may","june",
  "july","august","september","october","november","december"];
function dayFromArchive(raw:string,nowMs:number):string {
  const m=/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i.exec(raw);
  if(!m)throw new RangeError("Veřejný archiv neobsahuje datum podkladového snapshotu.");
  const month=months.indexOf(m[2].toLowerCase())+1;
  const iso=m[3]+"-"+String(month).padStart(2,"0")+"-"+m[1].padStart(2,"0");
  const timestamp=Date.parse(iso+"T00:00:00Z");
  if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==iso||
      timestamp>nowMs||nowMs-timestamp>120*86_400_000)
    throw new RangeError("Archivované podklady mají neplatné, budoucí nebo příliš staré datum.");
  return iso;
}
/** Must refer to the actual dated holdings, not another "as of" on the site. */
export function parseInvescoArchiveAsOf(html:string,isin:string,nowMs=Date.now()):string {
  if(typeof html!=="string"||html.length>3_000_000||!html.includes(isin))
    throw new RangeError("Chybí odpovídající stránka archivu a ISIN fondu.");
  const pattern=/(?:Holdings as published by Invesco,\s*holdings as at|Full portfolio declared by Invesco,\s*as of)\s*(\d{1,2}\s+[A-Za-z]+\s+20\d{2})/i;
  const m=pattern.exec(html.replace(/<[^>]*>/g," ").replace(/\s+/g," "));
  if(!m)throw new RangeError("Stránka archivu neuvádí datum podkladů Invesca.");
  return dayFromArchive(m[1],nowMs);
}
function numericWeight(raw:string):number {
  const clean=raw.trim();
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean))
    throw new RangeError("Neplatná numerická váha archivovaného Invesco ETF.");
  const n=Number(clean);
  if(!Number.isFinite(n)||n<0||n>100)throw new RangeError("Váha Invesco podkladu mimo 0–100 %.");
  return n;
}
export function parseInvescoArchiveXlsx(
  bytes:Uint8Array,feed:InvescoArchiveFeed,symbol:string,asOf:string,
):XRayConstituent[] {
  if(BY_ISIN.get(feed.isin)?.url!==feed.url ||
     !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !symbol.trim())
    throw new RangeError("Neověřený fond nebo datum archivovaného Invesco XLSX.");
  const grid=parseXlsxGrid(bytes);
  if(grid.length<92||grid.length>201)
    throw new RangeError("Invesco archiv neobsahuje očekávaný úplný fondový seznam.");
  const header=grid[0].map(s=>s.trim().toLowerCase());
  if(["name","isin","ticker","type","weight %"].some(v=>!header.includes(v)))
    throw new RangeError("Neočekávaná struktura veřejného Invesco XLSX.");
  const nameCol=header.indexOf("name"),isinCol=header.indexOf("isin"),
    tickerCol=header.indexOf("ticker"),weightCol=header.indexOf("weight %");
  const result=new Map<string,XRayConstituent>();
  let total=0,stockRows=0,cashRows=0;
  for(let i=1;i<grid.length;i++){
    const row=grid[i];
    if(!row.some(x=>x.trim()))throw new RangeError("Prázdný řádek uvnitř Invesco archivu.");
    const name=(row[nameCol]??"").trim();
    const isin=(row[isinCol]??"").trim().toUpperCase();
    const ticker=(row[tickerCol]??"").trim().toUpperCase();
    const weight=numericWeight(row[weightCol]??"");
    if(!name||name.length>150)throw new RangeError("Chybí název podkladu Invesco.");
    const isStock=/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin);
    const isCash=!isin&&/^cash and\/or derivatives$/i.test(name);
    if(!isStock&&!isCash)throw new RangeError("Nerozpoznaný podklad archivu Invesco: "+name.slice(0,60));
    if(isStock&&/^(?:cash|treasury)|\b(?:fund|ETF|future|swap|bond)\b/i.test(name))
      throw new RangeError("Podklad v Invesco archivu nemusí být akcie: "+name.slice(0,60));
    const key=isStock?isin:"OTHER-CASH";
    const previous=result.get(key);
    if(previous){
      if(previous.securityName!==name||previous.kind!==(isStock?"stock":"other"))
        throw new RangeError("Zaměněná identita ISIN ve zveřejněném Invesco archivu.");
      previous.weightPct+=weight;
    }else result.set(key,{
      fundSymbol:symbol.trim().toUpperCase(),fundIsin:feed.isin,
      securitySymbol:isStock?(ticker||isin):"OTHER-CASH",
      securityIsin:isStock?isin:null,securityName:name,
      weightPct:weight,kind:isStock?"stock":"other",asOf,
      source:"Rebalix archiv údajů Invesca, nikoli živý zdroj emitenta; "+asOf,
      exposureBasis:"fund-holdings",
    });
    if(isStock)stockRows++;else cashRows++;
    total+=weight;
  }
  if(stockRows<90||cashRows>3||total<98||total>100.000001)
    throw new RangeError("Archivované podklady Invesco nejsou úplné nebo součet přesahuje 100 %: "+
      total.toFixed(2)+" %.");
  const rows=[...result.values()];
  validateXRayConstituents(rows);
  return rows;
}

type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
type Cached={rows:XRayConstituent[];fetchedAt:string;expiresAt:number;asOf:string};
const CACHE=new Map<string,Cached>();
export async function fetchInvescoArchiveHoldings(
  feed:InvescoArchiveFeed,symbol:string,force=false,fetchImpl:FetchLike=fetch,
){
  if(BY_ISIN.get(feed.isin)?.url!==feed.url)throw new RangeError("Zdroj Invesco není povolený.");
  const old=CACHE.get(feed.isin),now=Date.now();
  if(!force&&old&&old.expiresAt>now)return {
    rows:old.rows.map(r=>({...r,fundSymbol:symbol})),fetchedAt:old.fetchedAt,
    cached:true,sourceUrl:feed.url,
  };
  const options:RequestInit={
    headers:{"Accept":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html"},
    signal:AbortSignal.timeout(15_000),cache:"no-store",redirect:"follow",
  };
  // Fetch page and corresponding workbook together. Never accept a workbook
  // date inferred from download time or from the filename.
  const [page,file]=await Promise.all([
    fetchImpl(feed.pageUrl,{...options,headers:{"Accept":"text/html"}}),
    fetchImpl(feed.url,options),
  ]);
  if(!page.ok||!file.ok)throw new Error("Veřejný archiv Invesco HTTP "+page.status+"/"+file.status+".");
  for(const result of [page,file]){
    if(result.url&&new URL(result.url).hostname!=="rebalix.com")
      throw new RangeError("Veřejný archiv Invesco přesměroval mimo povolenou doménu.");
  }
  const declaredLength=Number(file.headers.get("content-length"));
  if(declaredLength>16*1024*1024)throw new RangeError("Invesco archiv XLSX přesahuje limit.");
  const [html,buffer]=await Promise.all([page.text(),file.arrayBuffer()]);
  if(buffer.byteLength>16*1024*1024)throw new RangeError("Invesco archiv XLSX přesahuje limit.");
  const asOf=parseInvescoArchiveAsOf(html,feed.isin);
  const rows=parseInvescoArchiveXlsx(new Uint8Array(buffer),feed,symbol,asOf);
  const fetchedAt=new Date().toISOString();
  CACHE.set(feed.isin,{rows,fetchedAt,expiresAt:Date.now()+12*3600_000,asOf});
  return {rows,fetchedAt,cached:false,sourceUrl:feed.url};
}
