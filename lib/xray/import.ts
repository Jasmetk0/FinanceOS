import { validateXRayConstituents, type ExposureKind, type XRayConstituent } from "./engine.ts";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else field += c;
    } else if (afterQuote) {
      if (c === delimiter) {
        row.push(field); field = ""; afterQuote = false;
      } else if (c === "\n" || c === "\r") {
        row.push(field); rows.push(row); row = []; field = ""; afterQuote = false;
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else if (c !== " " && c !== "\t") {
        throw new RangeError("Neplatný CSV formát: znaky za koncem uvozované hodnoty.");
      }
    } else if (c === '"') {
      if (field.trim()) throw new RangeError("Neplatné uvozovky uvnitř CSV hodnoty.");
      quoted = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row);
      row = []; field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (quoted) throw new RangeError("Neukončené uvozovky v CSV.");
  if (field || row.length || afterQuote) rows.push([...row, field]);
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function delimiterOf(line: string) {
  let commas = 0, semicolons = 0, inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"' && inQuotes) { i++; continue; }
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === ",") commas++;
    else if (!inQuotes && c === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

const key = (header: string) => header.toLowerCase().replace(/^\uFEFF/, "").trim().replace(/[\s-]+/g, "_");
const aliases: Record<string, string[]> = {
  fund_symbol: ["fund_symbol","fund_ticker","etf_ticker","fund"],
  fund_isin: ["fund_isin","etf_isin"],
  security_symbol: ["security_symbol","ticker","holding_ticker","constituent_ticker"],
  security_isin: ["security_isin","isin","holding_isin"],
  security_name: ["security_name","company","name","holding_name"],
  weight_pct: ["weight_pct","weight_percent","portfolio_weight_pct","weight_%"],
  kind: ["kind","asset_class","type"],
  as_of: ["as_of","asof","holdings_date"],
  source: ["source","issuer_source"],
};

const parseWeight = (raw: string) => {
  const cleaned = raw.trim().replace(/\s/g, "").replace(/%$/, "").replace(",", ".");
  if (cleaned === "") throw new RangeError("Chybí váha podkladového aktiva.");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new RangeError("Neplatná váha podkladového aktiva: " + raw);
  return n;
};

function toKind(v: string): ExposureKind {
  const value = v.trim().toLowerCase();
  if (["stock", "equity", "akcie"].includes(value)) return "stock";
  if (["crypto", "krypto"].includes(value)) return "crypto";
  if (["other", "cash", "bond", "derivative", "ostatni", "ostatní", "dluhopis", "hotovost"].includes(value)) return "other";
  throw new RangeError("Nepodporovaný typ podkladu: " + v + ". Zadej stock, crypto nebo other.");
}

/**
 * Import a FULL issuer constituent snapshot, not a previously aggregated
 * Portfolio X-Ray result. Invalid rows reject the complete import atomically.
 */
export function parseXRayCompositionCsv(raw: string, fileLabel: string): XRayConstituent[] {
  if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) {
    throw new RangeError("Soubor přesahuje 8 MB. Importuj fondy v menších sadách.");
  }
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.trim()) throw new RangeError("Soubor je prázdný.");
  const delimiter = delimiterOf(text.split(/\r?\n/, 1)[0]);
  const parsed = parseDelimited(text, delimiter);
  if (parsed.length < 2) throw new RangeError("CSV musí obsahovat hlavičku a alespoň jeden podklad.");
  const names = parsed[0].map(key);
  const column = (k: string) => {
    const matches = aliases[k].map((a) => names.indexOf(a)).filter((i) => i >= 0);
    if (matches.length > 1) throw new RangeError("Duplicitní sloupec " + k + " v CSV.");
    return matches.length ? matches[0] : -1;
  };
  const columns = Object.fromEntries(Object.keys(aliases).map((k) => [k, column(k)])) as Record<keyof typeof aliases, number>;
  for (const required of ["fund_symbol", "security_symbol", "security_name", "weight_pct", "kind"]) {
    if (columns[required] < 0) throw new RangeError("CSV neobsahuje povinný sloupec " + required + ".");
  }
  const rows: XRayConstituent[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const fields = parsed[i];
    if (fields.length !== names.length) {
      throw new RangeError("Nesprávný počet polí na datovém řádku " + (i + 1) + ".");
    }
    const get = (k: string) => columns[k] < 0 ? "" : fields[columns[k]].trim();
    try {
      rows.push({
        fundSymbol: get("fund_symbol").toUpperCase(),
        fundIsin: get("fund_isin").toUpperCase() || null,
        securitySymbol: get("security_symbol").toUpperCase(),
        securityIsin: get("security_isin").toUpperCase() || null,
        securityName: get("security_name"),
        weightPct: parseWeight(get("weight_pct")),
        kind: toKind(get("kind")),
        asOf: get("as_of"),
        source: get("source") || fileLabel,
      });
    } catch (error) {
      throw new RangeError("Řádek " + (i + 1) + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  validateXRayConstituents(rows);
  return rows;
}
