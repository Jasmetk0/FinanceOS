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

Realized Investown P&L is calculated from signed `interest` and `income`
transactions minus provider fees. Principal movements, deposits, withdrawals,
secondary-market reservations and their releases are P&L-neutral. In particular,
`Smluvní pokuta` and `Zákonné úroky z prodlení` are compensation paid to the
investor and therefore increase realized profit when their statement amount is
positive.

## Portfolio reconstruction

For a complete statement from account inception, FinanceOS reconstructs:

- current wallet cash from all statement cash movements,
- outstanding principal for every project,
- pending secondary-market reservations,
- total Investown value,
- received investment yield,
- realized Investown profit from investment yield, compensation, referral/other income, net of provider fees,
- active project holdings,
- historical daily Investown account value.

The project URL is used as the stable project identity where available.

A current-value and wallet override remains available for partial statements.
When those fields are left blank, the native statement is treated as the source
of truth.

A native CSV only proves account value and P/L through the newest transaction
contained in that statement. FinanceOS therefore does not create a synthetic
"today" snapshot from older Investown data and does not carry the last statement
valuation forward on the historical chart. If another provider has newer
snapshots, Investown becomes unavailable after its own coverage date instead of
being silently treated as unchanged. Current portfolio profit/XIRR is also withheld
when an Investown statement-derived valuation does not reach the current date.

## Re-import behavior

Investown history is cumulative. A statement only has to be imported once.
Later files are merged with transactions already stored in FinanceOS; overlapping
rows are deduplicated by canonical transaction identity and genuinely new rows are
added. This means a later export may contain the full history, an overlapping
window, or only a newer period.

After merging, FinanceOS atomically rebuilds Investown transactions, projects,
holdings and daily snapshots from the complete known transaction set. The rebuild
also normalizes legacy transaction IDs and reapplies the current transaction
classification without losing older history.

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
