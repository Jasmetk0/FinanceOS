/**
 * A fund's ticker alone does not identify its stock share classes.
 *
 * Vanguard GPX provides check-digit-valid SEDOLs but usually no constituent
 * ISIN. State Street's official SPYI XLSX contains both IDs. Its COMPLETE,
 * recent holdings snapshot may serve as an identity dictionary EVEN WHEN
 * the investor does not own SPYI. Reference rows must never contribute NAV.
 */
import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";
import { buildSedolIsinCrosswalk } from "./security-identity.ts";
import { SPYI_ISIN } from "./auto-spyi.ts";
import { VWCE_ISIN, VALL_ISIN } from "./auto-vanguard.ts";

export const IDENTITY_REFERENCE_MAX_AGE_DAYS=14;
const REQUIRED_BRIDGES=100;
const REQUIRED_STOCK_ROWS=500;
const REQUIRED_STOCK_WEIGHT_PCT=85;

export function needsSpyiIdentityReference(
  heldFundIsins:Iterable<string|null|undefined>,
):boolean{
  const isins=new Set([...heldFundIsins].map(s=>(s??"").trim().toUpperCase()));
  return !isins.has(SPYI_ISIN)&&(isins.has(VWCE_ISIN)||isins.has(VALL_ISIN));
}
export function assertSpyiIdentityReference(
  rows:XRayConstituent[],nowMs=Date.now(),
):{asOf:string;bridges:number;stocks:number}{
  validateXRayConstituents(rows);
  if(!Number.isFinite(nowMs)||rows.length<REQUIRED_STOCK_ROWS||
     rows.some(r=>r.fundIsin!==SPYI_ISIN ||
       !r.source.startsWith("State Street official daily SPYI XLSX; ") ||
       r.exposureBasis==="reference-index" || r.exposureBasis==="reference-index-proxy" ||
       r.exposureBasis==="substitute-basket")){
    throw new RangeError("Identifikační reference SPYI není kompletní nebo nemá důvěryhodný původ.");
  }
  const days=new Set(rows.map(r=>r.asOf));
  if(days.size!==1||!/^\d{4}-\d{2}-\d{2}$/.test(rows[0].asOf))
    throw new RangeError("Referenční SPYI nemá jednotné platné datum.");
  const asOf=rows[0].asOf,t=Date.parse(asOf+"T00:00:00Z");
  if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==asOf||
     (nowMs-t)/86_400_000>IDENTITY_REFERENCE_MAX_AGE_DAYS||
     (nowMs-t)/86_400_000< -1){
    throw new RangeError("Identifikační seznam SPYI je zastaralý nebo má datum v budoucnosti.");
  }
  const stocks=rows.filter(x=>x.kind==="stock"&&x.weightPct>0);
  const stockPct=stocks.reduce((sum,x)=>sum+x.weightPct,0);
  const crosswalk=buildSedolIsinCrosswalk(rows);
  if(stocks.length<REQUIRED_STOCK_ROWS||stockPct<REQUIRED_STOCK_WEIGHT_PCT||
     crosswalk.linkedCount<REQUIRED_BRIDGES){
    throw new RangeError("Identifikační seznam SPYI neobsahuje dostatek ověřených SEDOL↔ISIN.");
  }
  return {asOf,bridges:crosswalk.linkedCount,stocks:stocks.length};
}
