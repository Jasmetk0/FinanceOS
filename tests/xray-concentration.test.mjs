import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calculateXRay} from "../lib/xray/engine.ts";
import {calculateXRayConcentration} from "../lib/xray/concentration.ts";

const MSFT="US5949181045",NVDA="US67066G1040";
const VWCE="IE00BK5BQT80",LYMS="LU1829221024";
const DAY=86_400_000;
const asOf=new Date(Date.now()-DAY).toISOString().slice(0,10);
const holding=(id,symbol,assetClass,valueCzk,isin=null)=>({
 id,symbol,name:symbol,assetClass,valueCzk,isin,
 quantity:1,provider:"trading212",accountName:"Invest",canonicalKey:null,
});
const row=(fundIsin,symbol,securitySymbol,securityIsin,weightPct,basis)=>({
 fundIsin,fundSymbol:symbol,securitySymbol,securityIsin,
 securityName:securitySymbol,kind:"stock",weightPct,asOf,
 source:fundIsin===LYMS?"CNDX as LYMS proxy":"Vanguard physical holdings",
 ...(basis?{exposureBasis:basis}:{}),
});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(){
 const lyms=Array.from({length:100},(_,i)=>
   row(LYMS,"LYMS",i===0?"MSFT":"MODEL"+i,i===0?MSFT:null,0.99,
     "reference-index-proxy"));
 return calculateXRay([
   holding("msft","MSFT","stock",300,MSFT),
   holding("nvda","NVDA","stock",100,NVDA),
   holding("btc","BTC","crypto",100),
   holding("vwce","VWCE","etf",1000,VWCE),
   holding("lyms","LYMS","etf",500,LYMS),
 ],[
   row(VWCE,"VWCE","MSFT",MSFT,10),
   row(VWCE,"VWCE","NVDA",NVDA,20),
   row(VWCE,"VWCE","TSLA","US88160R1014",30),
   ...lyms,
 ]);
}

test("concentration conserves total NAV across direct, issuer holdings, synthetic proxy and unknown",()=>{
 const report=fixture(),c=calculateXRayConcentration(report);
 close(c.denominatorCzk,2000);
 close(c.withoutProxyCzk,1100);
 close(c.proxyCzk,495);
 close(c.unresolvedCzk,405);
 close(c.withoutProxyCzk+c.proxyCzk+c.unresolvedCzk,c.denominatorCzk);
 close(c.withoutProxy.includedPct,55);
 close(c.includingProxy.includedPct,79.75);
 close(c.withoutProxy.top1Czk,400);
 close(c.withoutProxy.top1Pct,20);
 close(c.withoutProxy.top5Czk,1100);
 close(c.withoutProxy.top10Czk,1100);
 close(c.includingProxy.top1Czk,404.95);
 close(c.includingProxy.top5Czk,1109.9);
 close(c.includingProxy.top5Pct,55.495);
 assert.equal(c.withoutProxy.countedSecurities,4);
 assert.equal(c.includingProxy.countedSecurities,103);
 assert.equal(c.withoutProxy.positions.some(p=>p.proxyCzk>0&&p.withoutProxyCzk===0),false);
 close(report.mappedCzk+report.unallocatedCzk,report.denominatorCzk);
});
test("one stock held directly, physically through ETF and modeled by LYMS is counted once per ranking",()=>{
 const c=calculateXRayConcentration(fixture());
 const msft=c.includingProxy.positions.find(p=>p.key==="stock|isin:"+MSFT);
 assert.ok(msft);
 close(msft.directCzk,300);
 close(msft.viaFundsCzk,104.95);
 close(msft.proxyCzk,4.95);
 close(msft.withoutProxyCzk,400);
 close(msft.includingProxyCzk,404.95);
 assert.equal(msft.identity,"isin");
 assert.equal(c.includingProxy.positions.filter(p=>p.key==="stock|isin:"+MSFT).length,1);
 const nonproxy=c.withoutProxy.positions.find(p=>p.key==="stock|isin:"+MSFT);
 assert.equal(nonproxy.valueCzk,400);
 close(nonproxy.weightPct,20);
});
test("crypto ticker stays separate from same-named stock and has no invented ETF proxy",()=>{
 const r=calculateXRay([
   holding("crypto","ABC","crypto",300),
   holding("equity","ABC","stock",200),
 ],[]);
 const c=calculateXRayConcentration(r);
 assert.equal(c.positions.length,2);
 assert.notEqual(c.positions[0].key,c.positions[1].key);
 assert.ok(c.positions.some(x=>x.identity==="crypto"));
 assert.ok(c.positions.some(x=>x.identity==="unverified"));
 close(c.includingProxy.top5Czk,500);
 close(c.withoutProxy.includedPct,100);
});
test("unverified same ticker in different ETF remains separate, not falsely concentrated",()=>{
 const r=calculateXRay([
   holding("a","VWCE","etf",1000,VWCE),
   holding("b","OTHER","etf",1000,"IE00B0000000"),
 ],[
   row(VWCE,"VWCE","ABC",null,10),
   row("IE00B0000000","OTHER","ABC",null,20),
 ]);
 const c=calculateXRayConcentration(r);
 assert.equal(c.positions.length,2);
 assert.equal(c.withoutProxy.positions.filter(x=>x.ticker==="ABC").length,2);
 assert.equal(c.withoutProxy.positions[0].valueCzk,200);
 close(c.withoutProxy.top5Pct,15);
 close(c.unresolvedCzk,1700);
 assert.ok(c.positions.every(x=>x.identity==="unverified"));
});
test("unknown fund without constituents is 100% unresolved, not falsely diversified",()=>{
 const r=calculateXRay([holding("v","VWCE","etf",1200,VWCE)],[]);
 const c=calculateXRayConcentration(r);
 assert.equal(c.withoutProxy.countedSecurities,0);
 assert.equal(c.withoutProxy.top1Pct,0);
 assert.equal(c.includingProxy.top5Pct,0);
 assert.equal(c.withoutProxyCzk,0);
 assert.equal(c.proxyCzk,0);
 assert.equal(c.unresolvedCzk,1200);
});
test("zero portfolio is safe and does not divide by mapped NAV instead of full denominator",()=>{
 const c=calculateXRayConcentration(calculateXRay([],[]));
 assert.equal(c.withoutProxy.positions.length,0);
 assert.equal(c.includingProxy.includedPct,0);
 assert.equal(c.unresolvedCzk,0);
});
test("tampered proxy and mapped totals must fail closed before misleading concentration report",()=>{
 const original=fixture();
 assert.throws(()=>calculateXRayConcentration({...original,estimatedProxyCzk:0}),/nesouhlasí/);
 assert.throws(()=>calculateXRayConcentration({...original,unallocatedCzk:0}),/nesouhlasí/);
 assert.throws(()=>calculateXRayConcentration({...original,mappedCzk:100}),/nesouhlasí/);
 assert.throws(()=>calculateXRayConcentration({...original,denominatorCzk:-1}),/nezápornou/);
});
test("concentration does not redefine all assets as known and clearly differentiates modeled shares",()=>{
 const ui=readFileSync(new URL("../components/xray-concentration.tsx",import.meta.url),"utf8");
 const main=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
 assert.ok(ui.includes('useState<ConcentrationMode>("without-proxy")'));
 assert.ok(ui.includes('onClick={()=>setMode("including-proxy")}'));
 assert.ok(ui.includes('summary.unresolvedCzk'));
 assert.ok(ui.includes('summary.proxyCzk'));
 assert.ok(ui.includes("summary.denominatorCzk"));
 assert.ok(ui.includes("Skutečná koncentrace")||ui.includes("skutečná koncentrace"));
 assert.ok(main.includes("calculateXRayConcentration(report.data)"));
 assert.ok(main.includes("<XRayConcentration summary={concentration.summary}/>"));
});
