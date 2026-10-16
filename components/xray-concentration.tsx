"use client";

import { useState } from "react";
import type { XRayConcentrationSummary,ConcentrationMode } from "@/lib/xray/concentration";

const money=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:0})+" Kč";
const pct=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:2})+" %";
const width=(amount:number,denominator:number)=>
  (denominator>0?Math.max(0,Math.min(100,100*amount/denominator)):0)+"%";

/**
 * An honest look-through ranking, not a portfolio volatility/VaR estimate:
 * no "100% mapped" normalization, no pretending proxy or unidentified NAV
 * belongs to a known security, no ticker-based identity inference.
 */
export function XRayConcentration({summary}:{summary:XRayConcentrationSummary}) {
  const [mode,setMode]=useState<ConcentrationMode>("without-proxy");
  const view=mode==="without-proxy"?summary.withoutProxy:summary.includingProxy;
  const modelEnabled=mode==="including-proxy";
  const missing=summary.unresolvedCzk;
  const proxy=summary.proxyCzk;
  const known=summary.withoutProxyCzk;
  return <section className="finance-surface p-4 sm:p-5"
    aria-label="Koncentrace portfolia po rozkladu ETF">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-3xl">
        <h2 className="text-base font-semibold">Koncentrace akcií a krypta napříč ETF</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Největší ekonomické expozice po sloučení přímo držených instrumentů
          a rozpoznaných podkladů ETF. Všechna procenta počítají z celé analyzované
          hodnoty portfolia, nikoli jen ze známých akcií.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1 rounded-lg border border-[var(--border)] p-1"
        role="group" aria-label="Zahrnout modelované podklady LYMS">
        <button type="button" onClick={()=>setMode("without-proxy")}
          aria-pressed={!modelEnabled}
          className={"rounded-md px-3 py-1.5 text-xs font-medium "+(!modelEnabled?
            "bg-[var(--accent)] text-black":"text-[var(--muted)] hover:text-[var(--foreground)]")}>
          Bez odhadů
        </button>
        <button type="button" onClick={()=>setMode("including-proxy")}
          aria-pressed={modelEnabled}
          className={"rounded-md px-3 py-1.5 text-xs font-medium "+(modelEnabled?
            "bg-[var(--accent)] text-black":"text-[var(--muted)] hover:text-[var(--foreground)]")}>
          Včetně proxy
        </button>
      </div>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
      {[
        ["Největší titul",view.top1Pct,"Podíl největší jednotlivé expozice"],
        ["5 největších",view.top5Pct,"Součet pěti největších expozic"],
        ["10 největších",view.top10Pct,"Součet deseti největších expozic"],
        ["Rozpoznané v režimu",view.includedPct,view.countedSecurities.toLocaleString("cs-CZ")+" titulů"],
      ].map(([label,value,description])=><div key={String(label)}
        className="min-w-0 rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">{label}</p>
        <p className="mt-1.5 text-xl font-semibold tabular-nums">{pct(Number(value))}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">{description}</p>
      </div>)}
    </div>
    <div className="mt-4">
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <strong>Rozložení analyzované hodnoty</strong>
        <span className="tabular-nums text-[var(--muted)]">{money(summary.denominatorCzk)}</span>
      </div>
      <div role="img" className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-white/[.07]"
        aria-label={"Identifikované bez proxy "+pct(summary.denominatorCzk?100*known/summary.denominatorCzk:0)+
        ", modelová proxy "+pct(summary.denominatorCzk?100*proxy/summary.denominatorCzk:0)+
        ", nerozloženo "+pct(summary.denominatorCzk?100*missing/summary.denominatorCzk:0)}>
        <div className="h-full bg-emerald-500" style={{width:width(known,summary.denominatorCzk)}}/>
        <div className="h-full bg-amber-500" style={{width:width(proxy,summary.denominatorCzk)}}/>
        <div className="h-full bg-slate-500" style={{width:width(missing,summary.denominatorCzk)}}/>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-emerald-500"/>
          Identifikované bez proxy: <strong className="tabular-nums">{money(known)}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-amber-500"/>
          Odhad LYMS: <strong className="tabular-nums">{money(proxy)}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-slate-500"/>
          Nerozloženo: <strong className="tabular-nums">{money(missing)}</strong>
        </span>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">10 největších expozic {modelEnabled?"včetně odhadu":"bez modelové proxy"}</h3>
      <span className="text-[11px] text-[var(--muted)]">
        Hodnoty podle současného X-Ray, nikoliv historické tržní riziko
      </span>
    </div>
    <div className="finance-scrollbar mt-2 overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="finance-data-table min-w-[600px] text-left">
        <thead><tr>
          <th>Podklad</th>
          <th className="text-right">Expozice</th>
          <th className="text-right">Váha portfolia</th>
          <th className="text-right">Z toho přímo</th>
          <th className="text-right">Přes ETF</th>
        </tr></thead>
        <tbody>
          {view.positions.slice(0,10).map((row,i)=>{
            const viaShownCzk=modelEnabled?row.viaFundsCzk:row.viaFundsCzk-row.proxyCzk;
            return <tr key={row.key}>
              <td className="max-w-52">
                <span className="text-[10px] tabular-nums text-[var(--muted)]">{i+1}. </span>
                <strong className="text-sm">{row.ticker}</strong>
                <span className="block text-[10px] text-[var(--muted)]">{row.name}</span>
                {row.identity==="unverified"?<span className="block text-[10px] text-[var(--warning)]">
                  Nedoložená identita · bez slučování podle tickeru
                </span>:null}
                {row.proxyCzk>0?<span className="block text-[10px] text-[var(--warning)]">
                  {modelEnabled?"⚠ Odhad LYMS zahrnut: "+money(row.proxyCzk):
                  "Odhad LYMS v tomto pořadí vynechán"}
                </span>:null}
              </td>
              <td className="text-right font-semibold tabular-nums">{money(row.valueCzk)}</td>
              <td className="min-w-32 text-right tabular-nums">
                <strong>{pct(row.weightPct)}</strong>
                <div className="ml-auto mt-1 h-1.5 max-w-24 overflow-hidden rounded-full bg-white/[.075]">
                  <div className="h-full rounded-full bg-[var(--accent)]" style={{width:width(row.valueCzk,summary.denominatorCzk)}}/>
                </div>
              </td>
              <td className="text-right tabular-nums">{money(row.directCzk)}</td>
              <td className="text-right tabular-nums">{money(Math.max(0,viaShownCzk))}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {!view.positions.length?<p className="px-3 py-5 text-xs text-[var(--muted)]">
        Pro tento režim nejsou identifikované žádné expozice.
      </p>:null}
    </div>
    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      <strong className="text-[var(--foreground)]">Jak to číst:</strong>{" "}
      Největší 1/5/10 jsou součty konkrétních podkladů vzhledem k celému analyzovanému
      portfoliu. Neznámá část ETF může obsahovat stejnou akcii, takže skutečná koncentrace
      může být vyšší. „Bez odhadů“ vylučuje pouze explicitně modelovou proxy,
      nikoliv automaticky všechny historické či slabě identifikované zdroje.
      Jde o přehled známých expozic, nikoliv predikci ztráty, volatilitu nebo úplné HHI.
    </p>
  </section>;
}
