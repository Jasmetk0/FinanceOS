# Portfolio X-Ray — reálné ověření veřejných ETF zdrojů

## Co už je ověřené

Dne **14. října 2026** FinanceOS z nové větve přímo na internetově dostupném GitHub Actions runneru stáhl originální soubory a GraphQL podklady všech 6 fondů. Tím se odstranil dosavadní rozdíl mezi zelenými syntetickými testy a nefunkčním reálným ETF look-through.

- SXR8 / CSPX (iShares Core S&P 500): **úspěšně načteno**, 509 platných podkladů.
- IWDA / EUNL (iShares Core MSCI World): **úspěšně načteno**, 1 265 podkladů.
- SSAC / IUSQ (iShares ACWI): **úspěšně načteno**, 1 693 podkladů.
- EIMI / IS3N (iShares EM IMI): **úspěšně načteno**, přibližně 2 990 platných pozic. U chybějících tickerů „-“ se používá bezpečná jednoznačná identita konkrétního řádku souboru, nikoli falešné párování s jinou akcií.
- SPYI / IMIE / IMID (State Street SPDR ACWI IMI): **úspěšně načteno**, 5 964 rozložených pozic po zpracování XLSX. Skutečný formát má datum „13-Oct-2026“, exponentové procentní hodnoty, neoceněné či nealokované měnové řádky a jednorázový závěrečný právní text. Nerozpoznaným neakciovým řádkům se nikdy nepřiřazují falešné akcie.
- VWCE / VWRA / VWRP (Vanguard FTSE All-World): **kompletní síťové načtení potvrzeno**, 4 093 syrových podkladů; 3 764 validovaných ekonomických pozic po nettingu peněžních a FX instrumentů. **Složení je z 31. srpna 2026**, tedy z hlediska denních kotací významně starší.

GitHub Actions, reálný průchod ze dne 14. 10. 2026:
https://github.com/Jasmetk0/FinanceOS/actions/runs/38634828284

## Jak fungují opravené parsery

1. **iShares EIMI:** více různých akcií může mít identický placeholder ticker „-“ na stejné burze. V takovém případě se zachová bezpečná identita podle konkrétního zdrojového řádku; akcie se automaticky nesloučí se stejně pojmenovaným tickerem.
2. **State Street SPYI:** XLSX vyžaduje podporu data se spojovníky, exponentových procent a terminálního právního footeru. Řádky s „Unassigned“ a znakem „-“ nemají vydavatelem uvedenou procentní váhu a nemohou být vydávány za akcie. Jedna velmi malá záporná FX pozice se kompenzuje pouze uvnitř kladné neakciové hotovosti, nikdy se nepřenáší na akciové váhy.
3. **Vanguard VWCE:** GraphQL `totalHoldings` počítá i CT.SPOT FX deriváty a další typy, které dřívější filtrovaný dotaz vynechal. Nyní se načítají **všechny strany všech typů instrumentů** a kontroluje úplnost přes totalHoldings. Drobná FX záporná expozice se vypořádá pouze proti kladné neakciové hotovosti. Pokud by záporné expozice byly velké nebo záporné akciové, parser fail-closed odmítne celý snapshot.

## Automatická kontrola i v budoucnu

Samostatný workflow **Public ETF issuer live canary**:

- se po mergnutí do default větve `buuk` spouští přibližně jednou denně (GitHub scheduler může mít prodlevy);
- lze ručně spustit z GitHub Actions;
- používá přímo produkční adaptéry FinanceOS, nikoli paralelní parser nebo mock;
- při výpadku / parser chybě vyhodnotí červené CI a nahraje **pouze veřejný report** stavu zdrojů ve formátu JSON a tabulku do GitHub Actions Summary;
- zastaralé, ale validně načtené měsíční složení Vanguard označí jako varování; pouze stáří samo o sobě neznamená selhání parseru nebo HTTP;
- po selhání lze zobrazit bezpečně zkrácenou diagnostiku veřejného souboru a struktury stránkování.

Tento oddělený monitoring nemění ledger, žádné broker API klíče nepotřebuje ani je neodesílá; běžná PR CI na něm není blokována. Kontroluje dostupnost z GitHub serveru, ne z lokální sítě uživatele. Pro kontrolu přímo v aplikaci nadále slouží tlačítko z PR #69 na stránce /xray.

## Bezpečné limity interpretace

Aktuální tržní hodnotu tvých ETF určuje poslední synchronizace **broker API**. Obsah fondů určuje poslední **datum zveřejněné emitentem**. Ani když živý canary označí HTTP a parser za funkční, neznamená to, že ceny a složení jsou aktualizovány v každém okamžiku nebo že proběhl nezávislý audit podkladů emitenta. Zvláště u Vanguard je výslovně nutné uvádět staré as-of datum.
