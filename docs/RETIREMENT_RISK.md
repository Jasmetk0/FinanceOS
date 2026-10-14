# FinanceOS — Retirement Risk / Monte Carlo

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
