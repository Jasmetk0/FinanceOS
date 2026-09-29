import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import { importMintos, type MintosImportRow } from "@/lib/server/mintos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function optionalNumber(value: unknown) {
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
      cashValue?: unknown;
      rows?: unknown;
      replaceExisting?: unknown;
      sourceFormat?: unknown;
    };

    const rows = Array.isArray(body.rows)
      ? (body.rows as MintosImportRow[])
      : [];

    const sourceFormat =
      body.sourceFormat === "mintos-native-cs"
        ? "mintos-native-cs"
        : "mapped";

    const result = await importMintos({
      accountCurrency: String(body.accountCurrency || "EUR"),
      currentValue: optionalNumber(body.currentValue),
      cashValue: optionalNumber(body.cashValue),
      rows,
      replaceExisting: body.replaceExisting !== false,
      sourceFormat,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
