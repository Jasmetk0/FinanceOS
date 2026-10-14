import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay } from "../lib/xray/engine.ts";
import {
  classifyIssuerDate, reconcileIssuerRows, issuerKey,
  ISSUER_FRESH_DAYS, ISSUER_OLD_DAYS,
} from "../lib/xray/issuer-reliability.ts";
import { validateIssuerCache } from "../lib/xray/issuer-cache.ts";

const MSFT="US5949181045", VWCE="IE00BK5BQT80", SPYI="IE00B3YLTY66";
const now=Date.parse("2026-10-14T19:00:00Z");
const part=(isin, symbol, weight, asOf="2026-10-13", source="Vanguard",securityIsin=null)=>({
  fundSymbol:isin===VWCE?"VWCE":"SPYI",fundIsin:isin,securitySymbol:symbol,
  securityIsin,securityName:symbol,weightPct:weight,kind:"stock",asOf,source,
});
const fund=(isin,status="ok",asOf="2026-10-13")=>({
  isin,symbol:isin===VWCE?"VWCE":"SPYI",status,asOf,
  fetchedAt:"2026-10-14T18:00:00Z",holdings:1,
});
const holding=(isin,symbol,valueCzk)=>({id:isin,symbol,isin,name:symbol,
  assetClass:"etf",valueCzk,quantity:1,provider:"trading212",accountName:"Invest",canonicalKey:null});

test("issuer freshness is based on actual holdings as-of, never download timestamp",()=>{
  assert.deepEqual(classifyIssuerDate("2026-10-14",now),{state:"fresh",ageDays:0});
  assert.equal(classifyIssuerDate("2026-10-11",now).state,"fresh");
  assert.equal(classifyIssuerDate("2026-10-10",now).state,"aging");
  assert.equal(classifyIssuerDate("2026-10-07",now).state,"aging");
  assert.equal(classifyIssuerDate("2026-10-06",now).state,"stale");
  assert.equal(classifyIssuerDate("2026-10-17",now).state,"future");
  assert.equal(classifyIssuerDate("2026-02-30",now).state,"unknown");
  assert.equal(classifyIssuerDate("",now).state,"unknown");
  assert.equal(ISSUER_FRESH_DAYS,3);
  assert.equal(ISSUER_OLD_DAYS,7);
});

test("one provider failure retains last good rows while other ETF is replaced atomically",()=>{
  const old=[part(VWCE,"NVIDIA",30),part(SPYI,"OLD",70,"2026-10-12","SPDR")];
  const incoming=[part(SPYI,"MSFT",45,"2026-10-14","SPDR",MSFT)];
  const result=reconcileIssuerRows(old,incoming,[fund(VWCE,"error"),fund(SPYI,"ok","2026-10-14")]);
  assert.deepEqual(result.retainedIsins,[VWCE]);
  assert.equal(result.rows.length,2);
  assert.ok(result.rows.some(r=>r.fundIsin===VWCE&&r.securitySymbol==="NVIDIA"));
  assert.ok(result.rows.some(r=>r.fundIsin===SPYI&&r.securitySymbol==="MSFT"));
  assert.ok(!result.rows.some(r=>r.securitySymbol==="OLD"));
  const report=calculateXRay([holding(VWCE,"VWCE",1000),holding(SPYI,"SPYI",1000)],result.rows);
  assert.equal(report.denominatorCzk,2000);
  assert.equal(report.mappedCzk,750);
  assert.equal(report.unallocatedCzk,1250);
  assert.ok(Math.abs(report.denominatorCzk-report.mappedCzk-report.unallocatedCzk)<1e-7);
});

test("a failed complete issuer refresh does not turn previously mapped shares into unknowns",()=>{
  const old=[part(VWCE,"NVDA",10),part(SPYI,"MSFT",30,"2026-10-13","SPDR",MSFT)];
  const result=reconcileIssuerRows(old,[],[fund(VWCE,"error"),fund(SPYI,"error")]);
  assert.equal(result.rows.length,2);
  assert.deepEqual(result.retainedIsins,[VWCE,SPYI]);
  assert.equal(result.rows.find(r=>r.fundIsin===SPYI).securityIsin,MSFT);
});

test("fund no longer held is pruned; errors without history stay unmapped",()=>{
  const result=reconcileIssuerRows([part(VWCE,"NVDA",10)],[],[fund(SPYI,"error")]);
  assert.deepEqual(result.rows,[]);
  assert.deepEqual(result.retainedIsins,[]);
  assert.equal(issuerKey(" ie00bk5bqt80 "),VWCE);
});

test("refuse compromised or inconsistent fetched snapshots without merging partial data",()=>{
  const old=[part(VWCE,"NVDA",10)];
  assert.throws(()=>reconcileIssuerRows(old,[],[fund(VWCE,"ok")]),/nevrátil žádné podklady/);
  assert.throws(()=>reconcileIssuerRows(old,[part(VWCE,"NVDA",10)],[fund(SPYI,"ok")]),/bez úspěšně/);
  assert.throws(()=>reconcileIssuerRows(old,[part(VWCE,"NVDA",10)],[fund(VWCE,"ok","2026-10-14")]),/datum emitenta/);
  assert.throws(()=>reconcileIssuerRows(old,[],[fund(VWCE,"error"),fund(VWCE,"error")]),/Duplicitní/);
  assert.throws(()=>reconcileIssuerRows(old,[
    part(VWCE,"NVDA",50),part(VWCE,"MSFT",60),
  ],[fund(VWCE,"ok")]),/překračuje 100/);
  assert.throws(()=>reconcileIssuerRows(old,[
    part(VWCE,"NVDA",10,"2026-10-13"),part(VWCE,"MSFT",10,"2026-10-12"),
  ],[fund(VWCE,"ok","")]),/více dat/);
});

test("browser cache rejects data older than 60 days and corrupted rows",()=>{
  const payload={version:1,savedAt:"2026-10-14T18:00:00Z",
    rows:[part(VWCE,"NVDA",10)],funds:[fund(VWCE)]};
  assert.equal(validateIssuerCache(payload,now)?.rows.length,1);
  assert.equal(validateIssuerCache({...payload,savedAt:"2026-08-01T18:00:00Z"},now),null);
  assert.equal(validateIssuerCache({...payload,savedAt:"2030-01-01T00:00:00Z"},now),null);
  assert.equal(validateIssuerCache({...payload,version:2},now),null);
  assert.equal(validateIssuerCache({...payload,rows:[part(VWCE,"NVDA",125)]},now),null);
});

test("X-Ray stores issuer backups separately and does not touch accounting ledger",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const store=read("lib/xray/issuer-cache.ts");
  const ui=read("components/xray-auto-sync.tsx");
  assert.ok(store.includes('const CACHE_KEY="automatic-issuer-snapshots-v1"'));
  assert.ok(ui.includes("loadCachedIssuerSnapshots()"));
  assert.ok(ui.includes("reconcileIssuerRows(rowsRef.current,value.rows,value.funds)"));
  assert.ok(ui.includes("storeCachedIssuerSnapshots({"));
  assert.ok(ui.includes("retainedIsins"));
  assert.ok(ui.includes("Složení k:"));
  assert.ok(!store.includes("getDb("));
  assert.ok(!store.includes("credentials"));
});
