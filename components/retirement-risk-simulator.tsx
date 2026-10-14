"use client";

import { useMemo, useState } from "react";
import {
  RETIREMENT_RISK_DEFAULTS, runRetirementMonteCarlo, stressRetirement,
  type RetirementRiskInputs, type RetirementRiskResult,
} from "@/lib/simulator/risk";

const fmt = (n: number) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
const pct = (n: number) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " %";
const short = (n: number) => Math.abs(n) >= 1e6
  ? (n / 1e6).toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " mil."
  : (n / 1000).toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " tis.";

type Config = { key: keyof RetirementRiskInputs; label: string; unit: string; step: number; min: number; max?: number };
const configs: Config[] = [
  { key:"currentAge",label:"Současný věk",unit:"let",step:1,min:0,max:100 },
  { key:"years",label:"Celkový horizont",unit:"let",step:1,min:1,max:100 },
  { key:"retirementAfterYears",label:"Začátek čerpání za",unit:"let",step:1,min:0,max:99 },
  { key:"initialCzk",label:"Počáteční kapitál",unit:"Kč",step:10000,min:0 },
  { key:"monthlyContributionCzk",label:"Vklad před důchodem",unit:"Kč/měs.",step:500,min:0 },
  { key:"annualContributionIncreasePct",label:"Roční navyšování vkladů",unit:"%",step:.1,min:-99.9,max:100 },
  { key:"expectedAnnualReturnPct",label:"Očekávaný roční výnos",unit:"%",step:.5,min:-99.9,max:100 },
  { key:"annualVolatilityPct",label:"Roční volatilita",unit:"%",step:1,min:0,max:150 },
  { key:"annualInflationPct",label:"Průměrná roční inflace",unit:"%",step:.1,min:-99.9,max:100 },
  { key:"retirementIncomeMonthlyRealCzk",label:"Měsíční čerpání v dnešních Kč",unit:"Kč",step:1000,min:0 },
  { key:"goalWithdrawalRatePct",label:"Výběrová míra pro FIRE cíl",unit:"%",step:.1,min:.1,max:100 },
  { key:"trials",label:"Počet náhodných průběhů",unit:"běhů",step:100,min:100,max:10000 },
  { key:"seed",label:"Seed (opakovatelný výpočet)",unit:"",step:1,min:0,max:4294967295 },
];

function RiskChart({
  data, stress,
}: {
  data: RetirementRiskResult;
  stress: ReturnType<typeof stressRetirement> | null;
}) {
  const w=980,h=330,left=83,right=23,top=22,bottom=42;
  const years=Math.max(1,data.points.length-1);
  const maximum=Math.max(1,...data.points.map(p=>p.p90RealCzk),...(stress?.points.map(p=>p.realCzk)??[]))*1.08;
  const x=(year:number)=>left+year/years*(w-left-right);
  const y=(n:number)=>top+(1-n/maximum)*(h-top-bottom);
  const path=(get:(i:number)=>number, length:number)=>Array.from({length},(_,i)=>(i?"L":"M")+x(i).toFixed(2)+" "+y(get(i)).toFixed(2)).join(" ");
  const median=path(i=>data.points[i].medianRealCzk,data.points.length);
  const p10=path(i=>data.points[i].p10RealCzk,data.points.length);
  const p90=path(i=>data.points[i].p90RealCzk,data.points.length);
  const stressLine=stress?path(i=>stress.points[i].realCzk,stress.points.length):null;
  return <div className="finance-chart-canvas overflow-hidden p-2 sm:p-3">
    <svg viewBox={"0 0 "+w+" "+h} className="block w-full" role="img"
      aria-label="Monte Carlo pásmo 10. až 90. percentilu, medián portfolia a scénář propadu trhu">
      {[0,.25,.5,.75,1].map(v=><g key={v}>
        <line x1={left} x2={w-right} y1={y(maximum*v)} y2={y(maximum*v)} stroke="rgba(180,211,245,.15)" strokeDasharray="3 5"/>
        <text x={left-9} y={y(maximum*v)+4} fill="#a5b7ca" textAnchor="end" fontSize="12">{short(maximum*v)}</text>
      </g>)}
      {[0,.25,.5,.75,1].map(v=><text key={v} x={x(years*v)} y={h-12} fontSize="12" fill="#a5b7ca" textAnchor="middle">{Math.round(years*v)} let</text>)}
      <path d={p90+" "+Array.from({length:data.points.length},(_,k)=>{
        const i=data.points.length-1-k;
        return "L"+x(i).toFixed(2)+" "+y(data.points[i].p10RealCzk).toFixed(2);
      }).join(" ")+" Z"} fill="rgba(123,230,188,.12)" />
      <path d={p10} stroke="rgba(123,230,188,.55)" strokeWidth="1.5" fill="none" strokeDasharray="4 5"/>
      <path d={p90} stroke="rgba(123,230,188,.55)" strokeWidth="1.5" fill="none" strokeDasharray="4 5"/>
      <path d={median} stroke="#7be6bc" strokeWidth="3" fill="none" strokeLinejoin="round"/>
      {stressLine?<path d={stressLine} stroke="#f4c47c" strokeWidth="2.5" strokeDasharray="7 5" fill="none"/>:null}
    </svg>
    <div className="flex flex-wrap gap-4 px-2 py-1 text-[11px] text-[var(--muted)]">
      <span><span className="mr-1 text-[var(--accent)]">━━</span> Medián</span>
      <span><span className="mr-1 text-[var(--accent)]">┄┄</span> P10–P90 (bodové percentily)</span>
      {stressLine?<span><span className="mr-1 text-[var(--warning)]">┄┄</span> Stresový scénář</span>:null}
    </div>
  </div>;
}

export function RetirementRiskSimulator() {
  const [inputs,setInputs]=useState<RetirementRiskInputs>({...RETIREMENT_RISK_DEFAULTS});
  const [result,setResult]=useState<RetirementRiskResult|null>(null);
  const [usedInputs,setUsedInputs]=useState<RetirementRiskInputs|null>(null);
  const [shockYear,setShockYear]=useState(25);
  const [shockPct,setShockPct]=useState(-50);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [realTimeResult,setRealTimeResult]=useState(false);

  const stress=useMemo(()=>{
    if(!result||!usedInputs)return null;
    try {return stressRetirement(usedInputs,shockYear,shockPct);}catch{return null;}
  },[usedInputs,result,shockYear,shockPct]);

  const retirementAge=inputs.currentAge+inputs.retirementAfterYears;
  const changed=usedInputs!==null && configs.some(f=>usedInputs[f.key]!==inputs[f.key]);

  function update(key:keyof RetirementRiskInputs,text:string) {
    setInputs(old=>({...old,[key]:Number(text)}));
    setRealTimeResult(false);
    setError("");
  }

  function run() {
    if(busy)return;
    setBusy(true);
    setError("");
    // Yield one paint so the user sees that the CPU-intensive run has started.
    requestAnimationFrame(()=>{
      try {
        const next=runRetirementMonteCarlo(inputs);
        setResult(next);
        setUsedInputs({...inputs});
        setRealTimeResult(true);
      } catch(e) {
        setError(e instanceof Error?e.message:String(e));
        setRealTimeResult(false);
      } finally {setBusy(false);}
    });
  }
  return <div className="space-y-4">
    <section className="finance-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Životní plán a statistické předpoklady</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Před důchodem pravidelně investuješ, po jeho začátku automaticky přestaneš přispívat a budeš vybírat měsíční částku
            v dnešní kupní síle. Výběry se každý měsíc zvyšují o inflaci.
          </p>
        </div>
        <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/[.08] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]">
          Čerpání od {retirementAge} let
        </span>
      </div>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {configs.map(c=><label key={c.key} className="rounded-xl border border-[var(--border)] bg-white/[.025] p-3">
          <span className="block min-h-8 text-[11px] font-semibold leading-4 text-[var(--muted)]">{c.label}</span>
          <div className="mt-2 flex items-center gap-1.5">
            <input type="number" min={c.min} max={c.max} step={c.step} value={inputs[c.key]}
              onChange={e=>update(c.key,e.target.value)}
              className="finance-field !min-h-9 min-w-0 w-full !p-2 text-right text-sm font-semibold tabular-nums" />
            {c.unit?<span className="whitespace-nowrap text-[10px] text-[var(--muted)]">{c.unit}</span>:null}
          </div>
        </label>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] leading-5 text-[var(--muted)]">
          Zvolený seed zajišťuje opakovatelnost. Roční volatilita je aproximována volatilitou logaritmických výnosů.
        </p>
        <button type="button" className="finance-action finance-action-primary" disabled={busy} onClick={run}>
          {busy?"Počítám…":"Spustit Monte Carlo"}
        </button>
      </div>
      {error?<p role="alert" className="mt-3 rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/[.07] p-3 text-xs text-[var(--warning)]">{error}</p>:null}
    </section>

    {result&&usedInputs?<>
      {changed&&!realTimeResult?<p role="status" className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/[.07] p-3 text-xs text-[var(--warning)]">
        Vstupy se změnily. Výsledky níže pocházejí z předchozího běhu. Klikni znovu na Spustit Monte Carlo.
      </p>:null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Dosažení FIRE kapitálu",pct(result.retirementGoalHitPct),"V okamžiku začátku důchodu"],
          ["Uhrazení všech výběrů",pct(result.incomeFundedPct),"Po celé období čerpání"],
          ["Medián na konci",fmt(result.medianFinalRealCzk),"V dnešní kupní síle"],
          ["Vyčerpané scénáře",result.exhaustedPaths.toLocaleString("cs-CZ"),"Ze "+result.trials+" simulací"],
        ].map(([title,value,hint])=><div key={title} className="finance-surface p-4">
          <p className="text-[11px] text-[var(--muted)]">{title}</p>
          <p className="mt-2 break-words text-xl font-semibold text-[var(--accent)] tabular-nums">{value}</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p>
        </div>)}
      </section>
      <section className="finance-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold">Rozptyl budoucích hodnot</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">P10, medián a P90 po jednotlivých letech; statistická modelová pásma, ne jeden možný reálný průběh.</p></div>
          <span className="text-xs text-[var(--muted)]">Počet běhů: {result.trials.toLocaleString("cs-CZ")}</span>
        </div>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-white/[.02] p-3">
            <p className="text-[11px] text-[var(--muted)]">P10 na konci</p><p className="mt-1 font-semibold">{fmt(result.p10FinalRealCzk)}</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-white/[.02] p-3">
            <p className="text-[11px] text-[var(--muted)]">Potřebný FIRE kapitál dnes</p><p className="mt-1 font-semibold">{fmt(result.retirementGoalRealCzk)}</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-white/[.02] p-3">
            <p className="text-[11px] text-[var(--muted)]">P90 na konci</p><p className="mt-1 font-semibold">{fmt(result.p90FinalRealCzk)}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-semibold">Stresový scénář pro srovnání</h3>
          <div className="flex flex-wrap gap-2">
            <label className="text-[11px] text-[var(--muted)]">Propad v roce
              <input className="finance-field ml-2 !min-h-9 !w-[76px] !p-2" type="number" min="1" max={usedInputs.years} step="1" value={shockYear} onChange={e=>setShockYear(Number(e.target.value))} />
            </label>
            <label className="text-[11px] text-[var(--muted)]">Jednorázový propad
              <input className="finance-field ml-2 !min-h-9 !w-[88px] !p-2" type="number" min="-100" max="0" step="5" value={shockPct} onChange={e=>setShockPct(Number(e.target.value))} /> %
            </label>
          </div>
        </div>
        <div className="mt-3"><RiskChart data={result} stress={stress}/></div>
        {stress?<p className="mt-2 text-xs text-[var(--muted)]">
          Stresový scénář: konstantní očekávané zhodnocení plus jednorázový propad {pct(shockPct)} v roce {shockYear}.
          Neuhrazené nominální výběry: <strong className="text-[var(--warning)]">{fmt(stress.shortfallCzk)}</strong>.
        </p>:<p className="mt-2 text-xs text-[var(--warning)]">Zvol platný rok a rozsah propadu pro vykreslení stresového scénáře.</p>}
      </section>
      <p className="rounded-xl border border-[var(--border)] bg-white/[.02] p-4 text-xs leading-5 text-[var(--muted)]">
        <strong className="text-[var(--foreground)]">Co výsledky znamenají:</strong> Simulace používá nezávislé měsíční lognormální výnosy.
        Zadávaný očekávaný výnos není automaticky dlouhodobý CAGR; kvůli volatilitě bývá medián nižší.
        Úspěšné čerpání znamená, že žádný požadovaný měsíční výběr nemusel být krácen; 3% FIRE číslo je samostatný počáteční test kapitálu, ne garance důchodu.
        Inflace je konstantní předpoklad, výběry se každoročně i v průběhu roku indexují. Model neobsahuje daně, poplatky, korelace mezi aktivy ani historické krize.
        Počet úspěšných průběhů vyjadřuje pouze pravděpodobnost uvnitř zvoleného modelu a parametrů, ne skutečnou pravděpodobnost budoucnosti.
      </p>
    </>:null}
  </div>;
}
