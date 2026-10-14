# Portfolio X-Ray — automatický State Street SPYI

## Nová podpora

Fond **State Street SPDR MSCI All Country World Investable Market UCITS ETF (Acc)** — ISIN IE00B3YLTY66, tickery SPYI / IMIE / IMID — má oficiální veřejný soubor úplných denních podkladových pozic:

https://www.ssga.com/library-content/products/fund-data/etfs/emea/holdings-daily-emea-en-spyi-gy.xlsx

Oficiální stránka:
https://www.ssga.com/de/en_gb/institutional/etfs/state-street-spdr-msci-all-country-world-investable-market-ucits-etf-acc-spyi-gy

Při otevření /xray automatické lokální API identifikuje ETF s tímto ISIN, stáhne XLSX a validuje podkladové pozice. **Bez CSV uploadu a bez dalšího API klíče.**

## Bezpečnost a přesnost

- Konkrétní whitelistovaný veřejný URL, nikoli URL z požadavku uživatele. Nikdy se neodesílají credentials od brokera.
- Extrakce XLSX používá OOXML/ZIP čtečku s limity velikostí a počtu souborů, kontrolou struktury a odmítáním neznámého formátu. Nic nespouští, neinterpretuje vzorce.
- Identita akcií se přebírá z originálního ISIN. Oproti pouhému tickeru lze spolehlivěji sloučit přímé pozice stejné akciové třídy.
- Zdroj musí mít identifikovatelné datum snapshotu a sloupce Security Name, ISIN a Percent of Fund. Podezřele nízký nebo vysoký součet vah, záporné **akciové** váhy a poškozené řádky zastaví výpočet. Velmi malé záporné FX/peněžní pozice se započtou pouze vůči neakciové složce; významné záporné expozice se odmítnou.
- Duplicitní řádky se stejným ISIN se sčítají pouze při shodné identitě.
- Hotovost, ETF uvnitř ETF a neakciová aktiva zůstávají jako nezmapovaná expozice, nejsou falešně vydána za akcie.
- Při změně formátu/selhání State Street zůstává SPYI nerozložené nebo se použije platná ruční záloha. Ostatní ETF fungují dál.
- Uložení cache úspěšného oficiálního zdroje je 12 hodin.

## Ověření

Regresní testy obsahují syntetické ZIP/XLSX se skutečnou OOXML strukturou a prověřují datum, procenta, agregaci, ISIN a zachování celkové hodnoty portfolia.

**Živý test produkčního parseru proti skutečnému XLSX prošel 14. 10. 2026 na GitHub Actions:** soubor měl 6 044 tabulkových řádků a parser bezpečně vytvořil 5 964 expozic. Test kontroloval datum 13-Oct-2026, exponentové váhy, řádky „Unassigned“ s procentem „-“ a koncový právní text. [Ověření](https://github.com/Jasmetk0/FinanceOS/actions/runs/38634828284). Dostupnost z lokálního počítače se může lišit.

## Další práce

Pro VWCE je implementován úplný stránkovaný GraphQL zdroj a denní veřejný canary test. Podrobnosti: [XRAY_LIVE_ISSUER_CANARY.md](XRAY_LIVE_ISSUER_CANARY.md).
