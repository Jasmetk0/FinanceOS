# FinanceOS — cenový graf a historie obchodů

## Co zobrazuje

Stránka **Investice → detail pozice → Cenový graf a moje obchody** propojuje **denní závěrečné tržní ceny** se **skutečně uloženými vykonanými obchody** (buy/sell). Obchody se identifikují pomocí **ID konkrétního instrumentu**, ne pouhým tickerem. Tím se nesmísí různé tituly se stejným symbolem, jinými burzami nebo různými měnami.

Zelené **+** označuje nákup a červené **−** prodej. Kliknutím se zobrazí datum, množství, účet a realizační cena. Časová období: **1M, 3M, 1R, 5L, MAX**. Samostatný seznam ukazuje všechny načtené obchody daného instrumentu za zvolené období. Delší chybějící úseky historie nejsou spojovány vymyšlenými křivkami.

## Cenový zdroj a úroveň spolehlivosti

- **Provedené obchody**: z uložené historie Trading 212, Kraken a importovaných transakcí; interní převody se nepovažují za nákupy či prodeje.
- **Tržní ceny**: neoficiální denní historické ceny přes veřejný Yahoo Finance chart endpoint pro **ověřeně mapovaný** burzovní ticker. Nevysílají se API klíče, počty akcií ani finanční transakce. Externí endpoint však vidí požadovaný ticker a síťová metadata.
- **CSV**: u neznámého instrumentu nebo nedostupného zdroje lze použít existující stránku **Historie → Import historických cen**. Manuálně importované ceny se neoficiálním zdrojem **nikdy nepřepisují**.
- **Soukromí**: proměnná prostředí FINANCEOS_EXTERNAL_PRICE_FETCH=off vypíná nové externí cenové dotazy; již uložené ceny se zobrazují dál.

Úspěšná automatická aktualizace se po dobu přibližně **18 hodin** neopakuje; výpadek se zkouší znovu zhruba po **2 hodinách**. Paralelní načtení čeká maximálně asi **90 sekund** před případným dalším pokusem.

## Pravidla správnosti

1. **Čas** — ceny i provedení se při známém trhu přiřazují podle místního dne burzy, nikoli pouhým UTC řetězcem. Zohledňuje se letní čas.
2. **Měna** — GBP není totéž co britské pence (GBp/GBX). Měna tržních dat se musí shodovat s vykreslovanou měnou. U kryptoměn je jednotka aktiva (BTC) odlišná od kotace (například BTC-USD / BTC-EUR).
3. **Skutečná cena nákupu** — značka leží na realizační ceně jen při souhlasné měně a přiměřené cenové vzdálenosti od trhu. Jinak je vyznačena pouze orientačně u posledního dostupného předchozího závěru (tečkovaný okraj).
4. **Žádné cenové informace z budoucnosti** — při chybějícím kurzu není použita cena dalšího obchodního dne. Pokud není kurz dostupný v posledních pěti kalendářních dnech, zůstává obchod v seznamu, nikoliv na křivce.
5. **Rozdělení akcií** — starší obchody mohou mít cenu z doby před splitem. Nesmí se bez doložené transformace mechanicky porovnávat s upraveným historickým kurzem.
6. **Identita** — nejednoznačná burza, špatná měna nebo jiný ticker vrácený cenovým zdrojem zablokuje automatické spojení.

## Známá omezení

Ceny jsou **denní závěrečné, nikoli intradenní real-time**. Neoficiální Yahoo Finance feed nemá garanci dostupnosti a může omezovat počet požadavků. P2P projekty Mintos/Investown nejsou burzovně kotované cenné papíry a cenovou křivku tohoto typu nemají. U neúplné historie Trading 212 se zobrazí jen skutečně importované / synchronizované obchody.

Automaticky přidané tržní ceny nemají dopočítané historické přepočty do CZK (close_czk). Nejsou tedy automatickou náhradou za korektní FX data potřebná pro agregované historické ocenění portfolia.

## Testy

Spustit testy: **node --test tests/position-price-chart.test.mjs**. Celková kontrola zahrnuje npm test, npm run lint, npm run build a provozní smoke test v GitHub Actions.
