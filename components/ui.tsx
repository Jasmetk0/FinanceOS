import type { ReactNode } from "react";

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/[.075] px-3 py-1.5 text-[11px] font-semibold tracking-wide text-[var(--accent)]">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
      {children}
    </span>
  );
}

export function SectionCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--panel)] shadow-[0_12px_40px_rgba(0,0,0,.10)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[.055] px-5 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-.015em] text-[var(--foreground)] sm:text-base">{title}</h2>
          {subtitle ? <p className="mt-1.5 max-w-3xl text-xs leading-5 text-[var(--muted)] sm:text-[13px]">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="min-w-0 p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  format = "number",
  hint,
  positive,
}: {
  label: string;
  value: number | null;
  format?: "number" | "currency" | "percent";
  hint?: string;
  positive?: boolean;
}) {
  const formatted =
    value === null || !Number.isFinite(value)
      ? "—"
      : format === "currency"
        ? value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč"
        : format === "percent"
          ? value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) + " %"
          : value.toLocaleString("cs-CZ");

  const tone =
    positive === undefined || value === null
      ? "text-[var(--foreground)]"
      : positive
        ? "text-[var(--accent)]"
        : value < 0
          ? "text-[var(--danger)]"
          : "text-[var(--foreground)]";

  return (
    <div className="relative min-w-0 overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)] px-5 py-5 shadow-[0_12px_40px_rgba(0,0,0,.10)] sm:px-5 sm:py-6">
      <span aria-hidden="true" className="absolute right-0 top-0 h-16 w-16 translate-x-8 -translate-y-8 rounded-full bg-[var(--accent)]/[.08] blur-xl" />
      <p className="relative text-[12px] font-medium text-[var(--muted)]">{label}</p>
      <p className={["relative mt-3 break-words text-[clamp(1.4rem,2vw,1.85rem)] font-semibold tracking-[-.045em] tabular-nums", tone].join(" ")}>
        {formatted}
      </p>
      {hint ? <p className="relative mt-2 text-[11px] leading-[1.55] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-white/15 bg-white/[.015] px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[.07] text-[var(--accent)]">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 3v18h18M7 16l4-5 3 2 5-7" /></svg>
      </span>
      <p className="font-semibold">{title}</p>
      <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}
