# FinanceOS — automatický rozklad Vanguard VWCE

## Základní princip

Portfolio X-Ray při otevření podle ETF ISIN IE00BK5BQT80 (VWCE, VWRA, VWRP) vyhledá právě Vanguard EU FTSE All-World UCITS ETF, product ID 9679. Použije oddělený veřejný evropský Vanguard GPX GraphQL zdroj. Obvyklý broker API klíč tak i nadále poskytuje skutečné aktuální množství a ocenění, ale kompletní váhy podkladů se získávají od emitenta.

Oficiální stránka produktu: https://www.vanguard.co.uk/professional/product/etf/equity/9679/ftse-all-world-ucits
Rozhraní: https://www.ie.vanguard/gpx/graphql
Referenční implementace postupu s GraphQL: https://github.com/Sjohn21/ghostfolio-etf-data-sync/blob/main/src/sources/vanguard.ts

Toto rozhraní je veřejně používané ve webových klientech; **nejde o smluvně zaručené stabilní vývojářské API**. Vanguard ho může změnit nebo přestat obsluhovat.

## Kontroly úplnosti a integrity

- Pevně definovaný produkt a známé typy podkladů; žádné URL nebo GraphQL dotazy od uživatele.
- Postupné načítání všech stránek pomocí kurzoru lastItemKey a totalHoldings. Limity 12 stran, maximálně 12 000 aktiv.
- Důsledné odmítnutí nedostažené poslední strany, chybného počtu řádků, cyklických kurzorů, jiného fondu či smíšených dat snapshotů.
- Podkladové váhy marketValuePercentage se chápou jako procenta, ne desetinná čísla 0–1. Součet vah musí být 90 až 100,15 %; menší chybějící část zůstane nerozložená, přebytek v rámci zaokrouhlení se normalizuje.
- Kontrola záporných a neplatných vah; ETF/deriváty nejsou vydávány za přímo vlastněné akcie.
- Opatrná identita: evropský GPX nabízí SEDOL, nikoliv spolehlivý ISIN každé akcie. Akcie se v X-Ray zobrazí pod rozpoznatelným označením TICKER@SEDOL (případně SEDOL-<id>, pokud ticker chybí), aby se nesloučily dvě nesouvisející společnosti se stejným tickerem. Některé stejné akcie z přímých nákupů proto zůstanou oddělené, dokud nebude ověřené mapování SEDOL → ISIN. Jde o vědomý kompromis ve prospěch finanční správnosti.
- Pouze úspěšná celá data se používají a drží v serverové paměťové cache 12 hodin; aktualizovat je lze ručně v X-Ray.

## Ověření

Regresní testy prověřují 3 stránky s 3 800 akciemi, zachování 98,8 % identifikované a 1,2 % nerozložené části, bezpečné identity a chybná data i stránkování.

**Živé volání do GPX zatím nebylo možné provést z tohoto izolovaného build prostředí.** V případě změněného schématu nebo nedostupnosti zůstane fond nerozložený a aplikace nahlásí důvod; k provoznímu potvrzení je potřeba přímé vyzkoušení se skutečnou síťovou odpovědí na uživatelově instalaci FinanceOS.

Následuje ověření zdrojových odpovědí, robustní převod identit SEDOL/ISIN, rozšíření dalších podkladových tříd a zdravotní monitoring issuer sync.
