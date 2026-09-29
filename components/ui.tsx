import type { ReactNode } from "react";

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/8 px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
      {children}
    </span>
  );
}

export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/7 bg-[var(--panel)] p-4 shadow-[0_20px_80px_rgba(0,0,0,0.14)] sm:p-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
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
    value === null
      ? "—"
      : format === "currency"
        ? `${value.toLocaleString("cs-CZ")} Kč`
        : format === "percent"
          ? `${value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} %`
          : value.toLocaleString("cs-CZ");

  return (
    <div className="rounded-3xl border border-white/7 bg-[var(--panel)] p-4 sm:p-5">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight sm:text-[1.65rem]">
        {formatted}
      </p>
      {hint ? (
        <p
          className={[
            "mt-2 text-xs",
            positive ? "text-[var(--accent)]" : "text-[var(--muted)]",
          ].join(" ")}
        >
          {hint}
        </p>
      ) : null}
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
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
    </div>
  );
}
