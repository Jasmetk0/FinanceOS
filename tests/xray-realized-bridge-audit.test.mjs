import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay } from "../lib/xray/engine.ts";

const VWCE="IE00BK5BQT80",VALL="IE000VAHT5T0",SPYI="IE00B3YLTY66";
const MSFT="US5949181045",NVDA="US67066G1040";
const MSFT_SEDOL="B1YW440",NVDA_SEDOL="0263494",UNKNOWN_SEDOL="0000000";
const DAY=86_400_000;
const asOf=(days=1)=>new Date(Date.now()-days*DAY).toISOString().slice(0,10);
const holding=(id,symbol,assetClass,valueCzk,isin=null)=>({
  id,symbol,name:symbol,assetClass,valueCzk,isin,quantity:1,
  canonicalKey:null,provider:"trading212",accountName:"Invest",
});
const issuer=(fundSymbol,fundIsin,securitySymbol,securitySedol,weightPct,securityIsin=null)=>({
  fundSymbol,fundIsin,securitySymbol,securitySedol,securityIsin,
  securityName:securitySymbol,kind:"stock",weightPct,asOf:asOf(1),
  source:"Vanguard EU official GPX holdings; "+asOf(1),
});
const spyiRef=(ticker,sedol,isin,days=1)=>({
  fundSymbol:"SPYI",fundIsin:SPYI,securitySymbol:ticker,securitySedol:sedol,
  securityIsin:isin,securityName:ticker,kind:"stock",weightPct:1,asOf:asOf(days),
  source:"State Street official daily SPYI XLSX; "+asOf(days)+"; identity-only reference",
});
const holdings=[
  holding("vwce","VWCE","etf",1000,VWCE),
  holding("vwra","VWRA","etf",500,VWCE),
  holding("vall","VALL","etf",1000,VALL),
  holding("microsoft","MSFT","stock",100,MSFT),
  holding("nvidia","NVDA","stock",200,NVDA),
];
const fundRows=[
  issuer("VWCE",VWCE,"MSFT@B1YW440",MSFT_SEDOL,20),
  issuer("VWCE",VWCE,"NVDA@0263494",NVDA_SEDOL,10),
  issuer("VWCE",VWCE,"OTH@0000000",UNKNOWN_SEDOL,5),
  issuer("VALL",VALL,"MSFT@B1YW440",MSFT_SEDOL,15),
  issuer("VALL",VALL,"UNKNOWN@0000000",UNKNOWN_SEDOL,5),
  issuer("VALL",VALL,"NOID",null,10),
];
const reference=[
  spyiRef("MSFT",MSFT_SEDOL,MSFT),
  spyiRef("NVDA",NVDA_SEDOL,NVDA),
];

test("realized identity matches count held fund lines once across brokerage accounts",()=>{
  const result=calculateXRay(holdings,[...fundRows,...reference]);
  const audit=result.bridgeAudit;
  assert.equal(result.denominatorCzk,2800);
  assert.equal(result.mappedCzk,1125);
  assert.equal(result.unallocatedCzk,1675);
  assert.equal(audit.bridgedLines,3);
  assert.equal(audit.unresolvedSedolLines,2);
  assert.equal(audit.bridgedCzk,600);
  assert.equal(audit.unresolvedSedolCzk,125);
  assert.equal(audit.distinctBridgedIsins,2);
  assert.equal(audit.matchedDirectIsins,2);
  assert.equal(audit.funds.length,2);
  const vwce=audit.funds.find(f=>f.fundIsin===VWCE);
  const vall=audit.funds.find(f=>f.fundIsin===VALL);
  assert.ok(vwce);
  assert.equal(vwce.fundSymbol,"VWCE / VWRA");
  assert.equal(vwce.bridgedLines,2); // not counted again for second broker account
  assert.equal(vwce.unresolvedSedolLines,1);
  assert.equal(vwce.bridgedCzk,450);
  assert.equal(vwce.unresolvedSedolCzk,75);
  assert.equal(vwce.distinctBridgedIsins,2);
  assert.equal(vall.bridgedLines,1);
  assert.equal(vall.bridgedCzk,150);
  assert.equal(vall.unresolvedSedolLines,1);
  assert.equal(vall.unresolvedSedolCzk,50);
  assert.equal(vall.distinctBridgedIsins,1);
  assert.equal(result.identityCoverage.bridgedCzk,audit.bridgedCzk);
  assert.equal(result.identityCoverage.sedolOnlyCzk,audit.unresolvedSedolCzk);
  // SPYI identity-only rows do not count as holdings or as reference rows.
  assert.ok(result.funds.every(f=>f.isin!==SPYI));
});

test("dictionary size is NOT presented as number of actually matched securities",()=>{
  const checkWeights=[1,3,1,7,3,9];
  const surplus=Array.from({length:300},(_,i)=>{
    const stem=String(i+100).padStart(6,"0");
    const weighted=[...stem].reduce((sum,d,index)=>sum+Number(d)*checkWeights[index],0);
    const sedol=stem+String((10-weighted%10)%10);
    return {...spyiRef("UNUSED"+i,sedol,"US"+String(i+100).padStart(10,"0")),
      weightPct:0.001};
  });
  // Even a valid but irrelevant entry cannot change actual valued matches.
  const oneUnused=spyiRef("UNUSED","2588173","US0000000012");
  const r=calculateXRay(holdings,[...fundRows,...reference,oneUnused,...surplus]);
  assert.equal(r.bridgeAudit.bridgedLines,3);
  assert.equal(r.bridgeAudit.distinctBridgedIsins,2);
  assert.equal(r.bridgeAudit.matchedDirectIsins,2);
});

test("without SPYI security identity, only checked SEDOL is known; no invented direct match",()=>{
  const r=calculateXRay(holdings,fundRows);
  assert.equal(r.bridgeAudit.bridgedLines,0);
  assert.equal(r.bridgeAudit.unresolvedSedolLines,5);
  assert.equal(r.bridgeAudit.bridgedCzk,0);
  assert.equal(r.bridgeAudit.unresolvedSedolCzk,725);
  assert.equal(r.bridgeAudit.matchedDirectIsins,0);
  assert.equal(r.identityCoverage.sedolOnlyCzk,725);
  assert.ok(Math.abs(r.mappedCzk+r.unallocatedCzk-r.denominatorCzk)<1e-7);
});

test("stale identity-only reference stops creating matches even with browser cache still populated",()=>{
  const old=reference.map(r=>({
    ...r,asOf:asOf(19),
    source:"State Street official daily SPYI XLSX; "+asOf(19)+"; identity-only reference",
  }));
  const r=calculateXRay(holdings,[...fundRows,...old]);
  assert.equal(r.bridgeAudit.bridgedLines,0);
  assert.equal(r.bridgeAudit.matchedDirectIsins,0);
  assert.equal(r.bridgeAudit.unresolvedSedolCzk,725);
});

test("direct stock with same ticker but NO reliable ISIN remains a separate position",()=>{
  const r=calculateXRay([...holdings,holding("unverified","MSFT","stock",50)],
    [...fundRows,...reference]);
  assert.equal(r.bridgeAudit.matchedDirectIsins,2);
  assert.equal(r.exposures.find(e=>e.key==="stock|position:unverified").directCzk,50);
  assert.equal(r.denominatorCzk,2850);
});

test("only owned fund contribution generates money/line counts: identity-only data alone reports zero",()=>{
  const r=calculateXRay([holding("direct","MSFT","stock",100,MSFT)],reference);
  assert.deepEqual(r.bridgeAudit,{
    bridgedLines:0,unresolvedSedolLines:0,bridgedCzk:0,unresolvedSedolCzk:0,
    distinctBridgedIsins:0,matchedDirectIsins:0,funds:[],
  });
});

test("Vanguard rows with explicit ISIN are verified, not inflated as SEDOL bridges",()=>{
  const explicit=fundRows.map(row=>row.securitySedol===MSFT_SEDOL?
    {...row,securityIsin:MSFT}:row);
  const r=calculateXRay(holdings,[...explicit,...reference]);
  assert.equal(r.bridgeAudit.bridgedLines,1); // only NVDA in VWCE
  assert.equal(r.bridgeAudit.bridgedCzk,150);
  assert.equal(r.bridgeAudit.distinctBridgedIsins,1);
  assert.equal(r.bridgeAudit.matchedDirectIsins,1);
  assert.ok(r.identityCoverage.isinCzk>=550); // direct 300 + MSFT via both ETFs 450
});

test("readable interface renders real fund CZK, distinct ISIN and direct overlap, not dictionary size",()=>{
  const ui=readFileSync(new URL("../components/xray-identity-quality.tsx",import.meta.url),"utf8");
  const app=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
  assert.ok(ui.includes("bridgeAudit.bridgedCzk"));
  assert.ok(ui.includes("bridgeAudit.distinctBridgedIsins"));
  assert.ok(ui.includes("bridgeAudit.matchedDirectIsins"));
  assert.ok(ui.includes("bridgeAudit.funds.map"));
  assert.ok(app.includes("bridgeAudit={data.bridgeAudit}"));
});
