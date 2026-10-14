/**
 * Live issuer canary — runs the production provider adapters against public
 * internet endpoints from a GitHub-hosted runner. NO credentials, positions,
 * account data, broker connections or private URLs are ever used.
 *
 * Usage:
 *   node scripts/check-live-issuer-feeds.mjs
 *   node scripts/check-live-issuer-feeds.mjs --strict
 *
 * This is deliberately separate from PR correctness CI: a temporary issuer
 * outage must not prevent normal FinanceOS software development.
 */
import { appendFile, writeFile } from "node:fs/promises";
import { probeIssuer } from "../lib/xray/issuer-diagnostics.ts";
import { ISHARES_FEEDS, fetchIsharesHoldings } from "../lib/xray/auto-ishares.ts";
import { SPYI_ISIN, SPYI_OFFICIAL_URL, fetchSpyiHoldings } from "../lib/xray/auto-spyi.ts";
import { VWCE_ISIN, VANGUARD_EU_GRAPHQL_URL, fetchVwceHoldings } from "../lib/xray/auto-vanguard.ts";

const strict=process.argv.includes("--strict");
const results=await Promise.all([
  ...ISHARES_FEEDS.map((f)=>probeIssuer({
    provider:"iShares",name:f.name,isin:f.isin,
    symbol:f.name.split("(")[1]?.split("/")[0]||f.isin,
    sourceUrl:f.url,
  },()=>fetchIsharesHoldings(f,f.name.split("(")[1]?.split("/")[0]||f.isin,true))),
  probeIssuer({
    provider:"State Street",name:"SPDR MSCI ACWI IMI (SPYI)",
    isin:SPYI_ISIN,symbol:"SPYI",sourceUrl:SPYI_OFFICIAL_URL,
  },()=>fetchSpyiHoldings("SPYI",true)),
  probeIssuer({
    provider:"Vanguard",name:"FTSE All-World (VWCE)",
    isin:VWCE_ISIN,symbol:"VWCE",sourceUrl:VANGUARD_EU_GRAPHQL_URL,
  },()=>fetchVwceHoldings("VWCE",true)),
]);

const findings=results.map(x=>({
  fund:x.symbol,isin:x.isin,provider:x.provider,status:x.state,
  asOf:x.asOf,rows:x.holdings,stockPct:x.stockPct,otherPct:x.otherPct,
  uncoveredPct:x.uncoveredPct,elapsedMs:x.elapsedMs,
  source:x.sourceUrl,error:x.error,
}));
const checkedAt=new Date().toISOString();
const report={checkedAt,source:"GitHub Actions hosted runner (NOT user's local FinanceOS)",
  liveNetwork:true,productionParsers:true,findings};
const json=JSON.stringify(report,null,2)+"\n";
console.log(json);

const escapeCell=(v)=>String(v??"").replace(/\|/g,"\\|").replace(/\r?\n/g," ");
const table=[
  "## Portfolio X-Ray · public ETF issuer network canary",
  "",
  "**Checked:** "+checkedAt,
  "",
  "Runs on GitHub infrastructure, not on your local computer. Uses the same production holdings parsers, without any investment credentials.",
  "",
  "| ETF | Provider | Status | Holdings | As of | Stock % | Missing % | HTTP / parse diagnostic |",
  "|---|---|---|---:|---|---:|---:|---|",
  ...findings.map(x=>"| "+[
    x.fund,x.provider,x.status,x.rows,x.asOf??"—",
    x.stockPct.toFixed(2),x.uncoveredPct.toFixed(2),x.error??"OK",
  ].map(escapeCell).join(" | ")+" |"),
  "",
  "Warning: successfully parsed public ETF holdings do not constitute real-time prices or independently audited NAV.",
  "",
].join("\n");
if(process.env.GITHUB_STEP_SUMMARY){
  await appendFile(process.env.GITHUB_STEP_SUMMARY,table,"utf8");
}
if(process.env.XRAY_CANARY_REPORT_PATH){
  await writeFile(process.env.XRAY_CANARY_REPORT_PATH,json,{encoding:"utf8",flag:"w"});
}

const failing=results.filter(x=>x.state==="failed"||x.state==="partial");
const outOfDate=results.filter(x=>x.state==="stale");
if(failing.length||outOfDate.length){
  console.error("Issuer canary: "+failing.length+" unavailable/incomplete, "+
    outOfDate.length+" stale, of "+results.length+" total public sources.");
}
// A published monthly Vanguard snapshot is often older than seven days;
// this is a real freshness warning but not a transport/parser failure.
if(strict && failing.length)process.exitCode=1;
