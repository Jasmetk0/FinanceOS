# Mintos native statement import

FinanceOS supports the Czech Mintos **Account Statement CSV** format directly.

## Native columns

The importer auto-detects:

- `Date`
- `ID transakce:`
- `Detaily`
- `Obrat`
- `Balance`
- `Měna`
- `Typ platby`

Multiple statement files may be selected at once. FinanceOS orders them by the
first statement date, preserves the row order within each source file, and
deduplicates overlapping exports by Mintos transaction ID.

## Completeness validation

For native statements FinanceOS verifies the wallet balance identity row by row:

`previous Balance + Obrat = next Balance`

If the first row also implies an opening balance of zero, the set is marked as a
complete lifetime statement. A broken balance chain aborts the import instead of
silently producing incorrect history.

If a statement starts after account inception, FinanceOS keeps it as partial and
requires a current-value override unless older files are added.

## Transaction semantics

The current Czech Mintos transaction types are mapped as follows:

- `Vklady` → external deposit
- `Výběr` / `Výběry` → external withdrawal
- `Investice` → internal cash-to-principal transfer
- `Transakce na Sekundárním trhu` → internal principal movement; sign decides purchase vs return/sale
- `Obdržená jistina` → principal return
- `Jistina obdržená při odkupu úvěru` → principal return
- `Převod do investic do dluhopisů` → internal bond principal investment
- `Převod z investic do dluhopisů` → bond principal return
- `Obdržený úrok` → interest
- `Úrok obdržený při odkupu úvěru` → interest
- `Zpožděné výnos z úroku při odkoupení zpět` → interest
- `Obdržené poplatky z prodlení` → interest / compensation
- `Úrok obdržený z plateb ve zpracování` → interest
- `Cashback bonus` → other investment income
- `Srážková daň` → withholding tax
- `Mintos Core fee` → fee
- `Poplatek za neaktivitu` → fee

Unknown future native transaction types are preserved and surfaced in the import
audit instead of being silently treated as a known category.

## Portfolio reconstruction

When the lifetime history is complete FinanceOS reconstructs:

- current wallet cash from the final Mintos `Balance`,
- principal outstanding per ISIN,
- current book-value holdings for active Notes and bonds,
- realized interest / bonus income,
- withholding tax,
- Mintos Core and inactivity fees,
- realized P/L,
- daily historical book value in CZK using historical CNB FX.

The statement's `ISIN` is the stable asset identity. Individual loan IDs remain
in the transaction audit metadata.

The reconstructed Mintos value is a **book-value reconstruction from the account
statement**. If Mintos UI shows a materially different current total because of
provider-specific valuation, pending amounts or another component not represented
by the transaction ledger, the user can provide a current-value override. The
underlying transaction history remains unchanged.

## Re-import behavior

A complete Mintos import atomically replaces the previous Mintos transactions,
holdings, assets and Mintos snapshots. Re-importing newer overlapping statement
files therefore does not accumulate duplicates or stale holdings.

If validation or persistence fails, the old Mintos state remains intact.
