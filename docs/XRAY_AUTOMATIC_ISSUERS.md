# Portfolio X-Ray: automatická složení ETF

Trading 212 API poskytuje skutečné pozice, ocenění a metadata včetně ISIN. **Neposkytuje kompletní akcie uvnitř ETF**. FinanceOS proto automaticky navazuje na *veřejné oficiální zdroje emitentů*, bez dalšího API klíče a bez CSV uploadu.

## Implementované oficiální zdroje: iShares UCITS

| ISIN | Fond | Oficiální product ID |
|---|---|---|
| IE00B5BMR087 | Core S&P 500 (SXR8/CSPX) | 253743 |
| IE00B4L5Y983 | Core MSCI World (IWDA/EUNL) | 251882 |
| IE00B6R52259 | MSCI ACWI (SSAC/IUSQ) | 251850 |
| IE00BKM4GZ66 | Core MSCI EM IMI (EIMI/IS3N) | 264659 |
| IE00BF4RFH31 | MSCI World Small Cap (WSML) | 296576 |
| IE00B2QWCY14 | S&P SmallCap 600 (IUS3/ISP6) | 251920 |
| IE00BZCQB185 | MSCI India (QDV5/NDIA) | 297617 |
| IE000I8KRLL9 | MSCI Global Semiconductors (SEMI) | 319084 |
| IE00B1XNHC34 | Global Clean Energy Transition (INRG) | 251911 |

Automatický tok při otevření X-Ray:
1. GET /api/xray/auto čte skutečná ETF a jejich ISIN z lokální SQLite.
2. Server vybere odpovídající položky z výslovného whitelistu oficiálních CSV adres emitenta.
3. Stáhne úplný seznam podkladů, kontroluje řádky, datum složení a váhy; vrátí podklady a stav každého ETF.
4. Klient spojí expozice s aktuálními pozicemi z brokera. Při opakovaném otevření data znovu načte; serverová cache trvá 12 hodin. Tlačítko umožňuje vynutit refresh.
5. CSV import zůstává alternativou. Při dvou zdrojích stejného fondu se použije právě jeden snapshot, a to novější. Při stejném datu přednostně automatický.

Výpočet vah iShares preferuje přesné tržní hodnoty uvedené v oficiálním holdings CSV; údaj Weight (%) je zaokrouhlovaný a u malých pozic často uvádí 0.00 %. Pro přepočet se používá součet kladných market values. Významné záporné pozice znamenají odmítnutí zdroje, nikoliv falešný výsledek; nepřeceňuje se notional futures. Nejednoznačné tickery různého podkladu se nesmějí automaticky spojit. Rozklad představuje ekonomickou expozici, nikoli přímé vlastnictví akcií.

## Bezpečnost a omezení

- Bez nových API klíčů a bez předávání Trading 212 credentials vydavatelům ETF.
- Pouze whitelist konkrétních oficiálních iShares URL; žádná URL z uživatelského vstupu, žádný SSRF.
- Oddělená hlášení o nedostupných a nepodporovaných fondech; výpadek emitenta nesmaže jiné podklady.
- Bez změny účetního ledgeru, pozic a transakcí.
- **VWCE (Vanguard) a SPYI (State Street) jsou nyní automaticky podporovány** z veřejných kompletních (nikoliv jen top 10) emitentských zdrojů. Další, dosud nepodporovaná ETF zůstanou nerozložená. Ani Trading 212 API klíč neumí nahradit nezveřejněné podklady třetích stran.
- Reálná kompatibilita původních šesti podporovaných fondů byla ověřena na GitHub Actions 14. 10. 2026. Tři nově přidané iShares produkty byly ověřeny vůči originálním CSV od emitenta 15. 10. 2026; pravidelný síťový canary následně hlídá všech jedenáct zdrojů. Nové SEMI a INRG endpointy je nutné ověřit síťovým canary na finální větvi. Další plán: rozšíření ISIN pokrytí, důvěryhodnější identita podkladů, historie snapshotů a trvalá kontrola přesnosti. VWCE má nadále zastaralé emitentské složení k 31. 8. 2026.

## Oficiální zdroje

- https://www.ishares.com/uk/individual/en/products/253743/ishares-core-s-p-500-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/professionals/en/products/251882/ishares-core-msci-world-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/individual/en/products/251850/ishares-msci-all-country-world-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/individual/en/products/264659/ishares-core-msci-em-imi-ucits-etf/latest-holdings.csv

Poznámka: Některé iShares ETF drží jiné ETF (například NDIA, CNYA). Tyto mezifondové pozice jsou úmyslně považovány za nerozložené, dokud nebude implementovaný bezpečný víceúrovňový look-through. Nepočítají se jako přímo vlastněné akcie firem.

- https://www.ishares.com/uk/individual/en/products/296576/ishares-msci-world-small-cap-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/individual/en/products/251920/ishares-s-p-smallcap-600-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/individual/en/products/297617/ishares-msci-india-ucits-etf/latest-holdings.csv

- https://www.ishares.com/uk/individual/en/products/319084/ishares-msci-global-semiconductors-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/individual/en/products/251911/ishares-global-clean-energy-ucits-etf/latest-holdings.csv

**INRG:** Emitent uvádí, že část expozice může být realizována přes CFD. X-Ray proto ukazuje ekonomické podklady podle zveřejněné expozice a nikoliv počet fyzicky vlastněných akcií. Pokud emitentský soubor obsahuje významné záporné pozice, parser celý rozklad odmítne místo zamlčení rizika.


## iShares CNDX + LYMS – oddělený proxy model (15. 10. 2026)

Nový iShares oficiální feed: `IE00B53SZB19`, Nasdaq 100 (CNDX/SXRV), product ID `253741`, https://www.ishares.com/uk/individual/en/products/253741/ishares-nasdaq-100-ucits-etf/latest-holdings.csv.

Když je držen **syntetický Amundi LYMS (LU1829221024)**, lze ze stejného veřejného úplného CNDX zdroje vytvořit **výslovně modelovaný ekonomický proxy rozklad**, označený `reference-index-proxy`. Nejmladší povolené stáří je 14 dní, minimální rozsah 90 akcií a součet jejich vah alespoň 98 %. Nejde o přesné složení indexu XNDXNNR, o žádné skutečně držené akcie v LYMS, ani o náhradní swapový koš. Nenahrazuje oficiální benchmarkové váhy, které by mohly být odlišné.

BlackRock CNDX je samostatný desátý iShares feed a jeho fyzické držby se v X-Ray nikdy nemísí s fondem Amundi. Žádný další API klíč ani CSV uživatele.


### Živě ověřené napojení CNDX

Na GitHub Actions 15. 10. 2026 (Windows, Node 24) se spustil **stejný produkční iShares parser** s přímým HTTPS stažením skutečného souboru product 253741. Výsledek: **106 položek, z toho 101 kladných akciových podkladů**, datum `2026-10-14`, po vyloučení neakciových pozic ekonomický podíl akcií **99,9539055 %**. Model prošel validačními limity bez klíče či uživatelských dat. To ověřuje dostupnost v době testu, nikoli nepřetržitou budoucí dostupnost. Další hlídání zdroje dělá existující veřejný iShares canary, který automaticky iteruje všechny položky whitelistu.

**Diagnostika:** původní pevný limit 6 zdrojů je odstraněn. Po spojení obou změn se kontroluje všech 14 zdrojů dynamicky, včetně CNDX jako zvláštního proxy vstupu a obou nezávislých archivů Invesco.


## Úplné archivované Invesco podklady EQQQ / EQAC (15. 10. 2026)

Doplněné veřejné, **bezklíčové** zdroje:

| ISIN | Fond | Složení | Transport |
|---|---|---|---|
| IE0032077012 | EQQQ Dist | Měsíční snapshot fyzických podkladů | [Rebalix archiv](https://rebalix.com/en/etf/IE0032077012) |
| IE00BFZXGZ54 | EQAC Acc | Měsíční snapshot fyzických podkladů | [Rebalix archiv](https://rebalix.com/en/etf/IE00BFZXGZ54) |

**Důležité:** Rebalix není Invesco. Jde o nezávislý veřejný archiv údajů deklarovaných emitentem, nikoliv o přímé živé napojení na emitenta, a nelze nezávisle prokázat úplnost emitentem. Stav je vždy označen jako archiv a datem `asOf` uvedeným přímo v popisu zveřejněného souboru, nikoliv datem stažení. Při ověření 15. 10. 2026 uváděly oba dokumenty složení k **1. 10. 2026** (102 řádků).

Server využívá fixní allowlist dvojic ISIN a veřejný XLSX odkaz; čte kompletní zveřejněnou tabulku na listu 1, kontroluje datum příslušné stránky, 90+ akcií, přesné ISIN, nominální procentní váhy, součet 98–100 %, a explicitně odděluje řádek `Cash and/or Derivatives`. Žádné top 10 vydávané za celé portfolio, žádné zaměňování EQQQ a EQAC a žádné normalizování neúplného zdroje na 100 %. Selhání archivu neovlivní přímé emitentské zdroje. Stav diagnostiky uvádí zastarání; 12h server cache neopravňuje označit data za dnešní.

Stránky: https://rebalix.com/en/etf/IE0032077012, https://rebalix.com/en/etf/IE00BFZXGZ54
Souborová URL: https://rebalix.com/api/etf/composizione?isin=IE0032077012&lang=en a analogicky pro `IE00BFZXGZ54`.

Zůstává otevřené: přímé denní API Invesca pro originální držby, které se nepodařilo bezpečně ověřit. Pokud takový zdroj bude k dispozici, má být upřednostněn před archivem se starším datem.
