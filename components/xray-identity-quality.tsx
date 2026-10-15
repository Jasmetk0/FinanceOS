"use client";

import type { XRayIdentityCoverage, XRayFundCoverage, XRayBridgeAudit } from "@/lib/xray/engine";

const money=(value:number)=>value.toLocaleString("cs-CZ",{maximumFractionDigits:0})+" Kč";
const percent=(value:number)=>value.toLocaleString("cs-CZ",{maximumFractionDigits:2})+" %";

const buckets=[
  {key:"isinCzk",label:"ISIN uvedený v datech",hint:"Konkrétní akciová třída s identifikátorem ISIN",color:"bg-emerald-500"},
  {key:"bridgedCzk",label:"SEDOL → ISIN",hint:"Akcie spárované přes SEDOL a ISIN uvnitř zdrojů ETF",color:"bg-sky-500"},
  {key:"sedolOnlyCzk",label:"Jen SEDOL",hint:"Rozlišitelný cenný papír, zatím bez vazby na ISIN",color:"bg-amber-400"},
  {key:"tickerOnlyCzk",label:"Jen ticker",hint:"Označení nemusí jednoznačně určit akciovou třídu",color:"bg-orange-400"},
  {key:"cryptoCzk",label:"Krypto podle symbolu",hint:"Zatím bez ověřené identity blockchainového aktiva",color:"bg-violet-500"},
  {key:"unmappedCzk",label:"Nerozloženo",hint:"ETF bez úplného rozkladu, hotovost a jiné podklady",color:"bg-slate-500"},
] as const;

export function XRayIdentityQuality({
  coverage,funds,bridgeAudit,
}:{
  coverage:XRayIdentityCoverage;
  funds:XRayFundCoverage[];
  bridgeAudit:XRayBridgeAudit;
}){
  const denominator=coverage.totalCzk;
  const knownByInstrument=coverage.isinCzk+coverage.bridgedCzk;
  const noReliableIdentity=coverage.sedolOnlyCzk+coverage.tickerOnlyCzk+
    coverage.cryptoCzk+coverage.unmappedCzk;
  const fraction=(v:number)=>denominator>0?100*v/denominator:0;
  const missing=funds.filter(f=>f.unmappedCzk>1e-6).sort((a,b)=>b.unmappedCzk-a.unmappedCzk).slice(0,5);
  return <section className="finance-surface p-4 sm:p-5" aria-label="Kvalita identifikace portfolia">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold">Jak přesný je automatický rozklad?</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
          Rozdělení podle doložených identifikátorů akciových tříd. Vykázaný ISIN
          znamená identifikátor uvedený ve zdrojových datech, nikoli nezávisle ověřenou cenu,
          aktuálnost nebo vlastnictví samotných akcií uvnitř ETF.
        </p>
      </div>
      <strong className="text-sm tabular-nums text-[var(--accent)]">
        {percent(fraction(knownByInstrument))} s identitou ISIN
      </strong>
    </div>
    <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/[.07]" role="img"
      aria-label={"Podíl s ISIN "+percent(fraction(knownByInstrument))+
      ", bez doloženého ISIN "+percent(fraction(noReliableIdentity))}>
      <div className="flex h-full w-full">
        {buckets.map(b=><div key={b.key}
          className={"h-full "+b.color}
          style={{width:fraction(coverage[b.key])+"%"}} />)}
      </div>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {buckets.map(b=><div key={b.key}
        className="rounded-xl border border-[var(--border)] bg-white/[.02] p-3">
        <div className="flex items-center gap-2 text-xs">
          <span aria-hidden="true" className={"h-2.5 w-2.5 shrink-0 rounded-sm "+b.color}/>
          <span className="font-semibold">{b.label}</span>
          <span className="ml-auto tabular-nums">{percent(fraction(coverage[b.key]))}</span>
        </div>
        <p className="mt-1 text-sm font-semibold tabular-nums">{money(coverage[b.key])}</p>
        <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{b.hint}</p>
      </div>)}
    </div>
    <div className="mt-4 rounded-xl border border-[var(--border)] p-3" aria-label="Skutečně spárované identifikátory ETF">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Skutečné využití SEDOL → ISIN</h3>
        <span className="text-[11px] text-[var(--muted)]">Jen řádky ETF opravdu držených v portfoliu</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div>
          <p className="text-lg font-semibold tabular-nums">{bridgeAudit.bridgedLines.toLocaleString("cs-CZ")}</p>
          <p className="text-[11px] text-[var(--muted)]">Úspěšně spárované řádky</p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums">{money(bridgeAudit.bridgedCzk)}</p>
          <p className="text-[11px] text-[var(--muted)]">Hodnota takto identifikovaných akcií</p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums">{bridgeAudit.distinctBridgedIsins.toLocaleString("cs-CZ")}</p>
          <p className="text-[11px] text-[var(--muted)]">Unikátních doložených ISIN</p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums">{bridgeAudit.matchedDirectIsins.toLocaleString("cs-CZ")}</p>
          <p className="text-[11px] text-[var(--muted)]">Shod s přímo drženými ISIN</p>
        </div>
      </div>
      {bridgeAudit.funds.length>0?<details className="mt-3 text-xs text-[var(--muted)]">
        <summary className="w-fit cursor-pointer font-semibold text-[var(--accent)]">
          Rozpis skutečně spárovaných akcií podle ETF ({bridgeAudit.funds.length})
        </summary>
        <div className="mt-2 space-y-2">
          {bridgeAudit.funds.map(f=><div key={f.fundIsin??f.fundSymbol}
            className="flex flex-wrap justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
            <div>
              <strong className="text-[var(--foreground)]">{f.fundSymbol}</strong>
              <p>{f.bridgedLines.toLocaleString("cs-CZ")} spárovaných řádků ·
                {" "}{f.unresolvedSedolLines.toLocaleString("cs-CZ")} řádků pouze se SEDOL</p>
            </div>
            <div className="text-right tabular-nums">
              <strong className="text-[var(--foreground)]">{money(f.bridgedCzk)}</strong>
              <p>{money(f.unresolvedSedolCzk)} bez vazby na ISIN</p>
            </div>
          </div>)}
        </div>
      </details>:null}
      <p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">
        Jde o skutečný průnik identifikátorů v držených ETF, nikoli počet položek
        v externím SPYI slovníku. Jedna akcie může být v několika ETF, proto jsou
        počty řádků a unikátních ISIN rozdílné. Žádné referenční SPYI bez vlastnictví
        se nezapočítává do hodnoty ani těchto počtů.
      </p>
    </div>
    {missing.length>0?<details className="mt-4 text-xs text-[var(--muted)]">
      <summary className="cursor-pointer font-semibold text-[var(--accent)]">
        Největší dosud nerozložené fondy ({funds.filter(f=>f.unmappedCzk>1e-6).length})
      </summary>
      <div className="mt-2 space-y-1.5">
        {missing.map((f,i)=><div key={f.symbol+"|"+(f.isin??"")+"|"+i}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-2">
          <span>{f.symbol} {f.isin?"· "+f.isin:"· bez ISIN"}
            <span className="ml-2 opacity-80">({percent(f.mappedPct)} akcie/krypto)</span>
          </span>
          <strong className="tabular-nums">{money(f.unmappedCzk)} nerozloženo</strong>
        </div>)}
      </div>
    </details>:null}
    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      Součet všech šesti kategorií odpovídá celkové analyzované hodnotě.
      Procenta se počítají vůči akciím + ETF + kryptu, nikoliv vůči P2P,
      hotovosti nebo jiným účtům. Složení ETF je historický snapshot emitenta, nikoliv live stream.
    </p>
  </section>;
}
