"use client";

import {useState} from "react";
import type {XRaySectorResult} from "@/lib/xray/sector-exposure";

const money=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:0})+" Kč";
const pct=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:2})+" %";

/**
 * Partial issuer-derived GICS sector classification. The reference denominator
 * is NEVER the sector-covered subset, so unknown Vanguard/direct/crypto and
 * model proxy cannot be mistaken for real diversification.
 */
export function XRaySectorCoverage({result}:{result:XRaySectorResult}){
  const [showFunds,setShowFunds]=useState(false);
  const [showOrigin,setShowOrigin]=useState(false);
  const known=result.classifiedCzk,unclassified=result.unclassifiedCzk;
  return <section className="finance-surface p-4 sm:p-5"
    aria-label="Sektorová expozice podle doložených podkladů">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-3xl">
        <h2 className="text-base font-semibold">Sektory akcií – doložené emitenty</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Sektory vycházejí z oficiálních podkladů iShares a State Street SPYI.
          U dalších vlastněných fyzických ETF (například Vanguard) lze sektor
          bezpečně převzít jen pro stejný ověřený ISIN akcie. Chybějící podklady,
          neurčité identity a neověřené přímé akcie zůstávají neklasifikované.
        </p>
      </div>
      <span className="text-xs font-medium text-[var(--muted)]">
        {pct(result.classifiedPct)} portfolia klasifikováno
      </span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Klasifikované sektory</p>
        <strong className="mt-1 block text-lg tabular-nums">{money(known)}</strong>
      </div>
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Bez klasifikace</p>
        <strong className="mt-1 block text-lg tabular-nums">{money(unclassified)}</strong>
      </div>
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Z toho LYMS proxy</p>
        <strong className="mt-1 block text-lg tabular-nums">{money(result.modelProxyUnclassifiedCzk)}</strong>
      </div>
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Přímých ISIN se sektorem</p>
        <strong className="mt-1 block text-lg tabular-nums">{result.directMatchedIsins.toLocaleString("cs-CZ")}</strong>
      </div>
    </div>
    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
      Původ klasifikace přes ETF: <strong className="text-[var(--foreground)]">{money(result.issuerClassifiedCzk)}</strong> přímo ze sektoru emitenta
      {" · "} <strong className="text-[var(--foreground)]">{money(result.verifiedIsinClassifiedCzk)}</strong> přeneseno přes ověřený ISIN.
      Tyto dvě hodnoty tvoří pouze část „Přes ETF“, nikoli nové investice.
    </p>
    <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[.08]"
      role="img" aria-label={"Klasifikováno "+pct(result.classifiedPct)+
        ", bez klasifikace "+pct(100-result.classifiedPct)}>
      <div className="h-full bg-[var(--accent)]"
        style={{width:Math.max(0,Math.min(100,result.classifiedPct))+"%"}}/>
    </div>
    <p className="mt-1.5 text-[11px] text-[var(--muted)]">
      Váhy sektorů vždy vztažené k {money(result.denominatorCzk)} analyzovaného
      portfolia, nikoliv přepočtené na 100 % známých sektorů.
    </p>
    <div className="mt-3">
      <button type="button" className="finance-action" aria-expanded={showOrigin}
        onClick={()=>setShowOrigin(v=>!v)}>
        {showOrigin?"Skrýt":"Zobrazit"} původ sektorů podle ETF
      </button>
    </div>
    <div className="finance-scrollbar mt-2 overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className={showOrigin?"finance-data-table min-w-[800px] text-left":"finance-data-table min-w-[520px] text-left"}>
        <thead><tr>
          <th>Sektor</th>
          <th className="text-right">Přímo</th>
          <th className="text-right">Přes ETF</th>
          {showOrigin?<th className="text-right">Z údajů emitenta</th>:null}
          {showOrigin?<th className="text-right">Ověřený ISIN</th>:null}
          <th className="text-right">Celkem</th>
          <th className="text-right">% portfolia</th>
        </tr></thead>
        <tbody>
          {result.sectors.map(item=><tr key={item.sector}>
            <td className="font-medium">{item.sector}</td>
            <td className="text-right tabular-nums">{money(item.directCzk)}</td>
            <td className="text-right tabular-nums">{money(item.viaEtfCzk)}</td>
            {showOrigin?<td className="text-right tabular-nums">{money(item.viaIssuerCzk)}</td>:null}
            {showOrigin?<td className="text-right tabular-nums">{money(item.viaVerifiedIsinCzk)}</td>:null}
            <td className="text-right font-semibold tabular-nums">{money(item.totalCzk)}</td>
            <td className="text-right tabular-nums">{pct(item.portfolioPct)}</td>
          </tr>)}
          <tr>
            <td className="font-medium text-[var(--muted)]">Neznámé / neklasifikované</td>
            <td className="text-right tabular-nums">{money(result.directUnclassifiedCzk)}</td>
            <td className="text-right tabular-nums">{money(result.fundUnclassifiedCzk)}</td>
            {showOrigin?<td className="text-right tabular-nums">—</td>:null}
            {showOrigin?<td className="text-right tabular-nums">—</td>:null}
            <td className="text-right font-semibold tabular-nums">{money(unclassified)}</td>
            <td className="text-right tabular-nums">
              {pct(result.denominatorCzk?100*unclassified/result.denominatorCzk:0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div className="mt-3">
      <button type="button" className="finance-action"
        aria-expanded={showFunds} onClick={()=>setShowFunds(v=>!v)}>
        {showFunds?"Skrýt":"Zobrazit"} klasifikaci jednotlivých ETF ({result.funds.length})
      </button>
      {showFunds?<div className="mt-2 space-y-2">
        {result.funds.map(fund=><div key={fund.isin||fund.symbol}
          className="flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] p-3 text-xs">
          <div>
            <strong>{fund.symbol}</strong>
            <span className="ml-2 text-[var(--muted)]">{fund.asOf??"datum neuvedeno"}</span>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {fund.source??"Není k dispozici klasifikovaný zdroj"}
            </p>
          </div>
          <div className="text-right tabular-nums">
            <strong>{pct(fund.classifiedPct)} sektorově doloženo</strong>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {money(fund.classifiedCzk)} z {money(fund.valueCzk)}
            </p>
            {fund.classifiedCzk>0?<p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Emitent: {money(fund.issuerClassifiedCzk)} · ISIN převod: {money(fund.verifiedIsinClassifiedCzk)}
            </p>:null}
          </div>
        </div>)}
      </div>:null}
    </div>
    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      Sektor není identita společnosti: více akciových tříd stejné firmy se bez
      důvěryhodného identifikátoru emitenta neslučuje. Přímo držená akcie dostane sektor
      jen při shodném doloženém ISIN a jednoznačném zařazení z fondových dat.
      Přenos sektoru do dalšího fondu vyžaduje ověřený identický ISIN akcie;
      nezakládá nové podkladové držení. Krypto, neznámé sektory, indexové proxy a nerozložené zbytky tvoří část
      „neklasifikované“. Model LYMS je její podmnožinou, nikoli další položkou NAV.
    </p>
  </section>;
}
