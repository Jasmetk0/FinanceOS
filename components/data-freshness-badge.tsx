type Freshness = {
  status: "current" | "stale" | "manual" | "unknown";
  source: "api_sync" | "statement" | "manual_override" | "manual" | "unknown";
  coverageThrough: string | null;
  missingSince: string | null;
  updatedAt: string | null;
};

function displayDate(date: string | null) {
  if (!date) return null;
  return new Date(date + "T12:00:00").toLocaleDateString("cs-CZ");
}

function tooltip(freshness: Freshness) {
  const through = displayDate(freshness.coverageThrough);
  if (freshness.status === "current") {
    return through
      ? "Data jsou doložená minimálně do " + through + "."
      : "Data jsou aktuální.";
  }
  if (freshness.status === "stale") {
    return through
      ? "Poslední doložená data jsou z " + through + "."
      : "Zdroj nemá aktuální data.";
  }
  if (freshness.status === "manual") {
    return freshness.updatedAt
      ? "Ruční hodnota byla naposledy upravena " +
          new Date(freshness.updatedAt).toLocaleString("cs-CZ") +
          "."
      : "Ruční údaj nemá automaticky ověřitelnou aktuálnost.";
  }
  return "FinanceOS z dostupného zdroje neumí spolehlivě určit aktuálnost.";
}

export function DataFreshnessBadge({
  freshness,
  compact = false,
}: {
  freshness: Freshness;
  compact?: boolean;
}) {
  const missingSince = displayDate(freshness.missingSince);
  const updated = freshness.updatedAt
    ? new Date(freshness.updatedAt).toLocaleDateString("cs-CZ")
    : null;

  const label =
    freshness.status === "current"
      ? "Aktuální"
      : freshness.status === "stale"
        ? missingSince
          ? "Chybí od " + missingSince
          : "Neaktuální"
        : freshness.status === "manual"
          ? updated
            ? "Ruční údaj · " + updated
            : "Ruční údaj"
          : "Aktuálnost neznámá";

  const tone =
    freshness.status === "current"
      ? "border-[var(--accent)]/25 bg-[var(--accent)]/8 text-[var(--accent)]"
      : freshness.status === "stale"
        ? "border-[var(--warning)]/25 bg-[var(--warning)]/8 text-[var(--warning)]"
        : "border-white/10 bg-white/[0.035] text-[var(--muted)]";

  return (
    <span
      title={tooltip(freshness)}
      className={[
        "inline-flex w-fit items-center rounded-full border font-medium",
        compact
          ? "px-2 py-0.5 text-[10px]"
          : "px-2.5 py-1 text-[11px]",
        tone,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
