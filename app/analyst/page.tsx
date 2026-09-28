import { Pill, SectionCard } from "@/components/ui";
import { buildAiContext } from "@/lib/server/ai-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AnalystPage() {
  const context = buildAiContext();

  return (
    <main className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <Pill>AI-ready · no model connected</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Analyst
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          FinanceOS už umí připravit kompaktní, bezpečný kontext pro budoucí AI
          analytiku. API secrets ani raw provider credentials se do něj nedávají.
        </p>
      </div>

      <section className="mt-7 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <SectionCard title="AI context" subtitle="FinanceOS AI Context v1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric
              label="Accounts"
              value={String(context.portfolio.accounts.length)}
            />
            <Metric
              label="Holdings"
              value={String(context.portfolio.holdings.length)}
            />
            <Metric
              label="Recent transactions"
              value={String(context.recentTransactions.length)}
            />
            <Metric
              label="Snapshots"
              value={String(context.portfolio.snapshots.length)}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/api/export/ai-context"
              className="inline-flex rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
            >
              Download AI context
            </a>
            <a
              href="/api/export"
              className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white"
            >
              Full data export
            </a>
          </div>
        </SectionCard>

        <SectionCard title="Privacy contract">
          <ul className="space-y-3 text-sm leading-6 text-[var(--muted)]">
            <li>✓ API secrets: not included</li>
            <li>✓ Encryption key: not included</li>
            <li>✓ Raw provider payloads: not included</li>
            <li>✓ Portfolio and transaction analytics: included</li>
          </ul>
        </SectionCard>
      </section>

      <section className="mt-4">
        <SectionCard
          title="What the future AI layer can ask FinanceOS"
          subtitle="The underlying data functions are already separated from provider credentials"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              "Zhodnoť moje investiční chování za poslední rok.",
              "Jak se změnila koncentrace portfolia?",
              "Kolik z růstu majetku jsou vklady a kolik výnos?",
              "Projdi moje nákupy konkrétní akcie.",
              "Jak se vyvíjí savings rate a investiční cash flow?",
              "Která data jsou neúplná a co je potřeba dosynchronizovat?",
            ].map((question) => (
              <div
                key={question}
                className="rounded-2xl border border-white/7 bg-white/[0.025] p-4 text-sm leading-6"
              >
                {question}
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <div className="mt-4 rounded-3xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-5">
        <p className="text-sm font-semibold">Next AI phase</p>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          Tato verze sama neposílá finanční data žádnému externímu AI modelu.
          Až přidáme modelové API nebo ChatGPT connector/MCP, použijeme právě
          tento omezený kontext místo přímého přístupu k broker credentials.
        </p>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/7 bg-white/[0.025] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
