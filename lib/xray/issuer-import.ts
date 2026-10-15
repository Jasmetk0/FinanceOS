/**
 * Conservative adapter for original constituent CSVs supplied by an ETF issuer.
 *
 * Unlike FinanceOS's X-Ray-ready CSV, the issuer file normally has no ETF
 * identifier on every row, and may have a factsheet preamble. The user must
 * explicitly select the owned ETF and the date of the issuer snapshot.
 *
 * No row is silently discarded: an unexplained footer, missing security
 * or unknown asset class fails the entire preview.
 */
import { parseDelimited, delimiterOf } from "./import.ts";
import { validateXRayConstituents, type ExposureKind, type XRayConstituent } from "./engine.ts";
import { fundInsightForIsin } from "./fund-insights.ts";

export interface IssuerCsvOptions {
  fundSymbol: string;
  fundIsin: string | null;
  asOf: string;
  source: string;
  weightFormat: "percent" | "fraction";
}

export interface IssuerCsvPreview {
  rows: XRayConstituent[];
  headerLine: number;
  equityCount: number;
  cryptoCount: number;
  otherCount: number;
  identifiedPct: number;
  otherPct: number;
  remainderPct: number;
}

const norm = (value: string) => value.trim().toLowerCase()
  .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g,"");

const HEADERS = {
  ticker: ["ticker", "symbol", "holding_ticker", "security_ticker", "stock_ticker"],
  name: ["name", "security_name", "holding_name", "issuer", "description", "company", "investment"],
  isin: ["isin", "security_isin", "holding_isin"],
  weight: ["weight", "weight_pct", "weight_percent", "weight_percentage", "weight_in_fund",
    "weight_of_fund", "net_assets", "weighting", "portfolio_weight"],
  asset: ["asset_class", "asset_type", "type", "instrument_type", "security_type", "asset_category"],
} as const;

type Column = keyof typeof HEADERS;

function fieldsOf(header: string[]): Record<Column, number> {
  const fields = header.map(norm);
  const selected = {} as Record<Column, number>;
  for (const key of Object.keys(HEADERS) as Column[]) {
    const found = HEADERS[key].flatMap((name) =>
      fields.flatMap((field, index) => field === name ? [index] : []));
    if (found.length > 1) throw new RangeError("V souboru se opakuje sloupec " + key + ".");
    selected[key] = found.length ? found[0] : -1;
  }
  return selected;
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Datum složení fondu musí být YYYY-MM-DD.");
  const timestamp = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== value) {
    throw new RangeError("Neplatné kalendářní datum složení fondu.");
  }
}

function assetKind(value: string): ExposureKind {
  const v = norm(value);
  if (["equity","equities","stock","stocks","common_stock","shares","akcje","akcie","ordinary_shares"].includes(v)) return "stock";
  if (["crypto","cryptocurrency","digital_assets"].includes(v)) return "crypto";
  if (["cash", "cash_and_or_derivatives", "cash_and_derivatives", "cash_and_cash_equivalents",
    "cash_equivalents", "bonds", "bond", "fixed_income", "fixed_interest",
    "futures", "future", "derivative", "derivatives", "swap", "fund", "etf", "other",
    "money_market", "treasury", "forex", "fx", "receivables", "currency"].includes(v)) return "other";
  throw new RangeError("Neznámý typ podkladu „" + value + "“. Převeď jej na stock/crypto/other ve standardním formátu.");
}

function parseAmount(value: string, weightFormat: "percent" | "fraction"): number {
  const cleaned = value.trim().replace(/\s/g,"").replace(/%$/,"");
  if (!cleaned) throw new RangeError("Chybí podíl podkladové pozice.");
  const numeric = Number(cleaned.replace(",","."));
  if (!Number.isFinite(numeric)) throw new RangeError("Neplatný podíl: " + value);
  const result = weightFormat === "fraction" ? numeric * 100 : numeric;
  if (result < 0 || result > 100) throw new RangeError("Podíl podkladu mimo interval 0–100 %: " + value);
  return result;
}

export function parseIssuerCsv(raw: string, options: IssuerCsvOptions): IssuerCsvPreview {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 8 * 1024 * 1024) {
    throw new RangeError("Soubor není textový CSV nebo překračuje 8 MB.");
  }
  if (!options || !options.fundSymbol?.trim() || !options.source?.trim()) {
    throw new RangeError("Vyber fond a zdroj originálního souboru.");
  }
  // A native issuer file for swap ETFs can be a *substitute basket*.
  // It must not silently be interpreted as index stock exposure.
  if (fundInsightForIsin(options.fundIsin)?.structure === "synthetic-equity") {
    throw new RangeError("Syntetické ETF: soubor náhradního koše není rozklad referenčního indexu. Pro ekonomickou expozici použij úplný indexový snapshot výslovně označený exposure_basis=reference-index ve standardním X-Ray CSV.");
  }
  validateDate(options.asOf);
  if (!["percent","fraction"].includes(options.weightFormat)) {
    throw new RangeError("Zvol jednotku váhy (procenta nebo podíl 0–1).");
  }

  const text = raw.replace(/^\uFEFF/,"");
  // Issuer preambles often include metadata rows, sometimes separated by
  // commas even when the holdings table is semicolon-delimited. Inspect up
  // to 30 candidate physical lines for an unambiguous holdings header.
  const physicalLines = text.split(/\r\n|\n|\r/);
  let data: string[][] | null = null;
  let headerLine = -1;
  let columns: Record<Column, number> | null = null;
  for (let i = 0; i < Math.min(30,physicalLines.length); i++) {
    const line = physicalLines[i];
    if (!line.trim()) continue;
    const delim = delimiterOf(line);
    let parsed: string[][];
    try { parsed = parseDelimited(physicalLines.slice(i).join("\n"),delim); }
    catch { continue; }
    if (!parsed.length) continue;
    let fields: Record<Column, number>;
    try { fields = fieldsOf(parsed[0]); }
    catch { throw new RangeError("Duplicitní názvy sloupců v hlavičce tabulky."); }
    if (fields.weight < 0 || fields.asset < 0 || fields.name < 0 ||
        (fields.ticker < 0 && fields.isin < 0)) continue;
    data = parsed;
    headerLine = i + 1;
    columns = fields;
    break;
  }
  if (!data || !columns) {
    throw new RangeError("Nenašel jsem tabulku podkladů se sloupci Name, Weight, Asset Class a Ticker nebo ISIN. Použij standardní X-Ray CSV.");
  }
  if (data.length < 2) throw new RangeError("Za hlavičkou není žádný podklad.");
  if (data.length > 200_001) throw new RangeError("Soubor obsahuje příliš mnoho pozic.");

  const rows: XRayConstituent[] = [];
  for (let i = 1; i < data.length; i++) {
    const fields = data[i];
    const lineNumber = headerLine + i;
    if (fields.length !== data[0].length) {
      throw new RangeError("Řádek " + lineNumber + ": nesouhlasí počet sloupců. Import nebyl proveden.");
    }
    const get = (key: Column) => columns[key] < 0 ? "" : fields[columns[key]].trim();
    const securityName = get("name");
    const securityIsin = get("isin").toUpperCase();
    const label = get("ticker").toUpperCase();
    let kind: ExposureKind;
    let weightPct: number;
    try {
      kind = assetKind(get("asset"));
      weightPct = parseAmount(get("weight"), options.weightFormat);
    } catch (e) {
      throw new RangeError("Řádek " + lineNumber + ": " + (e instanceof Error ? e.message : String(e)));
    }
    if (!securityName) throw new RangeError("Řádek " + lineNumber + ": chybí název aktiva.");
    const symbol = label && label !== "-" && label !== "—" ? label :
      securityIsin || (kind === "other" ? "OTHER-" + lineNumber : "");
    if (!symbol) throw new RangeError("Řádek " + lineNumber + ": akcie nebo krypto nemá ticker ani ISIN.");
    rows.push({
      fundSymbol: options.fundSymbol.trim().toUpperCase(),
      fundIsin: options.fundIsin?.trim().toUpperCase() || null,
      securitySymbol: symbol,
      securityIsin: securityIsin || null,
      securityName,
      weightPct,
      kind,
      asOf: options.asOf,
      source: options.source.trim(),
    });
  }
  validateXRayConstituents(rows);
  const equity = rows.filter((r)=>r.kind==="stock");
  const cryptos = rows.filter((r)=>r.kind==="crypto");
  const others = rows.filter((r)=>r.kind==="other");
  const sum = (items: XRayConstituent[])=>items.reduce((total,r)=>total+r.weightPct,0);
  const identifiedPct = sum(equity)+sum(cryptos), otherPct = sum(others);
  const remainderPct = Math.max(0,100 - identifiedPct - otherPct);
  return {rows,headerLine,equityCount:equity.length,cryptoCount:cryptos.length,
    otherCount:others.length,identifiedPct,otherPct,remainderPct};
}
