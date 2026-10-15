# Portfolio X-Ray — skutečná diagnostika zdrojů ETF

FinanceOS nyní obsahuje volitelný **živý test emitentů**, oddělený od automatického výpočtu portfolia. Je dostupný pod rozbalovací sekcí **Ověřit skutečné napojení na emitenty (diagnostika)** přímo na stránce /xray.

## Chování a technické provedení

Po kliknutí na **Spustit skutečný test zdrojů** klient zavolá lokální POST /api/xray/diagnostics. Server provede skutečná externí HTTPS volání a použije **stejné vydavatelské adaptéry a validátory**, jaké již produkčně používá automatický ETF look-through:

- Vanguard FTSE All-World VWCE — oficiální EU GPX GraphQL, ISIN IE00BK5BQT80
- Vanguard FTSE Global All-Cap VALL — oficiální EU GPX GraphQL, ISIN IE000VAHT5T0 (vlastní `E161` fund ID, všechny stránky)
- State Street SPDR ACWI IMI SPYI — oficiální XLSX, ISIN IE00B3YLTY66
- iShares Core S&P 500 — ISIN IE00B5BMR087
- iShares Core MSCI World — ISIN IE00B4L5Y983
- iShares MSCI ACWI — ISIN IE00B6R52259
- iShares Core MSCI EM IMI — ISIN IE00BKM4GZ66
- iShares MSCI World Small Cap — ISIN IE00BF4RFH31
- iShares S&P SmallCap 600 — ISIN IE00B2QWCY14
- iShares MSCI India — ISIN IE00BZCQB185
- iShares MSCI Global Semiconductors — ISIN IE000I8KRLL9
- iShares Global Clean Energy Transition — ISIN IE00B1XNHC34
- iShares Nasdaq-100 CNDX — ISIN IE00B53SZB19 (referenční **zdroj proxy modelu LYMS**, nikoli fyzické podklady Amundi)
- Rebalix **archiv Invesco**, EQQQ Dist — ISIN IE0032077012
- Rebalix **archiv Invesco**, EQAC Acc — ISIN IE00BFZXGZ54

To je celkem patnáct ověřovaných konkrétních zdrojů (včetně dvou nezávislých archivů Rebalix, nikoliv přímých zdrojů emitenta). Žádné URL, ISIN ani credentiály nejsou dodávány uživatelem.

**Výsledek není jen odpověď HTTP 200.** Po úspěšném načtení parserem musí:

- sedět ISIN i burzovní symbol všech vrácených podkladů,
- být přítomné alespoň 10 podkladů,
- být platný a jednotný den posledního složení od emitenta,
- nebýt v budoucnosti,
- odpovídat whitelistovaná povolená veřejná URL příslušného emitenta nebo výslovně označeného nezávislého archivu,
- projít původní validací vah, typů a duplicit.

Diagnostika uvádí datum skutečného složení, počet podkladů, procenta akcií, ostatních instrumentů a chybějících vah, latenci a případné konkrétní chybové hlášení. Kategorie:

- **Zdroj funkční**: úspěšný parser, validní řádky, celková zveřejněná váha nejméně 98 %, datum složení staré nejvýše 3 dny.
- **Starší datum**: stejně validní data, ale datum složení je 4–7 kalendářních dnů staré.
- **Zastaralý snapshot**: více než 7 dnů staré podklady.
- **Neúplné váhy**: validní parsovaný podkladový seznam vykazuje méně než 98 % hodnoty; přiznaný zbytek se nedopočítává na akcie.
- **Chyba stahování / parseru**: selhání dostupnosti, změna formátu, neplatná váha, chybný identifikátor či jiné neúspěšné ověření.

Časy a stav se znovu zjišťují jen po **explicitním kliknutí**. Test je kvůli 15 vzdáleným zdrojům potenciálně pomalejší. Server znovu používá výsledek z posledních 5 minut a sdílí souběžné požadavky mezi otevřenými okny. Bez toho by časté klikání mohlo zbytečně zatěžovat vydavatele fondů.

## Bezpečnost a hranice

- POST pouze na localhost s existující kontrolou původu.
- Bez předávání broker API klíčů, bez čtení historie transakcí a bez změny účetního ledgeru.
- Žádný nový externí proxy ani tracker; komunikace probíhá ze serveru běžícího FinanceOS přímo na pevně definované issuer endpointy.
- Diagnostika se **nespouští sama při každém otevření**, jelikož běžný automatický X-Ray už má vlastní 12hodinovou cache, zatímco test má ověřit skutečnou aktuální dostupnost.
- Funkční síťový zdroj ani úspěšná validace nejsou důkazem aktuálních tržních cen, přesného NAV fondu nebo nezávislého auditu jeho skutečných pozic.
- Pro reálné potvrzení funkčnosti Vanguard GPX a State Street XLSX je potřeba spustit diagnostiku na uživatelově zařízení s fungujícím přístupem k jejich doménám. CI testuje deterministické syntetické odpovědi; síťové externí testy se v CI nespouštějí.

**Co při selhání:** nejprve se podívej na důvod u konkrétního ETF a jeho originální URL. FinanceOS zároveň zachovává poslední dříve validovaný podkladový snapshot v lokální záloze a označí jeho datum — nikdy si obsah automaticky nevymyslí.


**VALL:** Ověřuje se samostatným `portId=E161`. Úspěch HTTP 200 nestačí: všechny stránky fondu musejí patřit FTSE Global All-Cap, obsahovat validní SEDOL (je-li použit k identifikaci), váhy a jednotné datum. Ověřený snapshot 30. 9. 2026 může být 15. 10. v diagnostice veden jako `stale`, i když je rozklad platný a síť funguje. Nezaměňujte datum stažení s `effectiveDate` od vydavatele.
