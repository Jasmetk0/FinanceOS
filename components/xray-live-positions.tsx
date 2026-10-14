"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shouldStartAutoSync, XRAY_AUTO_REFRESH_MS, type XRayFreshness } from "@/lib/xray/freshness";
import type { XRayHolding } from "@/lib/xray/engine";

interface XRayLiveSnapshot {
  holdings: XRayHolding[];
  freshness: XRayFreshness;
}
interface RefreshAnswer {
  snapshot: XRayLiveSnapshot;
  attempted: boolean;
  reason?: string;
  results?: Array<{ provider: string; ok: boolean; error?: string }>;
}

const AUTO_ATTEMPT_KEY = "financeos-xray-last-auto-sync-v1";
const stamp = (v: string | null | undefined) => {
  if (!v) return "zatím bez údajů";
  const time = new Date(v);
  return Number.isFinite(time.valueOf())
    ? time.toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" })
    : "neznámé datum";
};
const labels:Record<string,string> = { trading212:"Trading 212",kraken:"Kraken",phantom:"Phantom" };
const status:Record<string,string> = { current:"Synchronizováno nedávno",stale:"Zastaralá synchronizace",
  error:"Chyba poslední synchronizace",disconnected:"Bez propojeného API" };

export function XRayLivePositions({
  initial, onUpdate, onIssuerRefresh,
}: {
  initial: XRayFreshness;
  onUpdate: (holdings:XRayHolding[])=>void;
  onIssuerRefresh: (force:boolean)=>void;
}) {
  const [freshness,setFreshness]=useState<XRayFreshness>(initial);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [details,setDetails]=useState(false);
  const active=useRef(false);

  const update=useCallback((next:XRayLiveSnapshot)=>{
    if(!Array.isArray(next.holdings) || !next.freshness?.connections) {
      throw new Error("FinanceOS vrátil neplatný přehled pozic.");
    }
    setFreshness(next.freshness);
    onUpdate(next.holdings);
  },[onUpdate]);

  const refresh=useCallback(async(mode:"auto"|"manual")=>{
    if(active.current)return;
    active.current=true;
    setBusy(true);
    if(mode==="manual")setMessage("");
    try {
      if(mode==="auto") {
        // Browser throttle complements server-side limiting across tabs.
        try {localStorage.setItem(AUTO_ATTEMPT_KEY,String(Date.now()));}
        catch { /* session without storage permission: server still guards requests */ }
      }
      const response=await fetch("/api/xray/live",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({mode}),
      });
      const payload:RefreshAnswer & {error?:string}=await response.json();
      if(!response.ok) throw new Error(payload.error||"Synchronizace API nebyla úspěšná.");
      update(payload.snapshot);
      // Broker sync can add/remove ETF. Refetch relevant issuer data against
      // the current SQLite positions (force official refresh only by request).
      onIssuerRefresh(mode==="manual");
      const failures=payload.results?.filter(r=>!r.ok)??[];
      if(failures.length) {
        setMessage("Částečná synchronizace: "+failures.map(r=>(labels[r.provider]??r.provider)+": "+(r.error??"chyba")).join("; ")+
          ". Nepovedené účty mohou stále ukazovat staré hodnoty.");
      } else if(!payload.attempted) {
        setMessage(payload.reason==="rate_limited"?"Synchronizace byla provedena nedávno; dodržujeme limit požadavků.":
          payload.reason==="no_connected_api"?"Zatím nejsou propojené podporované API účty.":"Údaje jsou již synchronizované.");
      } else if(mode==="manual")setMessage("Pozice byly znovu načteny z připojených účtů. Podklady ETF se také obnovují.");
      else setMessage("");
    } catch(e) {
      setMessage((mode==="auto"?"Automatická synchronizace: ":"Ruční synchronizace: ")+
        (e instanceof Error?e.message:String(e))+
        " Dosavadní pozice zůstávají zobrazené, ale nelze je považovat za živé.");
    } finally {
      active.current=false;
      setBusy(false);
    }
  },[onIssuerRefresh,update]);

  const check=useCallback(async()=>{
    if(active.current)return;
    active.current=true;
    let runAuto=false;
    try {
      const response=await fetch("/api/xray/live",{cache:"no-store",credentials:"same-origin"});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const snapshot:XRayLiveSnapshot=await response.json();
      update(snapshot);
      const now=Date.now();
      let previous:number|null=null;
      try {
        const raw=localStorage.getItem(AUTO_ATTEMPT_KEY);
        if(raw) previous=Number(raw);
      } catch {/* storage may be disabled */}
      runAuto=shouldStartAutoSync(snapshot.freshness,previous,now);
    } catch(e) {
      setMessage("Nelze ověřit aktuálnost pozic: "+(e instanceof Error?e.message:String(e))+
        ". Zobrazují se naposledy uložené hodnoty.");
    } finally {active.current=false;}
    if(runAuto)await refresh("auto");
  },[refresh,update]);

  useEffect(()=>{
    void Promise.resolve().then(()=>check());
    const interval=window.setInterval(()=>{
      if(document.visibilityState==="visible")void check();
    },5*60*1000);
    const visible=()=>{
      if(document.visibilityState==="visible")void check();
    };
    document.addEventListener("visibilitychange",visible);
    return ()=>{
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange",visible);
    };
  },[check]);

  return <section className="finance-surface p-4 sm:p-5" aria-label="Aktuálnost skutečných investičních pozic">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">Aktuálnost portfolia</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
          Propojené účty se automaticky obnovují při otevření X-Ray a při další aktivitě,
          pokud jejich poslední úspěšná synchronizace není novější než 15 minut.
          Údaje jsou snapshots API, nikoli burzovní ceny v reálném čase.
        </p>
      </div>
      <button type="button" disabled={busy} onClick={()=>void refresh("manual")}
        className="finance-action finance-action-primary">
        {busy?"Synchronizuji účty…":"↻ Aktualizovat účty + ETF nyní"}
      </button>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
      <strong className={freshness.status==="current"?"text-[var(--accent)]":
        freshness.status==="disconnected"?"text-[var(--muted)]":"text-[var(--warning)]"}>
        {status[freshness.status]}
      </strong>
      <span className="text-[var(--muted)]">
        Poslední aktualizace pozic: {stamp(freshness.newestPositionUpdateAt)}
      </span>
      <button type="button" onClick={()=>setDetails(s=>!s)}
        aria-expanded={details} className="text-[var(--accent)] underline">
        {details?"Skrýt zdroje":"Podrobnosti zdrojů"}
      </button>
    </div>
    {details?<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {freshness.connections.length?freshness.connections.map(c=>
        <div key={c.provider} className="rounded-xl border border-[var(--border)] bg-white/[.025] p-3 text-[11px]">
          <strong>{labels[c.provider]??c.provider}</strong>
          <span className="ml-2 text-[var(--muted)]">{c.status}</span>
          <p className="mt-1 text-[var(--muted)]">Úspěšná synchronizace: {stamp(c.lastSyncedAt)}</p>
          {c.lastError?<p className="mt-2 text-[var(--warning)]">Poslední chyba: {c.lastError}</p>:null}
        </div>
      ):<p className="text-xs text-[var(--muted)]">Žádný Trading 212, Kraken ani Phantom API účet není připojený.</p>}
      <div className="rounded-xl border border-[var(--border)] bg-white/[.025] p-3 text-[11px]">
        <strong>Stáří lokálních pozic</strong>
        <p className="mt-1 text-[var(--muted)]">Nejstarší aktualizace: {stamp(freshness.oldestPositionUpdateAt)}</p>
        <p className="mt-1 text-[var(--muted)]">Nejnovější aktualizace: {stamp(freshness.newestPositionUpdateAt)}</p>
        <p className="mt-1 text-[var(--muted)]">Počet pozic: {freshness.positionsCount}</p>
      </div>
    </div>:null}
    {message?<p role="status" aria-live="polite"
      className="mt-3 rounded-xl border border-[var(--border)] p-3 text-xs leading-5 text-[var(--muted)]">
      {message}
    </p>:null}
    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      Automatická synchronizace je omezena na nejvýše jeden pokus za {XRAY_AUTO_REFRESH_MS/60000} minut.
      Zdrojová data a jejich ocenění mohou být zpožděná již u brokera; samotná aktualizace neznamená skutečnou
      kotaci „live“. Časy složení ETF od emitentů jsou uvedeny zvlášť níže.
    </p>
  </section>;
}
