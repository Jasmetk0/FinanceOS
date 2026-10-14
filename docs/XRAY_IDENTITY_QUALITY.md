# Portfolio X-Ray — audit kvality identifikace a pokrytí

## Nové šestistupňové rozdělení hodnoty

Dřívější číslo „identifikovaná expozice“ měřilo jen to, kolik Kč bylo rozloženo na nějaký ticker krypta nebo akcie. To je užitečné pro kontrolu účetního součtu, ale neříká, zda lze jeden konkrétní podklad bezpečně sloučit s přímým nákupem či jiným ETF.

Nová obrazovka **Jak přesný je automatický rozklad?** rozděluje stejné analyzované portfolio do šesti vzájemně se vylučujících kategorií:

1. **ISIN uvedený ve zdrojových datech:** přímé akcie nebo podklady ETF mají vlastní konkrétní ISIN. Formát identifikátoru se v X-Ray kontroluje; nejde o nezávislé potvrzení, že externí emitent zveřejnil správnou cenu.
2. **SEDOL → ISIN:** podklad je dohledán na stejnou akciovou třídu přes jednoznačnou kontrolovanou dvojici SEDOL/ISIN od emitenta, jak ji umí propojit PR #67.
3. **Jen SEDOL:** fond má samostatný ověřitelný sedmimístný SEDOL, ale v aktuálním portfoliu chybí bezpečné mapování na ISIN.
4. **Jen ticker:** zdroj je identifikovaný hlavně symbolem, který může být nejednoznačný. Dokonce když se podle jediného tickeru podaří matematicky seskupit pozice, tato část se i nadále vykazuje jako nižší důkaz identity.
5. **Krypto podle symbolu:** není ověřený chain-specific mint/contract identifikátor. BTC/XBT se v původním výpočtu mohou normalizovat, přesto není důvod tuto část nazývat ISIN ověřením.
6. **Nerozloženo:** fondy bez úplného složení a zbytky hodnoty po podkladech other (hotovost, dluhopisy, další fondy či deriváty).

Procenta se počítají **vůči součtu skutečně analyzovaných akciových, ETF a kryptoměnových pozic**. P2P, volná hotovost a aktiva z jiných sekcí nejsou do tohoto jmenovatele zahrnuta, stejně jako v původním X-Ray reportu.

**Invarianta:** všechny šest kategorií dohromady musí odpovídat denominatorCzk, současně prvních pět se musí rovnat mappedCzk a poslední musí být unallocatedCzk. Při odchylce větší než numerická tolerance se výpočet přeruší a nezobrazí falešné váhy. Nejde o nové přepočítání hodnoty jednotlivých pozic; klasifikace probíhá nad stejnými přiřazenými CZK částkami.

## UI a uživatelská použitelnost

- Šestidílný proporční graf, přístupné popisky a kompaktní karty 3 na řádek při širším okně.
- Pod grafem lze rozkliknout pět fondů s největším nerozloženým objemem a konkrétní částkou Kč.
- Ruční CSV už není formulováno jako podmínka; primární cesta je automatické API a veřejné issuer feedy.

## Hranice

Tyto kategorie měří **identitu podkladu**, ne důvěryhodnost serverové domény, reálné cenové kotace nebo správnost původně nahlášených vah emitenta. Kvalita identifikace je jiná veličina než stáří dat složení ETF (as-of), které FinanceOS ukazuje samostatně. Bez skutečných issuer dat se celý nerozložený ETF fund vykáže jako nerozložený, a ne jako 100% identifikovaný z názvu.

Skutečný browserový E2E a ověření živého Vanguard GPX / SPDR XLSX z uživatelovy lokální instalace zůstávají dalším krokem.
