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

## Pravidelné životní fáze (2026-10-14)

Každé pravidlo má název, jednoznačné ID, typ, první a poslední aktivní měsíc (oba včetně), nominální měsíční částku a vlastní roční indexaci. Datum je relativní k začátku simulace. Věk v UI slouží jako pohodlný převod na měsíce; jeho pozdější změna **nemění** uložené relativní měsíce.

- **Změna základního vkladu:** nahrazuje standardní měsíční vklad pouze v období pravidla. Mimo období se znovu použije základní měsíční vklad s jeho původní indexací. Dvě taková období se nesmějí překrývat ani hraničním měsícem.
- **Dodatečný vklad:** v daném měsíci se přičte k běžnému vkladu, jednorázovým kladným událostem a ostatním dodatečným vkladům.
- **Pravidelný výběr:** v daném měsíci se sečte s jednorázovými zápornými událostmi. Pokud by přesáhl hodnotu portfolia po zhodnocení a všech vkladech, skutečný výběr se omezí na disponibilní kapitál a požadovaný rozdíl se vykáže jako neuspokojená částka.
- Indexace pravidla začíná až po celých dvanácti měsících jeho vlastní aktivity. Odlišuje se tedy od globální indexace základního vkladu.
- V této etapě jde o investiční cash flow; pravidelná mzda či nájem z jiného majetku **nepřitéká automaticky** do investičního portfolia.

Všechny metody solve (včetně inverzního dopočtu) a simulate používají stejný seznam pravidel. Neplatné případy, duplicity ID a kolizní období jsou odmítnuty ještě před výpočtem.

### Kompatibilita uložených scénářů

Nové uložení používá `financeos-financial-simulator-v2` s verzí 2 a se seznamem pravidel i počátečním věkem. Načítání nejdřív kontroluje v2, ale stále rozpozná v1. Načtený stav se před použitím ověřuje a stará v1 data se automaticky nemažou.

### Další vývoj

Plán: více uložených pojmenovaných scénářů, vizuální srovnávací graf pro dvě a více variant, editace jednotlivých pravidel, příjmový/výdajový rozpočet mimo investiční portfolio, samostatné modely čerpání důchodu a rizika.

## Monte Carlo a čerpání v důchodu (etapa 2026-10-14)

Samostatná stránka /simulator/risk přináší statistické scénáře oddělené od původního deterministického solveru.

- **Vkladová fáze:** každý měsíc do začátku důchodu se vkládá nominální částka, lze ji každý rok indexovat.
- **Důchodová fáze:** od prvního měsíce po zadaném počtu let se přestává přispívat a každý měsíc se vybírá požadovaný měsíční příjem v dnešní kupní síle. Výběr se měsíčně násobí kumulovanou inflací.
- **Nedostatek prostředků:** portfolio neklesne do záporných hodnot; požadavek na výběr není skryt a průběh se označí za neúspěšný od prvního nedostatku.
- **FIRE kontrola:** na začátku důchodu se portfolio v dnešní kupní síle porovná s cílem monthlyRealIncome*12/withdrawalRate. Tento test je odlišný od dlouhodobého financování výběrů.
- **Monte Carlo:** nezávislé měsíční lognormální hrubé výnosy. Logaritmický měsíční drift je log(1+R)/12 − sigma_month²/2, kde sigma_month = annualVolatility/sqrt(12). Zadané R reprezentuje očekávaný roční hrubý výnos, nikoli garantovaný CAGR. Statistický medián se liší od aritmetického očekávání.
- **RNG:** deterministický generátor mulberry32 + Box–Muller; stejný seed a předpoklady poskytují stejný rozptyl.
- **Výstupy:** P10 / medián / P90 reálného portfolia vždy po roce, podíl cest splňujících kapitál v okamžiku odchodu do důchodu a podíl cest, které plně financovaly všechny výběry do konce horizontu.
- **Stresový scénář:** samostatná deterministická křivka s jednorázovým propadem v zadaném roce a přiznaným neuhrazeným nominálním výběrem.

### Omezení rizikového modelu

Výnosy jsou nezávislé a lognormální, bez strukturálních změn režimu, korelací, fat tails, měnových šoků, daní nebo poplatků. Inflace je konstantní zadaný parametr. Vykreslené percentily jsou **bodové percentily pro jednotlivé roky**, nikoliv souvislé osobní historické dráhy. Statistiky představují jen pravděpodobnosti v rámci zvoleného modelu a nemají se vydávat za skutečné budoucí prognózy.

Výpočet probíhá pouze v klientském prohlížeči; žádná data o skutečném portfoliu se nemění.
