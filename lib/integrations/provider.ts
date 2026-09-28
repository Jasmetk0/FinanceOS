import type {
  Account,
  FinanceTransaction,
  Holding,
  ProviderId,
} from "@/lib/domain";

export interface SyncCursor {
  value: string | null;
}

export interface ProviderSyncResult {
  accounts: Account[];
  holdings: Holding[];
  transactions: FinanceTransaction[];
  nextCursor: SyncCursor;
}

export interface ProviderAdapter {
  readonly provider: ProviderId;

  /**
   * Validates provider-specific credentials without exposing them to the UI.
   * Concrete adapters will live on the server only.
   */
  validateConnection(): Promise<void>;

  /**
   * Runs an incremental sync. A null cursor means the initial historical backfill.
   */
  sync(cursor: SyncCursor): Promise<ProviderSyncResult>;
}
