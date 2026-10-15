import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { ISHARES_FEEDS, fetchIsharesHoldings } from "@/lib/xray/auto-ishares";
import { SPYI_ISIN, SPYI_OFFICIAL_URL, fetchSpyiHoldings } from "@/lib/xray/auto-spyi";
import { VWCE_ISIN, VANGUARD_EU_GRAPHQL_URL, fetchVwceHoldings } from "@/lib/xray/auto-vanguard";
import { INVESCO_ARCHIVE_FEEDS, fetchInvescoArchiveHoldings } from "@/lib/xray/auto-invesco";
import { probeIssuer, type IssuerHealthRecord, type IssuerHealthTarget } from "@/lib/xray/issuer-diagnostics";
import type { XRayConstituent } from "@/lib/xray/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const COOLDOWN_MS = 5*60*1000;
const headers={"Cache-Control":"private, no-store"};
interface DiagnosticReport {
  checkedAt:string;
  sources:IssuerHealthRecord[];
  healthy:number;
  limited:number;
  failed:number;
}
const globalState=globalThis as typeof globalThis & {
  __financeOsXrayIssuerDiagnostics?: {
    last:DiagnosticReport|null;
    lastAttempt:number;
    pending?:Promise<DiagnosticReport>;
  };
};
function state() {
  globalState.__financeOsXrayIssuerDiagnostics ??= {last:null,lastAttempt:0};
  return globalState.__financeOsXrayIssuerDiagnostics;
}

const targets:readonly IssuerHealthTarget[]=[
  ...ISHARES_FEEDS.map(feed=>({
    provider:"iShares" as const,name:feed.name,
    isin:feed.isin,symbol:feed.name.split("(")[1]?.split("/")[0]||feed.isin,
    sourceUrl:feed.url,
  })),
  {provider:"State Street",name:"SPDR MSCI ACWI IMI (SPYI)",
    isin:SPYI_ISIN,symbol:"SPYI",sourceUrl:SPYI_OFFICIAL_URL},
  {provider:"Vanguard",name:"FTSE All-World (VWCE)",
    isin:VWCE_ISIN,symbol:"VWCE",sourceUrl:VANGUARD_EU_GRAPHQL_URL},
  ...INVESCO_ARCHIVE_FEEDS.map(feed=>({
    provider:"Rebalix archive" as const,name:feed.name,
    isin:feed.isin,symbol:feed.isin==="IE0032077012"?"EQQQ":"EQAC",
    sourceUrl:feed.url,
  })),
];

async function runDiagnostics():Promise<DiagnosticReport>{
  const sources=await Promise.all(targets.map(async target=>{
    const read=async()=>{
      let outcome:{rows:XRayConstituent[];fetchedAt:string;sourceUrl:string};
      if(target.provider==="iShares") {
        const feed=ISHARES_FEEDS.find(f=>f.isin===target.isin);
        if(!feed)throw new RangeError("Zdroj ISIN již není ve whitelistu.");
        outcome=await fetchIsharesHoldings(feed,target.symbol,true);
      } else if(target.provider==="State Street") {
        outcome=await fetchSpyiHoldings(target.symbol,true);
      } else if(target.provider==="Rebalix archive"){
        const feed=INVESCO_ARCHIVE_FEEDS.find(f=>f.isin===target.isin);
        if(!feed)throw new RangeError("Archivovaný zdroj nebyl na seznamu.");
        outcome=await fetchInvescoArchiveHoldings(feed,target.symbol,true);
      } else {
        outcome=await fetchVwceHoldings(target.symbol,true);
      }
      return outcome;
    };
    return probeIssuer(target,read);
  }));
  return {checkedAt:new Date().toISOString(),sources,
    healthy:sources.filter(s=>s.state==="healthy").length,
    limited:sources.filter(s=>["aging","stale","partial"].includes(s.state)).length,
    failed:sources.filter(s=>s.state==="failed").length};
}

/**
 * Explicit-on-click, genuine network and parser probe. Does not read stored
 * investment accounts and never sends their credentials to fund issuers.
 * All fourteen source URL/ISIN pairs are defined server-side; user input cannot
 * add endpoints, hostnames, or dynamic queries.
 */
export async function POST(request:Request){
  const blocked=localOnly(request);
  if(blocked)return blocked;
  const shared=state();
  try {
    if(shared.pending){
      const data=await shared.pending;
      return NextResponse.json({...data,cached:false,shared:true},{headers});
    }
    const now=Date.now();
    if(shared.last && now-shared.lastAttempt<COOLDOWN_MS){
      return NextResponse.json({...shared.last,cached:true,shared:false},{headers});
    }
    shared.lastAttempt=now;
    const pending=runDiagnostics();
    shared.pending=pending;
    try {
      const report=await pending;
      shared.last=report;
      return NextResponse.json({...report,cached:false,shared:false},{headers});
    } finally {
      if(shared.pending===pending)shared.pending=undefined;
    }
  }catch(error){
    return NextResponse.json({error:"Nelze dokončit test emitentů: "+
      (error instanceof Error?error.message:String(error)).replace(/[\r\n]/g," ").slice(0,250)},
    {status:500,headers});
  }
}
