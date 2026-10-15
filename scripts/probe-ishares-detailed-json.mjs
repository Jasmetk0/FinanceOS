/** Read-only research of iShares issuer holdings JSON for UK UCITS; no user data. */
import {ISHARES_FEEDS} from "../lib/xray/auto-ishares.ts";
const ids=["IE00B5BMR087","IE00BF4RFH31","IE00B53SZB19"];
for(const isin of ids){
 const feed=ISHARES_FEEDS.find(f=>f.isin===isin);
 if(!feed)throw Error("Missing whitelisted "+isin);
 const base=new URL(feed.url),url=feed.url.replace("/latest-holdings.csv","");
 const productUrl=url;
 try {
  const page=await fetch(productUrl,{headers:{"User-Agent":"FinanceOS-Portfolio-XRay/1.0","Accept":"text/html"},signal:AbortSignal.timeout(25000)});
  const html=await page.text();
  const sample=[];
  for(const pattern of [/\d{11,15}\.ajax/gi,/\.ajax\?tab=all[^"'<>\s]*/gi,/aaData/gi,/fileType=json/gi]){
    sample.push({pattern:String(pattern),matches:[...html.matchAll(pattern)].slice(0,5).map(m=>({value:m[0],at:m.index,around:html.slice(Math.max(0,m.index-135),m.index+155).replace(/\s+/g," ")}))});
  }
  const patterns=[
    "US5949181045","US67066G1040","MSFT","MICROSOFT",
    "holdingsData","fundHoldings","portfolioHoldings","issuerTicker",
    "instrumentIsin","securityIsin","securityIdentifier","__NEXT_DATA__",
    "application/json","application/ld+json","window.__","dataLayer",
    "holdings","ISIN","isin","securityId","detailedHoldings"
  ];
  const sample2=patterns.map(term=>{
    const lower=html.toLowerCase(),needle=term.toLowerCase();
    const at=lower.indexOf(needle);
    return {term,count:lower.split(needle).length-1,index:at,
      around:at<0?null:html.slice(Math.max(0,at-170),at+420).replace(/\\s+/g," ").slice(0,620)};
  });
  const allEquityIsins=[...html.matchAll(/\\b(?:US|GB|CH|NL|IE|DE)[0-9A-Z]{10}\\b/g)];
  console.log("ISHARES_UK_HTML_ISIN_SCAN "+JSON.stringify({isin,status:page.status,size:html.length,
    countAll:allEquityIsins.length,
    unique:new Set(allEquityIsins.map(x=>x[0])).size,
    firstIsins:[...new Set(allEquityIsins.slice(0,30).map(x=>x[0]))],
    sample:sample2
  }));
  console.log("ISHARES_UK_PAGE_PROBE "+JSON.stringify({isin,status:page.status,bytes:html.length,sample}));
  const hashes=[...new Set([...html.matchAll(/\d{11,15}\.ajax/g)].map(m=>m[0]))];
  // Historical well-known UK iShares AJAX widget id; also try any IDs
  // discovered from the fund's official HTML. Fixed same-host paths only.
  const variants=[...new Set([...hashes,"1506575576011.ajax","1478358465952.ajax"])].slice(0,5);
  for(const id of variants){
   const endpoint=productUrl+"/"+id+"?tab=all&fileType=json";
   try {
    const response=await fetch(endpoint,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(15000)});
    const body=await response.text();
    let data;try { data=JSON.parse(body.replace(/^\uFEFF/,""));}catch{}
    const arr=data?.aaData ?? data?.data?.aaData;
    console.log("ISHARES_UK_JSON_PROBE "+JSON.stringify({isin,id,status:response.status,
      finalUrl:response.url,bytes:body.length,topKeys:data?Object.keys(data).slice(0,16):null,
      rowCount:Array.isArray(arr)?arr.length:null,
      firstRows:Array.isArray(arr)?arr.slice(0,2).map(x=>Array.isArray(x)?x.slice(0,18):x):null,
      preview:!data?body.slice(0,140):undefined}));
   }catch(e){ console.log("ISHARES_UK_JSON_ERROR "+JSON.stringify({isin,id,error:String(e)}));}
  }
 }catch(e){console.log("ISHARES_UK_PAGE_ERROR "+JSON.stringify({isin,error:String(e)}));}
}
