import Link from "next/link";
import { FinancialSimulator } from "@/components/financial-simulator";
import { getPlanData } from "@/lib/server/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SimulatorPage() {
  // This is the existing investable-asset total, not full net worth.
  // No balance is imported into a scenario without an explicit user click.
  const data = getPlanData();
  const trackedPortfolioCzk = Number.isFinite(data.totalValueCzk) && data.totalValueCzk > 0
    ? data.totalValueCzk : null;

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-5">
        <span className="finance-eyebrow">FinanceOS / Plánování</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Finanční simulátor</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Nastav si finanční cíl, zvol jednu neznámou k dopočítání a sleduj vývoj
          portfolia v dnešní kupní síle i nominálních korunách.
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[.045] px-4 py-3">
        <p className="text-xs leading-5 text-[var(--muted)]">Chceš zjistit nejen cílový kapitál, ale i riziko propadů a udržitelnost důchodových výběrů?</p>
        <Link href="/simulator/risk" prefetch={false} className="finance-action finance-action-primary">Otevřít Monte Carlo a FIRE riziko →</Link>
      </div>
      <FinancialSimulator trackedPortfolioCzk={trackedPortfolioCzk} />
    </main>
  );
}
