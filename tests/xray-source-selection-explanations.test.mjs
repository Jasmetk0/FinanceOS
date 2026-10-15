import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  explainConstituentSources,combineConstituentSources,
} from "../lib/xray/auto-merge.ts";
import {calculateXRay} from "../lib/xray/engine.ts";

const EQQQ="IE0032077012",VALL="IE000VAHT5T0",LYMS="LU1829221024",SPYI="IE00B3YLTY66";
const DAY=86_400_000;
const day=age=>new Date(Date.now()-age*DAY).toISOString().slice(0,10);
function basket(isin,symbol,n,pct,age,source,basis="fund-holdings"){
 return Array.from({length:n},(_,i)=>({
   fundSymbol:symbol,fundIsin:isin,securitySymbol:"STK"+String(i).padStart(4,"0"),
   securityName:"Stock "+i,securityIsin:null,
   kind:"stock",weightPct:pct/n,asOf:day(age),source,exposureBasis:basis,
 }));
}
const holding=(isin,symbol,valueCzk)=>({
  id:isin+symbol,isin,symbol,name:symbol,quantity:1,valueCzk,
  assetClass:"etf",canonicalKey:null,provider:"trading212",accountName:"Invest",
});
const decide=(manual,auto)=>explainConstituentSources(manual,auto);
test("audited decisions reuse exactly the authoritative rows for every legacy calculation",()=>{
 const a=basket(EQQQ,"EQQQ",100,99.7,1,"third-party Invesco archive");
 const top=basket(EQQQ,"EQQQ",10,63,0,"manual-top-ten.csv");
 const va=basket(VALL,"VALL",100,98.9,2,"Vanguard GPX");
 const vm=basket(VALL,"VALL",96,99.8,0,"manual-complete.csv");
 const audit=decide([...top,...vm],[...a,...va]);
 assert.deepEqual(audit.rows,combineConstituentSources([...top,...vm],[...a,...va]));
 assert.equal(audit.decisions.length,2);
 const eq=audit.decisions.find(d=>d.fundKey==="isin:"+EQQQ);
 const vall=audit.decisions.find(d=>d.fundKey==="isin:"+VALL);
 assert.equal(eq.selected,"automatic");
 assert.equal(eq.reason,"automatic-more-complete");
 assert.equal(eq.automatic.rows,100);
 assert.ok(Math.abs(eq.automatic.identifiedPct-99.7)<1e-7);
 assert.ok(Math.abs(eq.manual.totalPct-63)<1e-7);
 assert.equal(eq.manual.source,"manual-top-ten.csv");
 assert.equal(vall.selected,"manual");
 assert.equal(vall.reason,"manual-newer");
 assert.equal(vall.manual.rows,96);
 const report=calculateXRay([
   holding(EQQQ,"EQQQ",1000),holding(VALL,"VALL",800),
 ],audit.rows);
 assert.equal(report.denominatorCzk,1800);
 assert.ok(Math.abs(report.mappedCzk-(997+798.4))<1e-6);
 assert.ok(Math.abs(report.mappedCzk+report.unallocatedCzk-1800)<1e-7);
});
test("manual-only and automatic-only decisions carry precise provenance and do not invent alternatives",()=>{
 const manual=basket(EQQQ,"EQQQ",10,60,0,"manual.csv");
 const auto=basket(VALL,"VALL",100,99.8,1,"issuer GPX");
 const audit=decide(manual,auto);
 assert.equal(audit.decisions[0].reason,"manual-only");
 assert.equal(audit.decisions[0].automatic,null);
 assert.equal(audit.decisions[0].manual.eligible,true);
 assert.equal(audit.decisions[1].reason,"automatic-only");
 assert.equal(audit.decisions[1].manual,null);
 assert.equal(audit.decisions[1].automatic.asOf,day(1));
});
test("extra OTHER makes a top-ten 100% but audit still says why full issuer wins",()=>{
 const local=[...basket(EQQQ,"EQQQ",10,60,0,"top10.csv"),{
   ...basket(EQQQ,"EQQQ",1,40,0,"top10.csv")[0],
   securitySymbol:"OTHER",securityName:"Other",kind:"other",
 }];
 const auto=basket(EQQQ,"EQQQ",100,99.9,1,"archive");
 const audit=decide(local,auto);
 const d=audit.decisions[0];
 assert.equal(d.reason,"automatic-more-complete");
 assert.ok(Math.abs(d.manual.totalPct-100)<1e-9);
 assert.ok(Math.abs(d.manual.identifiedPct-60)<1e-9);
 assert.equal(d.automatic.rows,100);
 assert.ok(d.automatic.identifiedPct>99);
});
test("bad date cannot disguise an unusable manual source in UI provenance",()=>{
 const m=basket(VALL,"VALL",100,99.9,0,"manual");
 m.forEach(r=>r.asOf="2099-01-01");
 const a=basket(VALL,"VALL",100,99.7,2,"official");
 const result=decide(m,a);
 assert.equal(result.decisions[0].reason,"automatic-compatible");
 assert.equal(result.decisions[0].manual.eligible,false);
 assert.equal(result.decisions[0].automatic.eligible,true);
});
test("LYMS exact index wins equal dated CNDX proxy and audit never calls it physical holding",()=>{
 const exact=basket(LYMS,"LYMS",100,99,1,"real index","reference-index");
 const approximate=basket(LYMS,"LYMS",100,99,1,"CNDX proxy","reference-index-proxy");
 const d=decide(exact,approximate).decisions[0];
 assert.equal(d.reason,"manual-exact-index-tie");
 assert.equal(d.selected,"manual");
 assert.equal(d.manual.exposureBasis,"reference-index");
 assert.equal(d.automatic.exposureBasis,"reference-index-proxy");
 const report=calculateXRay([holding(LYMS,"LYMS",1000)],decide(exact,approximate).rows);
 assert.equal(report.estimatedProxyCzk,0);
});
test("an unowned SPYI identity-only auto reference wins without entering NAV",()=>{
 const ref=basket(SPYI,"SPYI (identita)",100,99,1,
   "State Street official daily SPYI XLSX; "+day(1)+"; identity-only reference");
 const local=basket(SPYI,"SPYI",100,99,0,"manual.csv");
 const data=decide(local,ref);
 assert.equal(data.decisions[0].reason,"identity-reference");
 assert.equal(data.decisions[0].selected,"automatic");
 const portfolio=calculateXRay([holding(VALL,"VALL",1000)],data.rows);
 assert.equal(portfolio.denominatorCzk,1000);
 assert.equal(portfolio.funds.length,1);
 assert.equal(portfolio.funds[0].mappedPct,0);
});
test("ineligible fallback is explicitly reported and never marked as verified",()=>{
 const local=basket(LYMS,"LYMS",5,50,1,"swap basket","substitute-basket");
 const remote=basket(LYMS,"LYMS",10,60,2,"top ten proxy","reference-index-proxy");
 const d=decide(local,remote).decisions[0];
 assert.equal(d.reason,"ineligible-fallback");
 assert.equal(d.selected,"manual");
 assert.equal(d.manual.eligible,false);
 assert.equal(d.automatic.eligible,false);
 const result=calculateXRay([holding(LYMS,"LYMS",1000)],decide(local,remote).rows);
 assert.equal(result.mappedCzk,0);
 assert.equal(result.unallocatedCzk,1000);
});
test("snapshot metadata is grouped by ISIN across exchange tickers, not by brokerage",()=>{
 const original=basket(VALL,"VALL",100,99,1,"issuer");
 const duplicate=basket(VALL,"VGLA",100,99,0,"manual");
 const result=decide(duplicate,original);
 assert.equal(result.decisions.length,1);
 assert.equal(result.decisions[0].fundSymbol,"VGLA");
 assert.equal(result.decisions[0].fundKey,"isin:"+VALL);
 assert.equal(result.decisions[0].selected,"manual");
});
test("dashboard links real source selection to calculated fund coverage, never fabricated fresh status",()=>{
 const app=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
 const widget=readFileSync(new URL("../components/xray-source-selection-audit.tsx",import.meta.url),"utf8");
 assert.ok(app.includes("explainConstituentSources(constituents,automaticRows)"));
 assert.ok(app.includes("decisions={selectedSources.decisions}"));
 assert.ok(widget.includes("f.mappedPct"));
 assert.ok(widget.includes("d.reason"));
 assert.ok(widget.includes("data.eligible"));
 assert.ok(widget.includes("reference-index-proxy"));
 assert.ok(widget.includes("f.source===null"));
 assert.ok(widget.includes("d.manual"));
 assert.ok(widget.includes("d.automatic"));
 assert.ok(widget.includes("fundKey(f)"));
 assert.ok(!widget.includes("portfolioValue"));
});
