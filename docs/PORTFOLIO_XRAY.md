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


## Syntetické ETF a referenční index – bezpečnost rozkladu (15. 10. 2026)

Fond **LYMS (LU1829221024)** používá swap. Amundi zveřejňuje odděleně:
- **Substitute basket / fund holdings:** fyzický náhradní koš akcií fondu (podklad swapové konstrukce).
- **Index constituents / reference index:** ekonomickou expozici Nasdaq-100 Notional NTR. Ta vysvětluje, na jakých akciích ekonomicky závisí výkon fondu, ale tyto akcie fond nemusel fyzicky nakoupit.

**Nikdy se nesmí automaticky zaměnit jeden seznam za druhý.** Nová ochrana se uplatňuje i na historické a ruční X-Ray/IndexedDB snapshoty. Staré podklady LYMS bez výslovného označení typu zůstanou nerozložené, i kdyby obsahovaly 100 % akcií. Zůstatek portfolia tím není ztracen.

Standardní X-Ray CSV nyní podporuje volitelný sloupec `exposure_basis`:
- `fund-holdings`: běžné fyzické fondové pozice (výchozí význam starších dat).
- `substitute-basket`: fyzický náhradní swapový koš; **není** ekonomická indexová expozice.
- `reference-index`: výslovně deklarovaný referenční index. U LYMS se započte *pouze* úplný, jednotně datovaný indexový seznam nejméně 90 akciových řádků s celkovou vahou alespoň 98 % a nejvýše 100 % (drobná numerická tolerance). Top 10 ani smíšený substitute/index soubor nesmějí projít.

Tento přepínač znamená **deklaraci původu od dodavatele souboru, nikoli kryptografický důkaz vydavatele**. Pro automatické načítání musí server samostatně ověřit původ, přesný benchmark, datum a úplnost. Pro fyzická ETF včetně EQQQ/EQAC se soubory označené `reference-index` **nepoužijí jako skutečné holdings fondu**.

Rozpis akcií v X-Ray u indexově mapované syntetické expozice obsahuje viditelné označení `Referenční index`. Výpočet dál zachovává aktuální hodnotu fondu právě jednou a odlišuje nepřímo ekonomicky exponované akcie od přímo držených kusů. Originální import emitenta pro LYMS nedovolí bez rozlišení nahrát substitute basket jako fyzický rozklad.

**Co není hotové:** není vytvořen nový automatický Invesco ani Amundi/Nasdaq serverový adapter. Oficiální Nasdaq zveřejňuje plný měsíční seznam vah na stránkách indexových politik, ale poslední ověřený PDF snapshot byl k 3. 8. 2026, což není dnešní live složení. Tento commit tyto historické váhy nenahrává jako aktuální a neodvozuje ekonomické expozice z pouhých top 10.


## LYMS – automatický model ekonomické expozice z CNDX (15. 10. 2026)

**LYMS / LU1829221024** je synteticky replikované ETF se swapovým náhradním košem. Prozatím není bezpečně dostupný aktuální bezklíčový export všech přesných vah referenčního indexu **Nasdaq-100 Notional NTR / XNDXNNR**. Nasdaq sice zveřejňuje všechna jména a historický vážený PDF soubor, veřejná verze úplných vah byla při vývoji k **3. 8. 2026**, tedy pro dnešní výpočet příliš stará.

**Automatický užitečný odhad**, který se nedá zaměnit za přesný index:

1. FinanceOS používá skutečný aktuální iShares **CNDX** (IE00B53SZB19, BlackRock product 253741), fyzicky replikující **Nasdaq-100 Index**, ze svého již existujícího oficiálního holdings CSV:
   https://www.ishares.com/uk/individual/en/products/253741/ishares-nasdaq-100-ucits-etf/latest-holdings.csv
2. Kompletní CSV od BlackRock musí obsahovat minimálně **90 akcií** a nejméně **98 % akciových vah** po vyloučení hotovosti/derivátů. Neznámá část LYMS se nepřepočítává na akcie.
3. Data nesmějí být starší **14 dní** ani z budoucnosti. Tento limit se znovu vyhodnocuje **i z cache** ve výpočetním enginu, takže staré proxy pozice se nevydávají za platné. Chybějící nebo poškozený iShares feed nedopočítává žádné domnělé váhy.
4. Podklady se přiřadí ekonomickému LYMS jako `reference-index-proxy`; nikdy se nezamění za `reference-index`, `fund-holdings` ani `substitute-basket`. Každý řádek má explicitní provenienci včetně ISIN CNDX.
5. X-Ray u LYMS a v detailu každé akcie viditelně označuje **ODHAD**, nikoli přesné váhy Nasdaq/Amundi a nikoli přímé vlastnictví akcií. Hodnota LYMS se započte právě jednou. Pokud CSV neobsahuje ověřené ISIN akcií, nelze akcii na základě samotného tickeru bezpečně spojit s přímou pozicí; rozdíl je v přehledu identity.

Dále je možné držet fyzické CNDX ve svém účtu: dostane samostatnou skutečnou expozici, zatímco syntetické LYMS užívá jeho váhy pouze jako **model**. CNDX má vlastní fyzický sklad a malé odchylky indexového trackingu či hotovosti; váhy CNDX nemusí přesně kopírovat XNDXNNR. Tento rozklad není živou expozicí indexu.

Zdroj pro cílový index: [Amundi LYMS](https://www.amundietf.com/amundi/bel/en/instit/LU1829221024).
Zdroj pro proxy: [iShares CNDX](https://www.ishares.com/uk/individual/en/products/253741/ishares-nasdaq-100-ucits-etf).
Vhodný další krok: přidat přímo ověřený plný a současný Nasdaq XNDXNNR endpoint s vyšší prioritou než odhad.


## Výběr správných automatických a ručně nahraných podkladů (15. 10. 2026)

Dříve se jedna lokální ručně importovaná skladba s novějším `asOf` upřednostnila před automatickým zdrojem podle ISIN **bez ohledu na typ ekonomické expozice**. U syntetického `LYMS` mohl nový *substitute swap basket* nebo neúplná tabulka přebít úplný model CNDX. Výpočet X-Ray pak správně odmítl přehodit swapový koš na indexové akcie, ale zbytečně zobrazil nulové pokrytí, přestože byl použitelný automatický model.

Při přítomnosti **dvou konkurenčních snapshotů stejného ISIN** FinanceOS nově vybere nejprve takový, jehož provenience pro daný fond dává ekonomický smysl:
- **LYMS / LU1829221024:** vyžaduje explicitní `reference-index` nebo `reference-index-proxy`, minimálně 90 akcií, minimálně 98 % a jedno správné datum. U modelu proxy zůstává bezpečnostní limit 14 dnů. `fund-holdings`, `substitute-basket`, smíšené a částečné seznamy mají nižší prioritu než platný model.
- **EQQQ a EQAC:** odvozená referenční indexová tabulka se nesmí vydávat za fyzický seznam emitenta ani ho přebít pouze novějším datem.
- **Když jsou oba zdroje použitelné**, stále vítězí novější `asOf`; při shodném datu se u LYMS upřednostní úplný referenční index před přibližným CNDX modelem. Ostatní shody vítězí automatické podklady.
- **Pokud automatický zdroj chybí**, lokální seznam zůstane dostupný a konečný X-Ray engine rozhoduje, zda je bezpečné ho započítat. Nedochází k míchání řádků různých dat a zdrojů v rámci jednoho fondu.

### NCLR / IE0003BJ2JS4

WisdomTree Uranium and Nuclear Energy UCITS ETF je fyzické akciové ETF. Oficiální stránka ve veřejném náhledu zobrazuje top 10 a zbytek portfolia agregovaně. Automatický pokus přes veřejné stránky WisdomTree (IE a GB) na GitHub Actions 15. 10. 2026 vrátil **HTTP 403**. Úplné podklady nejsou tímto ověřeny a **NCLR se v této verzi nestahuje a nerozkládá automaticky**; známá fyzická struktura je uvedena ve vysvětlení zdroje. Samotné jméno uranového ETF neumožňuje odvodit investice do Cameca nebo všech podkladových akcií. Při budoucím získání ověřeného kompletního zdroje lze přidat plný adaptér bez zasahování do účetnictví.
