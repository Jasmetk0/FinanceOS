export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Načítání finančního přehledu" className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-7 space-y-3">
        <div className="h-7 w-40 animate-pulse rounded-full bg-white/[.07]" />
        <div className="h-10 w-72 max-w-full animate-pulse rounded-xl bg-white/[.075]" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-white/[.04]" />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-[65px] animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--panel)]" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--panel)]" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,.8fr)]">
        <div className="h-[410px] animate-pulse rounded-[22px] border border-[var(--border)] bg-[var(--panel)]" />
        <div className="h-[410px] animate-pulse rounded-[22px] border border-[var(--border)] bg-[var(--panel)]" />
      </div>
      <p role="status" className="mt-4 text-xs text-[var(--muted)]">Načítám FinanceOS…</p>
    </main>
  );
}
