"use client";

import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";
import type { IssuerFundStatus } from "./issuer-reliability.ts";

const DB_NAME="financeos-xray";
const STORE_NAME="imports";
const CACHE_KEY="automatic-issuer-snapshots-v1";
const MAX_CACHED_ROWS=35_000;
const MAX_CACHE_AGE_MS=60*24*60*60*1000;

export interface SavedIssuerSnapshots {
  version: 1;
  savedAt: string;
  rows: XRayConstituent[];
  funds: IssuerFundStatus[];
}

async function withStore<T>(operation: "readonly"|"readwrite", f:(store:IDBObjectStore,success:(value:T)=>void)=>void):Promise<T> {
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{
    const opening=indexedDB.open(DB_NAME,1);
    opening.onupgradeneeded=()=>{
      if (!opening.result.objectStoreNames.contains(STORE_NAME))
        opening.result.createObjectStore(STORE_NAME);
    };
    opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>resolve(opening.result);
  });
  try {
    return await new Promise<T>((resolve,reject)=>{
      const transaction=database.transaction(STORE_NAME,operation);
      let value:T|undefined;
      f(transaction.objectStore(STORE_NAME),(v)=>{value=v;});
      transaction.oncomplete=()=>resolve(value as T);
      transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export function validateIssuerCache(raw:unknown,now=Date.now()):SavedIssuerSnapshots|null {
  if (!raw||typeof raw!=="object"||Array.isArray(raw)) return null;
  const v=raw as Partial<SavedIssuerSnapshots>;
  if (v.version!==1 || typeof v.savedAt!=="string" ||
      !Array.isArray(v.rows)||!Array.isArray(v.funds)||
      v.rows.length>MAX_CACHED_ROWS||v.funds.length>200) return null;
  const saved=Date.parse(v.savedAt);
  if(!Number.isFinite(saved)||saved>now+60_000||now-saved>MAX_CACHE_AGE_MS)return null;
  try { validateXRayConstituents(v.rows); }
  catch { return null; }
  if (v.funds.some(f=>!f||typeof f.isin!=="string"||typeof f.symbol!=="string"||
      !["ok","error","unsupported"].includes(f.status))) return null;
  return v as SavedIssuerSnapshots;
}

export async function loadCachedIssuerSnapshots():Promise<SavedIssuerSnapshots|null> {
  const raw=await withStore<unknown>("readonly",(store,success)=>{
    const request=store.get(CACHE_KEY);
    request.onsuccess=()=>success(request.result);
  });
  return validateIssuerCache(raw);
}

export async function storeCachedIssuerSnapshots(snapshots:SavedIssuerSnapshots):Promise<void> {
  if (!validateIssuerCache(snapshots))throw new RangeError("Nelze uložit neplatnou zálohu emitenta.");
  await withStore<void>("readwrite",(store)=>{
    store.put(snapshots,CACHE_KEY);
  });
}
