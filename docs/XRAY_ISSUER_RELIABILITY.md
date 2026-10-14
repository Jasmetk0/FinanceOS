# Portfolio X-Ray — spolehlivost automatických ETF zdrojů

## Proč to řešíme

V předchozích verzích endpoint pro automatické složení ETF vracel pouze úspěšně stažené fondy. Když dočasně selhal zdroj emitenta, klient přepsal všechny automatické podklady touto částečnou odpovědí. Výsledkem byl nečekaný pokles pokrytí i při dostupnosti dříve validovaného kompletního rozkladu.

Nová implementace neplete tři různé pojmy:
- Datum skutečných holdings emitenta (as-of)
- Datum posledního úspěšného stažení z emitenta (fetched-at)
- Datum poslední lokálně uložené kopie (saved-at)

Tyto hodnoty nejsou totožné a nikdy nemají být vydávány za ceny akcií v reálném čase.

## Nové chování

1. Pro každé ETF jednoznačně identifikované ISIN se vždy zpracuje celý nejnovější úspěšný snapshot najednou; řádky z více různých snapshotů se nekombinují.
2. Pokud se aktuální načtení daného emitenta nezdaří, FinanceOS zachová poslední dříve validovaný automatický snapshot tohoto konkrétního fondu, zatímco jiné úspěšné fondy se aktualizují.
3. Při prodeji fondu se jeho dříve získané automatické řádky přestanou používat (endpoint již nehlásí jeho ISIN jako držené).
4. Úspěšné validované snapshoty jsou nově uloženy odděleně v klientském IndexedDB pod klíčem automatic-issuer-snapshots-v1. Nezasahují do ručních CSV importů ani do účetní SQLite databáze.
5. Při novém otevření X-Ray jsou dostupné validní dříve uložené podklady i v době výpadku emitenta. Jsou ale označeny jako **záložní data**, nikoli jako čerstvě synchronizované.
6. Lokální záloha má maximální životnost 60 dní. Neúspěšné opakované obnovení jej samo neprodlužuje, a nepřeměňuje tak staré informace na „aktuální“.
7. Přehled zdrojů uvádí oficiální datum každého rozkladu. Důležité hranice aktuálnosti: do 3 kalendářních dnů = nedávné, 4–7 dní = starší, více než 7 dní = zastaralé. Jde o jednoduché **indikátory datové aktuálnosti**, ne o důkaz, že emitent vydal novější údaje.
8. Výpadky a chybné zdroje se zobrazí spolu s informací, zda starší podklady existují. Správně se zachová známá historická ekonomická expozice, ale neoznačí se za live.

### Kontrola dat

- Žádná dodaná akcie bez ověřeného úspěchu konkrétního fondu.
- Žádný úspěch bez skutečných podkladových pozic.
- Žádné smíšené as-of datum uvnitř jednoho snapshotu.
- Duplicitní ISIN fondu ve stavových výsledcích nebo nekonzistentní data se odmítnou.
- Celkové váhy ETF a účetní zachování hodnoty se nadále ověřují původním výpočetním enginem.
- Neplatný záznam v IndexedDB se bezpečně ignoruje.

## Hranice této etapy

Údaje z Trading 212, Krakenu a Phantomu se nadále aktualizují podle API synchronizace z PR #64. Naše záloha podkladů neobsahuje obchodní historie ani ceny. Data od emitentů jsou dávková a nemusí být pro daný den publikována. Nový kód neověřuje, že každé live rozhraní Vanguard nebo SPDR je aktuálně dostupné; skutečný browserový E2E test zůstává nutný.
