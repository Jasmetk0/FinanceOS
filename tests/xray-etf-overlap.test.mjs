import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calculateXRay} from "../lib/xray/engine.ts";
import {calculateXRayEtfOverlap} from "../lib/xray/etf-overlap.ts";

const VWCE="IE00BK5BQT80",VALL="IE000VAHT5T0",LYMS="LU1829221024";
const MSFT="US5949181045",NVDA="US67066G1040",TSLA="US88160R1014";
const asOf=new Date(Date.now()-86_400_000).toISOString().slice(0,10);
const holding=(id,symbol,assetClass,valueCzk,isin=null)=>({
  id,symbol,name:symbol,assetClass,valueCzk,isin,quantity:1,
  canonicalKey:null,provider:"trading212",accountName:"Invest",
});
function constituent(fundIsin,symbol,ticker,securityIsin,weightPct,extra={}){
  return {fundIsin,fundSymbol:symbol,securitySymbol:ticker,
    securityIsin,securityName:ticker,kind:"stock",weightPct,
    asOf,source:"Verified issuer holdings "+asOf,...extra};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(){
  const model=Array.from({length:100},(_,i)=>constituent(
    LYMS,"LYMS",i===0?"MSFT":i===1?"NVDA":"LYMS"+i,
    i===0?MSFT:i===1?NVDA:null,0.99,{exposureBasis:"reference-index-proxy"},
  ));
  return calculateXRay([
    holding("direct","MSFT","stock",250,MSFT),
    holding("crypto","BTC","crypto",100),
    holding("vwce","VWCE","etf",1000,VWCE),
    holding("vwra","VWRA","etf",500,VWCE),
    holding("vall","VALL","etf",2000,VALL),
    holding("lyms","LYMS","etf",500,LYMS),
  ],[
    constituent(VWCE,"VWCE","MSFT",MSFT,10),
    constituent(VWCE,"VWCE","NVDA",NVDA,15),
    constituent(VWCE,"VWCE","ANONYMOUS",null,20),
    constituent(VALL,"VALL","MSFT",MSFT,20),
    constituent(VALL,"VALL","NVDA",NVDA,5),
    constituent(VALL,"VALL","TSLA",TSLA,15),
    constituent(VALL,"VALL","ANONYMOUS",null,10),
    ...model,
  ]);
}
const select=(result,a,b)=>result.pairs.find(x=>
  new Set([x.left.isin,x.right.isin]).size===2 &&
  [a,b].every(isin=>isin===x.left.isin||isin===x.right.isin));

test("two physical ETFs have exact ISIN intersection and common NAV weights, not double-counted holdings",()=>{
 const report=fixture(),r=calculateXRayEtfOverlap(report);
 close(r.denominatorCzk,4350);
 assert.equal(r.withoutProxy.funds.length,3);
 assert.equal(r.withoutProxy.pairs.length,3);
 assert.equal(r.withoutProxy.pairsWithConfirmedOverlap,1);
 const overlap=select(r.withoutProxy,VWCE,VALL);
 assert.ok(overlap);
 assert.equal(overlap.sharedIdentities,2);
 assert.equal(overlap.sharedIsins,2);
 assert.equal(overlap.sharedSedols,0);
 close(overlap.commonWeightPct,15);
 close(overlap.combinedSharedCzk,875);
 close(overlap.left.valueCzk===1500?overlap.left.knownIdentityCzk:overlap.right.knownIdentityCzk,375);
 close(overlap.left.valueCzk===2000?overlap.left.knownIdentityCzk:overlap.right.knownIdentityCzk,800);
 const msft=overlap.sharedStocks.find(x=>x.key==="stock|isin:"+MSFT);
 assert.ok(msft);
 close(msft.combinedExposureCzk,550);
 assert.equal(overlap.sharedStocks.filter(x=>x.ticker==="ANONYMOUS").length,0);
 // Ratio is per respective fund NAV and not across the user's whole portfolio.
 close(msft.leftFundPct+msft.rightFundPct,30);
 close(report.denominatorCzk,report.mappedCzk+report.unallocatedCzk);
});
test("economic LYMS proxy contributes only in optional modeled comparison",()=>{
 const r=calculateXRayEtfOverlap(fixture());
 const physical=select(r.withoutProxy,VWCE,VALL);
 const without=select(r.withoutProxy,VWCE,LYMS);
 const withModel=select(r.includingProxy,VWCE,LYMS);
 assert.equal(without.sharedIdentities,0);
 assert.equal(without.combinedSharedCzk,0);
 assert.equal(withModel.sharedIdentities,2);
 assert.equal(withModel.sharedIsins,2);
 close(withModel.commonWeightPct,1.98);
 assert.equal(physical.sharedIdentities,2);
 close(physical.commonWeightPct,select(r.includingProxy,VWCE,VALL).commonWeightPct);
 assert.equal(r.withoutProxy.pairsWithConfirmedOverlap,1);
 assert.equal(r.includingProxy.pairsWithConfirmedOverlap,3);
 const modelFund=r.withoutProxy.funds.find(f=>f.isin===LYMS);
 assert.equal(modelFund.knownIdentityCzk,0);
 assert.equal(modelFund.notComparableCzk,500);
 const modeled=r.includingProxy.funds.find(f=>f.isin===LYMS);
 close(modeled.knownIdentityCzk,9.9);
});
test("same ticker but different ISIN is NOT a shared stock across two ETFs",()=>{
 const a="IE00B0000001",b="IE00B0000002";
 const r=calculateXRay([
   holding("a","AAA","etf",1000,a),
   holding("b","BBB","etf",2000,b),
 ],[
   constituent(a,"AAA","ABC","US0000000001",30),
   constituent(b,"BBB","ABC","US0000000002",40),
 ]);
 const overlap=calculateXRayEtfOverlap(r);
 assert.equal(overlap.withoutProxy.pairsWithConfirmedOverlap,0);
 assert.equal(overlap.withoutProxy.pairs[0].sharedIdentities,0);
 assert.equal(overlap.withoutProxy.pairs[0].combinedSharedCzk,0);
 close(r.mappedCzk+r.unallocatedCzk,3000);
});
test("ticker-only positions are excluded rather than misleadingly considered zero overlap evidence",()=>{
 const a="IE00B0000001",b="IE00B0000002";
 const r=calculateXRay([
   holding("a","AAA","etf",1000,a),
   holding("b","BBB","etf",1000,b),
 ],[
   constituent(a,"AAA","ABC",null,35),
   constituent(b,"BBB","ABC",null,65),
 ]);
 const overlap=calculateXRayEtfOverlap(r);
 assert.equal(overlap.withoutProxy.pairs[0].sharedIdentities,0);
 assert.equal(overlap.withoutProxy.funds[0].knownIdentityPct,0);
 assert.equal(overlap.withoutProxy.funds[1].knownIdentityPct,0);
 close(overlap.withoutProxy.funds[0].notComparableCzk,1000);
});
test("identical checksum-valid SEDOL with no ISIN is matched but explicitly marked SEDOL",()=>{
 const a="IE00B0000001",b="IE00B0000002";
 const sid="2588173";
 const r=calculateXRay([
   holding("a","AAA","etf",1000,a),
   holding("b","BBB","etf",1000,b),
 ],[
   constituent(a,"AAA","AAA@2588173",null,12,{securitySedol:sid}),
   constituent(b,"BBB","BBB@2588173",null,20,{securitySedol:sid}),
 ]);
 const overlap=calculateXRayEtfOverlap(r);
 const pair=overlap.withoutProxy.pairs[0];
 assert.equal(pair.sharedIdentities,1);
 assert.equal(pair.sharedIsins,0);
 assert.equal(pair.sharedSedols,1);
 close(pair.commonWeightPct,12);
 close(pair.combinedSharedCzk,320);
 assert.equal(pair.sharedStocks[0].identity,"sedol");
});
test("unknown ISIN fund is not paired with a different ticker or guessed from symbol",()=>{
 const r=calculateXRay([
   holding("a","AAA","etf",1000,null),
   holding("b","BBB","etf",1000,VWCE),
 ],[
   {...constituent(null,"AAA","MSFT",MSFT,20),fundIsin:null},
   constituent(VWCE,"BBB","MSFT",MSFT,20),
 ]);
 const result=calculateXRayEtfOverlap(r);
 assert.equal(result.excludedUnknownIsinFunds,1);
 assert.equal(result.withoutProxy.funds.length,1);
 assert.equal(result.withoutProxy.pairs.length,0);
 close(r.mappedCzk+r.unallocatedCzk,2000);
});
test("no ETF holdings and zero portfolio yield no synthetic pairs",()=>{
 const r=calculateXRay([
   holding("direct","MSFT","stock",100,MSFT),
   holding("btc","BTC","crypto",100),
 ],[]);
 const output=calculateXRayEtfOverlap(r);
 assert.equal(output.withoutProxy.pairs.length,0);
 assert.equal(output.withoutProxy.funds.length,0);
 assert.equal(output.denominatorCzk,200);
 const empty=calculateXRayEtfOverlap(calculateXRay([],[]));
 assert.equal(empty.denominatorCzk,0);
 assert.equal(empty.includingProxy.pairs.length,0);
});
test("invalid fund attribution, NAV and reporting totals fail closed",()=>{
 const base=fixture();
 assert.throws(()=>calculateXRayEtfOverlap({...base,mappedCzk:0}),/nesouhlasí|vyrovnaný/);
 assert.throws(()=>calculateXRayEtfOverlap({...base,unallocatedCzk:-1}),/vyrovnaný/);
 assert.throws(()=>calculateXRayEtfOverlap({...base,denominatorCzk:0}),/vyrovnaný/);
 const fund=base.funds.find(f=>f.isin===VWCE);
 const wrong=base.funds.map(f=>f.isin===VWCE?{...f,mappedCzk:fund.mappedCzk-50}:f);
 assert.throws(()=>calculateXRayEtfOverlap({...base,funds:wrong}),/ETF nemá vyrovnanou/);
 const swapped=base.funds.map(f=>f.isin===VWCE?{...f,unmappedCzk:f.unmappedCzk+100,mappedCzk:f.mappedCzk-100}:f);
 assert.throws(()=>calculateXRayEtfOverlap({...base,funds:swapped}),/Rozpad jednoho ETF/);
});
test("UI uses strictly backed intersection and discloses modeled and unknown components",()=>{
 const source=readFileSync(new URL("../components/xray-etf-overlap.tsx",import.meta.url),"utf8");
 const parent=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
 assert.ok(source.includes('useState<XRayOverlapMode>("without-proxy")'));
 assert.ok(source.includes('onClick={()=>{setMode("including-proxy")'));
 assert.ok(source.includes("pair.commonWeightPct"));
 assert.ok(source.includes("pair.sharedStocks.slice(0,30)"));
 assert.ok(source.includes("knownIdentityPct"));
 assert.ok(source.includes("pair.sharedSedols"));
 assert.ok(source.includes("nedokazuje")||source.includes("neznamená"));
 assert.ok(parent.includes("calculateXRayEtfOverlap(report.data)"));
 assert.ok(parent.includes("<XRayEtfOverlap result={overlap.result}/>"));
});
