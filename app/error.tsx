"use client";

import Link from "next/link";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-5 py-16 text-center" role="alert">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--danger)]/25 bg-[var(--danger)]/[.09] text-[var(--danger)]">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m10 3-8 15a2 2 0 0 0 1.8 3h16.4a2 2 0 0 0 1.8-3L14 3a2.3 2.3 0 0 0-4 0Z" /><path d="M12 9v5m0 4h.01" /></svg>
      </span>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[.22em] text-[var(--danger)]">Chyba zobrazení</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Tuto stránku se nepodařilo načíst</h1>
      <p className="mt-3 max-w-lg text-sm leading-7 text-[var(--muted)]">
        Některá data momentálně nejsou dostupná. FinanceOS při této chybě nic nemaže ani nemění v tvých investičních účtech.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--background)] transition hover:brightness-110">
          Zkusit znovu
        </button>
        <Link href="/" prefetch={false} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-5 py-3 text-sm font-semibold transition hover:border-white/25">
          Přejít na přehled
        </Link>
      </div>
    </main>
  );
}
