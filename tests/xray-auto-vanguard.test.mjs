import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VWCE_ISIN,VANGUARD_EU_GRAPHQL_URL,VANGUARD_EU_PRODUCT_ID,
  parseVanguardPage,parseVanguardHoldings,fetchVwceHoldings,
} from "../lib/xray/auto-vanguard.ts";
import { calculateXRay } from "../lib/xray/engine.ts";

const count=3800;
const fundName="Vanguard FTSE All-World UCITS ETF (USD) Accumulating";
function sourceHolding(index,update={}) {
  return {
    issuerName:"Company "+index,
    securityLongDescription:"Company "+index,
    ticker:"STK"+(index%3500),
    securityType:"EQ.STOCK",
    sedol1:"A"+String(index).padStart(6,"0"),
    marketValuePercentage:"0.026",
    effectiveDate:"2026-08-31",
    ...update,
  };
}
const source=Array.from({length:count},(_,i)=>sourceHolding(i+1));
function payload(items,total=count,cursor=null,name=fundName) {
  return {data:{funds:[{profile:{fundFullName:name,fundCurrency:"USD"}}],
    borHoldings:[{holdings:{items,totalHoldings:total,lastItemKey:cursor}}]}};
}
const page=(items,total=count,cursor=null)=>parseVanguardPage(payload(items,total,cursor));
const pages=[
  page(source.slice(0,1500),count,"p2"),
  page(source.slice(1500,3000),count,"p3"),
  page(source.slice(3000),count,null),
];

function holding(id,symbol,assetClass,valueCzk,isin) {
  return {id,symbol,name:symbol,assetClass,isin,canonicalKey:null,quantity:1,valueCzk,
    provider:"trading212",accountName:"Invest"};
}
test("Vanguard EU parser uses all 3800 holdings and preserves unallocated residual",()=>{
  const r=parseVanguardHoldings(pages,"VWCE");
  assert.equal(r.count,3800);
  assert.equal(r.rows.length,3800);
  assert.equal(r.asOf,"2026-08-31");
  assert.ok(Math.abs(r.coveragePct-98.8)<1e-7);
  assert.ok(Math.abs(r.unmappedPct-1.2)<1e-7);
  assert.equal(r.rows[0].fundIsin,VWCE_ISIN);
  assert.equal(r.rows[0].securityIsin,null);
  assert.equal(r.rows[0].securitySymbol,"SEDOL-A000001");
  const report=calculateXRay([
    holding("vwce","VWCE","etf",100_000,VWCE_ISIN),
    holding("stock","STK1","stock",10_000,"US5949181045"),
  ],r.rows);
  assert.equal(report.denominatorCzk,110_000);
  assert.ok(Math.abs(report.mappedCzk-108_800)<1e-5);
  assert.ok(Math.abs(report.unallocatedCzk-1200)<1e-5);
  assert.ok(Math.abs(report.mappedCzk+report.unallocatedCzk-report.denominatorCzk)<1e-5);
  assert.ok(report.exposures.some(x=>x.ticker==="STK1"),"Direct holding remains identifiable");
  assert.ok(report.exposures.some(x=>x.ticker==="SEDOL-A000001"),"Fund security retains precise SEDOL identity");
});

test("different SEDOLs with identical tickers do not collide or silently merge",()=>{
  const r=parseVanguardHoldings(pages,"VWRP");
  assert.equal(r.rows.length,3800);
  const keys=new Set(r.rows.map(x=>x.securitySymbol));
  assert.equal(keys.size,3800);
  assert.equal(r.rows[0].fundSymbol,"VWRP");
});

test("never accept truncated, inconsistent or cyclicly paginated fund holdings",()=>{
  assert.throws(()=>parseVanguardHoldings(pages.slice(0,2),"VWCE"),/všechny podklady/);
  assert.throws(()=>parseVanguardHoldings([page(source.slice(0,1500),3800,"p2"),page(source.slice(1500),3799,null)],"VWCE"),/všechny podklady/);
  assert.throws(()=>parseVanguardHoldings([page(source.slice(0,1500),3800,"p2"),page(source.slice(1500),3800,null)],"VWCE"),/všechny podklady/);
  assert.throws(()=>parseVanguardHoldings([
    page(source.slice(0,1500),3800,"p2"),
    page(source.slice(1500,3000).map((x,i)=>i===0?{...x,effectiveDate:"2026-07-31"}:x),3800,"p3"),
    pages[2],
  ],"VWCE"),/různá data/);
  assert.throws(()=>parseVanguardHoldings([page(source.map((x,i)=>i===0?{...x,marketValuePercentage:"110"}:x).slice(0,1500),3800,"p2"),...pages.slice(1)],"VWCE"),/neplatnou váhu/);
});

test("GraphQL response validates exact ETF, page size, total and error envelopes",()=>{
  assert.equal(parseVanguardPage(payload([source[0]],3800,"p2")).total,3800);
  assert.throws(()=>parseVanguardPage(payload([],3800,null,"Some Other Fund")),/neodpovídá/);
  assert.throws(()=>parseVanguardPage({errors:[{message:"forbidden"}],data:payload([],3800,null).data}),/ohlásil chybu/);
  assert.throws(()=>parseVanguardPage(payload([],NaN,null)),/neplatný počet/);
  assert.throws(()=>parseVanguardPage(payload(source.slice(0,1501),3800,null)),/neplatný počet/);
});

test("issuer request paginates to final item; no broker token or user-defined URL",async()=>{
  let count=0;
  const used=[];
  async function mock(url,init) {
    count++;
    assert.equal(url,VANGUARD_EU_GRAPHQL_URL);
    assert.equal(init.method,"POST");
    assert.equal(init.headers["X-Consumer-ID"],"ie0");
    assert.equal(init.headers.Authorization,undefined);
    const body=JSON.parse(init.body);
    assert.deepEqual(body.variables.portIds,[VANGUARD_EU_PRODUCT_ID]);
    used.push(body.variables.lastItemKey);
    const idx=count-1;
    return new Response(JSON.stringify(payload(pages[idx].items,count===3?3800:3800,
      pages[idx].cursor)),{status:200,headers:{"content-type":"application/json"}});
  }
  const first=await fetchVwceHoldings("VWCE",true,mock);
  assert.equal(first.rows.length,3800);
  assert.equal(first.asOf,"2026-08-31");
  assert.equal(first.cached,false);
  assert.equal(count,3);
  assert.deepEqual(used,[null,"p2","p3"]);
  const second=await fetchVwceHoldings("VWRA",false,async()=>{throw new Error("must reuse cache");});
  assert.equal(second.cached,true);
  assert.equal(second.rows[0].fundSymbol,"VWRA");
  assert.equal(second.rows.length,3800);
});

test("a repeated pagination cursor fails and never returns partial holdings",async()=>{
  let n=0;
  await assert.rejects(fetchVwceHoldings("VWCE",true,async()=>{
    n++;
    return new Response(JSON.stringify(payload(source.slice(0,1500),3800,"repeat")),{status:200});
  }),/cyklické stránkování/);
  assert.equal(n,2);
});

test("only ISIN IE00BK5BQT80 is automatically connected from the live portfolio",()=>{
  const route=readFileSync(new URL("../app/api/xray/auto/route.ts",import.meta.url),"utf8");
  const ui=readFileSync(new URL("../components/xray-auto-sync.tsx",import.meta.url),"utf8");
  assert.ok(route.includes("isin === VWCE_ISIN"));
  assert.ok(route.includes("fetchVwceHoldings(f.symbol,force)"));
  assert.ok(route.includes("localOnly(request)"));
  assert.ok(ui.includes("VWCE / VWRA / VWRP"));
});
