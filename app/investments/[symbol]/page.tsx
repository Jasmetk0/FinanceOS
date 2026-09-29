import Link from "next/link";
import { notFound } from "next/navigation";
import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getAssetDetail } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const detail = getAssetDetail(decodeURIComponent(rawSymbol));
  if (!detail) notFound();
  const isPrincipalAsset =
    detail.assetClass === "p2p" || detail.assetClass === "bond";
  const isMintosAsset = detail.providers.includes("mintos");

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Link
        href="/investments"
        className="text-sm text-[var(--muted)] transition hover:text-white"
      >
        ← Investments
      </Link>

      <div className="mt-5">
        <Pill>{detail.assetClass}</Pill>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">
              {detail.symbol}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">{detail.name}</p>
          </div>
          <p className="text-sm text-[var(--muted)]">
            {detail.providers.join(" · ")}
          </p>
        </div>
      </div>

      {isPrincipalAsset && detail.metadata ? (
        <section className="mt-5 rounded-3xl border border-white/7 bg-[var(--panel)] p-5">
          {isMintosAsset ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-xs text-[var(--muted)]">ISIN</p>
                <p className="mt-1 font-mono text-sm font-medium">
                  {detail.metadata.isin || detail.symbol}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Loan records</p>
                <p className="mt-1 font-mono text-sm font-medium">
                  {(detail.metadata.loanCount ?? 0).toLocaleString("cs-CZ")}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Current principal</p>
                <p className="mt-1 font-mono text-sm">
                  {(detail.metadata.currentPrincipal ?? 0).toLocaleString("cs-CZ", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  EUR
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Instrument</p>
                <p className="mt-1 text-sm font-medium">
                  {detail.metadata.bond ? "Bond" : "Mintos Notes"}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-xs text-[var(--muted)]">Úvěr</p>
                <p className="mt-1 text-sm font-medium">
                  {detail.metadata.loanName || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Typ projektu</p>
                <p className="mt-1 text-sm font-medium">
                  {detail.metadata.projectType || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Celkem vložená jistina</p>
                <p className="mt-1 font-mono text-sm">
                  {(detail.metadata.investedPrincipal ?? 0).toLocaleString("cs-CZ", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  Kč
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Vrácená jistina</p>
                <p className="mt-1 font-mono text-sm">
                  {(detail.metadata.returnedPrincipal ?? 0).toLocaleString("cs-CZ", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  Kč
                </p>
              </div>
            </div>
          )}

          {detail.metadata.projectUrl ? (
            <a
              href={detail.metadata.projectUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]/30"
            >
              Otevřít projekt v Investownu ↗
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Current value"
          value={detail.currentValueCzk}
          format="currency"
        />
        {isPrincipalAsset ? (
          <>
            <StatCard
              label="Received yield"
              value={detail.summary.interestCzk}
              format="currency"
              hint="Výnosy, bonusové výnosy a úroky"
              positive
            />
            <StatCard
              label="Principal invested"
              value={detail.summary.principalInCzk}
              format="currency"
              hint="Historicky vložená jistina"
            />
            <StatCard
              label="Principal returned"
              value={detail.summary.principalOutCzk}
              format="currency"
              hint="Splacení a odstoupení"
              positive
            />
          </>
        ) : (
          <>
            <StatCard
              label="Unrealized P/L"
              value={detail.unrealizedPnlCzk}
              format="currency"
              positive={detail.unrealizedPnlCzk >= 0}
            />
            <StatCard
              label="Historical buys"
              value={detail.summary.buysCzk}
              format="currency"
              hint="Z importované historie"
            />
            <StatCard
              label="Dividends"
              value={detail.summary.dividendsCzk}
              format="currency"
              hint="Z importované historie"
              positive
            />
          </>
        )}
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <SectionCard title="Current holdings" subtitle="Rozpad podle účtu">
          {detail.holdings.length ? (
            <div className="space-y-3">
              {detail.holdings.map((holding) => (
                <article
                  key={holding.id}
                  className="rounded-2xl border border-white/7 bg-white/[0.025] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{holding.accountName}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {holding.provider}
                      </p>
                    </div>
                    <p className="font-mono text-sm">
                      {holding.marketValueCzk.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 0,
                      })}{" "}
                      Kč
                    </p>
                  </div>

                  {isPrincipalAsset ? (
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-[var(--muted)]">
                          Outstanding principal
                        </dt>
                        <dd className="mt-1 font-mono">
                          {Math.max(
                            0,
                            holding.marketValueCzk -
                              (detail.metadata?.reservedOfferCzk ?? 0),
                          ).toLocaleString("cs-CZ", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          Kč
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--muted)]">
                          Pending offer
                        </dt>
                        <dd className="mt-1 font-mono">
                          {(detail.metadata?.reservedOfferCzk ?? 0).toLocaleString(
                            "cs-CZ",
                            { maximumFractionDigits: 2 },
                          )}{" "}
                          Kč
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--muted)]">Currency</dt>
                        <dd className="mt-1 font-mono">{holding.currency}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--muted)]">
                          Current exposure
                        </dt>
                        <dd className="mt-1 font-mono">
                          {holding.marketValueCzk.toLocaleString("cs-CZ", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          Kč
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-[var(--muted)]">Quantity</dt>
                        <dd className="mt-1 font-mono">
                          {holding.quantity.toLocaleString("cs-CZ", {
                            maximumFractionDigits: 8,
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--muted)]">Currency</dt>
                        <dd className="mt-1 font-mono">{holding.currency}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--muted)]">Avg. price</dt>
                        <dd className="mt-1 font-mono">
                          {holding.averagePrice === null
                            ? "—"
                            : holding.averagePrice.toLocaleString("cs-CZ", {
                                maximumFractionDigits: 4,
                              })}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--muted)]">Current price</dt>
                        <dd className="mt-1 font-mono">
                          {holding.currentPrice === null
                            ? "—"
                            : holding.currentPrice.toLocaleString("cs-CZ", {
                                maximumFractionDigits: 4,
                              })}
                        </dd>
                      </div>
                    </dl>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Asset už není v aktuálních pozicích.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title={isPrincipalAsset ? "Principal history" : "Trade history"}
          subtitle={
            isPrincipalAsset
              ? "Investice, výnosy a pohyby jistiny"
              : "Nákupy, prodeje a dividendy"
          }
        >
          {detail.transactions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Date</th>
                    <th className="pb-3 font-medium">Account</th>
                    <th className="pb-3 font-medium">Type</th>
                    <th className="pb-3 text-right font-medium">Quantity</th>
                    <th className="pb-3 text-right font-medium">Price</th>
                    <th className="pb-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-3 text-sm text-[var(--muted)]">
                        {new Date(tx.occurredAt).toLocaleString("cs-CZ")}
                      </td>
                      <td className="py-3 text-sm text-[var(--muted)]">
                        {tx.accountName}
                      </td>
                      <td className="py-3 text-xs font-medium uppercase">
                        {tx.kind}
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        {tx.quantity === null
                          ? "—"
                          : tx.quantity.toLocaleString("cs-CZ", {
                              maximumFractionDigits: 8,
                            })}
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        {tx.price === null
                          ? "—"
                          : tx.price.toLocaleString("cs-CZ", {
                              maximumFractionDigits: 4,
                            }) +
                            " " +
                            tx.currency}
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        {tx.amountCzk === null
                          ? tx.amount.toLocaleString("cs-CZ") + " " + tx.currency
                          : tx.amountCzk.toLocaleString("cs-CZ", {
                              maximumFractionDigits: 2,
                            }) + " Kč"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Pro tento asset zatím není historie.
            </p>
          )}
        </SectionCard>
      </section>

      <section className="mt-4">
        <SectionCard title="Cash-flow summary">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(detail.assetClass === "p2p"
              ? [
                  ["Principal invested", detail.summary.principalInCzk],
                  ["Principal returned", detail.summary.principalOutCzk],
                  ["Received yield", detail.summary.interestCzk],
                  ["Fees", detail.summary.feesCzk],
                ]
              : [
                  ["Buys", detail.summary.buysCzk],
                  ["Sells", detail.summary.sellsCzk],
                  ["Dividends", detail.summary.dividendsCzk],
                  ["Fees", detail.summary.feesCzk],
                ]
            ).map(([label, raw]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-white/7 bg-white/[0.025] p-4"
              >
                <dt className="text-xs text-[var(--muted)]">{label}</dt>
                <dd className="mt-2 font-mono text-lg">
                  {Number(raw).toLocaleString("cs-CZ", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  Kč
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </section>
    </main>
  );
}
