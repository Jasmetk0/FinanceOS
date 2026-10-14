# FinanceOS Financial Simulator — první funkční řez (2026-10-14)

## Rozsah

Samostatná cesta /simulator a deterministický měsíční engine. Nezasahuje do SQLite, klasifikace transakcí, synchronizace providerů ani databázových migrací.

### Výpočetní smlouva

- Všechny výnosy a inflace jsou efektivní roční míry, přepočítané na měsíční složené sazby: r_m = (1 + r_y)^(1/12) - 1.
- Pořadí měsíce: výnos z hodnoty z minulého měsíce → pravidelný vklad → mimořádný vklad nebo výběr.
- Měsíční vklad je na konci měsíce; při indexaci se změní vždy po 12 měsících.
- Mimořádné události jsou nominální a navázané na měsíc od zahájení simulace. Vklady a výběry se neindexují automaticky.
- Pokud jednorázový výběr převýší dostupné prostředky, portfolio zůstává na nule, rozdíl se vykáže jako shortfallCzk a žádný dluh nevznikne.
- Reálná hodnota v dnešní kupní síle po m měsících: nominalCzk / (1 + annualInflationPct/100)^(m/12).
- Cílový reálný kapitál: targetMonthlyIncomeCzk * 12 / (withdrawalRatePct/100).
- „Doba do cíle“ je první měsíc, kdy reálná hodnota dosáhne cílového kapitálu. Nepředstavuje pravděpodobnost dlouhodobé udržitelnosti výběrů.
- Výpočet probíhá maximálně 1 200 měsíců; nemožné a nedefinované výsledky se zobrazují jako chybové stavy, nikoli vymyšlené číslo.
- Inverzní výpočty řeší jednu neznámou najednou. Pro daný horizont používají bisekci na omezeném intervalu a neslibují výsledek mimo něj.

### Úložiště

Scénáře se ukládají pouze po explicitním kliknutí v prohlížeči (financeos-financial-simulator-v1). Hodnota investovatelného majetku načtená z existujícího getPlanData() je jen volitelná pomůcka pro počáteční kapitál. Aplikace automaticky nesynchronizuje změny skutečných zůstatků do již nastaveného scénáře.

### Regrese

Referenční scénář: 500 000 Kč, nominální CAGR 12 %, inflace 2,9 %, cíl 50 000 Kč měsíčně v dnešní kupní síle při výběrovém poměru 3 %.

- 0 Kč/měsíc: první dosažení cíle v měsíci 523.
- 5 000 Kč/měsíc fixně: v měsíci 422.
- 5 000 Kč/měsíc s roční indexací 2,9 %: v měsíci 404.

### Další etapy

1. Opakující se události na časové ose, vrstvené cash flow a více účtů.
2. Schématizované verze scénářů v lokální DB, import/export; žádné skryté automatické přepsání.
3. Analýza investiční strategie vs. čisté jmění a likvidita nemovitostí.
4. Model důchodu (procento aktuálního portfolia vs. fixní reálný výběr), poplatky a daně.
5. Stresové scénáře a reprodukovatelné Monte Carlo s jasnými modelovými předpoklady.

Tato první verze není osobní investiční doporučení ani predikce budoucích tržních výnosů.
