# Portfolio X-Ray — ochrana před návratem ke staršímu složení ETF

## Proč je to důležité

Při automatickém načítání podkladových akcií od Vanguardu, State Street a iShares může emitent nebo jeho CDN krátkodobě vrátit starší publikovaný soubor. Datum jeho právě provedeného stažení **neznamená**, že je obsah novější. Záměna obou časů může zkreslit investiční analýzu.

## Nové pravidlo

FinanceOS nyní pro **každý fond dle ISIN samostatně** porovnává datum `asOf` nového kompletního issuer snapshotu s datem posledního dříve ověřeného snapshotu:

- **Novější `asOf`**: nahradit celé složení fondu a přepočítat ekonomické expozice.
- **Stejné `asOf`**: přijmout opravené váhy od emitenta; neslučovat řádky dvou verzí.
- **Starší `asOf`**: zachovat celé již validované novější složení; nepovolit tichý rollback.
- **Chyba emitenta**: zachovat dříve validované složení stejně jako v PR #65, ale jasně označit důvod.
- **Nový fond bez ověřené historie**: přijmout jen datum, které je platným skutečným kalendářním dnem; nevyrábět ISIN ani ticker.
- **V jednom balíku různé fondy**: návrat ke starému stavu jednoho emitenta neblokuje přijetí nových vah jiného emitenta.

Klientský panel zdrojů výslovně zobrazí, že byl od emitenta získán starší snapshot než uložená verze. Datum skutečných podkladů se čte ze **zachované ověřené** tabulky, ne ze staženého staršího souboru. Čas posledního pokusu o stažení není prezentován jako čas poslední úspěšně použité aktualizace.

Původní 60denní expiry zálohy se při rollbacku **neprodlužuje** jen kvůli novému stažení staršího souboru.

## Omezení

Tento funkční řez **neřeší kvalitu původních upstream API**, nepřidává nový zdroj dat ani nepřevádí SEDOL na ISIN bez důvěryhodného mapování. Je to konkrétní ochrana transparentnosti a konzistence matematického look-through.

Regresní testy kontrolují tržní hodnotu a nerozložený zbytek po rollbacku, souběžnou obnovu druhého fondu, stejné datum s opravenými vahami, validaci kalendářního dne a přiznané chyby emitentů.
