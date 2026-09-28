import { Pill, SectionCard } from "@/components/ui";
import { demoTransactions } from "@/lib/mock-data";

export default function TransactionsPage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Demo data</Pill>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Transactions
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
            Jednotný ledger pro nákupy, prodeje, vklady, dividendy, úroky a další pohyby.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-[var(--muted)] opacity-70"
        >
          + Add transaction · soon
        </button>
      </div>

      <div className="mt-7">
        <SectionCard
          title="Historie"
          subtitle="Ukázka budoucího jednotného transakčního přehledu"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                  <th className="pb-3 font-medium">Date</th>
                  <th className="pb-3 font-medium">Transaction</th>
                  <th className="pb-3 font-medium">Account</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {demoTransactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-white/6 last:border-0">
                    <td className="py-4 text-sm text-[var(--muted)]">{tx.date}</td>
                    <td className="py-4 text-sm font-medium">{tx.title}</td>
                    <td className="py-4 text-sm text-[var(--muted)]">{tx.account}</td>
                    <td className="py-4">
                      <span className="rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[11px] font-medium text-[var(--muted)]">
                        {tx.kind}
                      </span>
                    </td>
                    <td className="py-4 text-right font-mono text-sm">{tx.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
