"use client";

import { useState } from "react";
import type { IssuerHealthRecord } from "@/lib/xray/issuer-diagnostics";

interface DiagnosticReport {
  checkedAt:string;
  sources:IssuerHealthRecord[];
  healthy:number;
  limited:number;
  failed:number;
  cached:boolean;
  shared:boolean;
  error?:string;
}
const STATUS:Record<IssuerHealthRecord["state"],string>={
  healthy:"Zdroj funkční",
  aging:"Starší datum",
  stale:"Zastaralý snapshot",
  partial:"Neúplné váhy",
  failed:"Chyba stahování / parseru",
};
const percentage=(v:number)=>v.toLocaleString("cs-CZ",{maximumFractionDigits:2})+" %";
const dateTime=(s:string|null)=>{
  if(!s)return "—";
  const d=new Date(s);
  return Number.isFinite(d.getTime())?
    d.toLocaleString("cs-CZ",{dateStyle:"medium",timeStyle:"short"}):"—";
};

/**
 * Explicit manual test: makes real requests from the locally running
 * FinanceOS server. No automatic remote monitoring, cron or external tokens.
 */
export function XRayIssuerDiagnostics(){
  const [report,setReport]=useState<DiagnosticReport|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  async function run(){
    if(loading)return;
    setLoading(true);
    setError("");
    try {
      const response=await fetch("/api/xray/diagnostics",{
        method:"POST",credentials:"same-origin",cache:"no-store",
      });
      const json:unknown=await response.json();
      if(!json || typeof json!=="object")throw new Error("Neplatná odpověď diagnostiky.");
      const result=json as DiagnosticReport;
      if(!response.ok)throw new Error(result.error||"Diagnostika nebyla dostupná.");
      if(!Array.isArray(result.sources)||!result.sources.length||
        !result.sources.every(item=>item&&typeof item.isin==="string"&&typeof item.symbol==="string")||
        new Set(result.sources.map(item=>item.isin)).size!==result.sources.length||
        ![result.healthy,result.limited,result.failed].every(Number.isSafeInteger)||
        result.healthy+result.limited+result.failed!==result.sources.length)
        throw new RangeError("Neplatný nebo neúplný seznam zdrojů emitentů.");
      setReport(result);
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{setLoading(false);}
  }
  return <details className="mt-3 rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
    <summary className="cursor-pointer font-semibold text-[var(--accent)]">
      Ověřit skutečné napojení na emitenty (diagnostika)
    </summary>
    <p className="mt-2 leading-5">
      Tento test provede skutečná síťová volání z tvého spuštěného FinanceOS,
      nikoli simulaci. Ověří všechny aktuálně podporované zdroje přes stejné
      produkční parsery, včetně odděleně označeného archivu Rebalix, a zobrazí chyby. Nespouští synchronizaci brokerů,
      nepoužívá jejich API klíče a nemění hodnoty portfolia.
    </p>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button type="button" disabled={loading} onClick={()=>void run()}
        className="finance-action finance-action-primary">
        {loading?"Kontroluji zdroje…":"Spustit skutečný test zdrojů"}
      </button>
      <span>Příliš časté opakování je omezeno na jeden test za 5 minut.</span>
    </div>
    {error?<p role="alert" className="mt-3 text-[var(--warning)]">{error}</p>:null}
    {report?<div className="mt-3 space-y-3">
      <p role="status" aria-live="polite">
        Kontrola: {dateTime(report.checkedAt)} {report.cached?"· ze serverové diagnostické cache":""}
        {" · "}{report.healthy} funkčních, {report.limited} omezených, {report.failed} chybových zdrojů.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {report.sources.map(item=><div key={item.isin}
          className="min-w-0 rounded-lg border border-[var(--border)] bg-white/[.02] p-3">
          <div className="flex flex-wrap justify-between gap-2">
            <strong>{item.symbol}</strong>
            <strong className={item.state==="healthy"?"text-[var(--accent)]":
              "text-[var(--warning)]"}>{STATUS[item.state]}</strong>
          </div>
          <p className="mt-1 break-all text-[11px]">{item.isin} · {item.provider}</p>
          {item.state!=="failed"?<>
            <p className="mt-2">Podklady: {item.holdings.toLocaleString("cs-CZ")}
              {" · "}složení k {item.asOf??"?"}</p>
            <p className="mt-1">Akcie {percentage(item.stockPct)}
              {" · "}ostatní {percentage(item.otherPct)}
              {" · "}nepopsáno {percentage(item.uncoveredPct)}</p>
          </>:<p className="mt-2 break-words text-[var(--warning)]">
            {item.error||"Nepodařilo se získat validní podklady."}
          </p>}
          <p className="mt-1">Doba požadavků: {(item.elapsedMs/1000).toLocaleString("cs-CZ",{maximumFractionDigits:1})} s</p>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer"
            className="mt-2 inline-block text-[var(--accent)] underline">Zdroj podkladů ↗</a>
        </div>)}
      </div>
      <p className="text-[11px] leading-5">
        Funkční zdroj znamená validně přečtená data s nedávným datem a alespoň 98 % deklarovaných vah.
        Není to ověření aktuálních burzovních cen. U selhání některého zdroje zůstává
        poslední validovaný rozklad ETF dostupný odděleně jako záloha.
      </p>
    </div>:null}
  </details>;
}
