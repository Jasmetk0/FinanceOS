import Link from "next/link";
import { Pill, SectionCard } from "@/components/ui";
import { AnnualReportsExplorer } from "@/components/annual-reports-explorer";
import { getAnnualReports } from "@/lib/server/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const data = getAnnualReports();
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Pill>{data.years.length} {data.years.length === 1 ? "rok" : data.years.length > 1 && data.years.length < 5 ? "roky" : "let"} historie</Pill>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Reporty</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            Porovnávej roky a platformy v přehledných souhrnech. Report je podklad z uložených transakcí, nikoliv automaticky hotové daňové přiznání.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/transactions" prefetch={false} className="finance-action">Historie transakcí ↗</Link>
          <a href="/api/export/annual-report" className="finance-action finance-action-primary">Export kompletního reportu (.csv) ↓</a>
        </div>
      </div>

      <div className="mt-5">
        <SectionCard title="Roční finanční přehled" subtitle="Interaktivní filtry roku a platformy, kompaktní tabulky a mobilní karty">
          <AnnualReportsExplorer data={data} />
        </SectionCard>
      </div>

      <div className="mt-4 rounded-2xl border border-[var(--warning)]/20 bg-[var(--warning)]/[.04] px-4 py-4">
        <p className="text-[13px] font-semibold text-[var(--warning)]">Důležité pro daňovou interpretaci</p>
        <p className="mt-2 max-w-5xl text-[12px] leading-6 text-[var(--muted)]">
          FinanceOS pouze sčítá doložené transakce a zobrazuje známé CZK převody. Neurčuje českou daňovou povinnost,
          časový ani hodnotový test a nerozhoduje, jaké náklady lze uplatnit.
          Celkové příjmy z prodejů nejsou stejné jako realizovaný zisk.
          Pokud chybí CZK převody, souhrn je neúplný.
        </p>
      </div>
    </main>
  );
}
