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
