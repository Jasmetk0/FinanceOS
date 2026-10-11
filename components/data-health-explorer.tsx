"use client";

import { useMemo, useState } from "react";
import type { getInsightsData } from "@/lib/server/analytics";

type Warning = ReturnType<typeof getInsightsData>["warnings"][number];
type Severity = "all" | Warning["severity"];

const labels: Record<Severity, string> = {
  all: "Vše",
  error: "Chyby",
  warning: "Upozornění",
  info: "Informace",
};

export function DataHealthExplorer({ warnings }: { warnings: Warning[] }) {
  const [severity, setSeverity] = useState<Severity>("all");
  const [expanded, setExpanded] = useState(true);

  const counts = useMemo(() => ({
    all: warnings.length,
    error: warnings.filter((warning) => warning.severity === "error").length,
    warning: warnings.filter((warning) => warning.severity === "warning").length,
    info: warnings.filter((warning) => warning.severity === "info").length,
  }), [warnings]);

  const filtered = useMemo(() =>
    severity === "all" ? warnings : warnings.filter((warning) => warning.severity === severity),
    [warnings, severity],
  );

  if (!warnings.length) {
    return (
      <div role="status" className="rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[.045] px-4 py-5">
        <p className="text-[13px] font-semibold text-[var(--accent)]">V dostupných datech nebyl zjištěn žádný definovaný problém.</p>
        <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">Nejde o záruku úplnosti dat. Aktuálnost jednotlivých účtů najdeš v jejich detailu.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtrovat upozornění podle závažnosti" className="flex flex-wrap gap-1.5">
          {(["all", "error", "warning", "info"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setSeverity(item); setExpanded(true); }}
              aria-pressed={severity === item}
              className={[
                "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition",
                severity === item
                  ? "border-[var(--accent)]/30 bg-[var(--accent)]/[.10] text-[var(--accent)]"
                  : "border-[var(--border)] bg-white/[.02] text-[var(--muted)] hover:text-white",
              ].join(" ")}
            >
              {labels[item]}
              <span className="rounded-md bg-white/[.07] px-1.5 py-0.5 text-[10px] tabular-nums">{counts[item]}</span>
            </button>
          ))}
        </div>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((previous) => !previous)} className="finance-action !min-h-9 !px-3">
          {expanded ? "Sbalit" : "Rozbalit"}
        </button>
      </div>

      <p role="status" aria-live="polite" className="mt-3 text-[11px] text-[var(--muted)]">
        {filtered.length} {filtered.length === 1 ? "nalezené upozornění" : "nalezených upozornění"}
      </p>

      {expanded ? (
        <div className="mt-3 space-y-2.5">
          {filtered.length ? filtered.map((warning) => (
            <article
              key={warning.id}
              className={[
                "rounded-[15px] border px-3.5 py-3.5",
                warning.severity === "error"
                  ? "border-[var(--danger)]/25 bg-[var(--danger)]/[.05]"
                  : warning.severity === "warning"
                    ? "border-[var(--warning)]/25 bg-[var(--warning)]/[.045]"
                    : "border-[var(--border)] bg-white/[.02]",
              ].join(" ")}
            >
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={["h-2 w-2 shrink-0 rounded-full", warning.severity === "error" ? "bg-[var(--danger)]" : warning.severity === "warning" ? "bg-[var(--warning)]" : "bg-[var(--blue)]"].join(" ")}
                />
                <h3 className="text-[12px] font-semibold leading-5">{warning.title}</h3>
              </div>
              <p className="mt-2 pl-[18px] text-[12px] leading-[1.65] text-[var(--muted)]">{warning.detail}</p>
            </article>
          )) : (
            <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--muted)]">
              V této kategorii nejsou žádná upozornění.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
