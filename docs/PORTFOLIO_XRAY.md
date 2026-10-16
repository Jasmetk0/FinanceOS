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


## Ochrana úplného rozkladu před novějším částečným CSV (15. 10. 2026)

Při výběru automatického a ručního seznamu **stejného ISIN fondu** FinanceOS nyní zohledňuje vedle data také datovou konzistenci a rozsah **pokrytí zveřejněných vah**. Nově importovaný „top 10“ soubor s pouhými 60–80 % pozic už nemůže pouze novějším datem nahradit 99% kompletní automatický rozklad. Stejně tak nemůže pouhý souhrnný řádek `OTHER` zakrýt 40 % neidentifikovaných akcií a snížit přesnost podkladových expozic, když jsou dostupné podrobnější data.

Pravidla fungují **jen při porovnávání dvou kandidátních souborů stejného ISIN**:
- Kandidát s jedním platným kalendářním datem, jedním původem a součtem vah přibližně **95–100 %** je z hlediska publikovaného součtu pokrytější než soubor s menším součtem. Nejde o kryptografický důkaz pravosti všech jeho jednotlivých položek.
- Jestliže jeden seznam obsahuje přes **95 % akciové/krypto expozice** a druhý pod **90 %**, má přednost lépe identifikovaná skladba (i kdyby součet druhého dosáhl 100 % přes `OTHER`).
- U rozsáhlého akciového fondu s minimálně **40 kladnými položkami** považujeme seznam s méně než **čtvrtinou** počtu řádků za podezřele zkrácený, pokud nevykazuje výrazně vyšší ekonomické pokrytí. Chrání i soubor, který chybně přepočítal prvních 10 akcií na 100 %.
- Jestliže jsou oba zdroje věrohodně stejně rozsáhlé, **platí dosavadní priorita novějšího data** a pravidla pro syntetický LYMS (skutečný index proti proxy).
- Neúplný ruční CSV **lze dál použít**, pokud pro fond není jiný zdroj. Chybějící hodnota zůstane jako `unallocated`, nikdy se nedopočítává smyšlenými pozicemi.
- Smíchané datumy nebo provenience v jednom fondu už nemohou vytlačit soudržný automatický snapshot. API klíče, transakce ani stav účtů se tím nemění.

Automatický zdroj v FinanceOS může být přímý emitentský soubor nebo výslovně označený archiv třetí strany (např. Invesco / Rebalix); tato arbitráž **nezaručuje nezávislé ověření jeho autenticity**, pouze brání ztrátě použitelných rozkladů při kolizi s očividně částečnými podklady.


## Audit výběru skutečného zdroje podkladů pro jednotlivé ETF (15. 10. 2026)

V **Portfolio X-Ray → Audit zdrojů rozkladu ETF** je u každého aktuálně drženého fondu (ISIN agregovaný napříč burzami/účty) nově možné rozbalit podrobnosti skutečného výběru mezi ručním a automatickým zdrojem. Jde o **stejnou rozhodovací větev** jako ve funkci `combineConstituentSources` – `explainConstituentSources` vrací zároveň vybrané podklady a přesnou příčinu jejich výběru. UI tak nepředstírá, že rozhodnutí zrekonstruovalo až dodatečně podle načteného souboru.

Zobrazuje pro oba kandidáty, jsou-li dostupní: datum `asOf`, původ `source`, typ expozice, počet pozic, sumu publikovaných vah a procento identifikovaných akciových/kryptoměnových aktiv. Výslovně rozlišuje novější podklady, úplnější akciové pozice, neplatnou provenienci/data, přednost úplného referenčního indexu před CNDX proxy, fallback obou odmítnutých podkladů a samostatnou identifikační referenci. Přehled u každého fondu zároveň ukazuje **skutečně výpočtem přijatou hodnotu rozloženou a nerozloženou v Kč**. Pokud byl zvolený soubor následně odmítnut enginem (např. syntetický swapový koš), je vidět upozornění místo tvrzení, že fond byl rozložen.

Automatický zdroj může být i starší cache; datum složení se zobrazí bez garance denního live stavu. Externí archiv Invesco zůstává archivem třetí strany, nikoli oficiálním přímým feedem. Model `reference-index-proxy` je výslovně označen **ODHAD**. Nezávislá reference `SPYI (identita)`, pokud ji nevlastníš, se do seznamu držených ETF ani do jejich Kč **nezapočítává**.

Tento audit nemění broker transakce, přímé držby, kurzové ocenění ani výběr fondu; zavádí přezkoumatelné vysvětlení téhož výběru. Při chybě porovnání je zobrazeno varování a stávající bezpečná ruční záloha, nikoli falešné tvrzení o úspěšném výběru zdroje.


## Koncentrace portfolia – bez odhadů a včetně ekonomické proxy (16. 10. 2026)

Pod souhrnem X-Ray se zobrazuje samostatný **přehled koncentrace akcií a kryptoměn napříč ETF**, vypočítaný pouze z existujícího `calculateXRay` výsledku. Sloučená expozice akcie může obsahovat přímou pozici plus více fondů, ale ani jedna tržní hodnota ETF se znovu nepřidává k jmenovateli. Přímá kryptoměna zůstává oddělená od akcie se stejným tickerem, nerozpoznané akcie stejného tickeru se nikdy nespojují bez ověřeného identifikátoru.

- **Bez odhadů** (výchozí): od každé podkladové expozice odečte pouze explicitní podíl `reference-index-proxy` z LYMS/CNDX. Ostatní již identifikované podklady zůstávají včetně případného explicitního referenčního indexu; tento režim **neznamená plně doložená ISIN ani čerstvá data**.
- **Včetně proxy:** do jednotlivých akciových expozic přidá *již vykázané*, jasně označené modelované podíly LYMS. Nevytváří nové pozice ani nepřičítá odhad k fyzicky drženému ETF nad jeho tržní hodnotu.
- **Nerozloženo:** fondy bez úplné skladby, hotovost uvnitř ETF a jiné neidentifikované podklady zůstávají ve zvláštní části. Jsou stále v celkovém jmenovateli a **nepředstírají diverzifikaci**.
- **TOP 1/5/10** uvádí podíly největších individuálně identifikovaných expozic v Kč a % *z celého analyzovaného portfolia* (akcie + ETF + crypto). Nesčítá procenta přepočtená pouze k částečně rozloženému výřezu.
- Rozpis 10 největších podkladů uvádí přímo, nepřímo, tržní hodnotu a váhu; při zapnutí modelu upozorňuje na jeho částku v jednotlivých akciích. Podklady bez ověřené identity jsou označené jako neslučované podle tickeru.

Nový čistě odvozený modul `lib/xray/concentration.ts` kontroluje součtové invariance:
`identifikované bez proxy + modelová proxy + nerozložená část = denominatorCzk`.
Ověřuje také `součet podkladových expozic = mappedCzk` a `součet označených proxy příspěvků = estimatedProxyCzk`. Při nesouladu zobrazí X-Ray samostatné upozornění a zavádějící přehled koncentrace **nevyrenderuje**. Nemění broker API ani obchodní historii.

**Interpretace:** Koncentrace je *dolní přehled pozorovaných expozic* u částečně známého portfolia, nikoli úplný risk model, HHI, volatilita, VaR ani exaktní dolní mez skutečné koncentrace. Nerozložená část ETF může obsahovat stejné velké akcie a skutečná koncentrace tak může být vyšší. Odhadovaný model může měnit pořadí; žádné predikce výnosu ani pravděpodobnosti ztrát se z něj nedělají.


## Párové překryvy ETF podle skutečně doložených podkladů (16. 10. 2026)

V novém panelu **Překryvy mezi jednotlivými ETF** si můžeš prohlédnout dvojice skutečně vlastněných fondů s doloženým ISIN a jejich **společné akciové třídy**. Výpočet vychází výhradně ze stejného `calculateXRay` výsledku jako přehled skutečných expozic: nic dalšího nestahuje, neslučuje tickery podle jména, nepočítá druhý portfolio NAV ani nehádá neznámé podklady.

**Metodika a dva různé významy procent:**
- Akcie se považuje za prokazatelně shodnou pouze při identickém `stock|isin:<ISIN>` nebo identickém kontrolovaném `stock|sedol:<SEDOL>`. ISIN identita má přednost před SEDOL; dva různé ISIN se nikdy nepropojí jen podle tickeru. SEDOL bez ISIN představuje méně univerzální burzovní identifikátor a ve výsledcích je odlišně označený.
- **Průnik vah dvojice ETF** = `SUMA( MIN(příspěvek společné akcie z ETF A / tržní hodnota ETF A, příspěvek z ETF B / tržní hodnota ETF B) ) × 100`. Například akcie s 10 % v A a 20 % v B tvoří 10 procentních bodů společného podílu jejich fondových složení. **Není to procento celého portfolia ani korelace ETF.** Vždy se používá NAV všech vlastněných burzovních variant jednoho ISIN.
- **Expozice v obou ETF dohromady (Kč)** = `SUMA(příspěvek akcie z A + příspěvek z B)` pouze přes doložené společné akcie. Nejde o účetní duplicitu ani částku k odečtení od investovaného kapitálu. Jsou to dvě platné nepřímé ekonomické expozice ke stejné akcii.
- Pro každý fond se ukazuje, jak velkou část jeho NAV vůbec pokrývají **pro srovnání použitelné ISIN/SEDOL identity**. Nerozložené, ticker-only, neznámé pozice, hotovost uvnitř ETF a příspěvky bez průkazné identity se nepoužijí. Pokud vyjde 0 % společných pozic, nelze z toho bez úplných podkladů usuzovat na skutečné nulové překrytí.
- **Bez odhadu** (výchozí režim) vyřadí z porovnání konkrétních akcií část označenou `reference-index-proxy` pro LYMS; **Včetně LYMS proxy** ji zahrne s výslovným označením aproximace. Tento přepínač nijak nemění pozice, ceny ani NAV.
- ETF bez ISIN fondu se do dvojic nespojují. U ostatních se fondy hodnotí nezávisle; při nákupu stejného ETF na více účtech a burzách se sčítá NAV a příspěvky jsou přiřazené správnému jedinému ISIN fondu.

Konzervace a integrita: součet přímých a fondových expozic musí odpovídat `mappedCzk`, všechna `mappedCzk + unallocatedCzk` musí odpovídat `denominatorCzk` a součty podkladových příspěvků každého ETF musí odpovídat přijatému rozkladu tohoto ETF. Při nesouladu se párový audit nevykreslí a zobrazí upozornění. Přehled nepředstavuje plný risk model ani statistickou korelaci; jeho omezení je úplnost a stáří emitentských snapshotů.


## Sektorový X-Ray – klasifikace přímo z emitentských podkladů (16. 10. 2026)

Panel **Sektory akcií – doložené emitenty** používá pouze skutečně publikované sektorové štítky z úplných vybraných skladbových souborů **iShares (sloupec `Sector`)** a **State Street SPYI (sloupec `Sector Classification`)**. Tyto informace byly ve zdrojových dokumentech už obsažené, ale FinanceOS je dříve nezachovával. Normalizují se výhradně přesným rozpoznáním jedenácti standardních názvů akciových sektorů GICS. Neznámé názvy, obecné `Technology`, alternativní průmyslové klasifikace, hotovost, deriváty a `Unassigned` se **neodhaduji** a zůstávají bez sektoru.

**Podklad v Kč se klasifikuje pouze tehdy, pokud jsou současně splněny všechny podmínky:**
- Jde o akcii se sektorovým štítkem přímo z jejího emitentského řádku, nikoliv z názvu/tickeru společnosti.
- Skutečně držené ETF v X-Ray bylo úspěšně rozloženo ze **stejného data `asOf` a stejné provenience `source`**. Starý CSV či nerelevantní současně uložená reference žádné sektory nepřidává.
- Fond má fyzické `fund-holdings` podklady. Explicitní referenční index, jeho odhadová proxy LYMS/CNDX a náhradní swapový koš se tímto algoritmem neoznačují jako sektorově ověřené pozice.
- Součet klasifikovaných akcií konkrétního fondu nesmí přesáhnout finanční částku fondu, kterou X-Ray skutečně rozložil.

**Přímo držená akcie** získá sektor pouze při úplné shodě svého již validovaného `stock|isin:` s emitentským security ISIN v některém **skutečně používaném, fyzicky drženém, sektorově klasifikovaném ETF**. Při konfliktu sektorů z různých emitentů zůstává přímá expozice bez klasifikace. iShares bez podkladového ISIN tak může klasifikovat svůj vlastní podíl, ale nesmí doplnit sektor přímo držené akcii jen podle tickeru.

**Jmenovatele a kontrola správnosti:** Procenta sektorů se vždy počítají z plného `denominatorCzk` X-Ray (přímo držené akcie + skutečná hodnota ETF + krypto), ne ze 100 % *již klasifikovaných* akcií. Platí striktní rovnice:

`klasifikované akcie přímo + klasifikované podklady ETF + neklasifikované přímé + neklasifikované ETF = plná analyzovaná hodnota`.

Panel ukazuje zvlášť neklasifikované přímé investice a neklasifikovanou část ETF, včetně úplně chybějících skladbových dat Vanguardu. Samostatně ukazuje **LYMS modelovou proxy jako část neklasifikovaného ETF NAV**, nikdy jako další nové peníze. Krypto nemá automaticky přiřazovaný akciový sektor. Při nesouhlasu jakékoli validační rovnice se panel nevykreslí a zobrazí chybu.

**Co tato verze neslibuje:** Jde o částečné pokrytí pro dva konkrétní emitenty, nikoliv o úplnou sektorovou analýzu všech fondů. Neprovádí se žádné párování více akciových tříd stejné společnosti podle jména, geografické přiřazení, odhad sektoru Vanguardu ani domnělé změny investorových akcií. Žádný nový API klíč, CSV import ani nový kurzový přepočet není potřeba. Všechny součty jsou odvozené ze stejného lokálního X-Ray reportu.


## Přenos doloženého sektoru podle přesného ISIN do Vanguardu (16. 10. 2026)

Původní sektorový X-Ray uměl sektor akcie načíst jen přímo z emitentského souboru iShares nebo SPYI. Vanguard GPX zveřejňuje bezpečný SEDOL, ale nemá samotný GICS sektor. Díky existujícímu ověřenému `SEDOL ↔ ISIN` převodu z oficiálního State Street SPYI lze dnes **část skutečně držených Vanguard akciových příspěvků označit sektorem z jiného, aktuálně vlastněného a fyzického emitentského ETF**, pokud mají **zcela stejný podkladový ISIN**.

Převod nepoužívá ticker, podobnost názvu, firmu jako celek ani zeměpis. Zdroj sektoru musí být **skutečně vlastněné ETF**, již použité v `calculateXRay`, s jasným oficiálním `source` a stejným `asOf` jako použitá skladba. Pouze referenční SPYI stažené kvůli identitě, které uživatel nevlastní, nesmí navíc sloužit jako sektorový důkaz. Neprověřené ruční CSV ani proxy LYMS/CNDX klasifikaci neposkytují. Při dvou různých emitentských sektorech pro stejný ISIN se převod vypne a případný přímý podíl akcie zůstane neklasifikovaný.

Vypočtené Kč jsou **již existující jednotlivé příspěvky vlastněného ETF** ve `XRayExposure.fundContributions`; žádné finanční aktivum se nepřidává ani neoceňuje znovu. Sektorový audit hlídá konzistenci klasifikovaného NAV s `mappedCzk` a zbytek ETF včetně neidentifikovaných pozic ponechává jako neklasifikovaný. V dashboardu zůstává zásadní, že pokud žádné fyzicky vlastněné ETF nesdílí ověřený ISIN a sektor, Vanguard **není** sektorově klasifikován. Průnik sektorů je vždy jen aktuálně doložený výřez portfolia.


## Audit původu sektorové klasifikace (16. 10. 2026)

Panel sektorů rozlišuje **tři neslučované části**: přímé investice s ověřeným ISIN, ETF příspěvky klasifikované podle vlastního oficiálního sektorového sloupce a ETF příspěvky se sektorem přeneseným přes identický prokázaný ISIN ze skutečně drženého jiného fyzického fondu. V rozbalovacím detailu lze ověřit původ v jednotlivých sektorech i fondech. Označení „přes ISIN“ není důkazem nové investice ani novou skladbou emitenta.

Pro každý sektor platí `přes ETF = sektor přímo z emitenta + sektor převzatý přes ISIN`. Součty obou kategorií musejí sedět po sektorech, fondech i v celém reportu; výsledná klasifikace a neznámý zbytek musí dát celé NAV portfolia. Fond s nulovou skutečně rozloženou hodnotou **nesmí poskytovat klasifikační důkaz** přes pouhou existenci stejně datovaného zdrojového řádku. Zcela neověřené pozice a modelový LYMS zůstávají neklasifikované. Žádná část nezapisuje transakce, ceny nebo externí vklady.


## Řazení nedostatků podkladů podle hodnoty investic (16. 10. 2026)

Sekce **Priority dokončení rozkladu ETF** nevymýšlí další ETF podklady ani nové kurzy. Přebírá souhrn fondu z aktuálního výpočtu X-Ray a řadí konkrétní nedostatky podle Kč; používá už sloučený fondový ISIN, takže více listingů téhož ETF není nová pozice.

- **Bez rozkladu:** dosud neidentifikovaná celá hodnota ETF. Neznamená to, že každá koruna musí představovat akcii.
- **Částečný rozklad:** neidentifikovaná zbývající část, která může obsahovat peníze, dluhopisy či deriváty, ne automaticky chybějící akcie.
- **Model indexu (LYMS):** i když model CNDX zvyšuje podíl mapovaných podkladů, celé NAV modelovaného fondu je označeno pro ověření přesných vah indexu. Model se nikdy nepovažuje za další investici.
- **Deklarovaný referenční index:** ekonomické podkladové váhy, nikoli fyzicky vlastněné akcie ve swapovém fondu.
- **Známý neakciový produkt:** ověřený fyzický zlatý ETC nebo pákový krypto ETP se neřadí do akciového backlogu; předpoklad spot BTC či konkrétních akcií je chybný.
- **Rozloženo:** fond bez významného nerozloženého zbytku, ale stále se může lišit datum tržního ocenění a datum holdings.

Panel nabízí filtr a odkazy na existující automatickou synchronizaci a volitelný ruční import originálních emitentských podkladů. Tím se neslibuje existence automatického zdroje pro každý ISIN; broker API klíč nadále stačí pro skutečné pozice a dostupné zdroje, CSV zůstává dobrovolnou zálohou.

**Finanční invariance:** součet NAV všech ETF odpovídá fondu X-Ray; mapované ETF + přímé akcie/krypto se rovná celkovému mapování; nerozložené ETF se rovná celkovému nerozloženému NAV; modelované podklady musí sedět na označený model X-Ray. Priorita je pracovní částka, která se může překrývat s mapovanými i nerozloženými hodnotami, a nikdy se k portfoliu nesčítá. Při rozporu se žebříček nezobrazí.
