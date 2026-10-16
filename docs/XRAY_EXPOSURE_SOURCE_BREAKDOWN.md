# Portfolio X-Ray — přesný rozpis každé akcie podle ETF a účtů

## Proč tato změna

Dosavadní tabulka X-Ray ukazovala u akcie sloupce „Přímo“ a „Přes fondy“ a případný seznam názvů ETF. Z tohoto seznamu ale nebylo možné zjistit, **kolik Kč jednotlivý fond nebo investiční účet reálně přispívá** do vykazované expozice. To komplikovalo kontrolu skutečné koncentrace portfolia a případných nesrovnalostí po broker API sync.

## Nově ve výpočtu

Pro každou identitu akcie/kryptoměny vedle původních částek vzniká:

- `directContributions`: přímá hodnota v Kč a počet přímo držených kusů, seskupené podle konkrétního pojmenovaného poskytovatele a jeho účtu.
- `fundContributions`: nepřímá hodnota v Kč podle jednotlivých ETF. Fondy se stejným skutečným ISIN se sloučí do jedné příspěvkové skupiny i tehdy, když mají burzovní varianty VWCE/VWRA. Fondy s různými ISIN se **nikdy nesloučí jen podle tickeru**.
- Pro každý výsledný cenný papír výpočet ověří dvě invariance:
  - součet `directContributions.valueCzk` == `directCzk`,
  - součet `fundContributions.valueCzk` == `viaFundsCzk`.
- Původní pravidla ISIN/SEDOL, kvality podkladů a účetní invarianta `mappedCzk + unallocatedCzk = denominatorCzk` platí beze změny. V případě nesouhlasu se raději vrátí chyba než falešné číslo.

## Nová podoba interakce

Po kliknutí na akcii se přímo pod jejím řádkem rozbalí detail přes celou šířku tabulky:

1. Kolik činí přímá a nepřímá expozice v Kč a jaký je jejich podíl z **této konkrétní akcie**.
2. Přehled investičních účtů, částek a skutečně přímo držených kusů.
3. Přehled jednotlivých ETF, jejich ISIN a přesné částky připadající na danou akcii. Každé ETF má i procento z konkrétní akciové expozice.
4. Úroveň identifikace akcie (ISIN, SEDOL nebo nedoložená) a případný matematický ekvivalent kusů vypočtený jen při dostupné přímé referenční ceně totožné akciové třídy.

**Důležité rozdíly procent:** Váha akcie v hlavní tabulce je procento z **celého analyzovaného portfolia** (akcie, ETF, krypto). Procenta uvnitř rozbaleného detailu jsou z hodnoty **této jedné akcie**, takže přímý + nepřímý podíl vždy dává 100 %. Tyto dvě veličiny se nesmějí zaměňovat.

## Příklad

Pokud máš Microsoft přímo za 300 Kč a současně v něm ekonomickou expozici přes VWCE za 100 Kč a SPYI za 100 Kč, detail ukáže:

- Přímo: 300 Kč, 60 % expozice Microsoftu (s rozpisem broker účtů)
- Přes ETF: 200 Kč, 40 % expozice Microsoftu
- VWCE: 100 Kč, 20 % expozice Microsoftu
- SPYI: 100 Kč, 20 % expozice Microsoftu
- Celkem Microsoft: 500 Kč

Jde jen o ilustrační matematický příklad; skutečné hodnoty zůstanou vždy převzaté z tvé lokální databáze a z validních vah ETF.

## Meze

Rozpis nepřidává fiktivní počet akcií z ETF ani nové živé ceny. Zůstává ekonomikou založenou na posledních broker API pozicích a na posledním skutečně publikovaném as-of složení fondů. Žádná změna ledgeru, transakcí, daňových lotů, API klíčů, ceny nákupů ani mapování tickerů. Detail pouze vysvětluje a auditovatelně rozepisuje částky, které FinanceOS už počítá.

## Regresní ověření

Nové testy ověřují stejné ISIN napříč účty, dvě ETF se stejnou akcií, burzovní varianty jednoho fondu s jedním ISIN, zachování výpočtu při zlomkových vahách, samostatnou krypto pozici, neidentifikované ticker-only akcie a tabulkovou integraci.


## Podíl konkrétní akcie na NAV každého ETF a na celém portfoliu (16. 10. 2026)

Ve stejném rozbaleném detailu se nyní rozlišují **tři různé jmenovatele procent**. Pro příspěvek Microsoftu ve fondu VWCE například:

- **% hodnoty ETF** = `příspěvek Microsoftu přes VWCE (Kč) / celková tržní hodnota vlastněného VWCE včetně VWRA (Kč) × 100`. Jde o podíl akcie *v tomto drženém fondu*, nikoli o poměr ke všem penězům v Microsoftu.
- **% expozice této akcie** = `příspěvek Microsoftu přes VWCE / (přímý Microsoft + všechny jiné ETF příspěvky Microsoftu) × 100`.
- **% analyzovaného portfolia** = `příspěvek Microsoftu přes VWCE / (přímo držené akcie + krypto + tržní hodnota ETF) × 100`. Hotovost, P2P a jiná aktiva mimo X-Ray se do tohoto jmenovatele **nezapočítávají**.

Nový čistě odvozený modul `lib/xray/exposure-attribution.ts` používá právě tržní hodnoty fondu z `XRayFundCoverage`, již spočtené příspěvky `XRayExposure.fundContributions` a **stejný `denominatorCzk`** z výpočetního enginu. Nepočítá znovu ceny ETF ani FX kurz, nemění výsledné akciové váhy a při chybějícím fondu, překročení NAV nebo rozdílu příspěvkových součtů odmítne falešná procenta. Současně přenáší původ a datum použitého fondu, takže jde u každého řádku dohledat, z jakého snapshotu pochází.

Pro syntetický **LYMS** se v rozpisu odděleně počítá **částka pouze odhadovaná přes CNDX proxy** – jde o podmnožinu existující nepřímé expozice, nikoliv novou investici nad rámec NAV. Uznané skutečné podklady a explicitní referenční index nejsou vydávány za proxy.

V hlavní tabulce je navíc filtr **Způsob držení** s režimy „Všechny expozice“, „Přímo i přes ETF“, „Pouze přímo“ a „Pouze přes ETF“. Při změně filtru se obnoví stránkování, vyhledávání funguje dál a pro určení skupiny se používají výhradně již validované hodnoty `directCzk` a `viaFundsCzk`; nespárované ticker-only akcie se nespojují ani filtrem.
