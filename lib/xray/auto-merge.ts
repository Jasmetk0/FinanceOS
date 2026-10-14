import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";

const identity = (row:XRayConstituent) =>
  row.fundIsin ? "isin:" + row.fundIsin.trim().toUpperCase() :
    "symbol:" + row.fundSymbol.trim().toUpperCase();

/**
 * Auto sources are primary when at least as recent as a manually imported
 * source. A missing or failed automatic fund retains the user's manual data.
 * Exactly ONE constituent snapshot can be selected per fund: no mixing.
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
  const groups:XRayConstituent[]=[];
  for (const key of new Set([...manualByFund.keys(),...autoByFund.keys()])) {
    const local=manualByFund.get(key),remote=autoByFund.get(key);
    let choice=remote??local??[];
    if (local?.length && remote?.length) {
      const localDate=local[0].asOf;
      const remoteDate=remote[0].asOf;
      choice=localDate && (!remoteDate || localDate>remoteDate) ? local : remote;
    }
    groups.push(...choice);
  }
  validateXRayConstituents(groups);
  return groups;
}
