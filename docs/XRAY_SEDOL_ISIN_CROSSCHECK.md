# Portfolio X-Ray — ověřené spojování SEDOL a ISIN mezi ETF

## Nový funkční řez

Předchozí verze FinanceOS správně nezaměňovala burzovní tickery za identitu akciové třídy. Při automatickém rozkladu Vanguard VWCE ale zdroj poskytoval hlavně SEDOL, kdežto přímé nákupy z Trading 212 a podklady State Street SPYI mají ISIN. Stejná akcie se proto mohla zobrazit ve dvou řádcích.

Nyní X-Ray podporuje **přímý most SEDOL ↔ ISIN**, aniž by hádal podle podobných názvů firem:

1. State Street SPDR SPYI XLSX již obsahuje sloupce ISIN a SEDOL; parser nově zachovává oba identifikátory, pokud se SEDOL podaří ověřit.
2. Vanguard GPX nově zachovává SEDOL podkladové akcie odděleně od čitelného TICKER@SEDOL štítku.
3. SEDOL musí být platný sedmimístný kód se správnou kontrolní číslicí. Pro kontrolu se používají váhy 1, 3, 1, 7, 3, 9, 1 a modulus 10.
4. Jen jednoznačné oficiálně označené páry SEDOL/ISIN v aktuální sadě podkladů SPYI se používají k rozhodnutí, že Vanguard pozice patří ke stejnému ISIN jako SPYI či přímo držená akcie.
5. Pokud se stejný SEDOL objeví s dvěma různými ISIN, **celý konfliktní pár se vyřadí**. Dvě odlišné akcie se nikdy nesloučí jen kvůli společnému tickeru nebo názvu.
6. Pokud SPYI není držený, SPDR feed nemá SEDOL nebo není dostupný, samostatné Vanguard pozice zůstávají beze změny — není zde externí neověřený lookup ani fiktivní převod identity.
7. Ruční a dřívější lokálně uložené podklady zůstávají kompatibilní; nová vlastnost securitySedol je volitelná. Výpočet nezmění součet aktiv, jen přesnost seskupování již identifikovaných akcií.

## Příklad

Pokud má uživatel přímo akcii s ISIN US5949181045 a souběžně drží VWCE i SPYI, může jedna ověřená vazba SEDOL → ISIN spojit přímou část, část z VWCE a část ze SPYI do **jediné ekonomické expozice**. Zobrazí se tedy současně původní přímá hodnota a hodnoty ze všech fondů. Testy jsou založeny na syntetických řádcích, nikoli na tvrzení, že konkrétní reálná pozice má v produkci ukázkový SEDOL z testu.

## Bezpečnost a omezení

- Tato vazba je použita pouze tehdy, když jsou v již načteném portfoliu obě ověřitelné identity. Provedení nové synchronizace brokera nevyžaduje nové API klíče.
- Samotný label souboru lze teoreticky ručně napodobit, protože klientský import používá textový zdroj; pro tvrdé bezpečnostní garance původu bude nutné podepsané/oddělené metadata od serveru. Funkce je konzervativní, nikoli plnohodnotný ověřovač původu třetích stran.
- SEDOL/ISIN most pracuje s akciovou třídou, nikoli se všemi rozdílnými třídami jedné ekonomické společnosti. Například dva odlišné ISIN téže firmy zůstanou oddělené, pokud nejsou explicitně doložené jako tentýž instrument.
- Podkladové zdroje Vanguard a State Street je stále nutné ověřit živým E2E v lokálním FinanceOS; regresní testy používají deterministická syntetická data.

Externí technické informace o validaci SEDOL: https://commons.apache.org/proper/commons-validator/apidocs/org/apache/commons/validator/routines/checkdigit/SedolCheckDigit.html
