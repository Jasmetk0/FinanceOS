import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { getXRayHoldings } from "@/lib/server/xray";
import { issuerFeedForIsin, fetchIsharesHoldings } from "@/lib/xray/auto-ishares";
import { SPYI_ISIN, fetchSpyiHoldings } from "@/lib/xray/auto-spyi";
import { VWCE_ISIN, VALL_ISIN, fetchVwceHoldings, fetchVallHoldings } from "@/lib/xray/auto-vanguard";
import { LYMS_ISIN, fetchLymsProxyHoldings } from "@/lib/xray/auto-lyms-proxy";
import { invescoArchiveForIsin, fetchInvescoArchiveHoldings } from "@/lib/xray/auto-invesco";
import type { XRayConstituent } from "@/lib/xray/engine";
import { fundInsightForIsin } from "@/lib/xray/fund-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Issuer refresh is read-only; it uses stored broker-backed holdings and public
 * allowlisted official issuer feeds and explicitly labelled external archives.
 * Never forward broker API credentials.
 * Each fund's failure is reported independently without inventing exposure.
 */
export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    const funds = new Map<string,{symbol:string; isin:string}>();
    const unavailable = new Map<string,{symbol:string;isin:string|null;reason:string}>();
    for (const h of getXRayHoldings()) {
      if (h.assetClass !== "etf") continue;
      const isin = h.isin?.trim().toUpperCase() || null;
      const feed = issuerFeedForIsin(isin);
      const archive = invescoArchiveForIsin(isin);
      const supportsSpyi = isin === SPYI_ISIN;
      const supportsVwce = isin === VWCE_ISIN;
      const supportsVall = isin === VALL_ISIN;
      const supportsLymsProxy = isin === LYMS_ISIN;
      if ((feed || supportsSpyi || supportsVwce || supportsVall || supportsLymsProxy || archive) && isin) {
        if (!funds.has(isin)) funds.set(isin,{isin,symbol:h.symbol});
      } else {
        const id = isin ?? "symbol:"+h.symbol.toUpperCase();
        const insight=fundInsightForIsin(isin);
        if (!unavailable.has(id)) unavailable.set(id,{
          isin,symbol:h.symbol,
          reason: isin ? (
            insight ? insight.label + ". " + insight.explanation :
              "Pro tento ISIN zatím není ověřený automatický zdroj."
          ) : "ETF nemá ISIN. Aktualizuj instrumenty z brokera.",
        });
      }
    }
    // A bounded number of allowlisted sources. Failure to read any one
    // issuer must not invalidate all other, successfully fetched funds.
    const results = await Promise.all([...funds.values()].map(async f => {
      const feed = issuerFeedForIsin(f.isin);
      const archive = invescoArchiveForIsin(f.isin);
      if (!feed && f.isin!==SPYI_ISIN && f.isin!==VWCE_ISIN && f.isin!==VALL_ISIN && f.isin!==LYMS_ISIN && !archive) return {isin:f.isin,symbol:f.symbol,status:"unsupported" as const,rows:[] as XRayConstituent[]};
      try {
        const fetched = feed ? await fetchIsharesHoldings(feed,f.symbol,force) :
          f.isin===SPYI_ISIN ? await fetchSpyiHoldings(f.symbol,force) :
          f.isin===VWCE_ISIN ? await fetchVwceHoldings(f.symbol,force) :
          f.isin===VALL_ISIN ? await fetchVallHoldings(f.symbol,force) :
          f.isin===LYMS_ISIN ? await fetchLymsProxyHoldings(f.symbol,force) :
          await fetchInvescoArchiveHoldings(archive!,f.symbol,force);
        return {isin:f.isin,symbol:f.symbol,status:"ok" as const,
          rows:fetched.rows,sourceUrl:fetched.sourceUrl,fetchedAt:fetched.fetchedAt,
          asOf:fetched.rows[0]?.asOf ?? "",cached:fetched.cached,
          sourceKind:f.isin===LYMS_ISIN ? "proxy-model" as const :
            archive ? "third-party-archive" as const : "official" as const};
      } catch(error) {
        return {isin:f.isin,symbol:f.symbol,status:"error" as const,rows:[] as XRayConstituent[],
          error:error instanceof Error?error.message:String(error)};
      }
    }));
    const rows = results.flatMap(result => result.rows);
    return NextResponse.json({
      rows,
      funds:results.map(({rows,...rest}) => ({...rest,holdings:rows.length})),
      unsupported:[...unavailable.values()],
      refreshedAt:new Date().toISOString(),
      supportedTotal:funds.size,
      ok:results.filter(result=>result.status==="ok").length,
    },{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) {
    return NextResponse.json({
      error:error instanceof Error?error.message:String(error),
    },{status:500,headers:{"Cache-Control":"private, no-store"}});
  }
}
