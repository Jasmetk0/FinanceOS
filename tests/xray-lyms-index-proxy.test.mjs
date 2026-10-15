import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calculateXRay,validateXRayConstituents} from "../lib/xray/engine.ts";
import {
  LYMS_ISIN,CNDX_ISIN,CNDX_PROXY_URL,
  cndxAsLymsProxy,fetchLymsProxyHoldings,
} from "../lib/xray/auto-lyms-proxy.ts";
import {issuerFeedForIsin} from "../lib/xray/auto-ishares.ts";

const day=new Date(Date.now()-24*3600_000).toISOString().slice(0,10);
const rows=(date=day,kind="fund-holdings")=>[
  ...Array.from({length:100},(_,i)=>({
    fundSymbol:"CNDX",fundIsin:CNDX_ISIN,
    securitySymbol:i===0?"MSFT":"NDX"+i,
    securityName:i===0?"Microsoft Corporation":"Nasdaq company "+i,
    securityIsin:i===0?"US5949181045":null,
    weightPct:0.99,kind:"stock",asOf:date,source:"iShares official holdings (253741)",
    exposureBasis:kind,
  })),
  {fundSymbol:"CNDX",fundIsin:CNDX_ISIN,securitySymbol:"OTHER-CASH",
    securityName:"Net cash",securityIsin:null,weightPct:1,kind:"other",
    asOf:date,source:"iShares official holdings (253741)",exposureBasis:kind},
];
const holding=(id,symbol,assetClass,valueCzk,isin)=>({
  id,symbol,assetClass,valueCzk,isin,name:symbol,quantity:1,canonicalKey:null,
  provider:"trading212",accountName:"Invest",
});

test("official CNDX feed is allowlisted by exact ISIN with product ID, never ticker guessing",()=>{
  const feed=issuerFeedForIsin(CNDX_ISIN);
  assert.equal(feed?.productId,"253741");
  assert.equal(feed?.url,CNDX_PROXY_URL);
  assert.equal(issuerFeedForIsin("CNDX"),null);
  assert.equal(LYMS_ISIN,"LU1829221024");
});

test("LYMS full proxy is stock-only, immutable original CNDX snapshot and labelled as model",()=>{
  const original=rows();
  const converted=cndxAsLymsProxy(original,"LYMS");
  assert.equal(converted.length,100);
  assert.equal(converted[0].fundIsin,LYMS_ISIN);
  assert.ok(converted.every(r=>r.kind==="stock"&&r.exposureBasis==="reference-index-proxy"));
  assert.ok(converted[0].source.includes("NE Nasdaq XNDXNNR"));
  assert.equal(original[0].fundIsin,CNDX_ISIN);
  assert.equal(original[0].exposureBasis,"fund-holdings");
  assert.ok(Math.abs(converted.reduce((sum,x)=>sum+x.weightPct,0)-99)<1e-7);
});

test("100 real proxy rows aggregate into economically estimated LYMS exposure without double counting",()=>{
  const proxy=cndxAsLymsProxy(rows(),"LYMS");
  const result=calculateXRay([
    holding("lyms","LYMS","etf",25116,LYMS_ISIN),
    holding("direct","MSFT","stock",300,"US5949181045"),
  ],proxy);
  assert.equal(result.funds.length,1);
  assert.equal(result.denominatorCzk,25416);
  assert.ok(Math.abs(result.mappedCzk-(25116*.99+300))<1e-7);
  assert.ok(Math.abs(result.estimatedProxyCzk-25116*.99)<1e-7);
  assert.ok(Math.abs(result.unallocatedCzk-251.16)<1e-7);
  const msft=result.exposures.find(x=>x.key==="stock|isin:US5949181045");
  assert.ok(msft);
  assert.ok(Math.abs(msft.viaFundsCzk-248.6484)<1e-8);
  assert.equal(msft.directCzk,300);
  assert.equal(msft.fundContributions[0].exposureBasis,"reference-index-proxy");
  assert.equal(result.funds[0].exposureBasis,"reference-index-proxy");
  assert.match(result.funds[0].note,/ODHAD/);
  assert.match(result.warnings.join(" "),/proxy/);
  assert.ok(result.exposures.some(x=>x.ticker==="NDX1"));
  assert.ok(Math.abs(result.mappedCzk+result.unallocatedCzk-result.denominatorCzk)<1e-7);
});

test("official CNDX itself remains an independently valued physical ETF if also held with LYMS",()=>{
  const full=rows();
  const proxy=cndxAsLymsProxy(full,"LYMS");
  const result=calculateXRay([
    holding("cndx","CNDX","etf",1000,CNDX_ISIN),
    holding("lyms","LYMS","etf",2000,LYMS_ISIN),
  ],[...full,...proxy]);
  assert.equal(result.denominatorCzk,3000);
  assert.equal(result.funds.length,2);
  assert.equal(result.funds.find(x=>x.isin===CNDX_ISIN)?.exposureBasis,undefined);
  assert.equal(result.funds.find(x=>x.isin===LYMS_ISIN)?.exposureBasis,"reference-index-proxy");
  assert.ok(Math.abs(result.mappedCzk+result.unallocatedCzk-3000)<1e-7);
  assert.ok(Math.abs(result.estimatedProxyCzk-1980)<1e-7);
});

test("proxy fails closed on missing source identity, malformed, insufficient or stale constituents",()=>{
  const old=new Date(Date.now()-17*86_400_000).toISOString().slice(0,10);
  for(const invalid of [
    rows().slice(0,20),
    rows(old),
    rows().map((r,i)=>i===0?{...r,fundIsin:LYMS_ISIN}:r),
    rows().map((r,i)=>i<5?{...r,weightPct:0}:r),
    rows().map((r,i)=>i<5?{...r,kind:"other"}:r),
    rows().map((r,i)=>i===0?{...r,exposureBasis:"substitute-basket"}:r),
  ]){
    assert.throws(()=>cndxAsLymsProxy(invalid,"LYMS"),/CNDX|iShares|Neplatný|Proxy|proxy|podklad/);
  }
});

test("synthetic LYMS index proxy with old date never appears as current indexed exposure even from cache",()=>{
  const old=new Date(Date.now()-20*86_400_000).toISOString().slice(0,10);
  const stale=rows(old).filter(r=>r.kind==="stock")
    .map(r=>({...r,fundIsin:LYMS_ISIN,fundSymbol:"LYMS",exposureBasis:"reference-index-proxy"}));
  validateXRayConstituents(stale);
  const result=calculateXRay([holding("lyms","LYMS","etf",1000,LYMS_ISIN)],stale);
  assert.equal(result.mappedCzk,0);
  assert.equal(result.unallocatedCzk,1000);
  assert.equal(result.estimatedProxyCzk,0);
  assert.match(result.funds[0].note,/14 dní/);
});

test("proxy cannot be assigned to physical ETFs even when complete and has exact ISIN",()=>{
  const proxy=cndxAsLymsProxy(rows(),"LYMS").map(x=>({...x,fundIsin:CNDX_ISIN,fundSymbol:"CNDX"}));
  const result=calculateXRay([holding("cndx","CNDX","etf",1000,CNDX_ISIN)],proxy);
  assert.equal(result.mappedCzk,0);
  assert.match(result.warnings.join(" "),/Fyzické ETF/);
});

test("automatic LYMS proxy performs only one issuer-allowlisted public fetch with no broker credentials",async()=>{
  const called=[];
  const stub=async(feed,symbol,force)=>{
    called.push({feed,symbol,force});
    return {rows:rows(),sourceUrl:feed.url,fetchedAt:new Date().toISOString(),cached:false};
  };
  const fetched=await fetchLymsProxyHoldings("LYMS",true,stub);
  assert.equal(fetched.rows.length,100);
  assert.equal(fetched.sourceKind,"proxy-model");
  assert.equal(fetched.sourceUrl,CNDX_PROXY_URL);
  assert.deepEqual(called.map(x=>[x.feed.isin,x.symbol,x.force]),[[CNDX_ISIN,"CNDX",true]]);
});

test("UI and API identify source explicitly as non-exact index-proxy",()=>{
  const read=x=>readFileSync(new URL("../"+x,import.meta.url),"utf8");
  assert.ok(read("components/portfolio-xray.tsx").includes('f.exposureBasis==="reference-index-proxy"'));
  assert.ok(read("components/portfolio-xray.tsx").includes("data.estimatedProxyCzk>0"));
  assert.ok(read("components/xray-exposure-breakdown.tsx").includes('item.exposureBasis==="reference-index-proxy"'));
  assert.ok(read("app/api/xray/auto/route.ts").includes('sourceKind:"proxy-model"'));
});
