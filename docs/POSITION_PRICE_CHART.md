# FinanceOS — cenový graf a historie obchodů

## Co zobrazuje

Stránka **Investice → detail pozice → Cenový graf a moje obchody** propojuje **denní závěrečné tržní ceny** se **skutečně uloženými vykonanými obchody** (buy/sell). Obchody se identifikují pomocí **ID konkrétního instrumentu**, ne pouhým tickerem. Tím se nesmísí různé tituly se stejným symbolem, jinými burzami nebo různými měnami.

Zelené **+** označuje nákup a červené **−** prodej. **Najetí myší, zaměření klávesnicí nebo kliknutí/tapnutí** zobrazí kartu provedeného obchodu: čas, množství, realizační cenu, evidovanou hodnotu obchodu, poplatky podle zdroje, účet a identifikátor. Karta přehledně zobrazuje i Kč s označením přesnosti. Časová období: **1M, 3M, 1R, 5L, MAX**. Samostatný seznam ukazuje všechny načtené obchody daného instrumentu za zvolené období. Pro případ více než 5 000 historických obchodů je stránka z výkonnostních důvodů omezena na posledních 5 000 a omezení výslovně přizná. Delší chybějící úseky historie nejsou spojovány vymyšlenými křivkami.

## Cenový zdroj a úroveň spolehlivosti

- **Provedené obchody**: z uložené historie Trading 212, Kraken a importovaných transakcí; interní převody se nepovažují za nákupy či prodeje.
- **Tržní ceny**: neoficiální denní historické ceny přes veřejný Yahoo Finance chart endpoint pro **ověřeně mapovaný** burzovní ticker. Nevysílají se API klíče, počty akcií ani finanční transakce. Externí endpoint však vidí požadovaný ticker a síťová metadata.
- **CSV**: u neznámého instrumentu nebo nedostupného zdroje lze použít existující stránku **Historie → Import historických cen**. Manuálně importované ceny se neoficiálním zdrojem **nikdy nepřepisují**.
- **Soukromí**: proměnná prostředí FINANCEOS_EXTERNAL_PRICE_FETCH=off vypíná nové externí cenové dotazy; již uložené ceny se zobrazují dál.

Úspěšná automatická aktualizace se po dobu přibližně **18 hodin** neopakuje; výpadek se zkouší znovu zhruba po **2 hodinách**. Paralelní načtení čeká maximálně asi **90 sekund** před případným dalším pokusem.

## Pravidla správnosti

1. **Čas** — ceny i provedení se při známém trhu přiřazují podle místního dne burzy, nikoli pouhým UTC řetězcem. Zohledňuje se letní čas.
2. **Měna** — GBP není totéž co britské pence (GBp/GBX). Měna tržních dat se musí shodovat s vykreslovanou měnou. U kryptoměn je jednotka aktiva (BTC) odlišná od kotace (například BTC-USD / BTC-EUR).
3. **Skutečná cena nákupu** — plné +/− leží na zaznamenané realizační ceně jen při souhlasné měně a přiměřené cenové vzdálenosti od trhu. **Duté kolečko s přerušovaným okrajem** neleží na cenové křivce: obchod nemá bezpečně srovnatelnou cenovou hodnotu a je umístěn do **samostatné časové osy pod grafem**. Pokud graf nemá žádné ceny, časová osa reálných obchodů funguje samostatně.
4. **Žádné cenové informace z budoucnosti** — při chybějícím kurzu není použita cena dalšího obchodního dne. Pokud nelze realizační cenu srovnat, značka se přesune do samostatné časové osy; nikdy se nepřemístí k libovolné tržní ceně. Poloha X vychází z místního času provedení, bez původního dekorativního posunutí více značek o několik pixelů.
5. **Rozdělení akcií** — starší obchody mohou mít cenu z doby před splitem. Nesmí se bez doložené transformace mechanicky porovnávat s upraveným historickým kurzem.
6. **Identita** — nejednoznačná burza, špatná měna nebo jiný ticker vrácený cenovým zdrojem zablokuje automatické spojení.

## Co znamená částka v Kč v informační kartě

- **Nativní CZK obchod:** FinanceOS zobrazí zaznamenanou částku obchodu přímo v Kč. Nemusí ale obsahovat případné nezaznamenané bankovní náklady.
- **Obchod v USD/EUR/jiné měně:** uložené pole `amount_czk` v současných importech Trading 212 a Kraken vzniká **historickým převodem podle kurzu ČNB**. Karta takovou částku označuje **Přepočet na Kč**, nikoliv skutečnou CZK platbu nebo zaručenou částku odečtenou bankou. Zobrazuje se rovněž originální měna a evidovaná částka obchodu; tato částka nemusí být totožná s konečným pohybem peněz po poplatcích.
- **Bez důvěryhodného CZK údaje:** zobrazí se **Nedostupná**; žádný kurz ani výsledná hodnota se nevymýšlí.
- Poplatek se zobrazuje odděleně v původní měně, pokud byl zaznamenán. Zapsaný pohyb peněz může podle zdroje poplatek již obsahovat nebo jej vykazuje zvlášť; proto se automaticky nepřičítá ani neodečítá podruhé.
- Časová poloha markerů vychází z provedení zaznamenaného poskytovatelem a časového pásma burzy, pokud je k dispozici. Samotná křivka však reprezentuje **pouze denní close**, nikoliv intradenní průběh. U timestampu bez doložené časové zóny to UI přiznává.

## Známá omezení

Ceny jsou **denní závěrečné, nikoli intradenní real-time**. Neoficiální Yahoo Finance feed nemá garanci dostupnosti a může omezovat počet požadavků. P2P projekty Mintos/Investown nejsou burzovně kotované cenné papíry a cenovou křivku tohoto typu nemají. U neúplné historie Trading 212 se zobrazí jen skutečně importované / synchronizované obchody.

Automaticky přidané tržní ceny nemají dopočítané historické přepočty do CZK (close_czk). Nejsou tedy automatickou náhradou za korektní FX data potřebná pro agregované historické ocenění portfolia.

## Testy

Spustit testy: **node --test tests/position-price-chart.test.mjs**. Celková kontrola zahrnuje npm test, npm run lint, npm run build a provozní smoke test v GitHub Actions.
