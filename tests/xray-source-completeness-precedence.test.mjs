import test from "node:test";
import assert from "node:assert/strict";
import {combineConstituentSources} from "../lib/xray/auto-merge.ts";
import {calculateXRay} from "../lib/xray/engine.ts";

const EQQQ="IE0032077012",VALL="IE000VAHT5T0";
const DAY=86_400_000;
const dated=n=>new Date(Date.now()-n*DAY).toISOString().slice(0,10);
const row=(fundIsin,symbol,pct,asOf,source,kind="stock")=>({
  fundIsin,fundSymbol:fundIsin===EQQQ?"EQQQ":"VALL",
  securitySymbol:symbol,securityName:symbol,securityIsin:null,
  kind,weightPct:pct,asOf,source,exposureBasis:"fund-holdings",
});
const basket=(isin,n,pct,age,source)=>
  Array.from({length:n},(_,i)=>row(isin,"STOCK"+String(i).padStart(3,"0"),pct/n,dated(age),source));
const actual=(isin,valueCzk)=>({
  id:isin,symbol:isin===EQQQ?"EQQQ":"VALL",name:"ETF",isin,
  quantity:1,valueCzk,assetClass:"etf",canonicalKey:null,
  provider:"trading212",accountName:"Invest",
});
const assertValue=(rows,isin,expectedMapped,valueCzk=1000)=>{
  const x=calculateXRay([actual(isin,valueCzk)],rows);
  assert.ok(Math.abs(x.denominatorCzk-valueCzk)<1e-8);
  assert.ok(Math.abs(x.mappedCzk-expectedMapped)<1e-8);
  assert.ok(Math.abs(x.mappedCzk+x.unallocatedCzk-valueCzk)<1e-8);
};
test("newer manual top-10 63% cannot displace complete 99.6% issuer EQQQ holdings",()=>{
  const manual=basket(EQQQ,10,63,0,"imported-public-top-ten.csv");
  const automatic=basket(EQQQ,100,99.6,1,"Invesco issuer archive complete");
  const result=combineConstituentSources(manual,automatic);
  assert.deepEqual(result,automatic);
  assertValue(result,EQQQ,996);
});
test("partial top 10 with an OTHER residual to make 100% cannot replace complete issuer stocks",()=>{
  const manual=[...basket(EQQQ,10,60,0,"top-ten-with-rest.csv"),
    row(EQQQ,"REMAINING",40,dated(0),"top-ten-with-rest.csv","other")];
  const automatic=basket(EQQQ,100,99.7,2,"complete-full-ETF");
  const result=combineConstituentSources(manual,automatic);
  assert.deepEqual(result,automatic);
  assertValue(result,EQQQ,997);
});
test("newer 10-stock CSV claiming 100% is not mistaken for 100-stock issuer physical fund",()=>{
  const manual=basket(EQQQ,10,100,0,"manually-reweighted-top-ten.csv");
  const automatic=basket(EQQQ,100,99.9,1,"complete-full-ETF");
  assert.deepEqual(combineConstituentSources(manual,automatic),automatic);
});
test("manual complete correction newer than issuer remains honored",()=>{
  const manual=basket(EQQQ,98,99.95,0,"verified-manual-complete.csv");
  const automatic=basket(EQQQ,100,99.8,1,"complete-full-ETF");
  const result=combineConstituentSources(manual,automatic);
  assert.deepEqual(result,manual);
  assertValue(result,EQQQ,999.5);
});
test("when automatic source becomes incomplete, full manual basket remains even if older",()=>{
  const manual=basket(VALL,120,98.8,2,"verified-complete-manual.csv");
  const automatic=basket(VALL,10,45,0,"network-partial-response");
  const result=combineConstituentSources(manual,automatic);
  assert.deepEqual(result,manual);
  assertValue(result,VALL,988);
});
test("manual partial import still works by itself when there is no automatic provider",()=>{
  const manual=basket(EQQQ,10,63,0,"standalone-manual.csv");
  const result=combineConstituentSources(manual,[]);
  assert.deepEqual(result,manual);
  assertValue(result,EQQQ,630);
});
test("mixed manual snapshot dates cannot override one coherent automatic snapshot",()=>{
  const local=basket(EQQQ,100,99.9,0,"newer-manual.csv");
  local[10]={...local[10],asOf:dated(1)};
  const official=basket(EQQQ,100,99.9,2,"complete-source");
  assert.deepEqual(combineConstituentSources(local,official),official);
});
test("mixed manual sources cannot override a coherent dated issuer",()=>{
  const local=basket(EQQQ,100,99.9,0,"newer-manual.csv");
  local[10]={...local[10],source:"different-csv-source"};
  const official=basket(EQQQ,100,99.9,2,"complete-source");
  assert.deepEqual(combineConstituentSources(local,official),official);
});
test("bad manual calendar date cannot override a valid issuer holdings day",()=>{
  const local=basket(EQQQ,100,99.9,0,"newer-manual.csv");
  for(const x of local)x.asOf="2026-02-30";
  const official=basket(EQQQ,100,99.9,2,"complete-source");
  assert.deepEqual(combineConstituentSources(local,official),official);
});
test("two independent valid funds are arbitrated without cross-fund mixing",()=>{
  const auto=[...basket(EQQQ,100,99.9,1,"Invesco archive"),
    ...basket(VALL,100,98.7,1,"Vanguard GPX")];
  const manual=[...basket(EQQQ,10,70,0,"top 10 EQQQ"),
    ...basket(VALL,100,99.6,0,"full VALL manual")];
  const result=combineConstituentSources(manual,auto);
  assert.equal(result.filter(x=>x.fundIsin===EQQQ).length,100);
  assert.equal(result.filter(x=>x.fundIsin===VALL).length,100);
  assert.ok(result.filter(x=>x.fundIsin===EQQQ).every(x=>x.source==="Invesco archive"));
  assert.ok(result.filter(x=>x.fundIsin===VALL).every(x=>x.source==="full VALL manual"));
  const x=calculateXRay([actual(EQQQ,1000),actual(VALL,1000)],result);
  assert.ok(Math.abs(x.mappedCzk-1995)<1e-8);
  assert.ok(Math.abs(x.unallocatedCzk-5)<1e-8);
});
