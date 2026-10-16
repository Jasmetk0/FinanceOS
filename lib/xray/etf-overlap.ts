import type { XRayFundCoverage,XRayResult,XRayExposure } from "./engine.ts";

/**
 * Only stable issuer/broker security identities are eligible to demonstrate
 * two ETF portfolios share a security. Ticker-only and fund-scoped symbols
 * are deliberately excluded, even if their names are identical.
 *
 * Financial weights use each ACTUAL held ETF NAV; modelled proxy data may
 * be shown separately but never counts as verified physical holdings.
 */
export type XRayOverlapMode="without-proxy"|"including-proxy";
export interface XRayOverlapFund {
  isin:string;
  symbol:string;
  valueCzk:number;
  asOf:string|null;
  source:string|null;
  knownIdentityCzk:number;
  knownIdentityPct:number;
  /** Unknown identities, unallocated assets and excluded proxy in this mode. */
  notComparableCzk:number;
}
export interface XRaySharedStock {
  key:string;
  ticker:string;
  name:string;
  leftCzk:number;
  rightCzk:number;
  /** Combined exposure from BOTH held ETF positions, not excess ownership. */
  combinedExposureCzk:number;
  leftFundPct:number;
  rightFundPct:number;
  identity:"isin"|"sedol";
}
export interface XRayFundPairOverlap {
  left:XRayOverlapFund;
  right:XRayOverlapFund;
  sharedIdentities:number;
  sharedIsins:number;
  sharedSedols:number;
  /** Sum of min(stock weight in fund A, stock weight in fund B). */
  commonWeightPct:number;
  /** Economic value of matching stocks in BOTH holdings; no extra NAV added. */
  combinedSharedCzk:number;
  sharedStocks:XRaySharedStock[];
}
export interface XRayOverlapView {
  mode:XRayOverlapMode;
  funds:XRayOverlapFund[];
  pairs:XRayFundPairOverlap[];
  pairsWithConfirmedOverlap:number;
}
export interface XRayOverlapResult {
  denominatorCzk:number;
  excludedUnknownIsinFunds:number;
  withoutProxy:XRayOverlapView;
  includingProxy:XRayOverlapView;
}
type StockEvidence={key:string;ticker:string;name:string;czk:number;isProxy:boolean;identity:"isin"|"sedol"};
type FundBucket={coverage:XRayFundCoverage;stocks:StockEvidence[]};

const eq=(a:number,b:number,scale:number)=>Math.abs(a-b)<=Math.max(1e-6,scale*1e-10);
const validNumber=(value:number)=>Number.isFinite(value)&&value>=0;
const ratio=(part:number,total:number)=>total>0?100*part/total:0;
const fundKey=(isin:string)=>isin.trim().toUpperCase();
function identified(row:XRayExposure):"isin"|"sedol"|null {
  if(row.kind!=="stock")return null;
  if(/^stock\|isin:[A-Z]{2}[A-Z0-9]{10}$/.test(row.key))return "isin";
  if(/^stock\|sedol:[A-Z0-9]{7}$/.test(row.key))return "sedol";
  return null;
}
function selectedStocks(bucket:FundBucket,mode:XRayOverlapMode):
  {fund:XRayOverlapFund;stocks:Map<string,StockEvidence>} {
  const valueCzk=bucket.coverage.valueCzk;
  const map=new Map<string,StockEvidence>();
  for(const stock of bucket.stocks){
    if(mode==="without-proxy"&&stock.isProxy)continue;
    const previous=map.get(stock.key);
    if(previous){
      previous.czk+=stock.czk;
    }else map.set(stock.key,{...stock});
  }
  const knownIdentityCzk=[...map.values()].reduce((v,s)=>v+s.czk,0);
  if(knownIdentityCzk>valueCzk+Math.max(1e-6,valueCzk*1e-10))
    throw new RangeError("Spárované podklady přesahují hodnotu drženého ETF.");
  const fund:XRayOverlapFund={
    isin:fundKey(bucket.coverage.isin??""),
    symbol:bucket.coverage.symbol,valueCzk,
    asOf:bucket.coverage.asOf,source:bucket.coverage.source,
    knownIdentityCzk,knownIdentityPct:ratio(knownIdentityCzk,valueCzk),
    notComparableCzk:Math.max(0,valueCzk-knownIdentityCzk),
  };
  return {fund,stocks:map};
}
function pairOf(
  left:{fund:XRayOverlapFund;stocks:Map<string,StockEvidence>},
  right:{fund:XRayOverlapFund;stocks:Map<string,StockEvidence>},
):XRayFundPairOverlap {
  const sharedStocks:XRaySharedStock[]=[];
  const [smaller,larger]=left.stocks.size<=right.stocks.size?
    [left.stocks,right.stocks]:[right.stocks,left.stocks];
  const firstIsLeft=smaller===left.stocks;
  for(const [key,item] of smaller){
    const other=larger.get(key);
    if(!other)continue;
    const leftCzk=firstIsLeft?item.czk:other.czk;
    const rightCzk=firstIsLeft?other.czk:item.czk;
    if(leftCzk<=0||rightCzk<=0)continue;
    sharedStocks.push({
      key,ticker:item.ticker,name:item.name,leftCzk,rightCzk,
      combinedExposureCzk:leftCzk+rightCzk,
      leftFundPct:ratio(leftCzk,left.fund.valueCzk),
      rightFundPct:ratio(rightCzk,right.fund.valueCzk),
      identity:item.identity,
    });
  }
  sharedStocks.sort((a,b)=>b.combinedExposureCzk-a.combinedExposureCzk||a.key.localeCompare(b.key));
  const commonWeightPct=sharedStocks.reduce((sum,row)=>
    sum+Math.min(row.leftFundPct,row.rightFundPct),0);
  const combinedSharedCzk=sharedStocks.reduce((sum,row)=>
    sum+row.combinedExposureCzk,0);
  if(commonWeightPct>100+1e-6 ||
     combinedSharedCzk>left.fund.valueCzk+right.fund.valueCzk+1e-6)
    throw new RangeError("Překryv ETF překročil fyzicky možnou hodnotu NAV.");
  return {
    left:left.fund,right:right.fund,
    sharedIdentities:sharedStocks.length,
    sharedIsins:sharedStocks.filter(x=>x.identity==="isin").length,
    sharedSedols:sharedStocks.filter(x=>x.identity==="sedol").length,
    commonWeightPct,combinedSharedCzk,sharedStocks,
  };
}
function calculateMode(buckets:FundBucket[],mode:XRayOverlapMode):XRayOverlapView {
  const resolved=buckets.map(b=>selectedStocks(b,mode));
  const pairs:XRayFundPairOverlap[]=[];
  for(let i=0;i<resolved.length;i++){
    for(let j=i+1;j<resolved.length;j++){
      pairs.push(pairOf(resolved[i],resolved[j]));
    }
  }
  pairs.sort((a,b)=>b.commonWeightPct-a.commonWeightPct||
    b.combinedSharedCzk-a.combinedSharedCzk||
    a.left.isin.localeCompare(b.left.isin)||
    a.right.isin.localeCompare(b.right.isin));
  return {
    mode,funds:resolved.map(x=>x.fund),
    pairs,pairsWithConfirmedOverlap:pairs.filter(p=>p.sharedIdentities>0).length,
  };
}
export function calculateXRayEtfOverlap(report:XRayResult):XRayOverlapResult {
  if(!validNumber(report.denominatorCzk)||!validNumber(report.mappedCzk)||
     !validNumber(report.unallocatedCzk)||!validNumber(report.directCzk)||
     !validNumber(report.fundsCzk)||
     !eq(report.mappedCzk+report.unallocatedCzk,report.denominatorCzk,report.denominatorCzk)||
     !eq(report.directCzk+report.fundsCzk,report.denominatorCzk,report.denominatorCzk))
    throw new RangeError("Překryvy ETF vyžadují vyrovnaný základ portfolia.");
  const buckets=new Map<string,FundBucket>();
  let excludedUnknownIsinFunds=0;
  for(const f of report.funds){
    if(!validNumber(f.valueCzk)||!validNumber(f.mappedCzk)||
       !validNumber(f.unmappedCzk)||!eq(f.mappedCzk+f.unmappedCzk,f.valueCzk,f.valueCzk))
      throw new RangeError("ETF nemá vyrovnanou tržní hodnotu rozkladu.");
    if(!f.isin){
      excludedUnknownIsinFunds++;
      continue;
    }
    const key=fundKey(f.isin);
    if(buckets.has(key))throw new RangeError("Duplicitní identita ETF v přehledu.");
    buckets.set(key,{coverage:f,stocks:[]});
  }
  let allocatedFunds=0;
  let allocatedDirect=0;
  const byFundMapped=new Map<string,number>();
  for(const exposure of report.exposures){
    if(!validNumber(exposure.totalCzk)||!validNumber(exposure.directCzk)||
       !validNumber(exposure.viaFundsCzk)||
       !eq(exposure.directCzk+exposure.viaFundsCzk,exposure.totalCzk,exposure.totalCzk))
      throw new RangeError("Nesouhlasí přímé a fondové příspěvky.");
    const sourceTotal=exposure.fundContributions.reduce((sum,entry)=>sum+entry.valueCzk,0);
    if(!eq(sourceTotal,exposure.viaFundsCzk,exposure.totalCzk))
      throw new RangeError("Součet ETF příspěvků neodpovídá akcii.");
    allocatedDirect+=exposure.directCzk;
    allocatedFunds+=sourceTotal;
    const identity=identified(exposure);
    for(const contribution of exposure.fundContributions){
      if(!validNumber(contribution.valueCzk))
        throw new RangeError("Nesprávná fondová akciová hodnota.");
      if(!contribution.fundIsin)continue;
      const key=fundKey(contribution.fundIsin);
      const bucket=buckets.get(key);
      if(!bucket)throw new RangeError("Příspěvek odkazuje na neexistující ETF.");
      byFundMapped.set(key,(byFundMapped.get(key)??0)+contribution.valueCzk);
      if(!identity||contribution.valueCzk===0)continue;
      bucket.stocks.push({
        key:exposure.key,ticker:exposure.ticker,name:exposure.name,
        czk:contribution.valueCzk,
        isProxy:contribution.exposureBasis==="reference-index-proxy",
        identity,
      });
    }
  }
  if(!eq(allocatedDirect,report.directCzk,report.denominatorCzk)||
     !eq(allocatedFunds+allocatedDirect,report.mappedCzk,report.denominatorCzk))
    throw new RangeError("Překryvy ETF nesouhlasí s rozloženou tržní hodnotou.");
  for(const [key,bucket] of buckets){
    if(!eq(byFundMapped.get(key)??0,bucket.coverage.mappedCzk,bucket.coverage.valueCzk))
      throw new RangeError("Rozpad jednoho ETF neodpovídá známým příspěvkům.");
  }
  const list=[...buckets.values()].sort((a,b)=>
    b.coverage.valueCzk-a.coverage.valueCzk||
    fundKey(a.coverage.isin??"").localeCompare(fundKey(b.coverage.isin??"")));
  return {
    denominatorCzk:report.denominatorCzk,excludedUnknownIsinFunds,
    withoutProxy:calculateMode(list,"without-proxy"),
    includingProxy:calculateMode(list,"including-proxy"),
  };
}
