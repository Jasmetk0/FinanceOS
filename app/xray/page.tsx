import Link from "next/link";
import { getXRayHoldings } from "@/lib/server/xray";
import { PortfolioXRay } from "@/components/portfolio-xray";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PortfolioXRayPage() {
  const holdings = getXRayHoldings();
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="finance-eyebrow">FinanceOS / Analýza a plánování</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Portfolio X-Ray</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Kolik skutečné ekonomické expozice máš v jednotlivých společnostech a kryptoměnách?
            Sloučení přímých pozic a skutečných rozkladů fondů bez dvojího započítání ETF.
          </p>
        </div>
        <Link href="/investments" prefetch={false} className="finance-action">Přejít na skutečné investice ↗</Link>
      </div>
      <PortfolioXRay holdings={holdings} />
    </main>
  );
}
