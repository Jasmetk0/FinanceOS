/**
 * Real issuer probe summary. It does not fake a fund being operational just
 * because HTTP responds: the SAME production parser must return complete
 * and internally consistent constituent data before the status is "healthy".
 */
import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";
import { classifyIssuerDate } from "./issuer-reliability.ts";

export type IssuerHealthState = "healthy" | "aging" | "stale" | "partial" | "failed";
export interface IssuerHealthRecord {
  provider: "iShares" | "Vanguard" | "State Street";
  name: string;
  isin: string;
  symbol: string;
  state: IssuerHealthState;
  checkedAt: string;
  elapsedMs: number;
  fetchedAt: string | null;
  asOf: string | null;
  ageDays: number | null;
  holdings: number;
  stockPct: number;
  otherPct: number;
  uncoveredPct: number;
  sourceUrl: string;
  error: string | null;
}
export interface IssuerHealthTarget {
  provider: IssuerHealthRecord["provider"];
  name: string;
  isin: string;
  symbol: string;
  sourceUrl: string;
}
export interface HealthFetchResult {
  rows: XRayConstituent[];
  fetchedAt: string;
  sourceUrl: string;
}

const round=(number:number)=>Math.round(number*10_000)/10_000;
const errorText=(error:unknown):string=>{
  const raw=error instanceof Error?error.message:String(error);
  // Untrusted HTTP / parse exception text can be long or contain newlines:
  // return only a limited textual description, never private request headers.
  return raw.replace(/[\r\n\t]/g," ").slice(0,260);
};

/** Supports deterministic synthetic read functions in regression tests. */
export async function probeIssuer(
  target:IssuerHealthTarget,
  read:()=>Promise<HealthFetchResult>,
  now:()=>number=Date.now,
):Promise<IssuerHealthRecord> {
  const begin=now();
  const checkedAt=new Date(begin).toISOString();
  const base={
    provider:target.provider,name:target.name,isin:target.isin,
    symbol:target.symbol,checkedAt,sourceUrl:target.sourceUrl,
  };
  try {
    const response=await read();
    const rows=response.rows;
    validateXRayConstituents(rows);
    if(rows.length<10 || rows.some(row=>row.fundIsin!==target.isin || row.fundSymbol!==target.symbol)) {
      throw new RangeError("Zdroj nevrátil úplné podklady očekávaného ETF.");
    }
    const dates=[...new Set(rows.map(r=>r.asOf))];
    if(dates.length!==1 || !dates[0])throw new RangeError("Zdroj nemá jednoznačné datum složení.");
    const date=classifyIssuerDate(dates[0],now());
    if(date.state==="unknown" || date.state==="future" || (date.ageDays??0)<0)
      throw new RangeError("Neplatné nebo budoucí datum podkladů.");
    if(response.sourceUrl!==target.sourceUrl)throw new RangeError("Zdroj dat není whitelistovaný emitent.");
    const stock=rows.filter(r=>r.kind==="stock").reduce((total,r)=>total+r.weightPct,0);
    const crypto=rows.filter(r=>r.kind==="crypto").reduce((total,r)=>total+r.weightPct,0);
    const other=rows.filter(r=>r.kind==="other").reduce((total,r)=>total+r.weightPct,0);
    const total=stock+crypto+other;
    const missing=Math.max(0,100-total);
    // Under 98% total coverage: the parser returned a numerically valid
    // but incomplete snapshot; show PARTIAL instead of giving green status.
    const state:IssuerHealthState=total<98 ? "partial" :
      date.state==="stale" ? "stale" :
      date.state==="aging" ? "aging" : "healthy";
    return {...base,state,fetchedAt:response.fetchedAt,
      asOf:dates[0],ageDays:date.ageDays,holdings:rows.length,
      stockPct:round(stock),otherPct:round(other+crypto),
      uncoveredPct:round(missing),elapsedMs:Math.max(0,now()-begin),error:null};
  } catch(error) {
    return {...base,state:"failed",fetchedAt:null,asOf:null,ageDays:null,
      holdings:0,stockPct:0,otherPct:0,uncoveredPct:100,
      elapsedMs:Math.max(0,now()-begin),error:errorText(error)};
  }
}
