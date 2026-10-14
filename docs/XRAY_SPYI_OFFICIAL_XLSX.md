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
- Zdroj musí mít identifikovatelné datum snapshotu a sloupce Security Name, ISIN a Percent of Fund. Podezřele nízký nebo vysoký součet vah, záporné podkladové váhy a poškozené řádky zastaví výpočet.
- Duplicitní řádky se stejným ISIN se sčítají pouze při shodné identitě.
- Hotovost, ETF uvnitř ETF a neakciová aktiva zůstávají jako nezmapovaná expozice, nejsou falešně vydána za akcie.
- Při změně formátu/selhání State Street zůstává SPYI nerozložené nebo se použije platná ruční záloha. Ostatní ETF fungují dál.
- Uložení cache úspěšného oficiálního zdroje je 12 hodin.

## Ověření

Regresní testy obsahují syntetické ZIP/XLSX se skutečnou OOXML strukturou a prověřují datum, procenta, agregaci, ISIN a zachování celkové hodnoty portfolia.

**Ještě není ověřená kompatibilita se skutečnými bajty aktuálního SPYI XLSX** v běžícím FinanceOS — vývojové prostředí nemá přístup ke stažení. Při jiné skutečné struktuře parser odmítne soubor, nikoliv že by rozklad tiše vymyslel.

## Další práce

VWCE od Vanguard má veřejně uvedené portfolio včetně tisíců titulů, ale zatím nemáme prověřený kompletní strojově čitelný export. Navazující práce: ověření skutečného SPYI XLSX a automatický Vanguard holdings feed bez degradace na top 10.
