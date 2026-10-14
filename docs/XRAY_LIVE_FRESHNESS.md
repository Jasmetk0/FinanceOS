# Portfolio X-Ray — automatická aktuálnost API a emitentů

## Co znamená live

FinanceOS nemá burzovní tick-by-tick stream. Má však periodické obnovení propojených investičních API účtů bez nahrávání CSV a bez opakovaného zadávání klíčů.

Dva oddělené typy dat:

1. **Počty a ocenění pozic:** Trading 212, Kraken a Phantom z posledního úspěšného syncu. V lokální databázi jsou zaznamenány poslední synchronizace připojení a data aktualizace jednotlivých pozic.
2. **Skutečné složení ETF:** automaticky od emitentů iShares, State Street SPDR a Vanguard podle ISIN. Datum zveřejněného snapshotu je odlišné od času jeho stažení nebo od ceny ETF. Emitenti nemusejí holdings aktualizovat v reálném čase.

## Nově implementované chování

- Při otevření stránky /xray se načte aktuální stav připojení a lokálních pozic. Pokud jsou propojené účty starší než 15 minut nebo poslední sync selhal, automaticky se spustí existující API synchronizace.
- Při aktivní viditelné kartě se stav kontroluje každých 5 minut a při návratu na kartu. Nejde o neustále běžící úlohu mimo spuštěnou aplikaci.
- Automatické pokusy se omezují na jeden za 15 minut na klientovi i serveru. Ruční refresh má serverový cooldown 30 sekund. Již probíhající synchronizace je sdílená, nikoliv duplicitně spuštěná.
- Tlačítko „Aktualizovat účty + ETF nyní“ provede novou synchronizaci připojených API účtů a zároveň vynutí nový issuer refresh.
- Po nové synchronizaci se portfolio přepočítá přímo ze skutečných pozic bez ručního obnovení stránky, včetně nově koupených či prodaných ETF.
- Viditelné jsou poslední úspěšné syncy jednotlivých providerů, nejstarší a nejnovější aktualizace pozic, plus samostatné issuer datum složení a čas stažení.
- Při chybě brokera zůstanou dříve uložené pozice k dispozici, ale objeví se varování; nejsou prohlašovány za skutečně živé.

## Soukromí a integrita

Lokální endpointy GET/POST /api/xray/live jsou omezené na localhost. Používají stávající bezpečně uložené credentials a běžný synchronizační modul FinanceOS, nikdy nepředávají API klíče do prohlížeče nebo k emitentům ETF. Endpoint vrací jen identitu provideru, stav a případnou chybu.

Žádná změna historického účetního ledgeru nebo klasifikací externích vkladů. Změna synchronizuje existující providerem vedené pozice stejně jako stránka Propojení.

## Limity

- Interval 15 minut není reálný burzovní stream. Broker může poskytovat ocenění opožděně.
- Žádné synchronizace mimo běžící a viditelnou lokální aplikaci.
- Mintos a Investown nejsou dostupné přes tento pravidelný broker sync a používají svá dosavadní importní workflow.
- Neúspěšný či nepodporovaný ETF feed zůstává nerozložený nebo se použije ověřená dřívější lokální záloha.
- Úspěšné automatické regresní testy nejsou ekvivalentem plného prohlížečového testu se skutečně připojenými poskytovateli.
