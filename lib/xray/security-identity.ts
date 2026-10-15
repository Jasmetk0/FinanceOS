/**
 * Match underlying share classes across issuers only on CHECKED security IDs.
 *
 * SPDR publishes both SEDOL and ISIN for equity constituents. Vanguard
 * exposes SEDOL but not a usable underlying ISIN. A checksum-valid, unique
 * pair can bridge these two sources without guessing from company names.
 *
 * Untrusted/ambiguous identifiers fail closed. The index includes only
 * source-labelled official SPDR equity constituent pairs; manual source
 * files are not independently verified by this module.
 */
import type { XRayConstituent } from "./engine.ts";

const WEIGHTS=[1,3,1,7,3,9,1] as const;
const SEDOL_CHARS=/^[0-9BCDFGHJKLMNPQRSTVWXYZ]{6}[0-9]$/;

export function normalizedSedol(sedol:string|null|undefined):string|null {
  const code=(sedol??"").trim().toUpperCase();
  if (!SEDOL_CHARS.test(code)) return null;
  let checksum=0;
  for(let i=0;i<7;i++){
    const n=Number.parseInt(code[i],36);
    checksum+=n*WEIGHTS[i];
  }
  return checksum%10===0?code:null;
}
export function normalizedIsin(isin:string|null|undefined):string|null {
  const normalized=(isin??"").trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{10}$/.test(normalized)?normalized:null;
}
export interface SedolIsinCrosswalk {
  exact: Map<string,string>;
  conflicted: Set<string>;
  linkedCount:number;
}

/**
 * SEDOL is market/security-line specific. One SEDOL must never resolve to
 * two different ISINs, even if two files say otherwise. Ambiguous codes
 * are removed from the crosswalk entirely.
 */
export function buildSedolIsinCrosswalk(rows:XRayConstituent[]):SedolIsinCrosswalk {
  const candidates=new Map<string,string>();
  const conflicted=new Set<string>();
  for(const row of rows){
    if(row.source.includes("; identity-only reference")) {
      // An issuer identity dictionary cached beyond 14 days must NEVER
      // silently convert current Vanguard SEDOLs to stale ISINs.
      const timestamp=Date.parse(row.asOf+"T00:00:00Z");
      const age=(Date.now()-timestamp)/86_400_000;
      if(!Number.isFinite(age)||age< -1||age>14)continue;
    }
    if(row.kind!=="stock" || row.fundIsin!=="IE00B3YLTY66" ||
       !row.source.startsWith("State Street official daily SPYI XLSX; ")) continue;
    const sedol=normalizedSedol(row.securitySedol);
    const isin=normalizedIsin(row.securityIsin);
    if(!sedol || !isin || conflicted.has(sedol))continue;
    const old=candidates.get(sedol);
    if(old && old!==isin){
      candidates.delete(sedol);
      conflicted.add(sedol);
    }else candidates.set(sedol,isin);
  }
  return {exact:candidates,conflicted,linkedCount:candidates.size};
}

export function resolveSecurityIsin(
  row:Pick<XRayConstituent,"securityIsin"|"securitySedol">,
  crosswalk:SedolIsinCrosswalk,
):string|null {
  const explicit=normalizedIsin(row.securityIsin);
  if(explicit)return explicit;
  const sedol=normalizedSedol(row.securitySedol);
  return sedol?crosswalk.exact.get(sedol)??null:null;
}
