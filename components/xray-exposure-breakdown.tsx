"use client";

import type { XRayExposure } from "@/lib/xray/engine";

const money=(value:number)=>value.toLocaleString("cs-CZ",{maximumFractionDigits:2})+" Kč";
const pct=(value:number)=>value.toLocaleString("cs-CZ",{maximumFractionDigits:2})+" %";
const quantity=(value:number)=>value.toLocaleString("cs-CZ",{maximumFractionDigits:8});

export function XRayExposureBreakdown({exposure}:{exposure:XRayExposure}){
  const total=exposure.totalCzk;
  const directPercent=total>0?100*exposure.directCzk/total:0;
  const viaPercent=total>0?100*exposure.viaFundsCzk/total:0;

  return <div className="rounded-lg border border-[var(--border)] bg-white/[.025] p-3 text-xs"
    aria-label={"Podrobný rozpis expozice "+exposure.ticker}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <strong className="text-sm">Z čeho se skládá {exposure.ticker}?</strong>
        <p className="mt-1 text-[var(--muted)]">
          Ekonomická expozice · {money(total)} celkem
        </p>
      </div>
      <span className="text-[var(--muted)]">Podíl z analyzovaného portfolia: {pct(exposure.weightPct)}</span>
    </div>
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[.07]"
      role="img" aria-label={"Přímo "+pct(directPercent)+", přes ETF "+pct(viaPercent)}>
      <div className="flex h-full w-full">
        <div className="h-full bg-emerald-500" style={{width:directPercent+"%"}}/>
        <div className="h-full bg-sky-500" style={{width:viaPercent+"%"}}/>
      </div>
    </div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-emerald-500"/>
            Přímo vlastněné
          </strong>
          <strong>{money(exposure.directCzk)} · {pct(directPercent)}</strong>
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          {exposure.directQuantity>0?quantity(exposure.directQuantity)+" přímo držených kusů":
            "Žádné přímo držené kusy"}
        </p>
        {exposure.directContributions.length?
          <ul className="mt-2 space-y-1.5">
            {exposure.directContributions.map(item=>
              <li key={item.account} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 break-words text-[var(--muted)]">{item.account}</span>
                <span className="shrink-0 font-semibold tabular-nums">{money(item.valueCzk)}
                  <span className="ml-1 font-normal text-[var(--muted)]">({quantity(item.quantity)} ks)</span>
                </span>
              </li>)}
          </ul>:
          <p className="mt-2 text-[var(--muted)]">Tuto akcii nevlastníš přímo.</p>}
      </div>
      <div className="min-w-0 rounded-lg border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-sky-500"/>
            Přes ETF
          </strong>
          <strong>{money(exposure.viaFundsCzk)} · {pct(viaPercent)}</strong>
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Nepřímá ekonomická expozice, nikoliv přímo vlastněné akcie
        </p>
        {exposure.fundContributions.length?
          <ul className="mt-2 space-y-1.5">
            {exposure.fundContributions.map((item,i)=>
              <li key={(item.fundIsin??item.fundSymbol)+"|"+i}
                className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <span className="min-w-0">
                  <span className="font-medium">{item.fundSymbol}</span>
                  {item.fundIsin?<span className="block break-all text-[10px] text-[var(--muted)]">{item.fundIsin}</span>:null}
                  {item.exposureBasis==="reference-index"?<span className="block text-[10px] text-[var(--warning)]">Ekonomická expozice přes referenční index · nikoliv akcie fyzicky držené ETF</span>:null}
                  {item.exposureBasis==="reference-index-proxy"?<span className="block text-[10px] font-semibold text-[var(--warning)]">⚠ ODHAD podle iShares CNDX, ne přesné váhy Nasdaq XNDXNNR ani fyzické držby LYMS</span>:null}
                </span>
                <span className="shrink-0 text-right font-semibold tabular-nums">
                  {money(item.valueCzk)}
                  <span className="block text-[10px] font-normal text-[var(--muted)]">
                    {pct(total>0?100*item.valueCzk/total:0)} z této expozice
                  </span>
                </span>
              </li>)}
          </ul>:
          <p className="mt-2 text-[var(--muted)]">Žádná doložená expozice přes ETF.</p>}
      </div>
    </div>
    {exposure.kind==="stock"?<p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      {exposure.key.startsWith("stock|isin:")?
        "Identita: ISIN "+exposure.key.slice("stock|isin:".length)+".":
        exposure.key.startsWith("stock|sedol:")?
        "Identita: SEDOL "+exposure.key.slice("stock|sedol:".length)+"; ISIN není potvrzený.":
        "Identita není doložena ISIN. Shodné tickery se proto neslučují bez dalšího důkazu."}
      {exposure.fundEquivalentQuantity!==null?
        " Odhad ekvivalentu přes ETF při referenční ceně přímo držené stejné akcie: "+
          quantity(exposure.fundEquivalentQuantity)+" ks (nikoliv přímo vlastněné kusy).":""}
    </p>:null}
    <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
      Každá částka je vypočtena z hodnot aktuálně uložených pozic a dostupných vah ETF.
      Data složení od emitentů mohou být starší než aktuální ocenění účtů.
    </p>
  </div>;
}
