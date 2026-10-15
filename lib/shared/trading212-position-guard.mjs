/**
 * Fail-closed Trading 212 open-position import.
 *
 * The positions endpoint is a COMPLETE account snapshot, not a patch:
 * silently skipping even one malformed row and then replaceHoldings()
 * would delete previously valid shares and falsify X-Ray and investedValue.
 * Validate ALL source rows before any account/asset/holding mutation.
 */
const object=(v)=>v!==null && typeof v==="object" && !Array.isArray(v);
const money=(v)=>typeof v==="number" && Number.isFinite(v) ||
  typeof v==="string" && v.trim()!=="" && Number.isFinite(Number(v));
const num=(v)=>Number(v);

export function assertTrading212PositionSnapshot(payload,summary={}) {
  if(!Array.isArray(payload)) {
    throw new RangeError("Trading 212 vrátil neplatnou strukturu pozic. Předchozí portfolio zůstává zachováno.");
  }
  if(payload.length>30000)throw new RangeError("Trading 212 vrátil nečekaně mnoho pozic.");
  const seen=new Set();
  for(let i=0;i<payload.length;i++){
    const p=payload[i];
    const ticker=(object(p?.instrument) ? p.instrument.ticker : null) ?? p?.ticker;
    if(!object(p)||typeof ticker!=="string"||!ticker.trim()) {
      throw new RangeError("Trading 212: pozice č. "+(i+1)+" nemá identifikovatelný ticker. Předchozí pozice nebyly přepsány.");
    }
    if(seen.has(ticker.trim()))throw new RangeError(
      "Trading 212 vrátil více pozic se stejným ID tickeru "+ticker.trim()+". Předchozí pozice zůstávají zachovány.");
    seen.add(ticker.trim());
    if(!money(p.quantity)||num(p.quantity)<0){
      throw new RangeError("Trading 212: pozice "+ticker+" má neplatný počet kusů.");
    }
    const wallet=object(p.walletImpact)?p.walletImpact:null;
    const hasWallet=wallet && Object.hasOwn(wallet,"currentValue") &&
      wallet.currentValue !== null && wallet.currentValue !== undefined;
    if(hasWallet && (!money(wallet.currentValue)||num(wallet.currentValue)<0)){
      throw new RangeError("Trading 212: pozice "+ticker+" má neplatnou hodnotu walletImpact.currentValue.");
    }
    if(hasWallet && !(typeof wallet.currency==="string" && /^[A-Z]{3}$/.test(wallet.currency.toUpperCase()))){
      throw new RangeError("Trading 212: pozice "+ticker+" má walletImpact.currentValue bez měny.");
    }
    // Only use instrument-currency quantity × price when account-wallet
    // valuation is absent. Missing price is NOT the same as a quoted zero.
    if(!hasWallet && (!money(p.currentPrice)||num(p.currentPrice)<0)){
      throw new RangeError("Trading 212: pozice "+ticker+" nemá platnou aktuální cenu ani wallet hodnotu.");
    }
    // Valid zero-valued/suspended positions can exist; do not fabricate
    // a price, but preserve their actual source value if explicitly given.
    if(num(p.quantity)>0 && !hasWallet && num(p.currentPrice)===0){
      throw new RangeError("Trading 212: pozice "+ticker+" nemá ověřitelnou kladnou hodnotu, nulová cena je nejednoznačná.");
    }
  }
  const invest=money(summary.investmentsCurrentValue)?num(summary.investmentsCurrentValue):0;
  const pieCash=money(summary.pieCash)?num(summary.pieCash):0;
  // A truly empty account is fine. But an EMPTY positions array while the
  // broker itself reports invested securities cannot be accepted as a sale.
  if(payload.length===0 && invest>Math.max(0,pieCash)+0.05){
    throw new RangeError("Trading 212 vrátil prázdné pozice, ale účet hlásí investované prostředky. Předchozí držby nebyly smazány.");
  }
  return payload;
}

/**
 * Explicit wallet currentValue is already denominated in walletImpact.currency
 * (account currency); otherwise quantity × currentPrice is denominated in
 * the instrument currency. Do not choose currency from the presence of an
 * unrelated walletImpact field such as fxImpact or unrealizedProfitLoss.
 */
export function trading212PositionValuation(position,instrumentCurrency){
  const wallet=object(position.walletImpact)?position.walletImpact:{};
  const hasWallet=Object.hasOwn(wallet,"currentValue") && wallet.currentValue != null;
  const quantity=num(position.quantity);
  if(hasWallet){
    return {marketValue:num(wallet.currentValue),currency:wallet.currency.toUpperCase(),source:"wallet"};
  }
  return {marketValue:quantity*num(position.currentPrice),currency:instrumentCurrency.toUpperCase(),source:"instrument"};
}

/** Never subtract an instrument-currency cost from a wallet-currency value. */
export function trading212PositionUnrealizedPnl(position,valuation){
  const wallet=object(position.walletImpact)?position.walletImpact:{};
  if(money(wallet.unrealizedProfitLoss))return num(wallet.unrealizedProfitLoss);
  if(valuation.source==="wallet"){
    return money(wallet.totalCost) ? valuation.marketValue-num(wallet.totalCost) : null;
  }
  return money(position.averagePricePaid)
    ? valuation.marketValue-num(position.quantity)*num(position.averagePricePaid) : null;
}
