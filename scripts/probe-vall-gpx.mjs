import {fetchVallHoldings} from "../lib/xray/auto-vanguard.ts";
/** Temporary identity-only public GPX probe for Vanguard VALL. No credentials or portfolio data. */
const url="https://www.ie.vanguard/gpx/graphql";
const query="query FinanceOsFundIdentity($portIds:[String!]) { funds(portIds:$portIds){ profile { fundFullName fundCurrency } } borHoldings(portIds:$portIds){ holdings(limit:1500,securityTypes:null,lastItemKey:null){totalHoldings lastItemKey items { issuerName securityLongDescription marketValuePercentage sedol1 ticker securityType effectiveDate } } } }";
for(const portId of ["E161","e161","E161A","VALU"]){
 try{
   const response=await fetch(url,{method:"POST",
     headers:{"Accept":"application/json","Content-Type":"application/json","X-Consumer-ID":"ie0"},
     body:JSON.stringify({query,variables:{portIds:[portId]}}),signal:AbortSignal.timeout(17000)});
   const body=await response.text();
   const json=JSON.parse(body);
   const funds=json.data?.funds?.map(f=>f.profile?.fundFullName);
   const holdings=json.data?.borHoldings?.[0]?.holdings;
   console.log(JSON.stringify({portId,status:response.status,errors:json.errors?.map(e=>e.message),
     funds,amount:holdings?.totalHoldings,cursor:holdings?.lastItemKey,
     first:holdings?.items?.slice(0,2),bodyPreview:!holdings?body.slice(0,350):undefined}));
 }catch(err){console.log(JSON.stringify({portId,error:err instanceof Error?err.message:String(err)}));}
}

try{
 const data=await fetchVallHoldings("VALL",true);
 console.log(JSON.stringify({proof:"FULL_PRODUCTION_VALL",count:data.rows.length,
   fundIsin:data.rows[0]?.fundIsin,asOf:data.asOf,
   stockPct:data.rows.filter(r=>r.kind==="stock").reduce((sum,r)=>sum+r.weightPct,0),
   otherPct:data.rows.filter(r=>r.kind==="other").reduce((sum,r)=>sum+r.weightPct,0),
   unallocatedPct:100-data.rows.reduce((sum,r)=>sum+r.weightPct,0)}));
}catch(error){
 console.error("VALL_FULL_PRODUCTION_FAILED",error instanceof Error?error.stack:String(error));
 process.exitCode=1;
}

const items=[];
let cursor=null;
const seen=new Set();
for(let i=0;i<12;i++){
 const response=await fetch(url,{method:"POST",
   headers:{"Accept":"application/json","Content-Type":"application/json","X-Consumer-ID":"ie0"},
   body:JSON.stringify({query:"query FinanceOsVanguardHoldings($portIds:[String!],$lastItemKey:String){borHoldings(portIds:$portIds){holdings(limit:1500,securityTypes:null,lastItemKey:$lastItemKey){totalHoldings lastItemKey items{issuerName securityLongDescription marketValuePercentage sedol1 ticker securityType effectiveDate}}}}" ,
     variables:{portIds:["E161"],lastItemKey:cursor}
   }),signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(data.errors?.length)throw new Error(JSON.stringify(data.errors));
 const h=data.data?.borHoldings?.[0]?.holdings;
 if(!h)throw new Error("Missing GPX page "+i);
 items.push(...h.items);
 console.log(JSON.stringify({detailPage:i+1,total:h.totalHoldings,count:h.items.length,
   cursorPresent:Boolean(h.lastItemKey)}));
 if(!h.lastItemKey)break;
 if(seen.has(h.lastItemKey))throw Error("Cyclic");
 seen.add(h.lastItemKey);cursor=h.lastItemKey;
}
const group=new Map();
for(const x of items){
 const typ=x.securityType??"NONE",w=Number(x.marketValuePercentage);
 const g=group.get(typ)??{type:typ,count:0,positive:0,negative:0};
 g.count++;
 if(w>=0)g.positive+=w;else g.negative+=w;
 group.set(typ,g);
}
console.log("VALL_RAW_ISSUER_BREAKDOWN "+JSON.stringify({count:items.length,
 groups:[...group.values()].sort((a,b)=>Math.abs(b.negative)-Math.abs(a.negative)),
 negativeNonStock:items.filter(x=>Number(x.marketValuePercentage)<0).sort((a,b)=>Number(a.marketValuePercentage)-Number(b.marketValuePercentage)).slice(0,18).map(x=>({
   type:x.securityType,name:x.securityLongDescription,weight:x.marketValuePercentage,ticker:x.ticker
 })),
 positiveOther:items.filter(x=>!["EQ.DRCPT","EQ.FSH","EQ.PREF","EQ.PSH","EQ.REIT","EQ.STOCK"].includes(x.securityType)&&Number(x.marketValuePercentage)>0).sort((a,b)=>Number(b.marketValuePercentage)-Number(a.marketValuePercentage)).slice(0,15).map(x=>({
 type:x.securityType,name:x.securityLongDescription,weight:x.marketValuePercentage,ticker:x.ticker
 }))
}));
