import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calculateXRay} from "../lib/xray/engine.ts";
import {calculateXRayCoveragePriorities} from "../lib/xray/coverage-priorities.ts";

const PHYS="IE00BK5BQT80",LYMS="LU1829221024";
const GOLD="IE00B4ND3602",MISS="IE0000000001",MSFT="US5949181045";
const DATE=new Date(Date.now()-86_400_000).toISOString().slice(0,10);
const h=(id,symbol,assetClass,valueCzk,isin=null)=>({
  id,symbol,name:symbol,assetClass,valueCzk,isin,canonicalKey:null,
  quantity:1,provider:"trading212",accountName:"Invest",
});
const row=(isin,symbol,ticker,kind,weightPct,basis)=>({
  fundIsin:isin,fundSymbol:symbol,securitySymbol:ticker,
  securityName:ticker,securityIsin:kind==="stock"?MSFT:null,
  kind,weightPct,asOf:DATE,source:"test issuer",
  ...(basis?{exposureBasis:basis}:{}),
});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+" != "+b);

test("ranks actual uncovered and modelled NAV without creating financial exposure",()=>{
  const physical=[
    h("physical","VWCE","etf",1000,PHYS),
    h("missing","MISSING","etf",600,MISS),
    h("gold","IGLN","etf",400,GOLD),
    h("lyms","LYMS","etf",500,LYMS),
    h("direct","MSFT","stock",200,MSFT),
    h("crypto","BTC","crypto",100),
  ];
  const proxy=Array.from({length:100},(_,i)=>({
    ...row(LYMS,"LYMS","INDEX"+i,"stock",0.99,"reference-index-proxy"),
    securityIsin:null,
  }));
  const result=calculateXRay(physical,[
    row(PHYS,"VWCE","MSFT","stock",70),
    row(PHYS,"VWCE","CASH","other",10),
    ...proxy,
  ]);
  const queue=calculateXRayCoveragePriorities(result);
  near(result.denominatorCzk,2800);
  near(queue.fundsCzk,2500);
  near(queue.fundMappedCzk,1195);
  near(queue.fundUnmappedCzk,1305);
  near(queue.proxyMappedCzk,495);
  near(queue.structuralCzk,400);
  near(queue.priorityCzk,1400);
  assert.deepEqual(queue.rows.slice(0,3).map(x=>x.status),["missing","proxy","partial"]);
  assert.equal(queue.rows.find(x=>x.isin===GOLD).status,"non-equity");
  assert.equal(queue.rows.find(x=>x.isin===GOLD).priorityCzk,0);
  assert.equal(queue.rows.find(x=>x.isin===LYMS).priorityCzk,500);
  near(result.directCzk+queue.fundMappedCzk,result.mappedCzk);
  near(result.mappedCzk+queue.fundUnmappedCzk,result.denominatorCzk);
});
test("direct-only portfolio does not fabricate ETF work",()=>{
  const report=calculateXRay([h("share","MSFT","stock",100,MSFT)],[]);
  const queue=calculateXRayCoveragePriorities(report);
  assert.equal(queue.rows.length,0);
  assert.equal(queue.priorityCzk,0);
  assert.equal(queue.structuralCzk,0);
});
test("declared synthetic index is not mistaken for issuer physical stock",()=>{
  const index=Array.from({length:100},(_,i)=>({
    ...row(LYMS,"LYMS","INDEX"+i,"stock",1,"reference-index"),
    securityIsin:null,
  }));
  const report=calculateXRay([
    h("physical","VWCE","etf",1000,PHYS),
    h("index","LYMS","etf",100,LYMS),
  ],[row(PHYS,"VWCE","MSFT","stock",100),...index]);
  const queue=calculateXRayCoveragePriorities(report);
  assert.equal(queue.rows.find(x=>x.isin===PHYS).status,"covered");
  assert.equal(queue.rows.find(x=>x.isin===PHYS).priorityCzk,0);
  assert.equal(queue.rows.find(x=>x.isin===LYMS).status,"index");
  near(queue.indexMappedCzk,100);
  near(queue.proxyMappedCzk,0);
});
test("refuses misleading NAV, duplicate fund identities and inconsistent proxy",()=>{
  const report=calculateXRay([h("etf","UNKNOWN","etf",10,MISS)],[]);
  assert.throws(()=>calculateXRayCoveragePriorities({...report,fundsCzk:11}),/neodpovídají|vyrovnanou/i);
  assert.throws(()=>calculateXRayCoveragePriorities({...report,estimatedProxyCzk:5}),/neodpovídají/i);
  assert.throws(()=>calculateXRayCoveragePriorities({...report,funds:[...report.funds,...report.funds]}),/Duplicitní/i);
});
test("interactive panel uses current X-Ray report and links to existing tools",()=>{
  const parent=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
  const ui=readFileSync(new URL("../components/xray-coverage-queue.tsx",import.meta.url),"utf8");
  const sync=readFileSync(new URL("../components/xray-auto-sync.tsx",import.meta.url),"utf8");
  assert.ok(parent.includes("calculateXRayCoveragePriorities(report.data)"));
  assert.ok(parent.includes("<XRayCoverageQueue result={coveragePriorities.result}/>"));
  assert.ok(parent.includes('id="xray-manual-import"'));
  assert.ok(sync.includes('id="xray-auto-sync"'));
  assert.ok(ui.includes('href="#xray-auto-sync"'));
  assert.ok(ui.includes('href="#xray-manual-import"'));
  assert.ok(ui.includes("result.proxyMappedCzk"));
  assert.ok(ui.includes("result.priorityCzk"));
});
