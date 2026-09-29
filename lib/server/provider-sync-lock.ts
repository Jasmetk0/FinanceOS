import crypto from "node:crypto";
import { getDb } from "@/lib/server/db";

const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const POLL_MS = 125;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function acquire(provider: string, owner: string, leaseMs: number) {
  const db = getDb();
  const nowMs = Date.now();
  const expiresAt = nowMs + leaseMs;
  const updatedAt = new Date(nowMs).toISOString();

  db.exec("BEGIN IMMEDIATE;");
  try {
    const current = db
      .prepare(
        "SELECT owner, expires_at FROM provider_sync_locks WHERE provider = ?",
      )
      .get(provider);

    const available =
      !current ||
      String(current.owner) === owner ||
      Number(current.expires_at) <= nowMs;

    if (!available) {
      db.exec("ROLLBACK;");
      return false;
    }

    db.prepare(
      "INSERT INTO provider_sync_locks(provider, owner, expires_at, updated_at) " +
        "VALUES(?, ?, ?, ?) " +
        "ON CONFLICT(provider) DO UPDATE SET " +
        "owner = excluded.owner, expires_at = excluded.expires_at, " +
        "updated_at = excluded.updated_at",
    ).run(provider, owner, expiresAt, updatedAt);

    db.exec("COMMIT;");
    return true;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Preserve original lock error.
    }
    throw error;
  }
}

function renew(provider: string, owner: string, leaseMs: number) {
  getDb()
    .prepare(
      "UPDATE provider_sync_locks SET expires_at = ?, updated_at = ? " +
        "WHERE provider = ? AND owner = ?",
    )
    .run(
      Date.now() + leaseMs,
      new Date().toISOString(),
      provider,
      owner,
    );
}

function release(provider: string, owner: string) {
  getDb()
    .prepare("DELETE FROM provider_sync_locks WHERE provider = ? AND owner = ?")
    .run(provider, owner);
}

export async function withProviderSyncLock<T>(
  provider: string,
  task: () => Promise<T>,
  options?: {
    leaseMs?: number;
    waitMs?: number;
  },
): Promise<T> {
  const leaseMs = options?.leaseMs ?? DEFAULT_LEASE_MS;
  const waitMs = options?.waitMs ?? 30_000;
  const owner = crypto.randomUUID();
  const deadline = Date.now() + waitMs;

  while (!acquire(provider, owner, leaseMs)) {
    if (Date.now() >= deadline) {
      throw new Error(
        provider + " sync is already running in another FinanceOS process.",
      );
    }
    await sleep(POLL_MS);
  }

  const heartbeat = setInterval(() => {
    try {
      renew(provider, owner, leaseMs);
    } catch {
      // The active task will still fail normally if the underlying DB is unavailable.
    }
  }, Math.max(5_000, Math.floor(leaseMs / 3)));

  try {
    return await task();
  } finally {
    clearInterval(heartbeat);
    release(provider, owner);
  }
}
