"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { parseIssuerCsv, type IssuerCsvPreview } from "@/lib/xray/issuer-import";
import type { XRayConstituent, XRayHolding } from "@/lib/xray/engine";

type FundOption = { key: string; symbol: string; isin: string | null; name: string };
const pct = (value:number)=>value.toLocaleString("cs-CZ",{maximumFractionDigits:3})+" %";

export function XRayIssuerImport({
  holdings, disabled, onCommit,
}: {
  holdings: XRayHolding[];
  disabled: boolean;
  onCommit: (rows: XRayConstituent[]) => Promise<void>;
}) {
  const funds = useMemo(()=>{
    const map = new Map<string,FundOption>();
    for (const h of holdings) {
      if (h.assetClass !== "etf" || h.valueCzk <= 0) continue;
      const key = h.isin ? "isin:" + h.isin.toUpperCase() : "ticker:" + h.symbol.toUpperCase();
      if (!map.has(key)) map.set(key,{key,symbol:h.symbol,isin:h.isin,name:h.name});
    }
    return [...map.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol));
  },[holdings]);

  const [fundKey,setFundKey]=useState("");
  const [asOf,setAsOf]=useState("");
  const [unit,setUnit]=useState<"percent"|"fraction">("percent");
  const [preview,setPreview]=useState<IssuerCsvPreview|null>(null);
  const [filename,setFilename]=useState("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const fund=funds.find(f=>f.key===fundKey);

  function clear() {setPreview(null);setFilename("");setError("");}

  async function previewFile(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file || disabled || saving) return;
    setError("");
    setPreview(null);
    try {
      if(!fund) throw new RangeError("Nejprve zvol fond, kterému soubor patří.");
      if(!file.name.toLowerCase().endsWith(".csv")) throw new RangeError("V této etapě jsou podporovány pouze CSV soubory.");
      if(file.size>8*1024*1024) throw new RangeError("Soubor je větší než 8 MB.");
      const incoming=parseIssuerCsv(await file.text(),{
        fundSymbol:fund.symbol,fundIsin:fund.isin,asOf,source:"Soubor emitenta: "+file.name,weightFormat:unit,
      });
      setPreview(incoming);
      setFilename(file.name);
    } catch(e) {
      setError(e instanceof Error?e.message:String(e));
    }
  }

  async function commit() {
    if(!preview || saving || disabled)return;
    setSaving(true);
    setError("");
    try {
      await onCommit(preview.rows);
      clear();
    } catch(e) {
      setError(e instanceof Error?e.message:String(e));
    } finally {setSaving(false);}
  }

  return (
    <div className="mt-4 rounded-2xl border border-[var(--border)] bg-black/[.09] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Import originální tabulky emitenta</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Nemusíš ručně přidávat ticker fondu ke každé akcii. Vyber ETF ze skutečných pozic, datum složení a soubor se sloupci
            Ticker/ISIN, Name, Weight (%) a Asset Class. Import se provede až po potvrzení náhledu.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)]">CSV · náhled před uložením</span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-[11px] text-[var(--muted)]">Fond z FinanceOS
          <select value={fundKey} onChange={e=>{setFundKey(e.target.value);clear();}} className="finance-field mt-1 block w-full min-w-0 text-xs">
            <option value="">Vyber ETF</option>
            {funds.map(f=><option key={f.key} value={f.key}>{f.symbol} · {f.isin ?? "bez ISIN"}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-[var(--muted)]">Datum zdrojového složení
          <input type="date" value={asOf} onChange={e=>{setAsOf(e.target.value);clear();}} className="finance-field mt-1 block w-full min-w-0 text-xs"/>
        </label>
        <label className="text-[11px] text-[var(--muted)]">Jednotka váhy v souboru
          <select value={unit} onChange={e=>{setUnit(e.target.value as "percent"|"fraction");clear();}} className="finance-field mt-1 block w-full min-w-0 text-xs">
            <option value="percent">Procenta (např. 6,5 = 6,5 %)</option>
            <option value="fraction">Podíl 0–1 (např. 0,065 = 6,5 %)</option>
          </select>
        </label>
        <div className="flex items-end">
          <label className={"finance-action flex w-full cursor-pointer items-center justify-center "+(disabled||saving||!fund||!asOf?"opacity-50":"")}>
            Vybrat originální CSV
            <input type="file" accept=".csv,text/csv" disabled={disabled||saving||!fund||!asOf} className="sr-only"
              onChange={e=>{void previewFile(e);}} aria-label="Vybrat CSV s podklady vybraného ETF"/>
          </label>
        </div>
      </div>
      {error?<p role="alert" className="mt-3 rounded-xl border border-[var(--warning)]/20 p-3 text-xs text-[var(--warning)]">{error}</p>:null}
      {preview?<div className="mt-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/[.035] p-3">
        <p className="text-xs font-semibold">Náhled: {filename} · {preview.rows.length.toLocaleString("cs-CZ")} řádků</p>
        <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
          Akcie {preview.equityCount}, krypto {preview.cryptoCount}, ostatní {preview.otherCount}.
          {" "}Identifikovatelná váha {pct(preview.identifiedPct)};
          {" "}ostatní instrumenty {pct(preview.otherPct)};
          {" "}chybějící do 100 % {pct(preview.remainderPct)}.
        </p>
        {preview.otherPct+preview.remainderPct>0.001?<p className="mt-2 text-[11px] text-[var(--warning)]">
          Neidentifikovaná část bude dál vykázána jako nerozložené ETF, ne jako akcie.
        </p>:null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-[var(--muted)]">Prvních pět záznamů: {preview.rows.slice(0,5).map(r=>r.securitySymbol+" "+pct(r.weightPct)).join(" · ")}</p>
          <div className="flex gap-2">
            <button type="button" className="finance-action" disabled={saving} onClick={clear}>Zrušit</button>
            <button type="button" className="finance-action finance-action-primary" disabled={saving||disabled} onClick={()=>{void commit();}}>
              {saving?"Ukládám…":"Potvrdit import pro "+fund?.symbol}
            </button>
          </div>
        </div>
      </div>:null}
      <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
        Podpora označení aktiv Equity, Cash, Fixed Income, Derivatives aj. Neznámé typy nebo chybný řádek import zastaví;
        nikdy se nevynechají bez upozornění. Originální soubor musí skutečně obsahovat váhy podkladů, ne jen
        hodnotu pozic či souhrn portfolia. Import je lokální a nepřepisuje původní transakce.
      </p>
    </div>
  );
}
