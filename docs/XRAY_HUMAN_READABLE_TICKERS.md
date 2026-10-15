# X-Ray — čitelné názvy akcií a rozlišení přímého držení od ETF

## Problém z produkčních screenshotů (15. 10. 2026)

Některé pozice složení Vanguardu se zobrazovaly například jako `2330@6889106`, `GOOG@BYY88Y7`, `TSLA@B616C79` nebo `LLY@2516152`. Část za znakem `@` je identifikátor **SEDOL**, který pomáhá bezpečně rozlišovat různé akciové třídy. Není to součást veřejného burzovního tickeru a v běžném seznamu proto nemá být v názvu.

Současně byl poslední sloupec **Přímé kusy** vyplněn číslem `0` i u akcií, které uživatel drží jen prostřednictvím ETF a jejichž ekonomická expozice v korunách je přesto kladná. To je výpočetně očekávané (uživatel přímo nevlastní akcie emitenta), ale v UI zavádějící.

## Nové chování

- X-Ray nyní při tvorbě **uživatelského zobrazovaného tickeru** oddělí konečný vzorec `TICKER@SEDOL`, pouze když kontrolní číslice SEDOL souhlasí a případný samostatně dodaný securitySedol je totožný.
- Platí také pro starší validní cache bez samostatného securitySedol: zobrazí čistý ticker, ale **původní interní identitu nijak neposílí**. Podklad se tedy nezačne omylem slučovat s dalšími cennými papíry.
- Původní unikátní `XRayExposure.key` podle ISIN, SEDOL či fondu zůstává zachovaný. Dvě akciové třídy se stejným tickerem se nikdy neslučují jen kvůli úpravě názvu.
- Tabulka ukazuje krátké burzovní tickery a plné názvy společností. U nepřímo držené akcie také `Pouze přes ETF` a při známém SEDOL identifikátor v drobném textu.
- Poslední sloupec zůstává **Přímé kusy**. Nyní se při nulové přímo vlastněné hodnotě zobrazí **—**, nikoliv zavádějící 0. Vysvětlující popisek a rozbalený detail říkají, že při expozici pouze z fondů jde o **ekonomický podíl**, nikoliv o přímo vlastněný počet akcií.
- Pokud uživatel nakoupil akcii také přímo, počet přímo držených kusů zůstává skutečnou hodnotou z brokera. Ekvivalent kusů přes ETF se počítá pouze pokud existuje skutečná referenční cena **téže ověřené akciové třídy** z přímého držení; bez ní se žádný počet kusů nehádá.
- Rozbalený detail obsahuje známý ISIN nebo SEDOL. Vyhledávání umí najít i interní identifikátor, přestože se už nezobrazuje jako hlavní ticker.
- Kontrolní testy obsahují přesně čtyři nahlášené případy včetně účetního součtu, různé akciové třídy se stejným tickerem, starou browser cache a situaci přímé + nepřímé pozice.

## Co se nemění

Žádné ceny, účetní pozice, historie transakcí, broker API, externí issuer data, původní cache ani výpočet vah **se nemění**. Úprava je v prezentačním štítku a vysvětlení počtu kusů, nikoli v identifikaci portfolia.

Pozor: `GOOG` a `GOOGL` jsou různé akciové třídy společnosti Alphabet, stejně jako lokální tchajwanská akcie `2330` a americké ADR `TSM` nejsou automaticky jediným identickým cenným papírem. Cílem je čitelná tabulka bez nevědomého slučování různých instrumentů.
