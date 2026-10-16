/**
 * Portfolio X-Ray: financially reconciled priorities for missing issuer coverage.
 * This reports UNKNOWN look-through, not guessed constituents or new NAV.
 */
import type {XRayResult,XRayFundCoverage} from "./engine.ts";
import {fundInsightForIsin} from "./fund-insights.ts";

export type CoverageStatus="missing"|"partial"|"proxy"|"index"|"non-equity"|"covered";

export interface CoveragePriority {
  isin:string|null;
  symbol:string;
  valueCzk:number;
  mappedCzk:number;
  unmappedCzk:number;
  mappedPct:number;
  priorityCzk:number;
  status:CoverageStatus;
  explanation:string;
  issuerUrl:string|null;
  asOf:string|null;
  source:string|null;
}
export interface CoveragePriorities {
  denominatorCzk:number;
  fundsCzk:number;
  fundMappedCzk:number;
  fundUnmappedCzk:number;
  proxyMappedCzk:number;
  indexMappedCzk:number;
  structuralCzk:number;
  /** Ranked attention, NOT another component of the portfolio NAV. */
  priorityCzk:number;
  rows:CoveragePriority[];
}
const sum=<T,>(rows:readonly T[],fn:(row:T)=>number)=>rows.reduce((v,r)=>v+fn(r),0);
const eps=(n:number)=>Math.max(1e-6,Math.abs(n)*1e-10);
const valid=(n:number)=>Number.isFinite(n)&&n>=0;

function classify(fund:XRayFundCoverage):Pick<CoveragePriority,"status"|"priorityCzk"|"explanation"|"issuerUrl"> {
  const insight=fundInsightForIsin(fund.isin);
  const issuerUrl=insight?.issuerUrl??null;
  // Metal and leveraged products are not ordinary spot securities. Their
  // unallocated NAV must not be advertised as missing common stocks.
  if((insight?.structure==="physical-gold"||insight?.structure==="leveraged-crypto") &&
     fund.mappedCzk<=eps(fund.valueCzk))
    return {status:"non-equity",priorityCzk:0,issuerUrl,
      explanation:"Jiný typ produktu, nikoli akciový rozklad ani přímo držené spot krypto. "+
        insight.explanation};
  if(fund.exposureBasis==="reference-index-proxy")
    return {status:"proxy",priorityCzk:fund.valueCzk,issuerUrl,
      explanation:"Akcie jsou pouze model podle CNDX, nikoli přesné váhy indexu LYMS. "+
        "Celou hodnotu fondu je potřeba posuzovat jako odhad, i když je rozložena."};
  if(fund.exposureBasis==="reference-index")
    return {status:"index",priorityCzk:fund.valueCzk,issuerUrl,
      explanation:"Ekonomický referenční index není fyzický koš akcií fondu. "+
        "Zkontroluj původ a datum zveřejněných indexových vah."};
  if(fund.mappedCzk<=eps(fund.valueCzk))
    return {status:"missing",priorityCzk:fund.unmappedCzk,issuerUrl,
      explanation:fund.isin ?
        "Nejsou použity identifikované podklady. Ověř automatický zdroj podle ISIN; "+
        "pokud neexistuje, lze volitelně dodat originální seznam od emitenta.":
        "Fondu chybí ISIN. Nejprve aktualizuj instrumenty z brokera, "+
        "ticker není bezpečný identifikátor podkladů."};
  if(fund.unmappedCzk>eps(fund.valueCzk))
    return {status:"partial",priorityCzk:fund.unmappedCzk,issuerUrl,
      explanation:"Neidentifikovaná hodnota může znamenat chybějící akcie, ale také "+
        "hotovost, dluhopisy nebo deriváty. Nelze ji automaticky převést na akcie."};
  return {status:"covered",priorityCzk:0,issuerUrl,
    explanation:"Celé aktuálně evidované NAV je rozloženo v toleranci zaokrouhlení. "+
      "Váhy podkladů mohou pocházet ze staršího data než hodnota fondu."};
}

export function calculateXRayCoveragePriorities(report:XRayResult):CoveragePriorities {
  if(!valid(report.denominatorCzk)||!valid(report.fundsCzk)||
     !valid(report.directCzk)||!valid(report.mappedCzk)||
     !valid(report.unallocatedCzk)||!valid(report.estimatedProxyCzk)||
     Math.abs(report.directCzk+report.fundsCzk-report.denominatorCzk)>eps(report.denominatorCzk)||
     Math.abs(report.mappedCzk+report.unallocatedCzk-report.denominatorCzk)>eps(report.denominatorCzk))
    throw new RangeError("X-Ray nemá vyrovnanou hodnotu portfolia.");
  const identities=new Set<string>();
  for(const f of report.funds){
    if(!valid(f.valueCzk)||!valid(f.mappedCzk)||!valid(f.unmappedCzk)||
       !Number.isFinite(f.mappedPct)||f.mappedPct<0||f.mappedPct>100+1e-7||
       Math.abs(f.mappedCzk+f.unmappedCzk-f.valueCzk)>eps(f.valueCzk)||
       Math.abs((f.valueCzk?100*f.mappedCzk/f.valueCzk:0)-f.mappedPct)>1e-6)
      throw new RangeError("Nesouhlasí rozklad jednotlivého ETF.");
    const key=f.isin?"isin:"+f.isin.trim().toUpperCase():"symbol:"+f.symbol.trim().toUpperCase();
    if(!key.split(":")[1]||identities.has(key))
      throw new RangeError("Duplicitní nebo chybějící identita ETF.");
    identities.add(key);
  }
  const rows:CoveragePriority[]=report.funds.map(f=>({
    isin:f.isin,symbol:f.symbol,valueCzk:f.valueCzk,mappedCzk:f.mappedCzk,
    unmappedCzk:f.unmappedCzk,mappedPct:f.mappedPct,asOf:f.asOf,source:f.source,
    ...classify(f),
  })).sort((a,b)=>b.priorityCzk-a.priorityCzk||b.unmappedCzk-a.unmappedCzk||
    b.valueCzk-a.valueCzk||a.symbol.localeCompare(b.symbol));
  const fundsCzk=sum(rows,r=>r.valueCzk);
  const fundMappedCzk=sum(rows,r=>r.mappedCzk);
  const fundUnmappedCzk=sum(rows,r=>r.unmappedCzk);
  const proxyMappedCzk=sum(rows,r=>r.status==="proxy"?r.mappedCzk:0);
  const indexMappedCzk=sum(rows,r=>r.status==="index"?r.mappedCzk:0);
  const structuralCzk=sum(rows,r=>r.status==="non-equity"?r.valueCzk:0);
  const priorityCzk=sum(rows,r=>r.priorityCzk);
  if(Math.abs(fundsCzk-report.fundsCzk)>eps(report.fundsCzk)||
     Math.abs(report.directCzk+fundMappedCzk-report.mappedCzk)>eps(report.denominatorCzk)||
     Math.abs(fundUnmappedCzk-report.unallocatedCzk)>eps(report.denominatorCzk)||
     Math.abs(proxyMappedCzk-report.estimatedProxyCzk)>eps(report.denominatorCzk)||
     Math.abs(fundMappedCzk+fundUnmappedCzk-fundsCzk)>eps(fundsCzk)||
     priorityCzk>fundsCzk+eps(fundsCzk))
    throw new RangeError("Priority neodpovídají skutečnému NAV či proxy rozkladu.");
  return {denominatorCzk:report.denominatorCzk,fundsCzk,fundMappedCzk,fundUnmappedCzk,
    proxyMappedCzk,indexMappedCzk,structuralCzk,priorityCzk,rows};
}
