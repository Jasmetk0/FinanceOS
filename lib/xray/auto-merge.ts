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

/**
 * Return one atomic snapshot per fund ISIN/ticker. Ordinary eligible sources
 * still use newest-as-of (automatic wins ties). A better-quality COMPLETE
 * direct reference-index snapshot outranks a CNDX proxy for synthetic funds
 * when dates are identical. Older real index snapshots do not silently
 * override newer proxies. On missing automatic data keep manual unchanged;
 * the engine remains the final fail-closed arbiter.
 */
export function combineConstituentSources(
  manual:XRayConstituent[],automatic:XRayConstituent[],
): XRayConstituent[] {
  validateXRayConstituents(manual);
  validateXRayConstituents(automatic);
  const manualByFund=new Map<string,XRayConstituent[]>();
  const autoByFund=new Map<string,XRayConstituent[]>();
  for (const row of manual) {
    const key=identity(row);
    if (!manualByFund.has(key)) manualByFund.set(key,[]);
    manualByFund.get(key)?.push(row);
  }
  for (const row of automatic) {
    const key=identity(row);
    if (!autoByFund.has(key)) autoByFund.set(key,[]);
    autoByFund.get(key)?.push(row);
  }
  const now=Date.now();
  const groups:XRayConstituent[]=[];
  for (const key of new Set([...manualByFund.keys(),...autoByFund.keys()])) {
    const local=manualByFund.get(key),remote=autoByFund.get(key);
    let choice=remote??local??[];
    if (local?.length && remote?.length) {
      // Do not let a user's newer manual SPYI portfolio file replace the
      // issuer-fetched security-ID reference used to identify Vanguard.
      // This special source is never an owned SPYI NAV allocation.
      if(remote.every(r=>r.source.endsWith("; identity-only reference"))) {
        groups.push(...remote);
        continue;
      }
      const localEligible=sourceEligible(key,local,now);
      const remoteEligible=sourceEligible(key,remote,now);
      if(localEligible&&!remoteEligible)choice=local;
      else if(!localEligible&&remoteEligible)choice=remote;
      else if(localEligible&&remoteEligible){
        const localDate=local[0].asOf,remoteDate=remote[0].asOf;
        choice=localDate>remoteDate?local:remote;
        // When snapshots are equally dated, prefer full benchmark
        // weights to a merely similar physically held CNDX basket.
        if(localDate===remoteDate&&basisOf(local)==="reference-index"&&
           basisOf(remote)==="reference-index-proxy")choice=local;
      } else {
        // Preserve previous preference; the engine will explicitly reject
        // an unsupported synthetic basket rather than inventing stocks.
        choice=local[0].asOf>remote[0].asOf?local:remote;
      }
    }
    groups.push(...choice);
  }
  validateXRayConstituents(groups);
  return groups;
}
