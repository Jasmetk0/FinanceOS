# Trading 212 → Portfolio X-Ray: ochrana celého snapshotu pozic a oceňovací měny

## Zjištěné chyby

Synchronizace dříve používala vzor `if (!ticker) continue` a po zpracování každého nového seznamu bez další kontroly volala `replaceHoldings()`. Pokud by Trading 212 vrátil neúplný, chybný nebo změněný formát odpovědi, FinanceOS mohl **smazat část či všechny předchozí správné pozice** a tím zkreslit X-Ray i hodnotu investované části účtu.

Další riziko bylo ve výběru měny: kód přepínal na wallet měnu už při libovolném neprázdném `walletImpact`, přestože tam mohl být pouze `fxImpact` nebo `unrealizedProfitLoss` a samotná `currentValue` chyběla. Náhradní hodnota `quantity * currentPrice` je ale v **měně instrumentu**, nikoliv automaticky v měně Trading 212 účtu. To mohlo vytvořit chybný přepočet do CZK.

Podle [oficiálního Trading 212 API](https://docs.trading212.com/api/positions) se kompletní otevřené pozice získávají jako **JSON array** a mohou obsahovat instrument.currency, quantity, currentPrice a walletImpact s vlastní měnou.

## Nové pravidlo — nejprve validovat, pak zapisovat

Ještě před prvním zápisem do účtu či tabulek holdings proběhne kontrola **celého** payloadu z `/equity/positions`:

- Odpověď musí být skutečné pole objektů, ne `null`, HTML chyba nebo wrapper `{items:...}`.
- Žádný nezpracovatelný řádek, chybějící `instrument.ticker` či duplicitní unikátní Trading 212 ID není dovoleno potichu přeskočit.
- Quantity a ocenění musí být číselné, konečné a nezáporné.
- Pokud existuje `walletImpact.currentValue`, musí být platná i jeho vlastní wallet měna.
- Pokud wallet ocenění chybí, musí být doložená použitelná `currentPrice`; neznámá cena nemůže automaticky znamenat nulovou hodnotu akcie. Výslovně doložená nula ve wallet ocenění je přípustná.
- Prázdné portfolio je legitimní jen tehdy, pokud broker současně nevykazuje investice nad známou neinvestovanou hotovostí v pies.
- Při neúspěchu se synchronizace pozic **přeruší před `upsertAccount`, `upsertAsset` a `replaceHoldings`**. Dříve správně uložené portfolio není tímto pokusem přepsáno.

## Oceňování v měnách

1. `walletImpact.currentValue` je explicitní ocenění v `walletImpact.currency` — tato měna má přednost pro hodnotu pozice a její FX přepočet.
2. Při absenci explicitního wallet ocenění použije FinanceOS `quantity * currentPrice` v **měně instrumentu**. Samotný `walletImpact.fxImpact` nesmí přepnout měnu náhradní hodnoty.
3. P/L v měně wallet se nikdy nesčítá a neodečítá s cenou v jiné instrument měně. Pokud není základna pro správný P/L známá, je P/L držby **nedostupné (null)**, nikoliv smyšlené číslo v nesprávné měně.
4. Celkový účetní P/L z `account.summary` zůstává beze změny a je nezávislý na tomto per-holding fallbacku.

## Testy a hranice

Regresní testy obsahují neplatné a prázdné odpovědi, chybějící tickery, duplicitní instrumenty, chybné quantity, chybějící aktuální cenu, explicitní wallet hodnotu a různou měnu tickeru vs. účtu, P/L s přesně doloženými náklady a chybějící P/L.

**Tento PR neopravuje kompletní historii cashflow a čistých vkladů** — otevřený PR #44 řeší zvlášť opravu uloženého Trading 212 exportu. U této změny se nerozšiřuje podporované ETF universe, nemění API klíče ani výchozí rozklad X-Ray; jde o integritu podkladové brokerské valuace.

Bez přímého API přístupu k uživatelově Trading 212 není možné potvrdit, zda se taková chyba už skutečně vyskytla na jeho účtu. Testy prokazují, že by ji nový import bezpečně odmítl.
