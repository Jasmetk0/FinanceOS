import { NextResponse } from "next/server";
import { localOnly } from "@/lib/server/local-only";
import {
  addJournalEntry,
  deleteJournalEntry,
  listJournalEntries,
  setJournalStatus,
} from "@/lib/server/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  return NextResponse.json({ entries: listJournalEntries() });
}

export async function POST(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    addJournalEntry({
      symbol: body.symbol ? String(body.symbol) : undefined,
      title: String(body.title || ""),
      thesis: String(body.thesis || ""),
      createdAt: body.createdAt ? String(body.createdAt) : undefined,
      reviewAt: body.reviewAt ? String(body.reviewAt) : undefined,
    });

    return NextResponse.json({ ok: true, entries: listJournalEntries() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    setJournalStatus(String(body.id || ""), String(body.status || ""));
    return NextResponse.json({ ok: true, entries: listJournalEntries() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    deleteJournalEntry(String(body.id || ""));
    return NextResponse.json({ ok: true, entries: listJournalEntries() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
