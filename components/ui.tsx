import type { ReactNode } from "react";

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/[.075] px-3 py-1.5 text-[11px] font-semibold tracking-[.035em] text-[var(--accent)]">
      <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-[var(--accent)] shadow-[0_0_10px_rgba(123,230,188,.35)]" />
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
    <section className="finance-surface min-w-0 overflow-hidden">
      <div className="finance-surface-header flex flex-wrap items-start justify-between gap-3 px-5 py-[19px] sm:px-6 sm:py-[21px]">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-.025em] text-[var(--foreground)] sm:text-[16px]">{title}</h2>
          {subtitle ? <p className="mt-1.5 max-w-3xl text-xs leading-[1.65] text-[var(--muted)] sm:text-[13px]">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0 self-center [&_a]:inline-flex [&_a]:min-h-9 [&_a]:items-center [&_a]:rounded-lg [&_a]:px-2.5 [&_a]:transition [&_a:hover]:bg-[var(--accent)]/[.08]">{action}</div> : null}
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
  featured = false,
}: {
  label: string;
  value: number | null;
  format?: "number" | "currency" | "percent";
  hint?: string;
  positive?: boolean;
  featured?: boolean;
}) {
  const valid = value !== null && Number.isFinite(value);
  const formatted =
    !valid || value === null
      ? "—"
      : format === "currency"
        ? value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč"
        : format === "percent"
          ? value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) + " %"
          : value.toLocaleString("cs-CZ");
  const tone =
    !valid || positive === undefined
      ? "text-[var(--foreground)]"
      : positive
        ? "text-[var(--accent)]"
        : (value ?? 0) < 0
          ? "text-[var(--danger)]"
          : "text-[var(--foreground)]";

  return (
    <div data-featured={featured ? "true" : "false"} className="finance-stat flex min-w-0 flex-col justify-between px-4 py-4 sm:px-[18px] sm:py-[17px]">
      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold leading-5 tracking-[.01em] text-[var(--muted)]">{label}</p>
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-white/[.085] bg-white/[.035] text-[var(--accent)]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17 9 12l4 3 7-8" /><path d="M16 7h4v4" /></svg>
        </span>
      </div>
      <div className="relative z-10 mt-2.5">
        <p className={["finance-stat-value text-[clamp(1.28rem,2vw,1.82rem)] font-semibold leading-[1.18] tracking-[-.05em]", featured ? "" : tone].join(" ")}>{formatted}</p>
        <p className="mt-2 max-w-[36ch] text-[11px] leading-[1.55] text-[var(--muted)]">{hint || "\u00a0"}</p>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-14 -right-14 h-36 w-36 rounded-full border border-white/[.045] bg-[var(--accent)]/[.024]" />
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
    <div className="flex flex-col items-center justify-center rounded-[19px] border border-dashed border-[var(--border-strong)] bg-[#0b1624]/55 px-6 py-11 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[.07] text-[var(--accent)]">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 3v18h18M7 16l4-5 3 2 5-7" /></svg>
      </span>
      <p className="text-[15px] font-semibold tracking-tight">{title}</p>
      <p className="mt-2 max-w-lg text-[13px] leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}
