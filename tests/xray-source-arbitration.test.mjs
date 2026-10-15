import test from "node:test";
import assert from "node:assert/strict";
import {calculateXRay} from "../lib/xray/engine.ts";
import {combineConstituentSources} from "../lib/xray/auto-merge.ts";
const LYMS="LU1829221024",EQQQ="IE0032077012";
const today=new Date().toISOString().slice(0,10);
const ago=(days)=>new Date(Date.now()-days*86_400_000).toISOString().slice(0,10);
const constituent=(fundIsin,fundSymbol,securitySymbol,weightPct,asOf,exposureBasis)=>({
 fundIsin,fundSymbol,securitySymbol,securityName:securitySymbol,securityIsin:null,
 weightPct,kind:"stock",asOf,source:exposureBasis??"manual",
 ...(exposureBasis?{exposureBasis}:{}),
});
const batch=(fundIsin,kind,asOf=today,symbol="LYMS",n=100)=>
 Array.from({length:n},(_,i)=>constituent(fundIsin,symbol,"STOCK"+String(i).padStart(3,"0"),
  99/n,asOf,kind));
const holding=(isin,symbol,valueCzk)=>({
 id:isin,symbol,name:symbol,assetClass:"etf",isin,canonicalKey:null,
 quantity:1,valueCzk,provider:"trading212",accountName:"Invest",
});
test("newer legacy substitute basket may not override complete LYMS automatic proxy",()=>{
 const manual=batch(LYMS,undefined,ago(0));
 const auto=batch(LYMS,"reference-index-proxy",ago(1));
 const merged=combineConstituentSources(manual,auto);
 assert.equal(merged.length,100);
 assert.ok(merged.every(r=>r.exposureBasis==="reference-index-proxy"));
 const result=calculateXRay([holding(LYMS,"LYMS",25116)],merged);
 assert.ok(Math.abs(result.estimatedProxyCzk-25116*.99)<1e-7);
 assert.equal(result.funds[0].exposureBasis,"reference-index-proxy");
 assert.ok(Math.abs(result.denominatorCzk-result.mappedCzk-result.unallocatedCzk)<1e-7);
});
test("explicitly declared substitute basket is no more eligible than unlabeled one",()=>{
 const a=batch(LYMS,"substitute-basket",ago(0));
 const b=batch(LYMS,"reference-index-proxy",ago(1));
 assert.deepEqual(combineConstituentSources(a,b),b);
});
test("top-10 alleged reference-index cannot knock out independently validated proxy",()=>{
 const a=batch(LYMS,"reference-index",ago(0),"LYMS",10);
 const b=batch(LYMS,"reference-index-proxy",ago(1));
 assert.deepEqual(combineConstituentSources(a,b),b);
});
test("a full, explicitly named exact benchmark wins when asOf ties a CNDX proxy",()=>{
 const exact=batch(LYMS,"reference-index",ago(1));
 const model=batch(LYMS,"reference-index-proxy",ago(1));
 const result=combineConstituentSources(exact,model);
 assert.deepEqual(result,exact);
 const r=calculateXRay([holding(LYMS,"LYMS",1000)],result);
 assert.equal(r.funds[0].exposureBasis,"reference-index");
 assert.equal(r.estimatedProxyCzk,0);
});
test("newer complete CNDX proxy wins over older exact benchmark because age matters",()=>{
 const model=batch(LYMS,"reference-index-proxy",ago(1));
 const older=batch(LYMS,"reference-index",ago(3));
 assert.deepEqual(combineConstituentSources(older,model),model);
});
test("stale CNDX proxy is ineligible when current exact benchmark is available",()=>{
 const stale=batch(LYMS,"reference-index-proxy",ago(35));
 const exact=batch(LYMS,"reference-index",ago(2));
 assert.deepEqual(combineConstituentSources(exact,stale),exact);
});
test("physical EQQQ newer manual benchmark list cannot silently replace actual issuer fund holdings",()=>{
 const bogus=batch(EQQQ,"reference-index",ago(0),"EQQQ");
 const official=batch(EQQQ,"fund-holdings",ago(7),"EQQQ");
 assert.deepEqual(combineConstituentSources(bogus,official),official);
 const result=calculateXRay([holding(EQQQ,"EQQQ",1000)],combineConstituentSources(bogus,official));
 assert.ok(result.mappedCzk>980);
 assert.equal(result.estimatedProxyCzk,0);
});
test("valid later manually corrected physical holdings still win newer as-of date",()=>{
 const local=batch(EQQQ,"fund-holdings",ago(0),"EQQQ");
 const remote=batch(EQQQ,"fund-holdings",ago(1),"EQQQ");
 assert.deepEqual(combineConstituentSources(local,remote),local);
});
test("keep available manual snapshot when automatic source is completely missing",()=>{
 const manual=batch(LYMS,"substitute-basket",ago(0));
 assert.deepEqual(combineConstituentSources(manual,[]),manual);
 const result=calculateXRay([holding(LYMS,"LYMS",5000)],manual);
 assert.equal(result.mappedCzk,0);
 assert.equal(result.unallocatedCzk,5000);
});
test("source arbitration merges by ISIN, never mixes names, tickers, or partial snapshots",()=>{
 const manual=batch(EQQQ,"fund-holdings",ago(0),"EQQQ");
 const auto=batch(EQQQ,"fund-holdings",ago(1),"EQAC_EXCHANGE");
 const distinct=batch("IE00BFZXGZ54","fund-holdings",ago(1),"EQAC");
 const result=combineConstituentSources(manual,[...auto,...distinct]);
 assert.equal(result.length,200);
 assert.equal(result.filter(r=>r.fundIsin===EQQQ).length,100);
 assert.equal(result.filter(r=>r.fundIsin===EQQQ)[0].fundSymbol,"EQQQ");
 assert.equal(result.filter(r=>r.fundIsin==="IE00BFZXGZ54").length,100);
});
