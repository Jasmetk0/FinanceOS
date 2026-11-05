# FinanceOS — světové indexy a benchmarky

## Kde to je

**Světové indexy** v levé navigaci FinanceOS; rychlý přechod také na stránce **Investice**. Přímá cesta: /indices. Výběr je v URL v parametru ids, například /indices?ids=sp500,nasdaq100. Výběr je deterministický a omezený na maximálně čtyři identifikované indexy.

### Deset dostupných benchmarků

| Index | Yahoo symbol | Poznámka |
|---|---|---|
| S&P 500 | ^GSPC | Americký cenový index, nikoli SPY/VOO |
| Nasdaq-100 | ^NDX | Nezaměňovat s Nasdaq Composite |
| FTSE All-World | AW01.FGI | Skutečný globální index, **nikoli VWCE** |
| Nasdaq Composite | ^IXIC | Širší Nasdaq index |
| Dow Jones | ^DJI | Cenově vážený |
| Russell 2000 | ^RUT | Small caps USA |
| EURO STOXX 50 | ^STOXX50E | Eurozóna |
| DAX | ^GDAXI | **Performance** index, obsahuje reinvestované dividendy |
| FTSE 100 | ^FTSE | Velká Británie |
| Nikkei 225 | ^N225 | Japonsko |

**Ověřitelné referenční zdroje symbolů:**
- Yahoo Finance index listing: https://finance.yahoo.com/markets/world-indices/
- Yahoo Finance FTSE All-World index: https://finance.yahoo.com/quote/AW01.FGI/
- O indexu od samotného FTSE Russell / LSEG: https://www.lseg.com/en/ftse-russell/indices/ftseall-world

Yahoo nemusí zveřejňovat dlouhou historii úplně u všech indexů (obzvlášť AW01.FGI). U chybějících dat aplikace nic nepředstírá ani nenahrazuje ETF proxy bez upozornění.

## Co graf ukazuje

- **Denní indexové body**, nikoli cena jedné jednotky investice. Jednotka USD/EUR/GBP v metadatech zdroje neznamená, že lze za tuto částku koupit 1 jednotku indexu.
- Při jednom indexu je defaultní graf vyjádřen v původních **indexových bodech**. Můžeš ho přepnout na základ 100.
- Při výběru více indexů se série **normalizují od 100** ve stejném počátečním obchodním dni.
- Všechny porovnávané indexy mají **identické počáteční a koncové datum**. Graf používá jen skutečné společné dny. Nepřepočítává žádné chybějící ceny na hodnotu z budoucnosti.
- Rozsahy 1M, 3M, 1R, 3R, 5R a dostupné maximum; maximum ze zdroje je nejvýše deset let.
- Denní kurz je historická kotace, **nejde o live cenu ani intradenní burzovní feed**. Nejnovější den zdroje může být v průběhu seance.

**Výnos indexu není investiční výnos ETF:** cenové indexy nezahrnují dividendy, náklady ETF, rozdíl tracking error, spready, daně ani změny kurzu CZK. Populární DAX ^GDAXI je navíc *performance* index, a proto není dividendově srovnatelný s cenovým S&P 500 či Nasdaq-100. Případnou budoucí výkonnost portfolia nebo investici nevypočítávej přímo z rozdílu těchto bodů.

## Data, cache a soukromí

Denní data se čtou z neoficiálního Yahoo Finance v8 chart endpointu. Zdroj se ověřuje **podle tickeru a měny**. Stahují se pouze **předem uvedené konkrétní indexy**, nikdy ticker z uživatelského libovolného textu.

Cache se ukládá odděleně v existující tabulce **provider_sync_state** pod providerem market_indices:
- úspěšná aktualizace: TTL 12 hodin;
- chyba: další pokus nejdřív po 30 minutách;
- právě probíhající požadavek: ochrana 90 sekund;
- při výpadku zůstávají starší lokálně uložené kurzy k dispozici a aplikace hlásí chybu.

Nepřepisuje se **assets, holdings, transactions, snapshots ani asset_prices**. Index není novou položkou investičního portfolia, nepočítá se jako nákup či prodej a nikdy se nezapočítává do čisté hodnoty majetku.

Při běžném síťovém požadavku Yahoo vidí ticker a metadata síťového spojení, **nikoli API klíč Trading 212/Kraken ani tvoje investiční transakce**. Nastavení prostředí FINANCEOS_EXTERNAL_PRICE_FETCH=off externí cenové dotazy zcela vypne, bez smazání již uložených grafů.

## Technické kontroly

node --test tests/market-indices-charts.test.mjs

Součástí CI je lint, úplné testy, produkční build a kontrola runtime. Testuje se úplná identita indexů, žádné nebezpečné symboly, kontrola měn, vícedenní srovnání, absence vymyšlených bodů, oddělená cache a navigace.
