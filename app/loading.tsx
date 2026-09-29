export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="h-5 w-28 animate-pulse rounded-full bg-white/8" />
      <div className="mt-4 h-10 w-64 max-w-full animate-pulse rounded-xl bg-white/8" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-2xl border border-white/7 bg-white/[0.025]"
          />
        ))}
      </div>
      <div className="mt-4 h-72 animate-pulse rounded-3xl border border-white/7 bg-white/[0.02]" />
      <p className="mt-4 text-xs text-[var(--muted)]">Načítám FinanceOS…</p>
    </main>
  );
}
