import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getDiagnostics } from "@/lib/server/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const severityLabel = {
  ok: "OK",
  info: "Info",
  warning: "Warning",
  error: "Error",
} as const;

export default function DiagnosticsPage() {
  const data = getDiagnostics();

  return (
    <main className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <Pill>Local data doctor</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Diagnostics
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          Kontrola integrity databáze, čerstvosti synchronizace, pokrytí CZK,
          záloh a souladu mezi účtem a aktuálními pozicemi.
        </p>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="OK" value={data.summary.ok} />
        <StatCard label="Warnings" value={data.summary.warning} />
        <StatCard label="Errors" value={data.summary.error} />
        <StatCard label="Info" value={data.summary.info} />
      </section>

      <div className="mt-4">
        <SectionCard
          title="Health checks"
          subtitle={"Generated " + new Date(data.generatedAt).toLocaleString("cs-CZ")}
        >
          <div className="space-y-3">
            {data.checks.map((check) => (
              <article
                key={check.id}
                className={[
                  "rounded-2xl border p-4",
                  check.severity === "error"
                    ? "border-[var(--danger)]/25 bg-[var(--danger)]/[0.04]"
                    : check.severity === "warning"
                      ? "border-[var(--warning)]/25 bg-[var(--warning)]/[0.04]"
                      : "border-white/7 bg-white/[0.02]",
                ].join(" ")}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        "h-2.5 w-2.5 rounded-full",
                        check.severity === "error"
                          ? "bg-[var(--danger)]"
                          : check.severity === "warning"
                            ? "bg-[var(--warning)]"
                            : check.severity === "ok"
                              ? "bg-[var(--accent)]"
                              : "bg-white/40",
                      ].join(" ")}
                    />
                    <h2 className="text-sm font-semibold">{check.title}</h2>
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
                    {severityLabel[check.severity]}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {check.detail}
                </p>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Runtime">
          <dl className="space-y-4 text-sm">
            <div className="flex items-start justify-between gap-5">
              <dt className="text-[var(--muted)]">Node</dt>
              <dd className="font-mono">{data.node}</dd>
            </div>
            <div className="flex items-start justify-between gap-5">
              <dt className="text-[var(--muted)]">Platform</dt>
              <dd className="font-mono">{data.platform}</dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard title="Local data directory">
          <p className="break-all font-mono text-xs leading-6 text-[var(--muted)]">
            {data.dataDir}
          </p>
          <a
            href="/api/export/diagnostics"
            className="mt-4 inline-flex rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white"
          >
            Download diagnostics (.json)
          </a>
        </SectionCard>
      </section>

      <div className="mt-4 rounded-3xl border border-white/7 bg-white/[0.02] p-5">
        <p className="text-sm font-semibold">Interpretace</p>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-[var(--muted)]">
          Warning nemusí znamenat chybu. Například broker může do account total
          zahrnovat rezervovanou nebo nevypořádanou hotovost. Diagnostics je
          kontrolní vrstva, která upozorní na rozdíly, ale sama finanční data
          automaticky nepřepisuje.
        </p>
      </div>
    </main>
  );
}
