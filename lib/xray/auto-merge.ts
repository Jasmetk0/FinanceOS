import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";
import { fundInsightForIsin } from "./fund-insights.ts";

const identity = (row:XRayConstituent) =>
  row.fundIsin ? "isin:" + row.fundIsin.trim().toUpperCase() :
    "symbol:" + row.fundSymbol.trim().toUpperCase();

/**
 * Synthetically replicated funds have two very different data types:
 * physical substitute basket (not benchmark exposure), and the tracked
 * reference index (economic exposure). A newer substitute-basket CSV must
 * NEVER displace a complete, dated, independently selected index/proxy
 * snapshot. Likewise a physical fund should not be replaced by index weights
 * just because a manual file reports a newer date.
 */
type Basis = "fund-holdings" | "reference-index" | "reference-index-proxy" | "substitute-basket";
function basisOf(rows:XRayConstituent[]):Basis|null {
  const kinds=new Set(rows.map(r=>r.exposureBasis??"fund-holdings"));
  return kinds.size===1 ? [...kinds][0] as Basis : null;
}
function isValidDay(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const ms=Date.parse(value+"T00:00:00Z");
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;
}
function sourceEligible(key:string,rows:XRayConstituent[],now:number):boolean {
  if(!rows.length)return false;
  // A single snapshot cannot mix days or provenance. calculateXRay will
  // reject it anyway, so a malformed newer CSV must not beat a usable feed.
  if(!isValidDay(rows[0].asOf) || !rows[0].source.trim() ||
     Date.parse(rows[0].asOf+"T00:00:00Z")>now+86_400_000 ||
     rows.some(r=>r.asOf!==rows[0].asOf||r.source!==rows[0].source))return false;
  const insight=key.startsWith("isin:")?fundInsightForIsin(key.slice(5)):null;
  const basis=basisOf(rows);
  if(!basis)return false;
  const dates=new Set(rows.map(r=>r.asOf));
  if(insight?.structure==="synthetic-equity"){
    if(basis!=="reference-index"&&basis!=="reference-index-proxy")return false;
    if(dates.size!==1||!isValidDay(rows[0].asOf))return false;
    const shareRows=rows.filter(r=>r.kind==="stock"&&r.weightPct>0);
    const equity=shareRows.reduce((sum,r)=>sum+r.weightPct,0);
    if(shareRows.length<90||shareRows.length!==rows.length||equity<98||equity>100.000001)return false;
    if(basis==="reference-index-proxy"){
      const age=(now-Date.parse(rows[0].asOf+"T00:00:00Z"))/86_400_000;
      return age>=-1&&age<=14;
    }
    return true;
  }
  if(insight?.structure==="physical-equity"||insight?.structure==="physical-gold"||
     insight?.structure==="leveraged-crypto"){
    return basis==="fund-holdings";
  }
  // Unknown products: reject explicitly mismatched or conflicting
  // provenance only when an eligible counterpart is available.
  return basis==="fund-holdings";
}

interface SnapshotEvidence {
  complete:boolean;
  investablePct:number;
  rows:number;
}
/**
 * A manual top-ten table often adds up to only ~50–80% of the fund.
 * An optional "OTHER" remainder may make it sum to 100% without providing
 * identities for the other shares. A current complete issuer basket must
 * not be displaced by a newer materially weaker snapshot for that ISIN.
 * This only arbitrates when BOTH candidate sources are present. A partial
 * manual upload on its own remains visible as partial, never invented data.
 */
function snapshotEvidence(rows:XRayConstituent[]):SnapshotEvidence {
  const total=rows.reduce((sum,row)=>sum+row.weightPct,0);
  return {
    complete:total>=95-1e-7 && total<=100+1e-7,
    investablePct:rows.reduce((sum,row)=>
      sum+(row.kind==="stock"||row.kind==="crypto"?row.weightPct:0),0),
    rows:rows.filter(row=>row.weightPct>0).length,
  };
}

export interface XRaySourceSnapshot {
  asOf:string|null;
  source:string|null;
  exposureBasis:Basis|null;
  rows:number;
  totalPct:number;
  identifiedPct:number;
  eligible:boolean;
}
export type XRaySourceChoice="manual"|"automatic";
export type XRaySourceReason=
  "manual-only"|"automatic-only"|"identity-reference"|
  "manual-compatible"|"automatic-compatible"|
  "manual-more-complete"|"automatic-more-complete"|
  "manual-newer"|"automatic-newer"|"automatic-tie"|
  "manual-exact-index-tie"|"ineligible-fallback";
export interface XRaySourceDecision {
  fundKey:string;
  fundSymbol:string;
  fundIsin:string|null;
  selected:XRaySourceChoice;
  reason:XRaySourceReason;
  manual:XRaySourceSnapshot|null;
  automatic:XRaySourceSnapshot|null;
}
export interface XRaySourceSelection {
  rows:XRayConstituent[];
  decisions:XRaySourceDecision[];
}
function inspectSource(rows:XRayConstituent[]|undefined,key:string,now:number):XRaySourceSnapshot|null {
  if(!rows?.length)return null;
  return {
    asOf:rows[0].asOf||null,
    source:rows[0].source||null,
    exposureBasis:basisOf(rows),
    rows:rows.length,
    totalPct:rows.reduce((sum,r)=>sum+r.weightPct,0),
    identifiedPct:snapshotEvidence(rows).investablePct,
    eligible:sourceEligible(key,rows,now),
  };
}

/**
 * The SAME arbitration drives both calculations and the UI audit.
 * Reasons describe the actual branch taken, not guessed source quality.
 */
export function explainConstituentSources(
  manual:XRayConstituent[],automatic:XRayConstituent[],now=Date.now(),
):XRaySourceSelection {
  if(!Number.isFinite(now))throw new RangeError("Neplatný čas rozhodnutí o rozkladu.");
  validateXRayConstituents(manual);
  validateXRayConstituents(automatic);
  const manualByFund=new Map<string,XRayConstituent[]>();
  const autoByFund=new Map<string,XRayConstituent[]>();
  for (const row of manual) {
    const key=identity(row);
    if(!manualByFund.has(key))manualByFund.set(key,[]);
    manualByFund.get(key)?.push(row);
  }
  for (const row of automatic) {
    const key=identity(row);
    if(!autoByFund.has(key))autoByFund.set(key,[]);
    autoByFund.get(key)?.push(row);
  }
  const rows:XRayConstituent[]=[];
  const decisions:XRaySourceDecision[]=[];
  for(const key of new Set([...manualByFund.keys(),...autoByFund.keys()])){
    const local=manualByFund.get(key),remote=autoByFund.get(key);
    let selected:XRaySourceChoice=remote?.length?"automatic":"manual";
    let reason:XRaySourceReason=remote?.length?"automatic-only":"manual-only";
    if(local?.length&&remote?.length){
      const localEligible=sourceEligible(key,local,now);
      const remoteEligible=sourceEligible(key,remote,now);
      if(remote.every(r=>r.source.endsWith("; identity-only reference"))){
        selected="automatic";reason="identity-reference";
      }else if(localEligible&&!remoteEligible){
        selected="manual";reason="manual-compatible";
      }else if(!localEligible&&remoteEligible){
        selected="automatic";reason="automatic-compatible";
      }else if(localEligible&&remoteEligible){
        const manualEvidence=snapshotEvidence(local);
        const issuerEvidence=snapshotEvidence(remote);
        const manualLessComplete=!manualEvidence.complete&&issuerEvidence.complete;
        const issuerLessComplete=!issuerEvidence.complete&&manualEvidence.complete;
        const manualMissingStocks=issuerEvidence.investablePct>=95 &&
          manualEvidence.investablePct<90;
        const issuerMissingStocks=manualEvidence.investablePct>=95 &&
          issuerEvidence.investablePct<90;
        const manualTruncated=issuerEvidence.investablePct>=95 &&
          issuerEvidence.rows>=40 &&
          manualEvidence.rows<issuerEvidence.rows*0.25 &&
          manualEvidence.investablePct<=issuerEvidence.investablePct+1;
        const issuerTruncated=manualEvidence.investablePct>=95 &&
          manualEvidence.rows>=40 &&
          issuerEvidence.rows<manualEvidence.rows*0.25 &&
          issuerEvidence.investablePct<=manualEvidence.investablePct+1;
        if((manualLessComplete||manualMissingStocks||manualTruncated)&&
           !(issuerLessComplete||issuerMissingStocks||issuerTruncated)){
          selected="automatic";reason="automatic-more-complete";
        }else if((issuerLessComplete||issuerMissingStocks||issuerTruncated)&&
                 !(manualLessComplete||manualMissingStocks||manualTruncated)){
          selected="manual";reason="manual-more-complete";
        }else if(local[0].asOf>remote[0].asOf){
          selected="manual";reason="manual-newer";
        }else if(local[0].asOf===remote[0].asOf &&
                 basisOf(local)==="reference-index" &&
                 basisOf(remote)==="reference-index-proxy"){
          selected="manual";reason="manual-exact-index-tie";
        }else{
          selected="automatic";reason=local[0].asOf===remote[0].asOf?
            "automatic-tie":"automatic-newer";
        }
      }else{
        selected=local[0].asOf>remote[0].asOf?"manual":"automatic";
        reason="ineligible-fallback";
      }
    }
    const chosen=selected==="automatic"?remote:local;
    if(!chosen?.length)throw new RangeError("Chybí vybrané ETF podklady.");
    rows.push(...chosen);
    const first=chosen[0];
    decisions.push({
      fundKey:key,fundSymbol:first.fundSymbol,
      fundIsin:first.fundIsin,selected,reason,
      manual:inspectSource(local,key,now),
      automatic:inspectSource(remote,key,now),
    });
  }
  validateXRayConstituents(rows);
  return {rows,decisions};
}

/** Backwards-compatible calculation entrypoint; never reimplement arbitration. */
export function combineConstituentSources(
  manual:XRayConstituent[],automatic:XRayConstituent[],
):XRayConstituent[]{
  return explainConstituentSources(manual,automatic).rows;
}
