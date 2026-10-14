# Portfolio X-Ray: automatická složení ETF

Trading 212 API poskytuje skutečné pozice, ocenění a metadata včetně ISIN. **Neposkytuje kompletní akcie uvnitř ETF**. FinanceOS proto automaticky navazuje na *veřejné oficiální zdroje emitentů*, bez dalšího API klíče a bez CSV uploadu.

## Implementovaná první etapa: iShares UCITS

| ISIN | Fond | Oficiální product ID |
|---|---|---|
| IE00B5BMR087 | Core S&P 500 (SXR8/CSPX) | 253743 |
| IE00B4L5Y983 | Core MSCI World (IWDA/EUNL) | 251882 |
| IE00B6R52259 | MSCI ACWI (SSAC/IUSQ) | 251850 |
| IE00BKM4GZ66 | Core MSCI EM IMI (EIMI/IS3N) | 264659 |

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
- Reálná kompatibilita všech šesti podporovaných fondů byla ověřena na GitHub Actions 14. 10. 2026. Další plán: rozšíření ISIN pokrytí, důvěryhodnější identita podkladů, historie snapshotů a trvalá kontrola přesnosti. VWCE má nadále zastaralé emitentské složení k 31. 8. 2026.

## Oficiální zdroje

- https://www.ishares.com/uk/individual/en/products/253743/ishares-core-s-p-500-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/professionals/en/products/251882/ishares-core-msci-world-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/individual/en/products/251850/ishares-msci-all-country-world-ucits-etf/latest-holdings.csv
- https://www.ishares.com/uk/individual/en/products/264659/ishares-core-msci-em-imi-ucits-etf/latest-holdings.csv

Poznámka: Některé iShares ETF drží jiné ETF (například NDIA, CNYA). Tyto mezifondové pozice jsou úmyslně považovány za nerozložené, dokud nebude implementovaný bezpečný víceúrovňový look-through. Nepočítají se jako přímo vlastněné akcie firem.
