import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-5 py-16 text-center">
      <span className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-2 font-mono text-lg font-semibold text-[var(--accent)]">404</span>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">Tato stránka neexistuje</h1>
      <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
        Odkaz je neplatný nebo byla stránka přesunuta. Můžeš se vrátit k přehledu investic.
      </p>
      <Link href="/" prefetch={false} className="mt-7 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--background)] transition hover:brightness-110">
        Zpět na přehled →
      </Link>
    </main>
  );
}
