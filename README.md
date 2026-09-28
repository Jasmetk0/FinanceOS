# FinanceOS

Local-first personal finance and investment dashboard.

FinanceOS is designed to combine brokerage, crypto and manually entered cash-flow
into one private local ledger, with a CZK reporting layer and a historical portfolio
timeline.

## Current V1

- Trading 212 read-only connection
- Kraken read-only connection
- encrypted local credential storage
- local SQLite database
- current accounts and holdings
- Trading 212 order/dividend/cash history
- Kraken trade and ledger history
- daily portfolio snapshots
- historical price CSV import per asset
- reconstructed historical priced-position curve from quantities + imported closes
- current and historical-date CZK conversion using CNB fixing
- manual income, gifts, expenses, interest and adjustments
- manual current balances for bank cash, other assets and liabilities
- personal cash-flow dashboard and savings-rate analytics
- generic bank/cash-flow CSV import with transfer-safe classification
- portfolio performance view with simple return and XIRR
- explicit historical coverage view for snapshots and known contributions
- user-defined target allocation and contribution-alignment plan
- deterministic concentration/data-health insights
- Diagnostics dashboard for SQLite integrity, sync freshness, reconciliation, FX coverage and backups
- per-asset position and transaction drill-down pages
- searchable/filterable unified transaction ledger
- investment thesis journal with future review dates
- privacy-safe AI context export and Analyst workspace
- installable PWA metadata and FinanceOS app icon
- Mintos CSV import with flexible column mapping and balance-only updates
- Investown CSV transaction import with project mapping and manual current-balance updates
- JSON data export without API secrets
- Excel-friendly transaction CSV export
- annual cross-provider reports for interest, dividends, sales, purchases, fees and cash transfers
- automatic 15-minute background provider sync
- automatic daily JSON backups with 60-day retention
- merge-safe JSON backup restore
- Windows one-click hidden launcher
- responsive dashboard, investments, transactions, accounts, connections and settings

## Architecture

FinanceOS is intentionally local-first.

- App: Next.js 16 + TypeScript
- Runtime: Node.js 24
- Database: built-in Node SQLite
- Secrets: AES-256-GCM encrypted at rest; on Windows the master key is protected with CurrentUser DPAPI when available
- Data directory: `%LOCALAPPDATA%\FinanceOS` on Windows
- Git repository: contains code only, never runtime finance data or API secrets
- Local web server: bound to `127.0.0.1`

The encryption key and SQLite database live outside the Git repository.

## Windows start

After pulling the version that contains the new launcher, run once:

`INSTALL_DESKTOP_LAUNCHER.cmd`

It creates:

- `FinanceOS` on the Desktop
- `FinanceOS Stop` on the Desktop

The FinanceOS shortcut updates `buuk`, updates npm packages, builds a production
bundle only when the Git revision changes, restarts the local production server,
starts a hidden 15-minute background sync worker, and opens the browser. The background worker continues syncing while the browser is closed
until `FinanceOS Stop` is used or the computer/session stops.

See `docs/DESKTOP_LAUNCHER.md` for details.

## API-key safety

Use read-only API keys.

FinanceOS does not need permission to place orders, cancel orders, add withdrawal
addresses, or withdraw funds.

Never paste live API secrets into GitHub issues, source files, commits, or chat.
Enter them only in the local FinanceOS Connections screen.

## Development

Requirements:

- Node.js 24+
- npm
- Git

Run:

```bash
npm ci
npm run lint
npm run build
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`.

## Historical data

Provider transaction history is backfilled when the provider API exposes it.
FinanceOS begins storing its own daily mark-to-market snapshots from the first
successful sync.

FinanceOS can import daily historical close prices for known assets, convert them
using historical CNB FX rates, and reconstruct a historical curve for priced
positions from transaction quantity changes. This reconstructed curve intentionally
stays separate from actual FinanceOS snapshots because it can exclude historical
cash and any asset without price coverage.

## Data ownership

Settings → Export all data creates a JSON export containing accounts, assets,
holdings, transactions and snapshots. The export intentionally excludes API
credentials and the encryption key.
