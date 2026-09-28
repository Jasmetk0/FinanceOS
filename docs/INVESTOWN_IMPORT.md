# Investown import

FinanceOS supports the native Czech CSV history exported by Investown.

## Native columns

The importer auto-detects this schema:

- `Datum`
- `Časová zóna`
- `Typ`
- `Detail`
- `Částka [CZK]`
- `Úvěr`
- `Název projektu`
- `Odkaz na projekt`
- `Typ projektu`

The original row metadata is retained in the local transaction `raw_json`.
Nothing from the uploaded statement is sent to an external FinanceOS service.

## Transaction semantics

FinanceOS explicitly understands the transaction types present in the current
Investown export format:

- `Vklad peněz` → external deposit
- `Výběr peněz` → external withdrawal
- `Výnos` → investment interest
- `Částečný výnos` → investment interest
- `Bonusový výnos` → investment interest
- `Smluvní pokuta` → investment interest / compensation
- `Zákonné úroky z prodlení` → investment interest / compensation
- `Odměna` → other income
- `Investice` → internal wallet-to-project principal transfer
- `Autoinvestice` → internal wallet-to-project principal transfer
- `Splacení jistiny` → internal project-to-wallet principal return
- `Částečné splacení jistiny` → internal project-to-wallet principal return
- `Odstoupení` → internal project-to-wallet principal return
- `Nabídka ke koupi` → internal wallet reservation for a secondary-market offer
- `Vrácení nabídky` → release of that reservation

Unknown future Investown transaction types are preserved, classified as an
adjustment, and surfaced by the importer and Diagnostics instead of being silently
misclassified.

## Portfolio reconstruction

For a complete statement from account inception, FinanceOS reconstructs:

- current wallet cash from all statement cash movements,
- outstanding principal for every project,
- pending secondary-market reservations,
- total Investown value,
- received investment yield,
- active project holdings,
- historical daily Investown account value.

The project URL is used as the stable project identity where available.

A current-value and wallet override remains available for partial statements.
When those fields are left blank, the native statement is treated as the source
of truth.

## Re-import behavior

A new complete Investown statement replaces the previous Investown statement in
one SQLite transaction and rebuilds transactions, projects, holdings and Investown
snapshots. This prevents duplicate or stale rows.

If an import fails, the previous complete Investown state remains intact.

## Where the data appears

Imported Investown data participates in:

- Dashboard net worth and allocation
- Investments and project drill-down
- Transactions
- Performance / XIRR
- History
- Reports
- Diagnostics
- backup / restore
- privacy-safe AI context

The importer does not require an Investown password, session cookie or private API.
