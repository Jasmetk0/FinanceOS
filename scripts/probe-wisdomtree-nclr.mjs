/**
 * One-off investigation of public WisdomTree NCLR product data. Read-only,
 * hardcoded issuer URLs only, no portfolio records or credentials.
 */
const urls=[
"https://www.wisdomtree.com/ie/products/equities/wisdomtree-uranium-and-nuclear-energy-ucits-etf---usd-acc",
"https://www.wisdomtree.com/gb/products/equities/wisdomtree-uranium-and-nuclear-energy-ucits-etf---usd-acc",
];
for(const url of urls){
 try{
  const response=await fetch(url,{headers:{"Accept":"text/html"},signal:AbortSignal.timeout(30_000)});
  const html=await response.text();
  const keys=["IE0003BJ2JS4","Cameco Corp","View all holdings","Remaining Portfolio",
   "Holdings","holdingsData","allHoldings","downloadHoldings","Nexgen Energy",
   "__NEXT_DATA__","__NUXT__","application/ld+json","portfolioHoldings"];
  const snippets=keys.map(key=>{
   let idx=html.toLowerCase().indexOf(key.toLowerCase());return {term:key,count:html.toLowerCase().split(key.toLowerCase()).length-1,
    index:idx,around:idx<0?null:html.slice(Math.max(0,idx-170),idx+450).replace(/\s+/g," ").slice(0,650)};
  });
  const candidateUrls=[...new Set([...html.matchAll(/https?:\\?\/\\?\/[a-zA-Z0-9._-]+[^"'<>\s]{0,200}/g)].map(m=>m[0]).filter(s=>/holdings|portfolio|wisdomtree|dataapi/i.test(s)))].slice(0,35);
  console.log("WISDOMTREE_NCLR_PAGE "+JSON.stringify({url,status:response.status,bytes:html.length,
   snippets,candidateUrls}));
 }catch(error){console.error("WISDOMTREE_NCLR_PROBE_FAILED",error.message);}
}
