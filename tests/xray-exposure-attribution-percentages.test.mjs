import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calculateXRay} from "../lib/xray/engine.ts";
import {
  explainExposureAttribution,matchesXRayOwnership,
} from "../lib/xray/exposure-attribution.ts";
const MSFT="US5949181045",VWCE="IE00BK5BQT80",SPYI="IE00B3YLTY66",LYMS="LU1829221024";
const dated=new Date(Date.now()-24*60*60*1000).toISOString().slice(0,10);
const holding=(id,symbol,kind,valueCzk,isin,quantity=1,provider="trading212",accountName="Invest")=>({
 id,symbol,name:symbol,assetClass:kind,valueCzk,isin,quantity,
 provider,accountName,canonicalKey:null,
});
const row=(symbol,fundIsin,securitySymbol,isin,weight,extra={})=>({
 fundSymbol:symbol,fundIsin,securitySymbol,securityIsin:isin,
 securityName:securitySymbol,weightPct:weight,kind:"stock",
 asOf:dated,source:"Verified issuer stock holdings; "+dated,...extra,
});
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function report(){
 return calculateXRay([
   holding("a","MSFT","stock",100,MSFT,0.5),
   holding("b","MSFT","stock",200,MSFT,1,"kraken","Spot"),
   holding("v1","VWCE","etf",1000,VWCE),
   holding("v2","VWRA","etf",500,VWCE),
   holding("s","SPYI","etf",2000,SPYI),
 ],[
   row("VWCE",VWCE,"MSFT",MSFT,10),
   row("SPYI",SPYI,"MSFT",MSFT,5),
 ]);
}
test("source percentages use full fund NAV across two exchanges, not just security subtotal",()=>{
 const x=report(),e=x.exposures.find(e=>e.key==="stock|isin:"+MSFT);
 assert.ok(e);
 assert.equal(x.denominatorCzk,3800);
 assert.equal(e.directCzk,300);
 assert.equal(e.viaFundsCzk,250);
 assert.equal(e.totalCzk,550);
 const a=explainExposureAttribution(e,x.funds,x.denominatorCzk);
 approx(a.directPortfolioPct,100*300/3800);
 approx(a.fundsPortfolioPct,100*250/3800);
 assert.equal(a.fundSlices.length,2);
 const v=a.fundSlices.find(f=>f.fundIsin===VWCE);
 const s=a.fundSlices.find(f=>f.fundIsin===SPYI);
 assert.equal(v.fundSymbol,"VWCE / VWRA");
 assert.equal(v.fundMarketValueCzk,1500);
 assert.equal(v.valueCzk,150);
 approx(v.withinFundPct,10);
 approx(v.portfolioPct,100*150/3800);
 approx(v.withinExposurePct,100*150/550);
 assert.equal(v.asOf,dated);
 assert.match(v.source,/Verified issuer/);
 assert.equal(s.fundMarketValueCzk,2000);
 assert.equal(s.valueCzk,100);
 approx(s.withinFundPct,5);
 approx(s.portfolioPct,100*100/3800);
 approx(s.withinExposurePct,100*100/550);
 approx(a.fundSlices.reduce((sum,f)=>sum+f.portfolioPct,0),a.fundsPortfolioPct);
 approx(a.directPortfolioPct+a.fundsPortfolioPct,e.weightPct);
 assert.equal(a.estimatedProxyCzk,0);
 approx(x.mappedCzk+x.unallocatedCzk,x.denominatorCzk);
});
test("LYMS model percentage and CZK stay separate from verified stock ownership",()=>{
 const lyms=Array.from({length:100},(_,i)=>row("LYMS",LYMS,
   i===0?"MSFT":"N"+i,i===0?MSFT:null,0.99,{
     exposureBasis:"reference-index-proxy",source:"CNDX synthetic index PROXY; "+dated,
   }));
 const x=calculateXRay([
   holding("msft","MSFT","stock",200,MSFT,1),
   holding("lyms","LYMS","etf",1000,LYMS),
 ],lyms);
 const e=x.exposures.find(e=>e.key==="stock|isin:"+MSFT);
 assert.ok(e);
 const a=explainExposureAttribution(e,x.funds,x.denominatorCzk);
 assert.equal(a.fundSlices.length,1);
 approx(a.fundSlices[0].withinFundPct,0.99);
 approx(a.estimatedProxyCzk,9.9);
 approx(a.estimatedProxyExposurePct,100*9.9/209.9);
 approx(a.estimatedProxyPortfolioPct,100*9.9/1200);
 assert.equal(e.directCzk,200);
 assert.equal(a.fundSlices[0].exposureBasis,"reference-index-proxy");
 assert.equal(x.estimatedProxyCzk,990);
 approx(x.denominatorCzk,x.mappedCzk+x.unallocatedCzk);
});
test("direct-only stock and crypto have zero ETF attribution without invented fund NAV",()=>{
 const x=calculateXRay([
   holding("msft","MSFT","stock",120,MSFT),
   holding("btc","BTC","crypto",80,null),
 ],[]);
 for(const e of x.exposures){
   const a=explainExposureAttribution(e,x.funds,x.denominatorCzk);
   assert.equal(a.fundSlices.length,0);
   assert.equal(a.fundsPortfolioPct,0);
   assert.equal(a.estimatedProxyCzk,0);
   approx(a.directPortfolioPct,100*e.directCzk/200);
 }
});
test("a fund-only stock has no direct quantity yet reports correct fund and portfolio shares",()=>{
 const x=calculateXRay([holding("vwce","VWCE","etf",2000,VWCE)],
   [row("VWCE",VWCE,"MSFT",MSFT,7.25)]);
 const e=x.exposures[0],a=explainExposureAttribution(e,x.funds,x.denominatorCzk);
 assert.equal(e.directQuantity,0);
 assert.equal(e.fundEquivalentQuantity,null);
 approx(e.totalCzk,145);
 approx(a.fundSlices[0].withinFundPct,7.25);
 approx(a.fundSlices[0].portfolioPct,7.25);
 approx(a.directPortfolioPct,0);
});
test("invalid fund attribution fails closed instead of producing a false percent",()=>{
 const x=report(),e=x.exposures.find(e=>e.key==="stock|isin:"+MSFT);
 const missing=x.funds.filter(f=>f.isin!==VWCE);
 assert.throws(()=>explainExposureAttribution(e,missing,x.denominatorCzk),/chybějící ETF/);
 const smaller=x.funds.map(f=>f.isin===SPYI?{...f,valueCzk:50}:f);
 assert.throws(()=>explainExposureAttribution(e,smaller,x.denominatorCzk),/neplatné/);
 assert.throws(()=>explainExposureAttribution(e,x.funds,-100),/Neplatná hodnota portfolia/);
});
test("filter accurately divides direct-only, via-only and overlapping exposure types",()=>{
 const both={directCzk:10,viaFundsCzk:10};
 const onlyDirect={directCzk:1,viaFundsCzk:0};
 const onlyFunds={directCzk:0,viaFundsCzk:1};
 const none={directCzk:0,viaFundsCzk:0};
 for(const source of [both,onlyDirect,onlyFunds,none])
   assert.equal(matchesXRayOwnership(source,"all"),true);
 assert.equal(matchesXRayOwnership(both,"both"),true);
 assert.equal(matchesXRayOwnership(onlyDirect,"both"),false);
 assert.equal(matchesXRayOwnership(onlyFunds,"both"),false);
 assert.equal(matchesXRayOwnership(onlyDirect,"direct-only"),true);
 assert.equal(matchesXRayOwnership(onlyFunds,"direct-only"),false);
 assert.equal(matchesXRayOwnership(onlyFunds,"funds-only"),true);
 assert.equal(matchesXRayOwnership(onlyDirect,"funds-only"),false);
 assert.equal(matchesXRayOwnership(none,"funds-only"),false);
});
test("UI wires real NAV/portfolio percentages, provenance, and controlled filter to X-Ray model",()=>{
 const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
 const app=read("components/portfolio-xray.tsx");
 const detail=read("components/xray-exposure-breakdown.tsx");
 assert.ok(app.includes("matchesXRayOwnership(item,ownershipFilter)"));
 assert.ok(app.includes('value={ownershipFilter}'));
 assert.ok(app.includes('value="both"'));
 assert.ok(app.includes('value="funds-only"'));
 assert.ok(app.includes('value="direct-only"'));
 assert.ok(app.includes("portfolioValueCzk={data.denominatorCzk}"));
 assert.ok(app.includes("funds={data.funds}"));
 assert.ok(detail.includes("explainExposureAttribution(exposure,funds,portfolioValueCzk)"));
 assert.ok(detail.includes("item.withinFundPct"));
 assert.ok(detail.includes("item.portfolioPct"));
 assert.ok(detail.includes("item.asOf"));
 assert.ok(detail.includes("item.source"));
 assert.ok(detail.includes("estimatedProxyCzk"));
 assert.ok(detail.includes("Ne"));
});
