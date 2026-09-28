import { Pill, SectionCard } from "@/components/ui";
import { ManualTransactionForm } from "@/components/manual-transaction-form";
import { getTransactions } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const transactions = getTransactions(1000);

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>{transactions.length} records</Pill>
      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Transactions
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            Nákupy, prodeje, vklady, výběry, dividendy, úroky i ruční výplaty a dary.
          </p>
        </div>
        <ManualTransactionForm />
      </div>

      <div className="mt-7">
        <SectionCard
          title="Historie"
          subtitle="Nejnovější nahoře. Provider raw data zůstávají v lokální databázi."
        >
          {transactions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Date</th>
                    <th className="pb-3 font-medium">Item</th>
                    <th className="pb-3 font-medium">Account</th>
                    <th className="pb-3 font-medium">Type</th>
                    <th className="pb-3 text-right font-medium">Quantity</th>
                    <th className="pb-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-4 text-sm text-[var(--muted)]">
                        {new Date(tx.occurredAt).toLocaleString("cs-CZ")}
                      </td>
                      <td className="py-4">
                        <p className="text-sm font-medium">
                          {tx.symbol || tx.note || tx.kind}
                        </p>
                        {tx.assetName && tx.assetName !== tx.symbol ? (
                          <p className="mt-1 max-w-[260px] truncate text-xs text-[var(--muted)]">
                            {tx.assetName}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-4 text-sm text-[var(--muted)]">
                        {tx.accountName}
                      </td>
                      <td className="py-4">
                        <span className="rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[11px] font-medium uppercase text-[var(--muted)]">
                          {tx.kind}
                        </span>
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {tx.quantity === null
                          ? "—"
                          : tx.quantity.toLocaleString("cs-CZ", {
                              maximumFractionDigits: 8,
                            })}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {tx.amountCzk === null
                          ? `${tx.amount.toLocaleString("cs-CZ")} ${tx.currency}`
                          : `${tx.amountCzk.toLocaleString("cs-CZ", {
                              maximumFractionDigits: 2,
                            })} Kč`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Zatím žádné transakce.
            </p>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
