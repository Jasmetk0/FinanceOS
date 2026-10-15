import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  VALL_ISIN,VWCE_ISIN,VANGUARD_VALL_PORT_ID,VANGUARD_EU_PRODUCT_ID,
  VANGUARD_EU_GRAPHQL_URL,vanguardFeedForIsin,
  parseVanguardPage,parseVanguardHoldings,fetchVallHoldings,fetchVwceHoldings,
} from "../lib/xray/auto-vanguard.ts";
import {calculateXRay} from "../lib/xray/engine.ts";

const count=2400;
const name="Vanguard FTSE Global All-Cap UCITS ETF USD Acc";
const items=Array.from({length:count},(_,i)=>({
  issuerName:"Constituent "+i,securityLongDescription:"Constituent "+i,
  ticker:i===0?"NVDA":"VGL"+i,securityType:"EQ.STOCK",
  sedol1:String(i+1).padStart(7,"0"),marketValuePercentage:0.0412,
  effectiveDate:"2026-09-30",
}));
const payload=(rows,total=count,cursor=null,profile=name)=>({
  data:{funds:[{profile:{fundFullName:profile,fundCurrency:"USD"}}],
    borHoldings:[{holdings:{items:rows,totalHoldings:total,lastItemKey:cursor}}]},
});
const first=(id="first")=>parseVanguardPage(payload(items.slice(0,1500),count,id),
  vanguardFeedForIsin(VALL_ISIN));
const last=()=>parseVanguardPage(payload(items.slice(1500),count,null),
  vanguardFeedForIsin(VALL_ISIN));
const holder=(id,symbol,isin,valueCzk)=>({
  id,symbol,name:symbol,isin,assetClass:"etf",quantity:1,valueCzk,canonicalKey:null,
  provider:"trading212",accountName:"Invest",
});
test("official Vanguard VALL product has fixed ISIN and proven issuer GPX portId E161",()=>{
  const fund=vanguardFeedForIsin(VALL_ISIN);
  assert.equal(fund?.productId,"E161");
  assert.equal(VANGUARD_VALL_PORT_ID,"E161");
  assert.equal(vanguardFeedForIsin(VWCE_ISIN)?.productId,VANGUARD_EU_PRODUCT_ID);
  assert.notEqual(VALL_ISIN,VWCE_ISIN);
  assert.equal(vanguardFeedForIsin("VALL"),null);
  assert.equal(vanguardFeedForIsin("ie000vaht5t0")?.isin,VALL_ISIN);
});
test("Vanguard VALL GPX requires correct fund profile, all pages and one source date",()=>{
  const fund=vanguardFeedForIsin(VALL_ISIN);
  assert.equal(first().name,name);
  const parsed=parseVanguardHoldings([first(),last()],"VALL",fund);
  assert.equal(parsed.rows.length,count);
  assert.equal(parsed.count,count);
  assert.equal(parsed.asOf,"2026-09-30");
  assert.ok(Math.abs(parsed.coveragePct-98.88)<1e-8);
  assert.ok(parsed.rows.every(r=>r.fundIsin===VALL_ISIN&&r.fundSymbol==="VALL"));
  assert.throws(()=>parseVanguardPage(payload(items.slice(0,1500),count,"x",
    "Vanguard FTSE All-World UCITS ETF"),fund),/neodpovídá/);
  assert.throws(()=>parseVanguardHoldings([first()],"VALL",fund),/všechny podklady/);
  assert.throws(()=>parseVanguardHoldings([first(),
    parseVanguardPage(payload(items.slice(1500),count,null,"Vanguard FTSE All-World UCITS ETF"),
    vanguardFeedForIsin(VWCE_ISIN))],"VALL",fund),/neshoduje/);
});
test("VALL snapshot does not masquerade as VWCE and portfolio market values are conserved",()=>{
  const v= parseVanguardHoldings([first(),last()],"VGLA",vanguardFeedForIsin(VALL_ISIN));
  const x=calculateXRay([holder("val1","VALL",VALL_ISIN,1000),
    holder("val2","VGLA",VALL_ISIN,500),
    holder("unrelated","UNKNOWN","IE0000000002",300)],v.rows);
  assert.equal(x.denominatorCzk,1800);
  assert.equal(x.funds.length,2);
  assert.equal(x.funds.find(f=>f.isin===VALL_ISIN)?.valueCzk,1500);
  assert.ok(Math.abs(x.mappedCzk-1500*0.9888)<1e-8);
  assert.ok(Math.abs(x.unallocatedCzk-(300+1500*(1-0.9888)))<1e-8);
  assert.ok(Math.abs(x.mappedCzk+x.unallocatedCzk-1800)<1e-8);
  assert.ok(!x.exposures.some(e=>e.fundContributions.some(f=>f.fundIsin===VWCE_ISIN)));
});
test("VALL GPX fetch paginates with E161 and never sends broker credentials",async()=>{
  const requestIds=[],pages=[first(),last()];
  const stub=async(url,init)=>{
    assert.equal(url,VANGUARD_EU_GRAPHQL_URL);
    assert.equal(init.headers.Authorization,undefined);
    assert.equal(init.headers["X-Consumer-ID"],"ie0");
    const body=JSON.parse(init.body);
    assert.deepEqual(body.variables.portIds,["E161"]);
    assert.equal(body.variables.securityTypes,null);
    requestIds.push(body.variables.lastItemKey);
    const page=pages[requestIds.length-1];
    return new Response(JSON.stringify(payload(page.items,page.total,page.cursor,page.name)),
      {status:200,headers:{"content-type":"application/json"}});
  };
  const result=await fetchVallHoldings("VALL",true,stub);
  assert.equal(result.rows.length,2400);
  assert.equal(result.asOf,"2026-09-30");
  assert.deepEqual(requestIds,[null,"first"]);
  const saved=await fetchVallHoldings("VALU",false,async()=>{throw Error("should be cached")});
  assert.equal(saved.cached,true);
  assert.equal(saved.rows[0].fundSymbol,"VALU");
  assert.equal(saved.rows[0].fundIsin,VALL_ISIN);
});
test("VALL API + diagnostics + canary integrate without altering VWCE routing",()=>{
 const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
 const api=read("app/api/xray/auto/route.ts");
 const diagnostic=read("app/api/xray/diagnostics/route.ts");
 const canary=read("scripts/check-live-issuer-feeds.mjs");
 assert.ok(api.includes("isin === VALL_ISIN"));
 assert.ok(api.includes("fetchVallHoldings(f.symbol,force)"));
 assert.ok(api.includes("fetchVwceHoldings(f.symbol,force)"));
 assert.ok(diagnostic.includes("fetchVallHoldings(target.symbol,true)"));
 assert.ok(canary.includes('fetchVallHoldings("VALL",true)'));
 assert.ok(api.includes("localOnly(request)"));
});
