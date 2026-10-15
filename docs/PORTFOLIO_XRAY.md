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


## Originální tabulky emitenta — praktický import

Stránka Portfolio X-Ray nově obsahuje samostatný importér originálních CSV tabulek od emitentů.
Nezaměňovat se standardním X-Ray CSV obsahujícím fund_symbol na každém řádku.

Postup:
1. Vybrat ETF z **aktuálně evidovaných pozic FinanceOS** (včetně jeho ISIN, je-li k dispozici).
2. Ručně zadat **datum, ke kterému pochází skutečné složení emitenta**. Datum nemusí být dnešní.
3. Zvolit jednotku vah — procenta (6.5 = 6.5 %) nebo číselný podíl (0.065 = 6.5 %).
4. Nahrát originální CSV s hlavičkou obsahující Name, Weight (%) a Asset Class, a alespoň Ticker nebo ISIN.
   Importér rozpozná i běžné varianty názvů sloupců, CSV oddělené středníkem, quoted názvy a krátkou faktografickou hlavičku před tabulkou.
5. **Prohlédnout před uložením** počet podkladů a identifikovaný podíl stock/crypto/other. Potvrdit import.

Chybějící nebo neznámý podkladový typ, řádek s chybným počtem sloupců, chybnou vahou, duplicitní podklad nebo celkovou vahou nad 100 % znemožní import celé dávky — soubor nelze částečně nahrát bez upozornění.

Při potvrzení do IndexedDB se nahrazuje pouze složení vybraného ETF. Ostatní fondy zůstanou beze změny.
Jestliže nová tabulka zná ISIN a starší tabulka stejného tickeru jej neznala, starší nejednoznačný ticker-only snapshot se odebere. Cizí fondy s jiným doloženým ISIN se neodstraňují.

**Důležité limity:** Výběr data i fund identity vychází z uživatelského přiřazení; nejde o automaticky ověřený upstream feed. Někteří emitenti používají odlišné nativní formáty, XLSX nebo další nestandardní třídy aktiv — v takovém případě je nutné převést tabulku na standardní X-Ray CSV bez ztráty či zaokrouhlení podkladových záznamů. Kód úmyslně neodvozuje akcie z dříve agregovaného X-Ray reportu.


## Rozlišování konstrukce fondů a duplicitních listingů (15. 10. 2026)

**Jedno ISIN = jeden řádek pokrytí** i když broker vrátí tentýž fond vícekrát (dva účty nebo dvě burzovní kotace). Jejich CZK hodnoty i rozložené/neznámé části se sčítají. Expozice ve výpočtu stále vznikají z jednotlivých reálných pozic, takže nedochází k dvojímu započtení ani ke změně oceňování. Odlišné ISIN se neslučují jen kvůli shodnému tickeru.

Při chybějícím automatickém seznamu podkladů se pro **výslovně ověřené ISIN** zobrazuje popis struktury produktu a přímý oficiální odkaz na emitenta:

| ISIN | Příklad | Ověřená struktura | Zacházení s chybějícími podklady |
|---|---|---|---|
| LU1829221024 | LYMS | Amundi, syntetická Nasdaq-100 replikace swapem | Nesmí zaměnit fyzický náhradní koš se složením indexové expozice |
| IE0032077012 | EQQQ | Invesco, fyzické Nasdaq-100 ETF Dist | Čeká se na úplný emitentský datovaný snapshot |
| IE00BFZXGZ54 | EQAC | Invesco, fyzické Nasdaq-100 ETF Acc | Neodvozuje se automaticky složení jiné třídy ETF |
| IE00B4ND3602 | IGLN | iShares Physical Gold ETC | Zlato, nikoli akcie těžařů |
| JE00BN2CJ301 | WGLD | WisdomTree Core Physical Gold ETC | Fyzicky kryté zlato, nikoli přímé kusy kovu v uživatelském účtu |
| GB00BTWSDN84 | BTC3EUR | Leverage Shares 3x Long Bitcoin ETP | 3× denní expozice přes futures/hotovost, nikoli 3× množství přímo držených BTC |

**Důležité:** Tyto klasifikace samy o sobě nejsou podkladové CSV a **nezvyšují procento pokrytí akcií/kryptoměn**. Neověřené a pákové expozice zůstávají v nerozloženém zbytku, aby seděl jmenovatel portfolia. Pro LYMS je třeba případnou budoucí indexovou expozici označit zvlášť od držeb swapového koše. Tím se snižuje riziko falešné přesnosti.

Oficiální odkazy jsou zapsané v `lib/xray/fund-insights.ts`; vybírají se pouze podle ISIN. Tabulka tak poskytuje informaci, proč fond ještě není rozložený, ale nedomýšlí si podklady.
