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
  /** Portion explicitly classified in the physical ETF issuer's own holdings rows. */
  viaIssuerCzk:number;
  /** Portion safely transferred from another owned physical ETF via exact share-class ISIN. */
  viaVerifiedIsinCzk:number;
  totalCzk:number;
  portfolioPct:number;
}
export interface XRaySectorFundAudit {
  isin:string;
  symbol:string;
  valueCzk:number;
  classifiedCzk:number;
  issuerClassifiedCzk:number;
  verifiedIsinClassifiedCzk:number;
  unclassifiedCzk:number;
  classifiedPct:number;
  asOf:string|null;
  source:string|null;
}
export interface XRaySectorResult {
  denominatorCzk:number;
  classifiedCzk:number;
  issuerClassifiedCzk:number;
  verifiedIsinClassifiedCzk:number;
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
type SectorTotals={directCzk:number;viaEtfCzk:number;viaIssuerCzk:number;viaVerifiedIsinCzk:number};
const emptyTotals=():SectorTotals=>({directCzk:0,viaEtfCzk:0,viaIssuerCzk:0,viaVerifiedIsinCzk:0});
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
  // Sector labels are security-level facts, but only issuer-verified, held,
  // accepted physical holdings may attest them. Cross-fund propagation is
  // limited to EXACT same ISIN after X-Ray has already resolved SEDOL bridges.
  // A conflicted security ISIN is not classified anywhere by this bridge.
  const sectorEvidence=new Map<string,DirectLookup>();
  for(const fund of report.funds){
    const rows=(constituentsByFund.get(keyOf(fund.isin??""))??[]);
    if(!fund.source||!fund.asOf||!official(fund.source)||fund.mappedCzk<=0||
       fund.exposureBasis==="reference-index"||
       fund.exposureBasis==="reference-index-proxy")continue;
    const accepted=rows.filter(r=>r.source===fund.source&&r.asOf===fund.asOf);
    if(!accepted.length || accepted.some(r=>
      r.exposureBasis==="reference-index"||
      r.exposureBasis==="reference-index-proxy"||
      r.exposureBasis==="substitute-basket"))continue;
    for(const row of accepted) {
      if(row.kind!=="stock"||!isXRaySector(row.sector)||!row.securityIsin)continue;
      const isin=keyOf(row.securityIsin);
      const previous=sectorEvidence.get(isin);
      if(previous===undefined)sectorEvidence.set(isin,row.sector);
      else if(previous!==row.sector)sectorEvidence.set(isin,"conflicting");
    }
  }
  const totals=new Map<XRayEquitySector,SectorTotals>();
  const fundAudits:XRaySectorFundAudit[]=[];
  let viaClassifiedCzk=0;
  let issuerClassifiedCzk=0,verifiedIsinClassifiedCzk=0;

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
    const eligible=fund.mappedCzk>0 && fund.source!==null && official(fund.source) &&
      fund.exposureBasis!=="reference-index" &&
      fund.exposureBasis!=="reference-index-proxy" &&
      matched.length>0 &&
      matched.every(r=>r.source===fund.source&&r.asOf===fund.asOf &&
        r.exposureBasis!=="reference-index"&&
        r.exposureBasis!=="reference-index-proxy"&&
        r.exposureBasis!=="substitute-basket");
    let classifiedCzk=0,issuerFundCzk=0,verifiedIsinFundCzk=0;
    if(eligible){
      for(const row of matched){
        if(row.kind!=="stock"||!isXRaySector(row.sector)||row.weightPct<=0)continue;
        const part=fund.valueCzk*row.weightPct/100;
        if(!Number.isFinite(part)||part<0)
          throw new RangeError("Neplatná částka zdrojem deklarovaného sektoru.");
        const total=totals.get(row.sector)??emptyTotals();
        total.viaEtfCzk+=part;
        total.viaIssuerCzk+=part;
        totals.set(row.sector,total);
        classifiedCzk+=part;
        issuerFundCzk+=part;

      }
      if(classifiedCzk>fund.mappedCzk+eps(fund.valueCzk))
        throw new RangeError("Deklarované sektory převýšily skutečný rozklad ETF.");
    }
    // A Vanguard / other held ETF may lack its own sector column.
    // Attribute ONLY already-valued X-Ray fund contributions with an exact
    // resolved security ISIN, and never reclassify an issuer-covered fund.
    // We deliberately do not infer from ticker, company, or SEDOL alone.
    if(!eligible && id && fund.valueCzk>0 && fund.mappedCzk>0){
      for(const exposure of report.exposures){
        if(exposure.kind!=="stock"||
           !/^stock\|isin:[A-Z]{2}[A-Z0-9]{10}$/.test(exposure.key))continue;
        const sector=sectorEvidence.get(exposure.key.slice("stock|isin:".length));
        if(!sector||sector==="conflicting")continue;
        for(const contribution of exposure.fundContributions){
          if(keyOf(contribution.fundIsin??"")!==id ||
             contribution.exposureBasis==="reference-index" ||
             contribution.exposureBasis==="reference-index-proxy")continue;
          const part=contribution.valueCzk;
          if(!Number.isFinite(part)||part<0)
            throw new RangeError("Neplatný převzatý sektorový příspěvek ETF.");
          classifiedCzk+=part;
          verifiedIsinFundCzk+=part;
          const total=totals.get(sector)??emptyTotals();
          total.viaEtfCzk+=part;
          total.viaVerifiedIsinCzk+=part;
          totals.set(sector,total);
        }
      }
      if(classifiedCzk>fund.mappedCzk+eps(fund.valueCzk))
        throw new RangeError("Přenesená sektorová identita přesáhla rozklad ETF.");
    }
    if(Math.abs(issuerFundCzk+verifiedIsinFundCzk-classifiedCzk)>eps(fund.valueCzk))
      throw new RangeError("Nesouhlasí původ sektorové klasifikace ETF.");
    viaClassifiedCzk+=classifiedCzk;
    issuerClassifiedCzk+=issuerFundCzk;
    verifiedIsinClassifiedCzk+=verifiedIsinFundCzk;
    fundAudits.push({
      isin:id,symbol:fund.symbol,valueCzk:fund.valueCzk,
      classifiedCzk,issuerClassifiedCzk:issuerFundCzk,
      verifiedIsinClassifiedCzk:verifiedIsinFundCzk,
      unclassifiedCzk:Math.max(0,fund.valueCzk-classifiedCzk),
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
    const sector=sectorEvidence.get(security);
    if(!sector||sector==="conflicting")continue;
    directClassifiedCzk+=item.directCzk;
    knownDirectIsins.add(security);
    const total=totals.get(sector)??emptyTotals();
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
    const v=totals.get(sector)??emptyTotals();
    const totalCzk=v.directCzk+v.viaEtfCzk;
    return {sector,directCzk:v.directCzk,viaEtfCzk:v.viaEtfCzk,
      viaIssuerCzk:v.viaIssuerCzk,viaVerifiedIsinCzk:v.viaVerifiedIsinCzk,
      totalCzk,portfolioPct:pct(totalCzk,denominatorCzk)};
  }).filter(x=>x.totalCzk>0).sort((a,b)=>
    b.totalCzk-a.totalCzk||a.sector.localeCompare(b.sector));
  if(Math.abs(sum(sectors,row=>row.totalCzk)-classifiedCzk)>eps(denominatorCzk) ||
     Math.abs(sum(sectors,row=>row.viaIssuerCzk)-issuerClassifiedCzk)>eps(denominatorCzk) ||
     Math.abs(sum(sectors,row=>row.viaVerifiedIsinCzk)-verifiedIsinClassifiedCzk)>eps(denominatorCzk) ||
     Math.abs(issuerClassifiedCzk+verifiedIsinClassifiedCzk-viaClassifiedCzk)>eps(denominatorCzk) ||
     Math.abs(sum(fundAudits,f=>f.issuerClassifiedCzk)-issuerClassifiedCzk)>eps(denominatorCzk) ||
     Math.abs(sum(fundAudits,f=>f.verifiedIsinClassifiedCzk)-verifiedIsinClassifiedCzk)>eps(denominatorCzk) ||
     sectors.some(row=>Math.abs(row.viaIssuerCzk+row.viaVerifiedIsinCzk-row.viaEtfCzk)>eps(row.viaEtfCzk)))
    throw new RangeError("Součet sektorů či jejich původ nesouhlasí s klasifikovaným NAV.");
  return {
    denominatorCzk,classifiedCzk,issuerClassifiedCzk,verifiedIsinClassifiedCzk,
    classifiedPct:pct(classifiedCzk,denominatorCzk),
    unclassifiedCzk:Math.max(0,unclassifiedCzk),
    directUnclassifiedCzk:Math.max(0,directUnclassifiedCzk),
    fundUnclassifiedCzk:Math.max(0,fundUnclassifiedCzk),
    modelProxyUnclassifiedCzk:report.estimatedProxyCzk,
    directMatchedIsins:knownDirectIsins.size,
    sectors,funds:fundAudits.sort((a,b)=>b.valueCzk-a.valueCzk),
  };
}
