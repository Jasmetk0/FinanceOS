import type {
  XRayConstituent,XRayFundCoverage,XRayResult,
} from "./engine.ts";
import {
  XRAY_EQUITY_SECTORS,isXRaySector,type XRayEquitySector,
} from "./sector-labels.ts";

/**
 * Industry/sector attribution uses ONLY the selected physical issuer rows
 * with an explicit recognized sector label. The input is the SAME
 * constituents array used by calculateXRay, not a second external feed.
 *
 * No ticker-based sector inference. Unknown Vanguard sectors, a stale
 * rejected snapshot, collateral, a synthetic proxy, crypto and unmatched
 * direct holdings remain unclassified, yet stay in the denominator.
 */
export interface XRaySectorExposure {
  sector:XRayEquitySector;
  directCzk:number;
  viaEtfCzk:number;
  totalCzk:number;
  portfolioPct:number;
}
export interface XRaySectorFundAudit {
  isin:string;
  symbol:string;
  valueCzk:number;
  classifiedCzk:number;
  unclassifiedCzk:number;
  classifiedPct:number;
  asOf:string|null;
  source:string|null;
}
export interface XRaySectorResult {
  denominatorCzk:number;
  classifiedCzk:number;
  classifiedPct:number;
  unclassifiedCzk:number;
  directUnclassifiedCzk:number;
  fundUnclassifiedCzk:number;
  /** SUBSET of fundUnclassifiedCzk, never added twice. */
  modelProxyUnclassifiedCzk:number;
  directMatchedIsins:number;
  sectors:XRaySectorExposure[];
  funds:XRaySectorFundAudit[];
}
const eps=(v:number)=>Math.max(1e-6,Math.abs(v)*1e-10);
const pct=(part:number,total:number)=>total>0?100*part/total:0;
const sum=<T,>(rows:T[],fn:(row:T)=>number)=>rows.reduce((a,b)=>a+fn(b),0);
const keyOf=(s:string)=>s.trim().toUpperCase();
const official=(source:string)=>source.startsWith("iShares official holdings (") ||
  source.startsWith("State Street official daily SPYI XLSX; ");
type SectorTotals={directCzk:number;viaEtfCzk:number};
type DirectLookup=XRayEquitySector|"conflicting";

export function calculateXRaySectorExposure(
  report:XRayResult,selectedConstituents:XRayConstituent[],
):XRaySectorResult {
  const denominatorCzk=report.denominatorCzk;
  if(!Number.isFinite(denominatorCzk)||denominatorCzk<0 ||
     !Number.isFinite(report.directCzk)||report.directCzk<0 ||
     !Number.isFinite(report.fundsCzk)||report.fundsCzk<0 ||
     !Number.isFinite(report.mappedCzk)||report.mappedCzk<0 ||
     !Number.isFinite(report.unallocatedCzk)||report.unallocatedCzk<0 ||
     !Number.isFinite(report.estimatedProxyCzk)||report.estimatedProxyCzk<0 ||
     Math.abs(report.directCzk+report.fundsCzk-denominatorCzk)>eps(denominatorCzk) ||
     Math.abs(report.mappedCzk+report.unallocatedCzk-denominatorCzk)>eps(denominatorCzk))
    throw new RangeError("Sektorový přehled nemá vyrovnané portfolio.");

  const constituentsByFund=new Map<string,XRayConstituent[]>();
  for(const row of selectedConstituents) {
    if(!row.fundIsin)continue;
    const id=keyOf(row.fundIsin);
    const list=constituentsByFund.get(id)??[];
    list.push(row);
    constituentsByFund.set(id,list);
  }
  const totals=new Map<XRayEquitySector,SectorTotals>();
  const directLookup=new Map<string,DirectLookup>();
  const fundAudits:XRaySectorFundAudit[]=[];
  let viaClassifiedCzk=0;

  for(const fund of report.funds) {
    if(!Number.isFinite(fund.valueCzk)||fund.valueCzk<0 ||
       !Number.isFinite(fund.mappedCzk)||fund.mappedCzk<0 ||
       !Number.isFinite(fund.unmappedCzk)||fund.unmappedCzk<0 ||
       Math.abs(fund.mappedCzk+fund.unmappedCzk-fund.valueCzk)>eps(fund.valueCzk))
      throw new RangeError("Sektorová expozice nesouhlasí s NAV jednotlivého ETF.");
    const id=keyOf(fund.isin??"");
    const matched=(constituentsByFund.get(id)??[]).filter(row=>
      fund.source!==null&&row.source===fund.source &&
      fund.asOf!==null&&row.asOf===fund.asOf);
    const eligible=fund.source!==null && official(fund.source) &&
      fund.exposureBasis!=="reference-index" &&
      fund.exposureBasis!=="reference-index-proxy" &&
      matched.length>0 &&
      matched.every(r=>r.source===fund.source&&r.asOf===fund.asOf &&
        r.exposureBasis!=="reference-index"&&
        r.exposureBasis!=="reference-index-proxy"&&
        r.exposureBasis!=="substitute-basket");
    let classifiedCzk=0;
    if(eligible){
      for(const row of matched){
        if(row.kind!=="stock"||!isXRaySector(row.sector)||row.weightPct<=0)continue;
        const part=fund.valueCzk*row.weightPct/100;
        if(!Number.isFinite(part)||part<0)
          throw new RangeError("Neplatná částka zdrojem deklarovaného sektoru.");
        const total=totals.get(row.sector)??{directCzk:0,viaEtfCzk:0};
        total.viaEtfCzk+=part;
        totals.set(row.sector,total);
        classifiedCzk+=part;
        // Direct investments are assigned ONLY with the same exact issuer
        // ISIN and only when all usable fund sources agree on its sector.
        if(row.securityIsin){
          const security=keyOf(row.securityIsin);
          const known=directLookup.get(security);
          if(known===undefined)directLookup.set(security,row.sector);
          else if(known!==row.sector)directLookup.set(security,"conflicting");
        }
      }
      if(classifiedCzk>fund.mappedCzk+eps(fund.valueCzk))
        throw new RangeError("Deklarované sektory převýšily skutečný rozklad ETF.");
    }
    viaClassifiedCzk+=classifiedCzk;
    fundAudits.push({
      isin:id,symbol:fund.symbol,valueCzk:fund.valueCzk,
      classifiedCzk,unclassifiedCzk:Math.max(0,fund.valueCzk-classifiedCzk),
      classifiedPct:pct(classifiedCzk,fund.valueCzk),
      asOf:fund.asOf,source:fund.source,
    });
  }
  const knownDirectIsins=new Set<string>();
  let directClassifiedCzk=0;
  for(const item of report.exposures){
    if(item.directCzk<=0||item.kind!=="stock"||
       !/^stock\|isin:[A-Z]{2}[A-Z0-9]{10}$/.test(item.key))continue;
    const security=item.key.slice("stock|isin:".length);
    const sector=directLookup.get(security);
    if(!sector||sector==="conflicting")continue;
    directClassifiedCzk+=item.directCzk;
    knownDirectIsins.add(security);
    const total=totals.get(sector)??{directCzk:0,viaEtfCzk:0};
    total.directCzk+=item.directCzk;
    totals.set(sector,total);
  }
  const classifiedCzk=viaClassifiedCzk+directClassifiedCzk;
  const directUnclassifiedCzk=report.directCzk-directClassifiedCzk;
  const fundUnclassifiedCzk=report.fundsCzk-viaClassifiedCzk;
  const unclassifiedCzk=denominatorCzk-classifiedCzk;
  if(directUnclassifiedCzk< -eps(denominatorCzk)||
     fundUnclassifiedCzk< -eps(denominatorCzk)||
     report.estimatedProxyCzk>fundUnclassifiedCzk+eps(denominatorCzk)||
     Math.abs(sum(fundAudits,f=>f.valueCzk)-report.fundsCzk)>eps(denominatorCzk)||
     Math.abs(classifiedCzk+directUnclassifiedCzk+fundUnclassifiedCzk-denominatorCzk)>eps(denominatorCzk))
    throw new RangeError("Sektory nelze bez ztráty hodnoty přiřadit k X-Ray NAV.");

  const sectors=XRAY_EQUITY_SECTORS.map(sector=>{
    const v=totals.get(sector)??{directCzk:0,viaEtfCzk:0};
    const totalCzk=v.directCzk+v.viaEtfCzk;
    return {sector,directCzk:v.directCzk,viaEtfCzk:v.viaEtfCzk,
      totalCzk,portfolioPct:pct(totalCzk,denominatorCzk)};
  }).filter(x=>x.totalCzk>0).sort((a,b)=>
    b.totalCzk-a.totalCzk||a.sector.localeCompare(b.sector));
  if(Math.abs(sum(sectors,row=>row.totalCzk)-classifiedCzk)>eps(denominatorCzk))
    throw new RangeError("Součet sektorů se neshoduje s klasifikovaným NAV.");
  return {
    denominatorCzk,classifiedCzk,classifiedPct:pct(classifiedCzk,denominatorCzk),
    unclassifiedCzk:Math.max(0,unclassifiedCzk),
    directUnclassifiedCzk:Math.max(0,directUnclassifiedCzk),
    fundUnclassifiedCzk:Math.max(0,fundUnclassifiedCzk),
    modelProxyUnclassifiedCzk:report.estimatedProxyCzk,
    directMatchedIsins:knownDirectIsins.size,
    sectors,funds:fundAudits.sort((a,b)=>b.valueCzk-a.valueCzk),
  };
}
