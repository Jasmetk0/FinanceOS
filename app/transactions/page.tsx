import { Pill, SectionCard } from "@/components/ui";
import { ManualTransactionForm } from "@/components/manual-transaction-form";
import { TransactionsTable } from "@/components/transactions-table";
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
          <TransactionsTable transactions={transactions} />
        </SectionCard>
      </div>
    </main>
  );
}
