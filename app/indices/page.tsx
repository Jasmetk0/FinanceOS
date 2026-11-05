import Link from "next/link";
import { Suspense } from "react";
import { Pill } from "@/components/ui";
import { MarketIndexExplorer } from "@/components/market-index-explorer";
import { getMarketIndexRows } from "@/lib/server/market-index-history";
import { normalizeMarketSelection } from "@/lib/shared/market-index-benchmarks.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function MarketIndexLoader({ ids, asOfDate }: { ids: string[]; asOfDate: string }) {
  const rows = await getMarketIndexRows(ids);
  return <MarketIndexExplorer rows={rows} selectedIds={ids} asOfDate={asOfDate} />;
}

export default async function IndicesPage({
  searchParams,
}: {
  searchParams: Promise<{ids?: string | string[]}>;
}) {
  const params = await searchParams;
  const ids = normalizeMarketSelection(params.ids) as string[];
  const asOfDate = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Trhy · skutečné indexy · denní data</Pill>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Světové indexy</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            Sleduj S&P 500, Nasdaq-100, FTSE All-World a další světové indexy.
            Porovnávej jejich reálnou historii na stejných obchodních dnech,
            ne ceny náhodně podobných ETF.
          </p>
        </div>
        <Link href="/investments" prefetch={false} className="finance-action">← Moje investice</Link>
      </div>
      <div className="mt-5">
        <Suspense fallback={
          <section className="finance-surface p-6" aria-live="polite">
            <p className="text-sm font-semibold">Načítám ověřitelnou historii indexů…</p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Externí cenová data mohou být opožděná nebo nedostupná.
              Historická srovnání nevymýšlíme.
            </p>
          </section>
        }>
          <MarketIndexLoader ids={ids} asOfDate={asOfDate} />
        </Suspense>
      </div>
    </main>
  );
}
