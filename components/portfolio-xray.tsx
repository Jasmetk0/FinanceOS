"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { calculateXRay, validateXRayConstituents, type XRayConstituent, type XRayHolding } from "@/lib/xray/engine";
import { parseXRayCompositionCsv } from "@/lib/xray/import";
import { XRayIssuerImport } from "@/components/xray-issuer-import";
import { XRayAutoSync } from "@/components/xray-auto-sync";
import { XRayIdentityQuality } from "@/components/xray-identity-quality";
import { XRaySourceSelectionAudit } from "@/components/xray-source-selection-audit";
import { XRayExposureBreakdown } from "@/components/xray-exposure-breakdown";
import { matchesXRayOwnership, type XRayOwnershipFilter } from "@/lib/xray/exposure-attribution";
import { XRayLivePositions } from "@/components/xray-live-positions";
import type { XRayFreshness } from "@/lib/xray/freshness";
import { explainConstituentSources } from "@/lib/xray/auto-merge";
import { fundInsightForIsin } from "@/lib/xray/fund-insights";

type Filter = "all" | "stock" | "crypto";
const DB_NAME = "financeos-xray";
const STORE_NAME = "imports";
const IMPORT_KEY = "issuer-holdings-v1";
const money = (n: number) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
const pct = (n: number) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) + " %";
const quantity = (n: number) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 8 });

function dbConnection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function loadRows(): Promise<XRayConstituent[]> {
  const db = await dbConnection();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(IMPORT_KEY);
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function writeRows(rows: XRayConstituent[]): Promise<void> {
  const db = await dbConnection();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(rows, IMPORT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export function PortfolioXRay({
  holdings, initialFreshness,
}: {
  holdings: XRayHolding[];
  initialFreshness: XRayFreshness;
}) {
  const [liveHoldings,setLiveHoldings]=useState(holdings);
  const [issuerRefresh,setIssuerRefresh]=useState({revision:0,force:false});
  const refreshIssuer=useCallback((force:boolean)=>{
    setIssuerRefresh((previous)=>({revision:previous.revision+1,force}));
  },[]);
  const [constituents, setConstituents] = useState<XRayConstituent[]>([]);
  const [automaticRows, setAutomaticRows] = useState<XRayConstituent[]>([]);
  const selectedSources = useMemo(() => {
    try { return {...explainConstituentSources(constituents,automaticRows),error:""}; }
    catch(error) {
      // Preserve usable manual rows, but make reconciliation failure visible.
      // Never fabricate a successful source decision after a failed merge.
      return {rows:constituents,decisions:[],
        error:error instanceof Error?error.message:String(error)};
    }
  },[constituents,automaticRows]);
  const effectiveRows=selectedSources.rows;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [ownershipFilter,setOwnershipFilter]=useState<XRayOwnershipFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showFunds, setShowFunds] = useState(false);
  const [visible, setVisible] = useState(50);

  useEffect(() => {
    let active = true;
    loadRows().then((data) => {
      validateXRayConstituents(data);
      if (active) setConstituents(data);
    }).catch((error) => {
      if (active) setMessage("Dříve uložené podklady nelze načíst: " + (error instanceof Error ? error.message : "neznámá chyba"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const report = useMemo(() => {
    try { return { data: calculateXRay(liveHoldings, effectiveRows), error: "" }; }
    catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [liveHoldings, effectiveRows]);

  const filtered = useMemo(() => (report.data?.exposures ?? []).filter((item) => {
    if (filter !== "all" && item.kind !== filter) return false;
    if(!matchesXRayOwnership(item,ownershipFilter))return false;
    const needle = query.trim().toLocaleLowerCase("cs");
    return !needle || [item.ticker, item.name, item.key, ...item.fundSymbols, ...item.accounts].some((v) => v.toLocaleLowerCase("cs").includes(needle));
  }), [report.data, filter, ownershipFilter, query]);

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (files.length > 40) throw new RangeError("Importuj maximálně 40 souborů najednou.");
      let merged = [...constituents];
      let imported = 0;
      const replaced = new Set<string>();
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith(".csv")) throw new RangeError("Podporované jsou soubory .csv, nikoliv " + file.name);
        if (file.size > 8 * 1024 * 1024) throw new RangeError("Soubor " + file.name + " překračuje 8 MB.");
        const incoming = parseXRayCompositionCsv(await file.text(), file.name);
        const identities = new Set(incoming.map((item) => item.fundIsin
          ? "isin:" + item.fundIsin.toUpperCase() : "symbol:" + item.fundSymbol.toUpperCase()));
        if ([...identities].some((id) => replaced.has(id))) throw new RangeError("Stejný fond je ve více vybraných souborech. Importuj ho jen jednou.");
        identities.forEach((id) => replaced.add(id));
        merged = merged.filter((item) => !identities.has(item.fundIsin
          ? "isin:" + item.fundIsin.toUpperCase() : "symbol:" + item.fundSymbol.toUpperCase()));
        merged.push(...incoming);
        imported += incoming.length;
      }
      validateXRayConstituents(merged);
      // Do not present unsaved work as saved, or silently lose other funds.
      await writeRows(merged);
      setConstituents(merged);
      setSelected(null);
      setMessage("Importováno " + imported.toLocaleString("cs-CZ") + " podkladů. Aktualizované fondy byly nahrazeny, ostatní zůstaly zachovány.");
    } catch (error) {
      setMessage("Import nebyl proveden: " + (error instanceof Error ? error.message : String(error)));
    } finally { setBusy(false); }
  }

  async function commitIssuerRows(incoming: XRayConstituent[]) {
    if (busy || loading) throw new RangeError("Právě probíhá jiný import nebo načítání.");
    if (!incoming.length) throw new RangeError("Prázdné složení ETF nelze importovat.");
    const first = incoming[0];
    if (incoming.some((r) => r.fundIsin !== first.fundIsin || r.fundSymbol !== first.fundSymbol)) {
      throw new RangeError("Jeden originální soubor musí obsahovat právě jeden vybraný fond.");
    }
    setBusy(true);
    try {
      // Remove an older symbol-only snapshot when the new file proves the
      // ISIN, but do not delete another fund with the same ticker and
      // a different, explicit ISIN.
      const replaced = constituents.filter((row) =>
        first.fundIsin
          ? row.fundIsin === first.fundIsin ||
            (!row.fundIsin && row.fundSymbol === first.fundSymbol)
          : !row.fundIsin && row.fundSymbol === first.fundSymbol
      );
      const previous = new Set(replaced);
      const next = [...constituents.filter((r) => !previous.has(r)), ...incoming];
      validateXRayConstituents(next);
      await writeRows(next);
      setConstituents(next);
      setSelected(null);
      setMessage("Originální rozklad fondu " + first.fundSymbol + " byl uložen: " +
        incoming.length.toLocaleString("cs-CZ") + " podkladových řádků. Ostatní fondy zůstaly zachovány.");
    } finally {
      setBusy(false);
    }
  }

  async function clearImport() {
    if (!window.confirm("Smazat všechny importované podklady ETF z tohoto prohlížeče? Skutečné pozice FinanceOS se nezmění.")) return;
    setBusy(true);
    try {
      await writeRows([]);
      setConstituents([]);
      setSelected(null);
      setMessage("Podklady ETF byly odstraněny. Skutečné investiční pozice se nezměnily.");
    } catch (error) {
      setMessage("Podklady nelze odstranit: " + (error instanceof Error ? error.message : String(error)));
    } finally { setBusy(false); }
  }

  function downloadExample() {
    const csv = "fund_symbol,fund_isin,security_symbol,security_isin,security_name,weight_pct,kind,as_of,source\nEXAMPLE,IE00B0000000,MSFT,US5949181045,Microsoft,6.5,stock,2026-10-14,issuer-example\nEXAMPLE,IE00B0000000,CASH,,Cash,93.5,other,2026-10-14,issuer-example\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "xray-format-example.csv"; document.body.append(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
  }

  const data = report.data;
  const usedFiles = [...new Set(constituents.map((r) => r.source))];
  return (
    <div className="space-y-4">
      <XRayLivePositions initial={initialFreshness} onUpdate={setLiveHoldings}
        onIssuerRefresh={refreshIssuer} />
      <XRayAutoSync onUpdate={setAutomaticRows} refreshSignal={issuerRefresh} />
      <section className="finance-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Volitelný ruční import a záloha složení</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
              Přímé akcie, kryptoměny a podporovaná ETF se načítají automaticky z propojených účtů a zdrojů emitentů. CSV slouží pouze jako volitelná záloha.
              FinanceOS nikdy nedopočítává chybějící společnosti z odhadů nebo z předchozího agregovaného X-Ray reportu.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="finance-action" onClick={downloadExample}>Ukázkový formát CSV ↓</button>
            <label className={"finance-action finance-action-primary " + (busy ? "opacity-60" : "")}>
              {busy ? "Importuji…" : "+ Importovat složení ETF"}
              <input type="file" accept=".csv,text/csv" multiple disabled={busy || loading} className="sr-only"
                onChange={(event) => { void importFiles(event); }} aria-label="Importovat složení ETF z CSV"/>
            </label>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[var(--muted)]">
            {loading ? "Načítám lokální podklady…" : "Importováno: " + constituents.length.toLocaleString("cs-CZ") + " řádků · " + usedFiles.length + " zdrojů"}
            {" · "}Data složení se ukládají pouze do tohoto prohlížeče (IndexedDB).
          </span>
          {constituents.length ? <button type="button" disabled={busy} onClick={() => void clearImport()} className="font-semibold text-[var(--warning)] hover:underline">Smazat importované podklady</button> : null}
        </div>
        {message ? <p role="status" aria-live="polite" className="mt-3 rounded-xl border border-[var(--border)] bg-black/10 p-3 text-xs leading-5">{message}</p> : null}
        <XRayIssuerImport holdings={liveHoldings} disabled={busy || loading} onCommit={commitIssuerRows} />
        <details className="mt-3 text-xs text-[var(--muted)]">
          <summary className="w-fit font-semibold text-[var(--accent)]">Jak připravit CSV a proč je to důležité?</summary>
          <p className="mt-2 leading-5">
            Povinné sloupce: fund_symbol, security_symbol, security_name, weight_pct, kind. Doporučujeme fund_isin,
            security_isin, as_of a source. Váha je 0–100 % hodnoty fondu (nikoliv násobek ani pákový notional).
            Podklad může být stock, crypto nebo other (hotovost, dluhopis, derivát). CSV se středníkem je podporováno.
            Každý fond musí mít součet vah nejvýše 100 %, jinak se import odmítne. Při opakovaném importu stejného fondu
            se jeho staré složení nahradí novým, zatímco ostatní fondy zůstanou.
          </p>
        </details>
      </section>

      {report.error ? <p role="alert" className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/[.07] p-4 text-sm text-[var(--warning)]">{report.error}</p> : null}
      {data ? (
        <>
          <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Stav Portfolio X-Ray">
            {[
              ["Zkoumané investice", money(data.denominatorCzk), "Akcie + ETF + krypto, bez hotovosti a P2P"],
              ["Identifikovaná expozice", money(data.mappedCzk), pct(data.mappedPct) + " z analyzovaných investic"],
              ["Nerozložená část", money(data.unallocatedCzk), "Zůstává započítaná ve jmenovateli vah"],
              ["Slučené položky", String(data.exposures.length), data.funds.length + " pozic ETF k rozkladu"],
            ].map(([label, value, hint]) => (
              <div key={label} className="finance-surface min-w-0 p-4">
                <p className="text-[11px] text-[var(--muted)]">{label}</p>
                <p className="mt-2 break-words text-xl font-semibold tabular-nums">{value}</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{hint}</p>
              </div>
            ))}
          </section>
          <XRaySourceSelectionAudit funds={data.funds}
            decisions={selectedSources.decisions} error={selectedSources.error}/>
          <XRayIdentityQuality coverage={data.identityCoverage} funds={data.funds} bridgeAudit={data.bridgeAudit} />
          <section className="finance-surface p-4 sm:p-5">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Skutečná expozice podle podkladu</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Součet přímé a nepřímé expozice. Každé ETF zůstává v celkovém základu pouze jednou.
                  Sloupec Přímé kusy označuje pouze skutečně přímo držené akcie, nikoliv jejich hodnotu uvnitř ETF.
                  Pomlčka znamená, že akcii držíš pouze nepřímo přes fondy.
                </p>
              </div>
              <span className="text-xs font-semibold text-[var(--accent)]">{pct(data.mappedPct)} identifikováno</span>
            </div>
            <div role="progressbar" aria-label="Identifikované procento portfolia" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(data.mappedPct.toFixed(2))} className="mt-3 h-2 overflow-hidden rounded-full bg-white/[.075]">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{width:data.mappedPct+"%"}}/>
            </div>
            {data.estimatedProxyCzk>0 ? <p className="mt-2 text-xs font-medium text-[var(--warning)]">
              ⚠ Z identifikovaných expozic představuje {money(data.estimatedProxyCzk)}
              {" "}({pct(data.denominatorCzk?100*data.estimatedProxyCzk/data.denominatorCzk:0)} celého portfolia)
              pouze přibližný model LYMS podle CNDX, nikoli doložené indexové váhy.
            </p>:null}
            {data.warnings.length ? <div className="mt-3 space-y-1 text-xs text-[var(--warning)]">{data.warnings.map((text) => <p key={text}>⚠ {text}</p>)}</div> : null}
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="min-w-[180px] flex-1 text-[11px] text-[var(--muted)]">Najít akcii, krypto nebo fond
                <input type="search" className="finance-field mt-1 block w-full text-xs" value={query}
                  placeholder="Microsoft, BTC, MSFT, VWCE…" onChange={(event)=>{setQuery(event.target.value);setVisible(50);}}/>
              </label>
              <label className="text-[11px] text-[var(--muted)]">Třída
                <select className="finance-field mt-1 block min-w-[145px] text-xs" value={filter}
                  onChange={(event)=>{setFilter(event.target.value as Filter);setVisible(50);}}>
                  <option value="all">Akcie i krypto</option><option value="stock">Akcie</option><option value="crypto">Kryptoměny</option>
                </select>
              </label>
              <label className="text-[11px] text-[var(--muted)]">Způsob držení
                <select className="finance-field mt-1 block min-w-[165px] text-xs"
                  value={ownershipFilter}
                  onChange={(event)=>{
                    setOwnershipFilter(event.target.value as XRayOwnershipFilter);
                    setSelected(null);setVisible(50);
                  }}>
                  <option value="all">Všechny expozice</option>
                  <option value="both">Přímo i přes ETF</option>
                  <option value="direct-only">Pouze přímo</option>
                  <option value="funds-only">Pouze přes ETF</option>
                </select>
              </label>
              <button type="button" className="finance-action"
                onClick={()=>{setFilter("all");setOwnershipFilter("all");setQuery("");setSelected(null);setVisible(50);}}>
                Vymazat filtry
              </button>
            </div>
            <p aria-live="polite" className="mt-3 text-[11px] text-[var(--muted)]">
              Zobrazeno {Math.min(visible, filtered.length)} z {filtered.length} titulů.
              Klikni na akcii pro přímé a nepřímé příspěvky v Kč a jejich podíl
              na hodnotě jednotlivých ETF i celého analyzovaného portfolia.
            </p>
            <div className="finance-scrollbar mt-2 overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="finance-data-table min-w-[710px] text-left">
                <thead><tr>
                  <th>Akcie / krypto</th><th className="text-right">Přímo</th>
                  <th className="text-right">Přes fondy</th><th className="text-right">Celkem</th>
                  <th className="text-right">Váha</th><th className="text-right" title="Počet akcií, které přímo držíš mimo ETF. Pomlčka znamená pouze nepřímou expozici.">Přímé kusy</th>
                </tr></thead>
                <tbody>
                  {filtered.slice(0,visible).map((item)=>(
                    <Fragment key={item.key}>
                    <tr className="cursor-pointer" onClick={()=>setSelected(selected===item.key?null:item.key)}>
                      <td className="max-w-60">
                        <button type="button" className="text-left" aria-expanded={selected===item.key}
                          onClick={(e)=>{e.stopPropagation();setSelected(selected===item.key?null:item.key);}}>
                          <span className="block text-sm font-semibold">{item.ticker}</span>
                          <span className="block text-[11px] text-[var(--muted)]">{item.name}</span>
                          {item.fundContributions.some(f=>f.exposureBasis==="reference-index-proxy")?
                             <span className="block text-[10px] text-[var(--warning)]">⚠ Obsahuje odhad LYMS podle CNDX</span>:null}
                           {item.directCzk === 0 && item.viaFundsCzk > 0 ?
                            <span className="block text-[10px] text-[var(--muted)]">Pouze přes ETF{item.kind==="stock" && item.key.startsWith("stock|sedol:") ?
                              " · SEDOL " + item.key.slice("stock|sedol:".length) : ""}</span> : null}

                        </button>
                      </td>
                      <td className="text-right">{money(item.directCzk)}</td>
                      <td className="text-right">{money(item.viaFundsCzk)}</td>
                      <td className="text-right font-semibold">{money(item.totalCzk)}</td>
                      <td className="text-right font-semibold text-[var(--accent)]">{pct(item.weightPct)}</td>
                      <td className="text-right">{item.directCzk > 0 ? quantity(item.directQuantity) :
                        <span className="text-[var(--muted)]" title="Žádné přímo držené akcie, pouze ekonomická expozice přes ETF">—</span>}</td>
                    </tr>
                    {selected===item.key ? <tr className="bg-white/[.015]">
                      <td colSpan={6} className="p-3">
                        <XRayExposureBreakdown exposure={item} funds={data.funds}
                          portfolioValueCzk={data.denominatorCzk}/>
                      </td>
                    </tr> : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {visible < filtered.length ? <button type="button" className="finance-action mt-3" onClick={()=>setVisible((v)=>v+50)}>Zobrazit dalších 50</button> : null}
            {!filtered.length ? <p className="py-7 text-center text-xs text-[var(--muted)]">Pro tuto kombinaci filtrů nejsou žádné identifikované expozice.</p> : null}
          </section>
          <section className="finance-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-base font-semibold">Pokrytí podkladů jednotlivých ETF / ETP</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">Souhrn podle ISIN (i při více účtech), způsob replikace, zdroj a datum podkladů pro každý produkt.</p></div>
              <button type="button" aria-expanded={showFunds} className="finance-action" onClick={()=>setShowFunds((v)=>!v)}>{showFunds?"Skrýt fondy":"Zobrazit fondy ("+data.funds.length+")"}</button>
            </div>
            {showFunds ? <div className="finance-scrollbar mt-3 overflow-x-auto">
              <table className="finance-data-table min-w-[600px] text-left">
                <thead><tr><th>ETF / ETC / ETP</th><th className="text-right">Hodnota</th><th className="text-right">Pokrytí</th><th className="text-right">Nerozloženo</th><th>Zdroj / datum</th></tr></thead>
                <tbody>{data.funds.map((f,i)=>{
                  const insight=fundInsightForIsin(f.isin);
                  return <tr key={f.isin??f.symbol+"|"+i}>
                    <td>
                      <span className="font-semibold">{f.symbol}</span>
                      {f.isin?<span className="block text-[10px] text-[var(--muted)]">{f.isin}</span>:null}
                      {insight?<span className="mt-1 block text-[10px] leading-4 text-[var(--accent)]">{insight.label}</span>:null}
                      {f.exposureBasis==="reference-index"?<span className="mt-1 block text-[10px] text-[var(--warning)]">Referenční index · ne fyzická držba podkladů</span>:null}
                      {f.exposureBasis==="reference-index-proxy"?<span className="mt-1 block text-[10px] font-semibold text-[var(--warning)]">⚠ Odhad z CNDX · NE skutečné váhy LYMS ani indexu</span>:null}
                    </td>
                    <td className="text-right">{money(f.valueCzk)}</td><td className="text-right">{pct(f.mappedPct)}</td>
                    <td className="text-right">{money(f.unmappedCzk)}</td>
                    <td className="max-w-[320px] text-[11px] text-[var(--muted)]">
                      {f.asOf??"Datum neznámé"} · {f.source??f.note??"Zdroj neznámý"}
                      {insight&&f.source?<span className="mt-1 block">{insight.explanation}</span>:null}
                      {insight?<a href={insight.issuerUrl} target="_blank" rel="noopener noreferrer"
                        className="mt-1 inline-block text-[var(--accent)] underline">Struktura podle emitenta ↗</a>:null}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>:null}
          </section>
          <p className="rounded-xl border border-[var(--border)] bg-white/[.02] p-4 text-xs leading-5 text-[var(--muted)]">
            <strong className="text-[var(--foreground)]">Omezení:</strong> Váhy se vztahují pouze k aktuálně evidovaným kladným pozicím akcií, ETF/ETC/ETP a kryptoměn, nikoliv k celému čistému jmění. Hotovost a P2P nejsou ve jmenovateli. Syntetická a páková expozice se automaticky neodvozuje. Neznámé podklady a ostatní instrumenty uvnitř fondů zůstávají v nerozložené části.
            Ekvivalentní kusy přes ETF se zobrazí pouze při dostupné přímé referenční ceně stejného instrumentu. Podklady emitenta mohou být starší než aktuální ceny pozic.
          </p>
        </>
      ) : null}
    </div>
  );
}
