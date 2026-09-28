import type { PortfolioSummary } from "@/lib/domain";

export const summary: PortfolioSummary = {
  netWorthCzk: 397428,
  investedCzk: 342000,
  unrealizedPnlCzk: 40420,
  cashCzk: 14980,
};

export const portfolioSeries = [
  { label: "Dub", valueCzk: 313000 },
  { label: "Kvě", valueCzk: 326400 },
  { label: "Čvn", valueCzk: 341900 },
  { label: "Čvc", valueCzk: 353100 },
  { label: "Srp", valueCzk: 381500 },
  { label: "Zář", valueCzk: 397428 },
];

export const platformBalances = [
  { name: "Trading 212", kind: "Brokerage", valueCzk: 302418, share: 76 },
  { name: "Kraken", kind: "Crypto", valueCzk: 47990, share: 12 },
  { name: "Mintos", kind: "P2P", valueCzk: 32040, share: 8 },
  { name: "Manual", kind: "Cash / other", valueCzk: 14980, share: 4 },
];

export const allocation = [
  { label: "ETF", share: 46, valueCzk: 182817 },
  { label: "Stocks", share: 30, valueCzk: 119228 },
  { label: "Crypto", share: 12, valueCzk: 47990 },
  { label: "P2P", share: 8, valueCzk: 32040 },
  { label: "Cash", share: 4, valueCzk: 15353 },
];

export const recentTransactions = [
  {
    id: "tx-1",
    title: "VWCE",
    account: "Trading 212",
    date: "27. 9. 2026",
    amount: "−1 000 Kč",
    kind: "BUY",
  },
  {
    id: "tx-2",
    title: "AMD",
    account: "Trading 212",
    date: "25. 9. 2026",
    amount: "−500 Kč",
    kind: "BUY",
  },
  {
    id: "tx-3",
    title: "BTC",
    account: "Kraken",
    date: "23. 9. 2026",
    amount: "−600 Kč",
    kind: "BUY",
  },
  {
    id: "tx-4",
    title: "Interest",
    account: "Mintos",
    date: "21. 9. 2026",
    amount: "+84 Kč",
    kind: "INTEREST",
  },
];

export const demoHoldings = [
  {
    symbol: "VWCE",
    name: "Vanguard FTSE All-World UCITS ETF",
    assetClass: "ETF",
    valueCzk: 126540,
    weight: 31.8,
    pnlCzk: 14520,
  },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices",
    assetClass: "Stock",
    valueCzk: 54120,
    weight: 13.6,
    pnlCzk: 8280,
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    assetClass: "Crypto",
    valueCzk: 31950,
    weight: 8.0,
    pnlCzk: 4410,
  },
  {
    symbol: "SOFI",
    name: "SoFi Technologies",
    assetClass: "Stock",
    valueCzk: 18420,
    weight: 4.6,
    pnlCzk: -1380,
  },
];

export const demoAccounts = platformBalances.map((item, index) => ({
  id: `account-${index + 1}`,
  name: item.name,
  type: item.kind,
  valueCzk: item.valueCzk,
  status: item.name === "Manual" ? "Manual" : "Not connected",
}));

export const demoTransactions = [
  ...recentTransactions,
  {
    id: "tx-5",
    title: "Deposit",
    account: "Trading 212",
    date: "18. 9. 2026",
    amount: "+5 000 Kč",
    kind: "DEPOSIT",
  },
  {
    id: "tx-6",
    title: "Dividend",
    account: "Trading 212",
    date: "12. 9. 2026",
    amount: "+128 Kč",
    kind: "DIVIDEND",
  },
];
