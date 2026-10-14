/**
 * State Street's official SPDR MSCI ACWI IMI (SPYI/IMID/IMIE) daily
 * holdings XLSX: ISIN-based identities, explicit as-of and precise weights.
 * The workbook is a remote provider feed, not the user's spreadsheet.
 */
import { parseXlsxGrid } from "./xlsx-grid.ts";
import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";
import { normalizedSedol } from "./security-identity.ts";

export const SPYI_ISIN="IE00B3YLTY66";
export const SPYI_OFFICIAL_URL="https://www.ssga.com/library-content/products/fund-data/etfs/emea/holdings-daily-emea-en-spyi-gy.xlsx";

const DATE_PATTERNS=[
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
  /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/,
  /\b(\d{1,2})[-\s]+([A-Za-z]{3,9})[-\s]+(\d{4})\b/,
  /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/,
];
function asOfOf(rows:string[][]):string{
  const months=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  for(const row of rows.slice(0,12)){
    const line=row.join(" ").trim();
    if(!/as.?of|holdings|portfolio|date/i.test(line))continue;
    for(let p=0;p<DATE_PATTERNS.length;p++){
      const m=DATE_PATTERNS[p].exec(line);if(!m)continue;
      let day:number,month:number,year:number;
      if(p===0){year=+m[1];month=+m[2];day=+m[3];}
      else if(p===1){day=+m[1];month=+m[2];year=+m[3];}
      else if(p===2){day=+m[1];month=months.indexOf(m[2].toLowerCase().slice(0,3))+1;year=+m[3];}
      else{month=months.indexOf(m[1].toLowerCase().slice(0,3))+1;day=+m[2];year=+m[3];}
      if(month<1||month>12)continue;
      const d=year+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");
      if(new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d)return d;
    }
  }
  throw new RangeError("SPDR XLSX neobsahuje ověřitelné datum složení.");
}
const header=(s:string)=>s.toLowerCase().trim().replace(/[\s_/()%.-]+/g," ");
function number(value:string):number{
  const cleaned=value.trim().replace(/[, %]/g,"");
  if(!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/.test(cleaned))
    throw new RangeError("Neplatná váha podkladu SPDR: "+value);
  const n=Number(cleaned);if(!Number.isFinite(n))throw new RangeError("Nekonečná váha.");
  return n;
}
export function parseSpyiXlsx(data:Uint8Array,symbol:string):XRayConstituent[]{
  const grid=parseXlsxGrid(data);
  const asOf=asOfOf(grid);
  let rowIndex=-1;
  let names:string[]=[];
  for(let i=0;i<Math.min(20,grid.length);i++){
    const c=grid[i].map(header);
    if(c.includes("isin")&&c.some(x=>x==="security name"||x==="name") &&
       c.some(x=>x==="percent of fund"||x==="weight"||x==="weight percent")){
      rowIndex=i;names=c;break;
    }
  }
  if(rowIndex<0)throw new RangeError("SPDR XLSX má nepodporovanou tabulku podkladů.");
  const col=(values:string[])=>names.findIndex(s=>values.includes(s));
  const isinCol=col(["isin"]),nameCol=col(["security name","name"]);
  const weightCol=col(["percent of fund","weight","weight percent"]);
  const sectorCol=col(["sector classification","sector","asset class"]);
  const sedolCol=col(["sedol","sedol 1","sedol1"]);
  if(isinCol<0||nameCol<0||weightCol<0)throw new RangeError("SPDR XLSX nemá povinné sloupce.");
  if(grid.length-rowIndex<12)throw new RangeError("SPDR XLSX neobsahuje úplný rozklad fondu.");
  const byIsin=new Map<string,XRayConstituent>();
  let total=0;
  let seen=0;
  for(let i=rowIndex+1;i<grid.length;i++){
    const row=grid[i];
    if(!row.some(x=>x.trim()))continue;
    const isin=(row[isinCol]??"").trim().toUpperCase();
    const name=(row[nameCol]??"").trim();
    const sedol=normalizedSedol(sedolCol>=0?(row[sedolCol]??""):null);
    const rawWeight=(row[weightCol]??"").trim();
    // Blank unlabelled padding is allowed; labelled footers cannot be
    // silently accepted as constituents or omitted.
    if(!isin&&!name&&!rawWeight)continue;
    if(!rawWeight||!name)throw new RangeError("Neúplný řádek SPDR "+(i+1)+".");
    const weight=number(rawWeight);
    if(weight<0)throw new RangeError("SPDR obsahuje záporné podkladové váhy.");
    if(weight>100)throw new RangeError("SPDR XLSX nemá procentní váhy 0–100.");
    const isEquity=/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin) &&
      !/(ETF|FUND|CASH|FUTURE|SWAP|FORWARD|TREASURY|BOND)/i.test(name) &&
      !/^(cash|money market|fixed income|derivative)/i.test((row[sectorCol]??"").trim());
    const kind=isEquity?"stock":"other";
    const key=isEquity?isin:"OTHER-"+(i+1);
    const previous=byIsin.get(key);
    if(previous){
      if(previous.kind!==kind||previous.securityName!==name)throw new RangeError("Stejný ISIN s rozdílnou identitou v SPDR.");
      if(previous.securitySedol && sedol && previous.securitySedol!==sedol)
        previous.securitySedol=null; // one ISIN, multiple listings: no unique SEDOL for this row
      previous.weightPct+=weight;
    }else byIsin.set(key,{
      fundSymbol:symbol,fundIsin:SPYI_ISIN,securitySymbol:isEquity?isin:"OTHER-"+(i+1),
      securityIsin:isEquity?isin:null,securitySedol:isEquity?sedol:null,securityName:name,weightPct:weight,
      kind,asOf,source:"State Street official daily SPYI XLSX; "+asOf,
    });
    seen++;
    total+=weight;
  }
  if(seen<10||total<90||total>101)
    throw new RangeError("SPDR složení je neúplné nebo má nesprávné jednotky vah; součet "+total.toFixed(3)+" %.");
  // Source may be rounded at 4+ decimals; preserve small cash/unknown
  // remainder rather than manufacture equities or distribute the shortfall.
  const rows=[...byIsin.values()];
  if(total>100){
    if(total>100.2)throw new RangeError("SPDR váhy překračují 100 %.");
    // Total can exceed 100 slightly due rounding; normalize the
    // display basket uniformly so the reporting engine conserves value.
    for(const row of rows)row.weightPct*=100/total;
  }
  validateXRayConstituents(rows);
  return rows;
}
type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
type Cached={rows:XRayConstituent[];fetchedAt:string;expiresAt:number};
const CACHE=new Map<string,Cached>();
export async function fetchSpyiHoldings(symbol:string,force=false,fetchImpl:FetchLike=fetch){
  const old=CACHE.get(SPYI_ISIN),now=Date.now();
  if(!force&&old&&old.expiresAt>now)return {
    rows:old.rows.map(r=>({...r,fundSymbol:symbol})),fetchedAt:old.fetchedAt,
    cached:true,sourceUrl:SPYI_OFFICIAL_URL,
  };
  const response=await fetchImpl(SPYI_OFFICIAL_URL,{
    headers:{"Accept":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    signal:AbortSignal.timeout(15_000),cache:"no-store",redirect:"follow",
  });
  if(!response.ok)throw new Error("HTTP "+response.status+" při získávání SPDR holdings.");
  if(response.url&&new URL(response.url).hostname!=="www.ssga.com")
    throw new RangeError("SPDR přesměroval mimo oficiální doménu.");
  const len=Number(response.headers.get("content-length"));
  if(len>16*1024*1024)throw new RangeError("SPDR XLSX je příliš velké.");
  const bytes=new Uint8Array(await response.arrayBuffer());
  const rows=parseSpyiXlsx(bytes,symbol);
  const fetchedAt=new Date().toISOString();
  CACHE.set(SPYI_ISIN,{rows,expiresAt:Date.now()+12*3600*1000,fetchedAt});
  return {rows,fetchedAt,cached:false,sourceUrl:SPYI_OFFICIAL_URL};
}
