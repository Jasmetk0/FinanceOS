import crypto from "node:crypto";
import { getDb } from "@/lib/server/db";

export function listJournalEntries(limit = 200) {
  return getDb()
    .prepare(`
      SELECT id, symbol, title, thesis, created_at, review_at, status
      FROM investment_journal
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(limit)
    .map((row) => ({
      id: String(row.id),
      symbol: row.symbol ? String(row.symbol) : null,
      title: String(row.title),
      thesis: String(row.thesis),
      createdAt: String(row.created_at),
      reviewAt: row.review_at ? String(row.review_at) : null,
      status: String(row.status),
    }));
}

export function addJournalEntry(input: {
  symbol?: string;
  title: string;
  thesis: string;
  createdAt?: string;
  reviewAt?: string;
}) {
  const title = input.title.trim();
  const thesis = input.thesis.trim();
  if (!title) throw new Error("Journal title is required.");
  if (!thesis) throw new Error("Journal thesis is required.");

  const created = input.createdAt ? new Date(input.createdAt) : new Date();
  if (Number.isNaN(created.getTime())) {
    throw new Error("Invalid journal date.");
  }

  let reviewAt: string | null = null;
  if (input.reviewAt?.trim()) {
    const review = new Date(input.reviewAt);
    if (Number.isNaN(review.getTime())) {
      throw new Error("Invalid review date.");
    }
    reviewAt = review.toISOString();
  }

  const id = `journal:${crypto.randomUUID()}`;
  getDb()
    .prepare(`
      INSERT INTO investment_journal(
        id, symbol, title, thesis, created_at, review_at, status
      )
      VALUES(?, ?, ?, ?, ?, ?, 'active')
    `)
    .run(
      id,
      input.symbol?.trim().toUpperCase() || null,
      title,
      thesis,
      created.toISOString(),
      reviewAt,
    );

  return id;
}

export function setJournalStatus(id: string, status: string) {
  if (!["active", "reviewed", "closed"].includes(status)) {
    throw new Error("Unsupported journal status.");
  }

  const result = getDb()
    .prepare("UPDATE investment_journal SET status = ? WHERE id = ?")
    .run(status, id);
  if (!result.changes) throw new Error("Journal entry was not found.");
}

export function deleteJournalEntry(id: string) {
  const result = getDb()
    .prepare("DELETE FROM investment_journal WHERE id = ?")
    .run(id);
  if (!result.changes) throw new Error("Journal entry was not found.");
}
