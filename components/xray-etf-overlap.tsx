"use client";

import {useState} from "react";
import type {
  XRayOverlapResult,XRayOverlapMode,XRayFundPairOverlap,
} from "@/lib/xray/etf-overlap";

const money=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:0})+" Kč";
const pct=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:2})+" %";

function PairDetail({pair}:{pair:XRayFundPairOverlap}){
  return <details className="mt-2 rounded-lg border border-[var(--border)] p-2.5">
    <summary className="cursor-pointer text-[11px] font-medium text-[var(--accent)]">
      Společné doložené akcie ({pair.sharedIdentities}) · rozbalit přesné příspěvky
    </summary>
    <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
      {pair.left.symbol}: {pct(pair.left.knownIdentityPct)} hodnoty má použitelný ISIN/SEDOL
      {" · "}{pair.right.symbol}: {pct(pair.right.knownIdentityPct)}.
      Ostatní pozice nelze bezpečně použít pro hledání průniku.
    </p>
    <p className="mt-1 text-[11px] text-[var(--muted)]">
      Datum {pair.left.symbol}: {pair.left.asOf??"neznámé"}{" · "}
      {pair.right.symbol}: {pair.right.asOf??"neznámé"}.
    </p>
    <div className="finance-scrollbar mt-2 overflow-x-auto">
      <table className="finance-data-table min-w-[500px] text-left">
        <thead><tr>
          <th>Stejný podklad</th>
          <th className="text-right">{pair.left.symbol}</th>
          <th className="text-right">{pair.right.symbol}</th>
          <th className="text-right">V obou celkem</th>
        </tr></thead>
        <tbody>{pair.sharedStocks.slice(0,30).map(stock=><tr key={stock.key}>
          <td>
            <strong>{stock.ticker}</strong>
            <span className="block text-[10px] text-[var(--muted)]">{stock.name}</span>
            <span className="block text-[10px] text-[var(--muted)]">
              {stock.identity==="isin"?"Doložený ISIN":"Doložený SEDOL"}
              {" · "}{stock.key.replace(/^stock\|(?:isin|sedol):/,"")}
            </span>
          </td>
          <td className="text-right tabular-nums">{money(stock.leftCzk)}
            <span className="block text-[10px] text-[var(--muted)]">{pct(stock.leftFundPct)} NAV</span>
          </td>
          <td className="text-right tabular-nums">{money(stock.rightCzk)}
            <span className="block text-[10px] text-[var(--muted)]">{pct(stock.rightFundPct)} NAV</span>
          </td>
          <td className="text-right font-medium tabular-nums">{money(stock.combinedExposureCzk)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pair.sharedStocks.length>30?<p className="mt-2 text-[11px] text-[var(--muted)]">
      Zobrazeno 30 největších z {pair.sharedStocks.length.toLocaleString("cs-CZ")}
      společných identifikovaných titulů.
    </p>:null}
    <p className="mt-2 text-[11px] text-[var(--muted)]">
      Součet v Kč znamená ekonomickou expozici k týmž akciím ve dvou fondech,
      nikoli duplicitní položku v účetnictví nebo peníze k odečtení.
    </p>
  </details>;
}

export function XRayEtfOverlap({result}:{result:XRayOverlapResult}){
  const [mode,setMode]=useState<XRayOverlapMode>("without-proxy");
  const [includeZeros,setIncludeZeros]=useState(false);
  const [visible,setVisible]=useState(10);
  const view=mode==="without-proxy"?result.withoutProxy:result.includingProxy;
  const pairs=includeZeros?view.pairs:view.pairs.filter(pair=>pair.sharedIdentities>0);
  const selected=pairs.slice(0,visible);
  return <section className="finance-surface p-4 sm:p-5"
    aria-label="Ověřené překryvy mezi drženými ETF">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">Překryvy mezi jednotlivými ETF</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
          Jaké stejné akcie jsou podložené ISIN nebo SEDOL ve dvou fondech.
          Shodný ticker ani název firmy nestačí. Rozložení používá reálnou hodnotu
          tvých ETF, nikoli jejich počet kusů.
        </p>
      </div>
      <div className="flex shrink-0 gap-1 rounded-lg border border-[var(--border)] p-1"
        role="group" aria-label="Model LYMS při srovnání ETF">
        <button type="button" aria-pressed={mode==="without-proxy"}
          className={"rounded-md px-2.5 py-1.5 text-xs "+(mode==="without-proxy"?
            "bg-[var(--accent)] text-black":"text-[var(--muted)]")}
          onClick={()=>{setMode("without-proxy");setVisible(10);}}>
          Bez odhadu
        </button>
        <button type="button" aria-pressed={mode==="including-proxy"}
          className={"rounded-md px-2.5 py-1.5 text-xs "+(mode==="including-proxy"?
            "bg-[var(--accent)] text-black":"text-[var(--muted)]")}
          onClick={()=>{setMode("including-proxy");setVisible(10);}}>
          Včetně LYMS proxy
        </button>
      </div>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Fondy s doloženým ISIN</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{view.funds.length.toLocaleString("cs-CZ")}</p>
      </div>
      <div className="rounded-xl border border-[var(--border)] p-3">
        <p className="text-[11px] text-[var(--muted)]">Dvojice s prokázaným průnikem</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{view.pairsWithConfirmedOverlap.toLocaleString("cs-CZ")}</p>
      </div>
      <div className="col-span-2 rounded-xl border border-[var(--border)] p-3 sm:col-span-1">
        <p className="text-[11px] text-[var(--muted)]">Všechny možné dvojice</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{view.pairs.length.toLocaleString("cs-CZ")}</p>
      </div>
    </div>
    {result.excludedUnknownIsinFunds>0?<p className="mt-2 text-xs text-[var(--warning)]">
      {result.excludedUnknownIsinFunds} ETF bez ověřeného ISIN fondu nelze do dvojic bezpečně přiřadit.
    </p>:null}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-[var(--muted)]">
        Průnik vah = součet menších podílů každé společné akcie ve dvou ETF.
        Nejde o korelaci cen.
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={includeZeros}
          onChange={e=>{setIncludeZeros(e.target.checked);setVisible(10);}}/>
        Ukázat i dvojice bez prokázaného překryvu
      </label>
    </div>
    <div className="mt-2 space-y-2">
      {selected.map(pair=><div key={pair.left.isin+"|"+pair.right.isin}
        className="rounded-xl border border-[var(--border)] p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <p className="text-sm font-semibold">{pair.left.symbol} ↔ {pair.right.symbol}</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {pair.left.isin} · {pair.right.isin}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {pair.sharedIdentities.toLocaleString("cs-CZ")} doložených společných podkladů
              {" · "}{pair.sharedIsins} podle ISIN, {pair.sharedSedols} podle SEDOL
            </p>
          </div>
          <div className="tabular-nums sm:text-right">
            <p className="text-lg font-semibold">{pct(pair.commonWeightPct)} průnik vah</p>
            <p className="text-[11px] text-[var(--muted)]">{money(pair.combinedSharedCzk)} expozice v obou ETF</p>
          </div>
        </div>
        {pair.sharedIdentities>0?<PairDetail pair={pair}/>:
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Není prokázaný společný identifikátor; to neznamená, že fondy žádné stejné akcie nemají.
          </p>}
      </div>)}
      {!pairs.length?<p className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
        Z dostupných fondových podkladů nelze prokázat společné akcie.
        Může chybět úplný seznam, ISIN nebo SEDOL; nulový průnik zde není důkaz diverzifikace.
      </p>:null}
    </div>
    {visible<pairs.length?<button type="button" className="finance-action mt-3"
      onClick={()=>setVisible(n=>n+10)}>
      Zobrazit dalších 10 dvojic
    </button>:null}
    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      Důležité: „Průnik vah“ měří pouze totožné **identifikované** akcie v dostupných
      portfoliích fondů, neměří podíl dvou ETF na tvém celkovém portfoliu.
      Nerozložené podklady, řádky bez důvěryhodného identifikátoru a případně zastaralá
      data mohou skutečný překryv podhodnocovat. Model LYMS je jen aproximace
      ekonomické expozice, ne skutečně držené akcie fondu.
    </p>
  </section>;
}
