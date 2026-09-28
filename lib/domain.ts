export type CurrencyCode = string;

export type ProviderId =
  | "trading212"
  | "kraken"
  | "mintos"
  | "manual";

export type ConnectionStatus =
  | "not_connected"
  | "connected"
  | "syncing"
  | "error";

export type AccountType =
  | "brokerage"
  | "crypto"
  | "p2p"
  | "cash"
  | "asset"
  | "liability"
  | "manual";

export type AssetClass =
  | "stock"
  | "etf"
  | "crypto"
  | "bond"
  | "cash"
  | "p2p"
  | "other";

export type TransactionKind =
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "dividend"
  | "interest"
  | "fee"
  | "transfer"
  | "income"
  | "expense"
  | "gift"
  | "adjustment";

export interface ProviderConnection {
  id: string;
  provider: ProviderId;
  status: ConnectionStatus;
  lastSyncedAt: string | null;
  accountIds: string[];
}

export interface Account {
  id: string;
  provider: ProviderId;
  name: string;
  type: AccountType;
  baseCurrency: CurrencyCode;
  valueCzk: number;
}

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quoteCurrency: CurrencyCode;
}

export interface Holding {
  id: string;
  accountId: string;
  assetId: string;
  quantity: number;
  averageCost: number | null;
  marketPrice: number;
  marketValueCzk: number;
  unrealizedPnlCzk: number | null;
}

export interface FinanceTransaction {
  id: string;
  accountId: string;
  kind: TransactionKind;
  occurredAt: string;
  currency: CurrencyCode;
  amount: number;
  assetId?: string;
  quantity?: number;
  price?: number;
  fee?: number;
  externalId?: string;
  note?: string;
}

export interface PortfolioSnapshot {
  date: string;
  valueCzk: number;
  investedCzk: number;
  cashCzk: number;
}

export interface PortfolioSummary {
  netWorthCzk: number;
  investedCzk: number;
  unrealizedPnlCzk: number;
  cashCzk: number;
}
