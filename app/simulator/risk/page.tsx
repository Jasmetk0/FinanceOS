import Link from "next/link";
import { RetirementRiskSimulator } from "@/components/retirement-risk-simulator";

export default function RetirementRiskPage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="finance-eyebrow">FinanceOS / Finanční simulátor</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Riziko a finanční nezávislost</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Monte Carlo simulace, důchodové výběry indexované o inflaci a stresové scénáře.
            Modelované pravděpodobnosti jsou závislé na tebou zvolených předpokladech.
          </p>
        </div>
        <Link className="finance-action" href="/simulator" prefetch={false}>← Základní simulátor</Link>
      </div>
      <RetirementRiskSimulator />
    </main>
  );
}
