/**
 * Conservative canonicalization of issuer-reported GICS-style equity sectors.
 * Never derive a sector from ticker, company name or geography.
 * Unknown or incompatible classifications remain unclassified.
 */
export const XRAY_EQUITY_SECTORS=[
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
] as const;
export type XRayEquitySector=typeof XRAY_EQUITY_SECTORS[number];
const exact=new Map<string,XRayEquitySector>(XRAY_EQUITY_SECTORS.map(s=>[s.toLowerCase(),s] as const));
// Only spelling variations of the SAME sector, not approximations of broader
// labels (e.g. "Technology" or "Consumer Services" are deliberately UNKNOWN).
const aliases=new Map<string,XRayEquitySector>([
  ["healthcare","Health Care"],
  ["communication services","Communication Services"],
  ["real estate","Real Estate"],
  ["information technology","Information Technology"],
]);
export function normalizeIssuerSector(value:unknown):XRayEquitySector|null {
  if(typeof value!=="string")return null;
  const key=value.trim().replace(/\s+/g," ").toLowerCase();
  if(!key||key.length>80)return null;
  return exact.get(key)??aliases.get(key)??null;
}
export function isXRaySector(value:unknown):value is XRayEquitySector{
  return typeof value==="string" && exact.get(value.toLowerCase())===value;
}
