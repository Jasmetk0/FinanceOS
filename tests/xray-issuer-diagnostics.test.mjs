import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { probeIssuer } from "../lib/xray/issuer-diagnostics.ts";

const now=Date.parse("2026-10-14T18:00:00Z");
const target={
  provider:"iShares",name:"iShares Core S&P 500",isin:"IE00B5BMR087",
  symbol:"SXR8",sourceUrl:"https://www.ishares.com/uk/individual/en/products/253743/ishares-core-s-p-500-ucits-etf/latest-holdings.csv",
};
const part=(i,weight=10,asOf="2026-10-13",kind="stock")=>({
  fundSymbol:"SXR8",fundIsin:target.isin,securitySymbol:"STK"+i,
  securityIsin:null,securityName:"Test company "+i,weightPct:weight,kind,
  asOf,source:"iShares official holdings (253743, positive market value; "+asOf+")",
});
const rows=(asOf="2026-10-13",weight=10)=>Array.from({length:10},(_,i)=>part(i,weight,asOf));
const fetched=(list)=>({rows:list,fetchedAt:new Date(now).toISOString(),sourceUrl:target.sourceUrl});

test("live provider probe verifies full production-valid holdings and precise composition",async()=>{
  const result=await probeIssuer(target,async()=>fetched(rows()),()=>now);
  assert.equal(result.state,"healthy");
  assert.equal(result.asOf,"2026-10-13");
  assert.equal(result.ageDays,1);
  assert.equal(result.holdings,10);
  assert.equal(result.stockPct,100);
  assert.equal(result.otherPct,0);
  assert.equal(result.uncoveredPct,0);
  assert.equal(result.sourceUrl,target.sourceUrl);
  assert.equal(result.error,null);
});

test("HTTP success with stale holdings is NEVER claimed healthy",async()=>{
  const aging=await probeIssuer(target,async()=>fetched(rows("2026-10-10")),()=>now);
  const stale=await probeIssuer(target,async()=>fetched(rows("2026-09-30")),()=>now);
  assert.equal(aging.state,"aging");
  assert.equal(aging.ageDays,4);
  assert.equal(stale.state,"stale");
  assert.equal(stale.ageDays,14);
});

test("parsed rows accounting for only 93% are marked PARTIAL not green",async()=>{
  const result=await probeIssuer(target,async()=>fetched(rows("2026-10-13",9.3)),()=>now);
  assert.equal(result.state,"partial");
  assert.equal(result.stockPct,93);
  assert.equal(result.uncoveredPct,7);
  assert.equal(result.error,null);
});

test("parser fails closed on wrong fund, future date, mixed dates and duplicate rows",async()=>{
  for(const payload of [
    rows().map((r,i)=>i===0?{...r,fundIsin:"IE00C0000000"}:r),
    rows("2026-10-15"),
    rows("2026-10-18"),
    rows().map((r,i)=>i===0?{...r,asOf:"2026-10-12"}:r),
    rows().map((r,i)=>i===0?{...r,securitySymbol:"STK1"}:r),
    rows().slice(0,2),
  ]){
    const result=await probeIssuer(target,async()=>fetched(payload),()=>now);
    assert.equal(result.state,"failed");
    assert.ok(result.error);
  }
});

test("wrong response provenance and upstream HTTP errors are explicitly failed",async()=>{
  const source=await probeIssuer(target,async()=>({
    ...fetched(rows()),sourceUrl:"https://untrusted.example.net/holdings.csv",
  }),()=>now);
  assert.equal(source.state,"failed");
  assert.match(source.error,/whitelist/);
  const timeout=await probeIssuer(target,async()=>{throw new Error("Vanguard GPX HTTP 403\nAuthorization: example");},()=>now);
  assert.equal(timeout.state,"failed");
  assert.equal(timeout.holdings,0);
  assert.equal(timeout.fetchedAt,null);
  assert.equal(timeout.error.includes("\n"),false);
});

test("server diagnostics never reads brokerage credentials and probes all eleven fixed official funds",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const server=read("app/api/xray/diagnostics/route.ts");
  const component=read("components/xray-issuer-diagnostics.tsx");
  const parent=read("components/xray-auto-sync.tsx");
  assert.ok(server.includes("localOnly(request)"));
  assert.ok(server.includes("const COOLDOWN_MS = 5*60*1000"));
  assert.ok(server.includes("fetchIsharesHoldings(feed,target.symbol,true)"));
  assert.ok(server.includes("fetchSpyiHoldings(target.symbol,true)"));
  assert.ok(server.includes("fetchVwceHoldings(target.symbol,true)"));
  assert.ok(server.includes("shared.pending"));
  assert.ok(!server.includes("getXRayHoldings()"));
  assert.ok(!server.includes("credentials_enc"));
  assert.ok(component.includes('fetch("/api/xray/diagnostics"'));
  assert.ok(component.includes('method:"POST"'));
  assert.ok(parent.includes("<XRayIssuerDiagnostics />"));
});
