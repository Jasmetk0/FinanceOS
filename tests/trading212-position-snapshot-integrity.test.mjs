import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertTrading212PositionSnapshot,
  trading212PositionValuation,
  trading212PositionUnrealizedPnl,
} from "../lib/shared/trading212-position-guard.mjs";

const row=(ticker="AAPL_US_EQ",overrides={})=>({
  instrument:{ticker,currency:"USD",isin:"US0378331005"},
  quantity:2.5,averagePricePaid:100,currentPrice:120,
  walletImpact:{currency:"CZK",currentValue:7500,totalCost:6400,unrealizedProfitLoss:1100},
  ...overrides,
});
const money=(p,currency="USD")=>{
  const v=trading212PositionValuation(p,currency);
  return {marketValue:v.marketValue,currency:v.currency,source:v.source,
    pnl:trading212PositionUnrealizedPnl(p,v)};
};

test("all valid open positions from official nested Trading 212 API are kept without losing rows",()=>{
  const positions=[row(),row("MSFT_US_EQ")];
  assert.equal(assertTrading212PositionSnapshot(positions,{investmentsCurrentValue:50000}),positions);
  const a=money(positions[0]);
  assert.deepEqual(a,{marketValue:7500,currency:"CZK",source:"wallet",pnl:1100});
});

test("missing or malformed positions array cannot ever trigger destructive empty replacement",()=>{
  for(const payload of [undefined,null,{},{"items":[row()]},true,"",15]){
    assert.throws(()=>assertTrading212PositionSnapshot(payload),/neplatnou strukturu/);
  }
  assert.deepEqual(assertTrading212PositionSnapshot([],{investmentsCurrentValue:0}),[]);
  assert.deepEqual(assertTrading212PositionSnapshot([],{investmentsCurrentValue:25,pieCash:25}),[]);
  assert.throws(()=>assertTrading212PositionSnapshot([],{investmentsCurrentValue:100,pieCash:30}),/prázdné pozice/);
});

test("any missing ticker, null row or duplicate broker instrument ID aborts entire snapshot",()=>{
  for(const bad of [
    [row(),{quantity:1,currentPrice:10}],
    [null],
    [row("A"),row("A")],
    [row("",{instrument:{currency:"USD"}})],
  ]){
    assert.throws(()=>assertTrading212PositionSnapshot(bad),/ticker|stejným ID|pozice/);
  }
});

test("source quantity must be finite and nonnegative; no silent zero from malformed JSON",()=>{
  for(const quantity of [undefined,null,"",NaN,Infinity,-2,"abc"]){
    assert.throws(()=>assertTrading212PositionSnapshot([row("MSFT_US_EQ",{quantity})]),
      /neplatný počet kusů/);
  }
  assert.equal(assertTrading212PositionSnapshot([row()]).length,1);
  assert.equal(assertTrading212PositionSnapshot([row("D",{quantity:0,
    walletImpact:{currency:"CZK",currentValue:0}})]).length,1);
});

test("valid account wallet currentValue always uses WALLET currency, not instrument currency",()=>{
  const p=row("NVIDIA_US_EQ",{quantity:10,currentPrice:200,
    walletImpact:{currency:"CZK",currentValue:45200,unrealizedProfitLoss:20200}});
  assert.deepEqual(money(p),{marketValue:45200,currency:"CZK",source:"wallet",pnl:20200});
});

test("instrument fallback uses instrument price currency even if walletImpact has unrelated FX metadata",()=>{
  const p=row("AAPL_US_EQ",{quantity:3,currentPrice:100,averagePricePaid:60,
    walletImpact:{currency:"CZK",fxImpact:-50}});
  assert.equal(assertTrading212PositionSnapshot([p]).length,1);
  assert.deepEqual(money(p),{marketValue:300,currency:"USD",source:"instrument",pnl:120});
});

test("never subtract instrument averagePrice from account-currency wallet currentValue",()=>{
  const p=row("AMD_US_EQ",{quantity:2,averagePricePaid:100,currentPrice:110,
    walletImpact:{currency:"CZK",currentValue:5200}});
  assert.deepEqual(money(p),{marketValue:5200,currency:"CZK",source:"wallet",pnl:null});
  const cost={...p,walletImpact:{currency:"CZK",currentValue:5200,totalCost:4800}};
  assert.equal(money(cost).pnl,400);
});

test("wallet profit without wallet valuation must not mix quote and PnL currencies",()=>{
  const p=row("AMD_US_EQ",{quantity:2,averagePricePaid:50,currentPrice:80,
    walletImpact:{currency:"CZK",unrealizedProfitLoss:1000}});
  assert.deepEqual(money(p),{marketValue:160,currency:"USD",source:"instrument",pnl:60});
});

test("explicit invalid account-currency wallet value and missing FX currency fail closed",()=>{
  for(const walletImpact of [
    {currency:"CZK",currentValue:"not-a-number"},
    {currency:"CZK",currentValue:-1},
    {currentValue:300},
    {currency:"USDD",currentValue:200},
  ]){
    assert.throws(()=>assertTrading212PositionSnapshot([row("A",{walletImpact})]),
      /neplatnou hodnotu|bez měny/);
  }
});

test("missing price may never silently zero an existing open position",()=>{
  for(const currentPrice of [undefined,null,"","NaN",Infinity,-1,0]){
    const p=row("A",{quantity:5,currentPrice,walletImpact:{currency:"CZK",fxImpact:1}});
    assert.throws(()=>assertTrading212PositionSnapshot([p]),
      /nemá platnou aktuální cenu|nulová cena/);
  }
  const explicitZero=row("A",{quantity:5,walletImpact:{currency:"USD",currentValue:0}});
  assert.equal(money(explicitZero).marketValue,0);
});

test("integration validates the whole API response BEFORE account mutation and replaceHoldings",()=>{
  const s=readFileSync(new URL("../lib/server/integrations/trading212.ts",import.meta.url),"utf8");
  const preflight=s.indexOf("const checkedPositions = assertTrading212PositionSnapshot");
  const account=s.indexOf("const accountIdValue = upsertAccount");
  const replace=s.indexOf("replaceHoldings(accountIdValue, holdings);");
  assert.ok(preflight>0 && account>preflight && replace>account);
  assert.ok(s.includes("for (const rawPosition of checkedPositions)"));
  assert.ok(!s.includes("if (!ticker) continue;"));
  assert.ok(s.includes("toCzk(marketValue,valuation.currency)"));
  assert.ok(s.includes("trading212PositionUnrealizedPnl(position,valuation)"));
  assert.ok(s.includes("pnl === null ? Promise.resolve(null)"));
});
