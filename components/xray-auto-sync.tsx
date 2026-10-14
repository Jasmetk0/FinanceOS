"use client";

import { useCallback, useEffect, useState } from "react";
import { validateXRayConstituents, type XRayConstituent } from "@/lib/xray/engine";

export interface AutoFundStatus {
  isin:string;
  symbol:string;
  status:"ok"|"error"|"unsupported";
  asOf?:string;
  sourceUrl?:string;
  fetchedAt?:string;
  cached?:boolean;
  holdings:number;
  error?:string;
}
interface AutoResponse {
  rows:XRayConstituent[];
  funds:AutoFundStatus[];
  unsupported:Array<{isin:string|null;symbol:string;reason:string}>;
  ok:number;
  supportedTotal:number;
  error?:string;
}

export function XRayAutoSync({
  onUpdate,
}: {
  onUpdate: (rows:XRayConstituent[]) => void;
}) {
  const [status,setStatus]=useState<AutoResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  const refresh=useCallback(async(force:boolean,signal?:AbortSignal)=>{
    setLoading(true);
    setError("");
    try {
      const response=await fetch("/api/xray/auto"+(force?"?refresh=1":""),{
        method:"GET",credentials:"same-origin",cache:"no-store",signal,
      });
      const payload:unknown=await response.json();
      if (!payload || typeof payload!=="object") throw new Error("Neplatná odpověď zdrojového API.");
      const value=payload as AutoResponse;
      if (!response.ok) throw new Error(value.error||"Automatické načtení ETF se nezdařilo.");
      if (!Array.isArray(value.rows) || !Array.isArray(value.funds) || !Array.isArray(value.unsupported)) {
        throw new Error("Nesprávná data ze synchronizace podkladů ETF.");
      }
      validateXRayConstituents(value.rows);
      if (signal?.aborted) return;
      setStatus(value);
      onUpdate(value.rows);
    } catch(e) {
      if (signal?.aborted) return;
      setError(e instanceof Error?e.message:String(e));
      // Keep prior verified data in the UI; never replace with zero shares
      // because an issuer is temporarily down.
    } finally {if (!signal?.aborted) setLoading(false);}
  },[onUpdate]);

  useEffect(()=>{
    const controller=new AbortController();
    void refresh(false,controller.signal);
    return ()=>controller.abort();
  },[refresh]);

  const failures=status?.funds.filter(item=>item.status==="error")??[];
  return <section className="finance-surface p-4 sm:p-5" aria-label="Automatický rozklad ETF">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">Automatický rozklad ETF</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
          Po synchronizaci účtů FinanceOS načte ETF a jejich ISIN. X-Ray potom sám stáhne dostupné oficiální
          složení z podporovaných emitentů. Žádné CSV ani další API klíče nejsou pro podporované fondy potřeba.
        </p>
      </div>
      <button type="button" disabled={loading} onClick={()=>void refresh(true)}
        className="finance-action finance-action-primary">{loading?"Aktualizuji…":"↻ Aktualizovat podklady ETF"}</button>
    </div>
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
      <span>{loading?"Zjišťuji data emitentů…":status?
        "Aktualizováno "+status.ok+" z "+status.supportedTotal+" podporovaných fondů":
        "Zatím bez zdrojového rozkladu"}</span>
      {status?<span>Bez automatického zdroje: {status.unsupported.length} fondů</span>:null}
    </div>
    {error?<p role="alert" className="mt-2 text-xs text-[var(--warning)]">{error}</p>:null}
    {failures.length?<p role="status" className="mt-2 text-xs text-[var(--warning)]">
      Nelze načíst {failures.length} podporovaných fondů. Zůstávají nerozložené nebo se použije dříve importovaný rozklad.
    </p>:null}
    {status&&status.funds.length? <details className="mt-3 text-xs text-[var(--muted)]">
      <summary className="w-fit cursor-pointer font-semibold text-[var(--accent)]">Zobrazit stav automatických zdrojů</summary>
      <div className="mt-2 space-y-1.5">
        {status.funds.map(item=><p key={item.isin} className="rounded-lg border border-[var(--border)] p-2">
          <strong>{item.symbol}</strong> · {item.status==="ok"?
            item.holdings+" podkladů · složení k "+item.asOf+(item.cached?" · ze serverové cache":"") :
            "Chyba: "+(item.error||"bez dat")}
          {item.status==="ok"&&item.sourceUrl?<a href={item.sourceUrl} target="_blank" rel="noreferrer"
            className="ml-2 text-[var(--accent)] underline">Zdroj ↗</a>:null}
        </p>)}
      </div>
    </details>:null}
    {status?.unsupported.length?<details className="mt-2 text-xs text-[var(--muted)]">
      <summary className="w-fit cursor-pointer font-semibold">ETF bez podporovaného zdroje ({status.unsupported.length})</summary>
      <div className="mt-2 space-y-1">
        {status.unsupported.map((item,i)=><p key={item.isin??item.symbol+"-"+i}>
          {item.symbol} ({item.isin??"bez ISIN"}) · {item.reason}
        </p>)}
      </div>
    </details>:null}
    <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
      Zatím je automaticky podporována ověřená podmnožina iShares UCITS fondů (SXR8/CSPX, IWDA/EUNL,
      SSAC/IUSQ, EIMI/IS3N). Nepodporované ETF včetně VWCE zůstává nerozložené, dokud není k dispozici
      ověřený zdroj nebo volitelný CSV import. Data emitenta mají vlastní datum a nemusí být z dnešního obchodního dne.
    </p>
  </section>;
}
