import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import {
  importInvestown,
  type InvestownImportRow,
} from "@/lib/server/investown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as {
      accountCurrency?: unknown;
      currentValue?: unknown;
      walletCash?: unknown;
      rows?: unknown;
      replaceExisting?: unknown;
      sourceFormat?: unknown;
      dryRun?: unknown;
      allowAuthoritativeRemovals?: unknown;
      confirmationToken?: unknown;
    };

    const rows = Array.isArray(body.rows)
      ? (body.rows as InvestownImportRow[])
      : [];

    const sourceFormat =
      body.sourceFormat === "investown-native"
        ? "investown-native"
        : "mapped";

    const result = await importInvestown({
      accountCurrency: String(body.accountCurrency || "CZK"),
      currentValue: optionalNumber(body.currentValue),
      walletCash: optionalNumber(body.walletCash),
      rows,
      replaceExisting: body.replaceExisting !== false,
      sourceFormat,
      dryRun: body.dryRun === true,
      allowAuthoritativeRemovals: body.allowAuthoritativeRemovals === true,
      confirmationToken:
        typeof body.confirmationToken === "string"
          ? body.confirmationToken
          : undefined,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
