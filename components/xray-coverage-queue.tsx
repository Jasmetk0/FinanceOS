"use client";

import {useMemo,useState} from "react";
import type {CoveragePriorities,CoverageStatus} from "@/lib/xray/coverage-priorities";

const money=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:0})+" Kč";
const pct=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:2})+" %";
const label:Record<CoverageStatus,string>={
  missing:"Bez rozkladu",partial:"Částečný rozklad",
  proxy:"Model indexu",index:"Referenční index",
  "non-equity":"Jiný typ produktu",covered:"Rozloženo",
};
type Filter="priority"|"all"|"non-equity"|"covered";

export function XRayCoverageQueue({result}:{result:CoveragePriorities}){
  const [filter,setFilter]=useState<Filter>("priority");
  const [showAll,setShowAll]=useState(false);
  const filtered=useMemo(()=>result.rows.filter(r=>
    filter==="all"||
    (filter==="priority"&&r.priorityCzk>0)||
    (filter==="non-equity"&&r.status==="non-equity")||
    (filter==="covered"&&r.status==="covered")
  ),[filter,result.rows]);
  const visible=showAll?filtered:filtered.slice(0,12);
  return <section className="finance-surface p-4 sm:p-5" aria-label="Priority pokrytí podkladů ETF">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-3xl">
        <h2 className="text-base font-semibold">Priority dokončení rozkladu ETF</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Fondy seřazené podle finančního dopadu chybějícího nebo modelovaného
          složení, nikoliv podle počtu neznámých tickerů. Původní investice
          se tím nemění.
        </p>
      </div>
      <span className="text-xs text-[var(--muted)]">{result.rows.length} fondů podle identity</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Hodnota k prověření</p>
        <strong className="mt-1 block text-base tabular-nums">{money(result.priorityCzk)}</strong>
        <p className="mt-1 text-[11px] text-[var(--muted)]">Zahrnuje celé NAV modelových fondů</p>
      </div>
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Nerozloženo ve fondech</p>
        <strong className="mt-1 block text-base tabular-nums">{money(result.fundUnmappedCzk)}</strong>
      </div>
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Odhadovaná část (proxy)</p>
        <strong className="mt-1 block text-base tabular-nums">{money(result.proxyMappedCzk)}</strong>
        <p className="mt-1 text-[11px] text-[var(--muted)]">Již zahrnuto v mapovaném NAV</p>
      </div>
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Známé neakciové produkty</p>
        <strong className="mt-1 block text-base tabular-nums">{money(result.structuralCzk)}</strong>
        <p className="mt-1 text-[11px] text-[var(--muted)]">Např. zlato či pákové ETP</p>
      </div>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
      Částky „k prověření“, „nerozloženo“ a „proxy“ se mohou překrývat;
      nesmí se sčítat jako nové investice. Celé NAV fondů je {money(result.fundsCzk)}
      {" "}z {money(result.denominatorCzk)} analyzovaného portfolia.
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label htmlFor="xray-coverage-filter" className="text-xs text-[var(--muted)]">Zobrazení</label>
      <select id="xray-coverage-filter" className="finance-field text-xs" value={filter}
        onChange={e=>{setFilter(e.target.value as Filter);setShowAll(false);}}>
        <option value="priority">K prověření</option>
        <option value="all">Všechny fondy</option>
        <option value="non-equity">Jiné typy produktů</option>
        <option value="covered">Rozložené</option>
      </select>
      <span aria-live="polite" className="text-xs text-[var(--muted)]">
        {filtered.length} výsledků
      </span>
      <a className="finance-action ml-auto" href="#xray-auto-sync">
        Automatické zdroje ↑
      </a>
    </div>
    <div className="mt-3 space-y-2">
      {visible.map(r=><article key={r.isin??"symbol:"+r.symbol}
        className="rounded-xl border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <strong className="text-sm">{r.symbol}</strong>
            <span className="ml-2 text-[11px] text-[var(--muted)]">{label[r.status]}</span>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{r.isin??"Bez ISIN"}</p>
          </div>
          <div className="text-right text-xs tabular-nums">
            <strong>{money(r.priorityCzk)} k prověření</strong>
            <p className="mt-1 text-[var(--muted)]">
              {pct(r.mappedPct)} rozloženo · {money(r.unmappedCzk)} nerozloženo
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{r.explanation}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span className="text-[var(--muted)]">
            {r.asOf ? "Podklady k "+r.asOf+" · "+(r.source??"zdroj neznámý") :
              "Datum podkladů není k dispozici"}
          </span>
          {r.priorityCzk>0?<a href="#xray-manual-import"
            className="font-semibold text-[var(--accent)] underline">
            Volitelné doplnění podkladů ↑
          </a>:null}
          {r.issuerUrl?<a href={r.issuerUrl} target="_blank" rel="noopener noreferrer"
            className="font-semibold text-[var(--accent)] underline">Emitent ↗</a>:null}
        </div>
      </article>)}
      {!filtered.length?<p className="py-4 text-sm text-[var(--muted)]">
        V tomto filtru nejsou žádné fondy.
      </p>:null}
    </div>
    {!showAll&&filtered.length>visible.length?<button className="finance-action mt-3"
      type="button" onClick={()=>setShowAll(true)}>
      Zobrazit dalších {filtered.length-visible.length} fondů
    </button>:null}
    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      Priorita není slib dostupného API emitenta ani důkaz chybějících akcií.
      Nerozložená hodnota může být i hotovost nebo deriváty. Zlato a pákové
      instrumenty neznamenají přímo vlastněné akcie nebo spot kryptoměny.
    </p>
  </section>;
}
