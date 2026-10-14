# Portfolio X-Ray — první funkční verze

Samostatná stránka /xray spojuje **přímo držené akcie a kryptoměny** s doloženou ekonomickou expozicí přes ETF.

## Finanční pravidla

- Zdroj skutečných pozic: lokální SQLite FinanceOS, tabulky holdings, assets, accounts. Pro rozlišení stejného podkladu se přebírá ISIN a canonical_key, pokud jsou doložené.
- Analyzovaný základ zahrnuje pouze známé kladné pozice kategorií stock, etf, crypto. Nezahrnuje hotovost, P2P, dluhy ani celkové čisté jmění.
- Celá tržní hodnota každého ETF je v základu **právě jednou**. Podkladové váhy z rozkladu se z této hodnoty oddělí; nerozložený zbytek zůstává viditelný ve jmenovateli.
- Součet rozložené a nerozložené části musí odpovídat celé analyzované hodnotě. Podíly se nikdy nepřepočítají jen mezi identifikované tituly.
- Akcie se slučují přednostně podle ISIN; symbol bez ISIN se napojí na ISIN pouze, pokud je pro daný symbol jednoznačný. Různé třídy akcií s jiným ISIN se neslučují domněnkou. Symboly kryptoměn se slučují v rámci crypto (např. XBT/BTC); akcie se stejným tickerem jako token se neslučují.
- Fondy se přiřazují přednostně podle ISIN, ticker jen pokud to není nejednoznačné.
- Podkladové soubory mohou být neúplné. Nezjištěné podklady se **nikdy** nepředstírají jako známé.
- Typ other uvnitř ETF je považován za nerozloženou část, tedy deriváty, peníze či dluhopisy **nejsou** vydávány za skutečné akcie.
- Pákové / syntetické / swapové produkty se automaticky nepřepočítávají na běžné akcie. Návratnost či notional nemusí odpovídat tržní hodnotě fondu.
- Teoretické ekvivalentní kusy přes ETF jsou odhadovány jen při dostupné přímé referenční ceně **téhož** identifikovaného instrumentu a nikdy se nezaměňují s přímo vlastněnými kusy.

## Import CSV od emitenta

Podporované hlavičky:
- Povinné: fund_symbol, security_symbol, security_name, weight_pct, kind
- Doporučené: fund_isin, security_isin, as_of, source
- kind: stock, crypto, other (běžná synonyma viz importer)
- weight_pct: procento **tržní hodnoty fondu** v rozsahu 0–100 (ne podíl 0–1, ne pákové nominální hodnoty)
- CSV může používat čárku i středník, včetně quoted polí a desetinné čárky u souborů oddělených středníkem.

Import je atomický: žádné tiché vynechání chybných řádků, duplicity jsou odmítnuty, váhy přes 100 % jsou odmítnuty. U aktualizovaného fondu se jeho dřívější importovaná složení nahrazují. Ostatní fondy se při importu dalšího souboru zachovávají.

Zdrojový import se ukládá do **IndexedDB pouze v místním prohlížeči**. Žádná datová migrace SQLite, žádná změna původních pozic, žádná synchronizace API a žádné soukromé exporty v repozitáři.

### Co tento formát není

Předchozí agregovaný soubor portfolio_lookthrough_*.csv **není** seznam podkladů jednotlivých ETF. Jeho součty nelze bez dalšího rozložit zpět na skutečné záznamy podkladů fondu. Do X-Ray proto patří originální tabulky constituent weights od emitenta, nikoli již sečtené výsledky.

## Navazující práce

1. Volitelný import originálních holdings ve formátu emitentů s mapováním sloupců, fondů a snapshotů.
2. Ověřené automatické stažení zveřejňovaného složení podporovaných emitentů, s výslovným datem a zdrojem.
3. Detailní mapy ekonomické expozice derivátů, ETF na kryptoměny a úrokových produktů odděleně od akcií.
4. Historické snapshoty a srovnávání portfolia v různých obdobích.
5. Napojení na simulační engine jako analytický pohled, nikoli falešná historická data.
