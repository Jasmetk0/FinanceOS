import type { XRayExposure,XRayResult } from "./engine.ts";

/**
 * Concentration based only on actual positive brokerage NAV and the X-Ray
 * look-through allocations. Never renormalize the known slice to 100%.
 * A modelled reference-index proxy is NOT confirmed physical fund holdings.
 */
export type ConcentrationMode="without-proxy"|"including-proxy";
export interface XRayConcentrationPosition {
  key:string;
  kind:XRayExposure["kind"];
  ticker:string;
  name:string;
  directCzk:number;
  viaFundsCzk:number;
  proxyCzk:number;
  withoutProxyCzk:number;
  includingProxyCzk:number;
  directlyHeld:boolean;
  hasFundExposure:boolean;
  identity:"isin"|"sedol"|"unverified"|"crypto";
}
export interface XRayConcentrationView {
  mode:ConcentrationMode;
  positions:Array<XRayConcentrationPosition & {valueCzk:number;weightPct:number}>;
  top1Czk:number;
  top5Czk:number;
  top10Czk:number;
  top1Pct:number;
  top5Pct:number;
  top10Pct:number;
  includedCzk:number;
  includedPct:number;
  countedSecurities:number;
}
export interface XRayConcentrationSummary {
  denominatorCzk:number;
  withoutProxyCzk:number;
  proxyCzk:number;
  unresolvedCzk:number;
  /** Checked conservation: identified non-proxy + proxy + unresolved = original NAV. */
  positions:XRayConcentrationPosition[];
  withoutProxy:XRayConcentrationView;
  includingProxy:XRayConcentrationView;
}

const tol=(amount:number)=>Math.max(1e-6,Math.abs(amount)*1e-10);
const percent=(part:number,total:number)=>total>0?100*part/total:0;
const totalOf=<T,>(rows:T[],value:(row:T)=>number)=>
  rows.reduce((sum,row)=>sum+value(row),0);
function identityOf(row:XRayExposure):XRayConcentrationPosition["identity"] {
  if(row.kind==="crypto")return "crypto";
  if(row.key.startsWith("stock|isin:"))return "isin";
  if(row.key.startsWith("stock|sedol:"))return "sedol";
  return "unverified";
}
function viewOf(
  positions:XRayConcentrationPosition[],
  denominatorCzk:number,mode:ConcentrationMode,
):XRayConcentrationView {
  const selected=positions.map(row=>{
    const valueCzk=mode==="including-proxy"?row.includingProxyCzk:row.withoutProxyCzk;
    return {...row,valueCzk,weightPct:percent(valueCzk,denominatorCzk)};
  }).filter(row=>row.valueCzk>0).sort((a,b)=>
    b.valueCzk-a.valueCzk||a.key.localeCompare(b.key));
  const sumTop=(count:number)=>totalOf(selected.slice(0,count),row=>row.valueCzk);
  const includedCzk=totalOf(selected,row=>row.valueCzk);
  const top1Czk=sumTop(1),top5Czk=sumTop(5),top10Czk=sumTop(10);
  return {
    mode,positions:selected,top1Czk,top5Czk,top10Czk,
    top1Pct:percent(top1Czk,denominatorCzk),
    top5Pct:percent(top5Czk,denominatorCzk),
    top10Pct:percent(top10Czk,denominatorCzk),
    includedCzk,includedPct:percent(includedCzk,denominatorCzk),
    countedSecurities:selected.length,
  };
}
export function calculateXRayConcentration(report:XRayResult):XRayConcentrationSummary {
  const denominatorCzk=report.denominatorCzk;
  if(!Number.isFinite(denominatorCzk)||denominatorCzk<0 ||
     !Number.isFinite(report.unallocatedCzk)||report.unallocatedCzk<0 ||
     !Number.isFinite(report.estimatedProxyCzk)||report.estimatedProxyCzk<0)
    throw new RangeError("Koncentrace vyžaduje platnou nezápornou hodnotu X-Ray.");
  const positions=report.exposures.map(row=>{
    if(!Number.isFinite(row.totalCzk)||row.totalCzk<0 ||
       !Number.isFinite(row.directCzk)||row.directCzk<0 ||
       !Number.isFinite(row.viaFundsCzk)||row.viaFundsCzk<0)
      throw new RangeError("Neplatná jednotlivá expozice při výpočtu koncentrace.");
    const proxyCzk=totalOf(row.fundContributions.filter(c=>
      c.exposureBasis==="reference-index-proxy"),c=>c.valueCzk);
    const withoutProxyCzk=row.totalCzk-proxyCzk;
    if(!Number.isFinite(proxyCzk)||proxyCzk<0 ||
       proxyCzk>row.viaFundsCzk+tol(row.totalCzk) ||
       Math.abs(row.directCzk+row.viaFundsCzk-row.totalCzk)>tol(row.totalCzk) ||
       withoutProxyCzk < -tol(row.totalCzk))
      throw new RangeError("Modelový podíl neodpovídá jednotlivé expozici.");
    return {
      key:row.key,kind:row.kind,ticker:row.ticker,name:row.name,
      directCzk:row.directCzk,viaFundsCzk:row.viaFundsCzk,
      proxyCzk,withoutProxyCzk:Math.max(0,withoutProxyCzk),
      includingProxyCzk:row.totalCzk,
      directlyHeld:row.directCzk>0,hasFundExposure:row.viaFundsCzk>0,
      identity:identityOf(row),
    };
  });
  const proxyCzk=totalOf(positions,row=>row.proxyCzk);
  const withoutProxyCzk=totalOf(positions,row=>row.withoutProxyCzk);
  const mappedCzk=totalOf(positions,row=>row.includingProxyCzk);
  if(Math.abs(proxyCzk-report.estimatedProxyCzk)>tol(denominatorCzk) ||
     Math.abs(mappedCzk-report.mappedCzk)>tol(denominatorCzk) ||
     Math.abs(withoutProxyCzk+proxyCzk+report.unallocatedCzk-denominatorCzk)>tol(denominatorCzk))
    throw new RangeError("Koncentrace nesouhlasí s hodnotou analyzovaného portfolia.");
  return {
    denominatorCzk,withoutProxyCzk,proxyCzk,
    unresolvedCzk:report.unallocatedCzk,positions,
    withoutProxy:viewOf(positions,denominatorCzk,"without-proxy"),
    includingProxy:viewOf(positions,denominatorCzk,"including-proxy"),
  };
}
