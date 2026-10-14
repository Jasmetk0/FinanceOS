# Portfolio X-Ray — bezpečné identity akcií napříč brokery a fondy

## Proč je oprava nutná

Předchozí X-Ray používal fallback **stejný ticker → stejný ISIN**, pokud byl mezi podklady fondů jen jeden kandidát. To však není nezávislý důkaz stejné akciové třídy. Burzy opakují tickery, mohou existovat rozdílné podíly a společnost může vydávat další cenné papíry. V takovém případě se přímý nákup omylem sčítal s ETF podkladem a X-Ray vykazoval falešnou koncentraci.

Další chyba: uživatelem ručně nahrané symbol-only CSV se za určitých okolností aplikovalo i na držený ETF s **jiným explicitním ISIN**, pokud souhlasil ticker. To je riziko nesprávných procent a naprosto nepatří do účetního přehledu.

## Nové jednoznačné slučování

- **Přímá akcie s ISIN**: spojuje se jen s identickou ISIN akcií napříč účty, případně s odpovídajícím podkladem ETF. Akceptuje se též brokerův explicitní kanonický klíč `isin:`.
- **Přímá akcie bez ISIN**: zůstane samostatná pod identitou konkrétní držené pozice. Není automaticky převedena na nějaký ISIN jen na základě tickeru ani spojena s dalším brokerem stejného tickeru.
- **ETF podklad s ověřeným ISIN**: seskupuje se přesný ISIN, nezávisle na rozdílných burzovních tickerech.
- **ETF podklad s platným SEDOL**: přednostně využije již implementovaný kontrolovaný SEDOL→ISIN crosswalk z State Street SPYI; jinak je možné seskupit identický validovaný SEDOL, ale takový řádek zůstává nižší úrovní identity.
- **ETF podklad jen s tickerem**: je oddělený podle konkrétního fondu (ISIN či identita fondu). Nerozlišitelné údaje z různých fondů se nesmějí slučovat bez ISIN/SEDOL.
- **ETF, které má známý ISIN**: používá pouze zdroj složení se stejným `fund_isin`. Symbol-only CSV bez tohoto identifikátoru není důvěryhodné pro takový fond a zůstane nerozložený s varováním.
- **ETF bez známého ISIN**: staré symbol-only CSV může fungovat, ale pouze pokud stejný ticker nereprezentuje více fondů.
- **Krypto**: stávající konzervativní pravidla normalizace symbolů se nemění. Symbol bez mint/chain identity nelze vydávat za jednoznačně ověřený kontrakt.

## Výsledek pro uživatele

Hodnota portfolia, váhy v Kč, historie transakcí i ledger zůstávají stejné. Může **vzniknout více samostatných řádků se stejným tickerem** tam, kde důkaz totožné akciové třídy zatím neexistuje. To je záměrná ochrana proti falešnému slučování, nikoli finanční ztráta. V detailu řádku X-Ray nově uvádí dostupnou úroveň identifikátoru. V přehledu se zobrazí upozornění na chybějící ISIN u přímých pozic a nesprávně vyplněný fund_isin u ručního CSV.

Žádné nové API klíče, neověřená externí lookup služba ani změna původních finančních transakcí. Opravuje se pouze výpočet ekonomických expozic.

## Regresní kontrola

Testy pokrývají nezávislé účty se stejným tickerem, přímou a fondovou pozici se stejným tickerem a jiným ISIN, bezpečné spojování identického ISIN, kanonické ISIN, stejné SEDOL napříč fondy, falešné přiřazení symbol-only CSV ke známému ETF a konzervaci součtu všech CZK expozic.
