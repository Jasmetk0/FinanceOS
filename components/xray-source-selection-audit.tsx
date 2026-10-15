"use client";

import type { XRayFundCoverage } from "@/lib/xray/engine";
import type {
  XRaySourceDecision,XRaySourceReason,XRaySourceSnapshot,
} from "@/lib/xray/auto-merge";

const formatPct=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:3})+" %";
const money=(n:number)=>n.toLocaleString("cs-CZ",{maximumFractionDigits:0})+" Kč";
const cause:Record<XRaySourceReason,string>={
  "manual-only":"K dispozici je pouze ruční import; jeho úplnost není zaručena.",
  "automatic-only":"K dispozici je pouze automatický zdroj.",
  "identity-reference":"Jde pouze o identifikační referenci; nevytváří vlastnictví ETF.",
  "manual-compatible":"Automatický zdroj neprošel kontrolou použitelnosti.",
  "automatic-compatible":"Ruční zdroj neprošel kontrolou použitelnosti.",
  "manual-more-complete":"Ruční soubor zachovává podstatně více ověřitelných vah nebo řádků.",
  "automatic-more-complete":"Automatický rozklad je podstatně úplnější než ruční seznam.",
  "manual-newer":"Oba soubory mají srovnatelné pokrytí; ruční je novější.",
  "automatic-newer":"Oba soubory mají srovnatelné pokrytí; automatický je novější.",
  "automatic-tie":"Data jsou stejně aktuální; při shodě má přednost automatický zdroj.",
  "manual-exact-index-tie":"Při shodném datu má úplný referenční index přednost před proxy modelem.",
  "ineligible-fallback":"Ani jeden kandidát neprošel kontrolou použitelnosti; ponechána pouze záloha pro bezpečné posouzení výpočetním enginem.",
};
const basisLabel:Record<string,string>={
  "fund-holdings":"Vlastní podklady fondu",
  "reference-index":"Přesný referenční index",
  "reference-index-proxy":"ODHAD ekonomické expozice",
  "substitute-basket":"Náhradní koš swapu (NE index)",
};
function sourceLine(label:string,data:XRaySourceSnapshot|null,selected:boolean) {
  if(!data)return null;
  return <div className={"rounded-lg border p-2.5 "+(selected?
    "border-[var(--accent)]/45":"border-[var(--border)]")} >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-[var(--foreground)]">{label}</strong>
      <span className="text-[11px]">{selected?"Použito pro výběr":"Nevybráno"}</span>
    </div>
    <p className="mt-1 break-words">Zdroj: {data.source??"Neuveden"}</p>
    <p className="mt-1">
      K {data.asOf??"neznámému datu"} · {data.rows.toLocaleString("cs-CZ")} řádků
      {" · "}Součet vah {formatPct(data.totalPct)}
      {" · "}Podklady akcií/krypta {formatPct(data.identifiedPct)}
    </p>
    <p className="mt-1">{basisLabel[data.exposureBasis??"fund-holdings"]??"Smíšený typ podkladů"}
      {" · "}{data.eligible?"Prošel kontrolou použitelnosti":"Neprošel kontrolou použitelnosti"}
    </p>
  </div>;
}
const fundKey=(fund:XRayFundCoverage)=>fund.isin?
  "isin:"+fund.isin.trim().toUpperCase():"symbol:"+fund.symbol.trim().toUpperCase();

/** Read-only explanation of the very same selection used by the X-Ray engine. */
export function XRaySourceSelectionAudit({
  funds,decisions,error,
}:{
  funds:XRayFundCoverage[];
  decisions:XRaySourceDecision[];
  error?:string;
}) {
  const audit=new Map(decisions.map(d=>[d.fundKey,d]));
  const valued=[...funds].filter(f=>f.valueCzk>0).sort((a,b)=>b.valueCzk-a.valueCzk);
  if(!valued.length)return null;
  const automatic=valued.filter(f=>audit.get(fundKey(f))?.selected==="automatic").length;
  const manual=valued.filter(f=>audit.get(fundKey(f))?.selected==="manual").length;
  const missing=valued.length-automatic-manual;
  return <section className="finance-surface p-4 sm:p-5" aria-label="Proč FinanceOS vybral podklady ETF">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold">Audit zdrojů rozkladu ETF</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Který podklad byl pro každý držený fond vybrán, proč vyhrál a kolik hodnoty
          fondu se skutečně podařilo rozložit. Datum podkladů není čas živé burzovní ceny.
        </p>
      </div>
      <span className="text-xs text-[var(--muted)]">{automatic} automatických
        {" · "}{manual} ručních
        {" · "}{missing} bez podkladů</span>
    </div>
    {error?<p role="alert" className="mt-2 text-xs text-[var(--warning)]">
      Nelze ověřit rozhodnutí o zdroji: {error}. Zobrazený rozklad používá záložní stav.
    </p>:null}
    <div className="mt-3 space-y-2">
      {valued.map(f=>{
        const d=audit.get(fundKey(f));
        const snapshot=d?.selected==="manual"?d.manual:d?.automatic;
        const uncertain=!snapshot?.eligible;
        return <details key={fundKey(f)}
          className="rounded-xl border border-[var(--border)] p-3 text-xs">
          <summary className="cursor-pointer">
            <div className="inline-flex w-[calc(100%-1rem)] flex-wrap items-center justify-between gap-x-3 gap-y-1 align-middle">
              <span className="font-semibold">{f.symbol} · {f.isin??"bez ISIN"}</span>
              <span className="tabular-nums">{money(f.valueCzk)} · rozloženo {formatPct(f.mappedPct)}</span>
              <span className={"w-full text-[11px] "+(uncertain?"text-[var(--warning)]":"text-[var(--muted)]")}>
                {d?d.selected==="automatic"?"Automatický zdroj":"Ruční podklady":"Zdroj není dostupný"}
                {" · "}{snapshot?.asOf??"datum neuvedeno"}
                {uncertain?" · použitelnost zdroje neověřena":""}
                {snapshot?.exposureBasis==="reference-index-proxy"?" · ODHAD":""}
              </span>
            </div>
          </summary>
          <div className="mt-3 space-y-2 text-[var(--muted)]">
            {d?<p className="font-medium text-[var(--foreground)]">Důvod: {cause[d.reason]}</p>:
              <p>Pro tento fond nebyl nalezen použitelný import ani automatický zdroj.</p>}
            {d&&f.source===null?<p className="text-[var(--warning)]">
              Vybraný soubor nebyl výpočetním enginem přijat jako rozložitelná expozice.
              Jeho řádky se nepřičítají k akciím.
            </p>:null}
            <p>Skutečně rozloženo {money(f.mappedCzk)} · nerozloženo {money(f.unmappedCzk)}.</p>
            {d?<div className="grid gap-2 md:grid-cols-2">
              {sourceLine("Ruční CSV / import",d.manual,d.selected==="manual")}
              {sourceLine("Automatický / zálohovaný zdroj",d.automatic,d.selected==="automatic")}
            </div>:null}
            {f.note?<p>Upozornění: {f.note}</p>:null}
          </div>
        </details>;
      })}
    </div>
    <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
      Při několika účtech se stejný ISIN ETF zobrazuje jednou a jeho hodnota se správně
      sčítá. Ruční zálohy se nemažou; rozklady z archivu třetí strany nejsou přímými
      daty emitenta. Stáří dat a případné výpadky sleduj také v panelu automatického rozkladu.
      Výběr kandidáta nezaručuje autenticitu souboru ani jeho aktuálnost.
    </p>
  </section>;
}
