import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizedSedol, buildSedolIsinCrosswalk, resolveSecurityIsin } from "../lib/xray/security-identity.ts";
import { calculateXRay, validateXRayConstituents } from "../lib/xray/engine.ts";

const vanguard="IE00BK5BQT80",spdr="IE00B3YLTY66", msft="US5949181045";
const stock=(fundIsin,symbol,securityIsin,securitySedol,weightPct,source)=>{
  return { fundSymbol:fundIsin===vanguard?"VWCE":"SPYI",fundIsin,
    securitySymbol:symbol,securityIsin,securitySedol,securityName:symbol,
    weightPct,kind:"stock",asOf:"2026-10-13",source};
};
const vg=(symbol,sedol,weight)=>stock(vanguard,symbol,null,sedol,weight,
  "Vanguard EU official GPX holdings; 2026-10-13");
const ss=(isin,sedol,weight)=>stock(spdr,isin,isin,sedol,weight,
  "State Street official daily SPYI XLSX; 2026-10-13");
const holding=(id,symbol,assetClass,valueCzk,isin)=>({
  id,symbol,name:symbol,assetClass,valueCzk,isin,
  canonicalKey:null,quantity:1,provider:"trading212",accountName:"Invest",
});

test("strict SEDOL check digits: examples, case and forbidden letters",()=>{
  assert.equal(normalizedSedol(" b1yw440 "),"B1YW440");
  assert.equal(normalizedSedol("0263494"),"0263494");
  assert.equal(normalizedSedol("B1YW441"),null);
  assert.equal(normalizedSedol("B1IW440"),null);
  assert.equal(normalizedSedol("A000001"),null);
  assert.equal(normalizedSedol("026349"),null);
  assert.equal(normalizedSedol(null),null);
});

test("Vanguard + SPDR + direct shares become one precisely identified share-class exposure",()=>{
  const composition=[
    vg("MSFT@B1YW440","B1YW440",10),
    ss(msft,"B1YW440",20),
  ];
  validateXRayConstituents(composition);
  const holdings=[
    holding("direct","MSFT","stock",100,msft),
    holding("etf-a","VWCE","etf",1000,vanguard),
    holding("etf-b","SPYI","etf",500,spdr),
  ];
  const report=calculateXRay(holdings,composition);
  assert.equal(report.denominatorCzk,1600);
  const exposure=report.exposures.find(e=>e.key==="stock|isin:"+msft);
  assert.ok(exposure);
  assert.equal(exposure.directCzk,100);
  assert.equal(exposure.viaFundsCzk,200);
  assert.equal(exposure.totalCzk,300);
  assert.deepEqual(exposure.fundSymbols,["SPYI","VWCE"]);
  assert.equal(report.exposures.length,1);
  assert.equal(report.mappedCzk,300);
  assert.equal(report.unallocatedCzk,1300);
  assert.ok(Math.abs(report.denominatorCzk-report.mappedCzk-report.unallocatedCzk)<1e-7);
});

test("SPDR feed without actual SEDOL does NOT infer matching Vanguard shares from names/tickers",()=>{
  const c=[vg("MSFT@B1YW440","B1YW440",10),ss(msft,null,20)];
  const r=calculateXRay([
    holding("direct","MSFT","stock",100,msft),
    holding("v","VWCE","etf",1000,vanguard),
    holding("s","SPYI","etf",500,spdr),
  ],c);
  assert.equal(r.exposures.length,2);
  assert.equal(r.exposures.find(e=>e.key==="stock|isin:"+msft).totalCzk,200);
  assert.equal(r.exposures.find(e=>e.ticker==="MSFT@B1YW440").viaFundsCzk,100);
});

test("conflicting SEDOL->two ISINs are quarantined without cross-provider false merge",()=>{
  const c=[vg("MSFT@B1YW440","B1YW440",10),
    ss(msft,"B1YW440",15),
    ss("US0000000002","B1YW440",5)];
  const index=buildSedolIsinCrosswalk(c);
  assert.equal(index.exact.size,0);
  assert.ok(index.conflicted.has("B1YW440"));
  const result=calculateXRay([
    holding("v","VWCE","etf",1000,vanguard),
    holding("s","SPYI","etf",1000,spdr),
  ],c);
  assert.equal(result.exposures.length,3);
  assert.equal(result.denominatorCzk,2000);
  assert.equal(result.mappedCzk,300);
  assert.equal(result.unallocatedCzk,1700);
});

test("invalid, forged or unlabeled data cannot act as a cross-provider identifier bridge",()=>{
  const fake=ss(msft,"B1YW440",20);
  const invalid=[vg("MSFT@B1YW440","B1YW440",10),
    {...fake,source:"manual-fund-import.csv"}];
  assert.equal(buildSedolIsinCrosswalk(invalid).linkedCount,0);
  assert.equal(resolveSecurityIsin(invalid[0],buildSedolIsinCrosswalk(invalid)),null);
  const noCheckDigit=vg("MSFT@B1YW441","B1YW441",10);
  assert.throws(()=>validateXRayConstituents([noCheckDigit]),/Neplatný podklad/);
});

test("manual extra securitySedol metadata is optional; unchanged legacy data passes",()=>{
  const legacy=vg("MSFT@B1YW440",null,30);
  validateXRayConstituents([legacy]);
  const c=buildSedolIsinCrosswalk([legacy]);
  assert.equal(c.linkedCount,0);
});

test("Vanguard and SPDR ingest check-digit-sound SEDOL while preserving official source identity",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const [vgCode,spCode]=await Promise.all([read("lib/xray/auto-vanguard.ts"),read("lib/xray/auto-spyi.ts")]);
  assert.ok(vgCode.includes("securitySedol:kind==="));
  assert.ok(spCode.includes("securitySedol:isEquity?sedol:null"));
});
