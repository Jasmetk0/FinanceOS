import { Pill, SectionCard } from "@/components/ui";
import { JournalManager } from "@/components/journal-manager";
import { listJournalEntries } from "@/lib/server/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function JournalPage() {
  const entries = listJournalEntries();

  return (
    <main className="mx-auto w-full max-w-[1300px] p-4 sm:p-6 lg:p-8">
      <Pill>Decision memory</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Investment Journal
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          FinanceOS tak nebude znát jen to, co jsi koupil, ale i proč jsi to
          tehdy udělal a kdy chceš investiční tezi znovu zkontrolovat.
        </p>
      </div>

      <div className="mt-7">
        <SectionCard
          title="Theses"
          subtitle={entries.length + " journal entries"}
        >
          <JournalManager initialEntries={entries} />
        </SectionCard>
      </div>
    </main>
  );
}
