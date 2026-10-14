"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { validateXRayConstituents, type XRayConstituent } from "@/lib/xray/engine";
import {
  classifyIssuerDate, issuerKey, reconcileIssuerRows,
  type IssuerFundStatus,
} from "@/lib/xray/issuer-reliability";
import {
  loadCachedIssuerSnapshots, storeCachedIssuerSnapshots,
} from "@/lib/xray/issuer-cache";

interface AutoResponse {
  rows: XRayConstituent[];
  funds: IssuerFundStatus[];
  unsupported: Array<{ isin:string|null; symbol:string; reason:string }>;
  ok:number;
  supportedTotal:number;
  refreshedAt:string;
  error?:string;
}
const stamp=(value?:string|null) => {
  if(!value)return "neuvedeno";
  const d=new Date(value);
  return Number.isFinite(d.valueOf())
    ? d.toLocaleString("cs-CZ",{dateStyle:"medium",timeStyle:"short"})
    : "neznámý čas";
};
const staleLabel=(asOf?:string|null) => {
  const health=classifyIssuerDate(asOf,Date.now());
  if(health.state==="fresh")return "Složení nedávné";
  if(health.state==="aging")return "Složení starší než 3 dny";
  if(health.state==="stale")return "Zastaralé složení";
  if(health.state==="future")return "Datum složení je v budoucnosti";
  return "Neznámé datum složení";
};

export function XRayAutoSync({
  onUpdate, refreshSignal,
}: {
  onUpdate: (rows:XRayConstituent[])=>void;
  refreshSignal?: { revision:number; force:boolean };
}) {
  const [status,setStatus]=useState<AutoResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [retainedIsins,setRetainedIsins]=useState<string[]>([]);
  const [showingSaved,setShowingSaved]=useState(false);
  const rowsRef=useRef<XRayConstituent[]>([]);
  const loaded=useRef(false);
  const running=useRef(false);

  const refresh=useCallback(async(force:boolean,signal?:AbortSignal)=>{
    if(running.current || signal?.aborted)return;
    running.current=true;
    setLoading(true);
    setError("");
    try {
      if(!loaded.current){
        loaded.current=true;
        try {
          const saved=await loadCachedIssuerSnapshots();
          if(signal?.aborted)return;
          if(saved) {
            rowsRef.current=saved.rows;
            onUpdate(saved.rows);
            setRetainedIsins([...new Set(saved.rows.map(row=>issuerKey(row.fundIsin)).filter(Boolean))]);
            setStatus({
              rows:[],
              funds:saved.funds,
              unsupported:[],
              ok:0,
              supportedTotal:saved.funds.length,
              refreshedAt:saved.savedAt,
            });
            setShowingSaved(true);
          }
        } catch {
          // Malformed/blocked IndexedDB is not a reason to suppress online
          // issuer fetch. Never trust corrupt local backup data.
        }
      }
      const response=await fetch("/api/xray/auto"+(force?"?refresh=1":""),{
        method:"GET",credentials:"same-origin",cache:"no-store",signal,
      });
      const payload:unknown=await response.json();
      if(!payload||typeof payload!=="object")throw new Error("Neplatná odpověď API emitenta.");
      const value=payload as AutoResponse;
      if(!response.ok)throw new Error(value.error||"Načtení podkladů ETF selhalo.");
      if(!Array.isArray(value.rows)||!Array.isArray(value.funds)||
        !Array.isArray(value.unsupported)||typeof value.refreshedAt!=="string") {
        throw new Error("Neúplná odpověď automatické synchronizace ETF.");
      }
      validateXRayConstituents(value.rows);
      const result=reconcileIssuerRows(rowsRef.current,value.rows,value.funds);
      if(signal?.aborted)return;
      rowsRef.current=result.rows;
      onUpdate(result.rows);
      setRetainedIsins(result.retainedIsins);
      setShowingSaved(false);
      setStatus(value);
      try {
        await storeCachedIssuerSnapshots({
          version:1,savedAt:new Date().toISOString(),
          rows:result.rows,
          funds:value.funds.map(f=>({...f})),
        });
      } catch {
        // Current valid network snapshot is usable even if browser storage
        // was denied. The UI explains that cache is best-effort.
      }
    } catch(e) {
      if(signal?.aborted)return;
      setError(e instanceof Error?e.message:String(e));
      // Retain the last known-good portfolio exposure (memory or IndexedDB).
      if(rowsRef.current.length)setShowingSaved(true);
    } finally {
      running.current=false;
      if(!signal?.aborted)setLoading(false);
    }
  },[onUpdate]);

  useEffect(()=>{
    const controller=new AbortController();
    void Promise.resolve().then(()=>refresh(Boolean(refreshSignal?.force),controller.signal));
    return ()=>controller.abort();
  },[refresh,refreshSignal?.revision,refreshSignal?.force]);

  const failures=status?.funds.filter(item=>item.status==="error")??[];
  const issues=status?.funds.filter(f=>{
    const key=issuerKey(f.isin);
    const fallback=rowsRef.current.find(r=>issuerKey(r.fundIsin)===key);
    const age=classifyIssuerDate(f.status==="ok"?f.asOf:fallback?.asOf,Date.now());
    return f.status!=="ok"||age.state!=="fresh";
  })??[];
  const savedSet=new Set(retainedIsins);
  return (
    <section className="finance-surface p-4 sm:p-5" aria-label="Automatické složení ETF a aktuálnost emitentů">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Automatický rozklad ETF</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            ETF jsou přiřazena podle ISIN z propojených účtů. FinanceOS načítá kompletní dostupné podklady
            od emitentů automaticky; CSV není povinné. Datum složení se může lišit od dnešního data i od ocenění.
          </p>
        </div>
        <button type="button" disabled={loading} onClick={()=>void refresh(true)}
          className="finance-action finance-action-primary">
          {loading?"Načítám emitenty…":"↻ Znovu stáhnout složení ETF"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
        <span>{loading?"Ověřuji zdroje…":status?
          status.ok+" z "+status.supportedTotal+" fondů úspěšně načteno":
          "Zatím bez automatického rozkladu"}</span>
        {status?<span>Bez automatického zdroje: {status.unsupported.length}</span>:null}
        {status?<span>Poslední kontrola: {stamp(status.refreshedAt)}</span>:null}
      </div>

      {(error||failures.length>0||retainedIsins.length>0||showingSaved)?(
        <p role="status" aria-live="polite"
          className="mt-3 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/[.05] p-3 text-xs leading-5 text-[var(--warning)]">
          {error?"Zdroj se nepodařilo obnovit: "+error+". ":""}
          {failures.length?failures.length+" emitentů ohlásilo chybu. ":""}
          {retainedIsins.length?
            "Používám poslední ověřené složení "+retainedIsins.length+
            " ETF ze zálohy; NEJDE o aktuální stav emitenta. ":""}
          {showingSaved?"Poslední úspěšné podklady jsou zachované lokálně. ":""}
          {(!error&&!failures.length&&!retainedIsins.length&&showingSaved)?
            "Zkouším ověřit jejich aktuálnost.":""}
        </p>
      ):null}
      {issues.length>0?<p className="mt-2 text-[11px] text-[var(--warning)]">
        {issues.length} fondů má zastaralý, nedostupný nebo neověřený rozklad. Detailní datum je níže.
      </p>:null}

      {status?.funds.length?<details className="mt-3 text-xs text-[var(--muted)]" open={false}>
        <summary className="w-fit cursor-pointer font-semibold text-[var(--accent)]">
          Stav a přesná data složení fondů ({status.funds.length})
        </summary>
        <div className="mt-2 space-y-2">
          {status.funds.map(f=>{
            const saved=rowsRef.current.find(r=>issuerKey(r.fundIsin)===issuerKey(f.isin));
            const fallback=savedSet.has(issuerKey(f.isin))||showingSaved;
            const asOf=fallback?saved?.asOf:f.asOf;
            const freshness=classifyIssuerDate(asOf,Date.now());
            return <div key={f.isin} className="rounded-xl border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{f.symbol} · {f.isin}</strong>
                <span className={fallback||f.status!=="ok"||freshness.state==="stale"||
                  freshness.state==="future"?"text-[var(--warning)]":"text-[var(--accent)]"}>
                  {fallback?"Záložní data · ":f.status==="ok"?"Zdroj funkční · ":"Chyba zdroje · "}
                  {staleLabel(asOf)}
                </span>
              </div>
              <p className="mt-1">Složení k: <strong>{asOf??"neuvedeno"}</strong>
                {" · "}Poslední stažení: {stamp(f.fetchedAt)}
                {" · "}Počet podkladů: {fallback?
                  rowsRef.current.filter(r=>issuerKey(r.fundIsin)===issuerKey(f.isin)).length:
                  f.holdings??"neuvedeno"}
              </p>
              {f.error?<p className="mt-1 text-[var(--warning)]">{f.error}</p>:null}
              {f.sourceUrl?<a href={f.sourceUrl} rel="noreferrer" target="_blank"
                className="mt-1 inline-block text-[var(--accent)] underline">Oficiální zdroj ↗</a>:null}
            </div>;
          })}
        </div>
      </details>:null}
      {status?.unsupported.length?<details className="mt-2 text-xs text-[var(--muted)]">
        <summary className="w-fit cursor-pointer font-semibold">
          ETF bez automatického zdroje ({status.unsupported.length})
        </summary>
        <div className="mt-2 space-y-1">
          {status.unsupported.map((f,i)=><p key={f.isin??f.symbol+"-"+i}>
            {f.symbol} ({f.isin??"bez ISIN"}) · {f.reason}
          </p>)}
        </div>
      </details>:null}
      <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
        Podporované zdroje: Vanguard VWCE, State Street SPYI a vybrané fondy iShares.
        Aktuálnost se posuzuje podle data skutečného složení, ne podle času, kdy jsme soubor stáhli.
        Zálohované automatické podklady jsou v tomto prohlížeči uchovávány maximálně 60 dní.
        Neúplné či chybné zdroje se nepovažují za živé.
      </p>
    </section>
  );
}
