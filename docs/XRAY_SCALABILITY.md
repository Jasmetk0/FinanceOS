# Portfolio X-Ray — škálovatelnost a provenience


## Výkon pro rozsáhlé fondy a konzistence snapshotů

Výpočet rozkladu fondu nyní používá vložení do existující skupiny v konstantním čase místo opakovaného kopírování rostoucího pole při každém podkladovém titulu. Při vysokém počtu constituentů jde o změnu ze zbytečně kvadratického na lineární seskupování podkladových řádků. Zbytek analýzy zahrnuje očekávané seskupování a závěrečné řazení výsledků.

Z bezpečnostních důvodů se pro jedno ETF **neslučují dvě sady složení se stejným datem, ale odlišně deklarovaným zdrojem**. Celá příslušná investice v takovém případě zůstane nerozložená a ve výstupu se zobrazí výstraha. Toto pravidlo doplňuje starší odmítnutí smíšených dat snapshotů. Složení z více brokerů se tím nezakazuje; rozhoduje dohledaný zdroj **podkladového souboru emitenta**, nikoliv broker, na kterém je fond vlastněn.

Regresní test zahrnuje ETF s 10 000 podkladovými akciemi a kontroluje zachování hodnoty a nezapočítaného zbytku.
