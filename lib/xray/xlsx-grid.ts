/**
 * Dependency-free, bounded OOXML .xlsx reader for public issuer spreadsheets.
 * No macros, formulas, external relationships, or arbitrary filesystem access.
 */
import { inflateRawSync } from "node:zlib";

const ZIP_LIMIT=16*1024*1024;
const UNPACKED_LIMIT=48*1024*1024;
const ENTRIES_LIMIT=50;
const ROW_LIMIT=40_000;
const COL_LIMIT=45;

function unpackXlsx(buffer:Uint8Array):Map<string,string> {
  const b=Buffer.from(buffer);
  if(b.length<22||b.length>ZIP_LIMIT)throw new RangeError("XLSX je prázdné nebo příliš velké.");
  // Require a conventional central-directory footer. Reject ZIP64 and
  // multi-volume archives; never rely on untrusted local header lengths.
  let eocd=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--){
    if(b.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0||b.readUInt16LE(eocd+4)!==0||b.readUInt16LE(eocd+6)!==0)throw new RangeError("Neplatný XLSX ZIP.");
  const total=b.readUInt16LE(eocd+10);
  const size=b.readUInt32LE(eocd+12);
  const offset=b.readUInt32LE(eocd+16);
  if(total>ENTRIES_LIMIT||total===0xffff||size===0xffffffff||offset===0xffffffff||
     offset+size>eocd)throw new RangeError("Nepodporovaný nebo příliš složitý XLSX soubor.");
  let index=offset,unpacked=0;
  const result=new Map<string,string>();
  for(let i=0;i<total;i++){
    if(index+46>b.length||b.readUInt32LE(index)!==0x02014b50)throw new RangeError("Poškozený XLSX index.");
    const flags=b.readUInt16LE(index+8), method=b.readUInt16LE(index+10);
    const compressed=b.readUInt32LE(index+20),original=b.readUInt32LE(index+24);
    const pathBytes=b.readUInt16LE(index+28),extra=b.readUInt16LE(index+30),comment=b.readUInt16LE(index+32);
    const local=b.readUInt32LE(index+42);
    const filename=b.toString("utf8",index+46,index+46+pathBytes);
    index+=46+pathBytes+extra+comment;
    if((flags&1)!==0||![0,8].includes(method)||original>UNPACKED_LIMIT||
      compressed>ZIP_LIMIT||index>offset+size||local+30>b.length)throw new RangeError("Nepodporovaná struktura XLSX.");
    if(!["xl/sharedStrings.xml","xl/worksheets/sheet1.xml"].includes(filename))continue;
    if(result.has(filename))throw new RangeError("Duplicitní XML uvnitř XLSX.");
    if(b.readUInt32LE(local)!==0x04034b50)throw new RangeError("Neplatný XLSX ZIP header.");
    const dataStart=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
    if(dataStart+compressed>b.length)throw new RangeError("Zkrácený XLSX ZIP.");
    const compressedData=b.subarray(dataStart,dataStart+compressed);
    const bytes=method===8?inflateRawSync(compressedData,{maxOutputLength:Math.min(UNPACKED_LIMIT,original+1)}):compressedData;
    if(bytes.length!==original)throw new RangeError("Nesoulad délky XLSX XML.");
    unpacked+=bytes.length;
    if(unpacked>UNPACKED_LIMIT)throw new RangeError("Příliš mnoho XLSX dat.");
    result.set(filename,bytes.toString("utf8"));
  }
  if(!result.has("xl/worksheets/sheet1.xml"))throw new RangeError("XLSX nemá podporovaný první list.");
  return result;
}

function unescapeXml(value:string):string{
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,s:string)=>{
    if(s[0]==="#"){
      const n=s[1]?.toLowerCase()==="x"?parseInt(s.slice(2),16):parseInt(s.slice(1),10);
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):"";
    }
    return ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'"} as Record<string,string>)[s.toLowerCase()]??"";
  });
}
function textFragments(fragment:string):string{
  return [...fragment.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>unescapeXml(m[1])).join("");
}
function columnIndex(cell:string):number{
  const a=/^[A-Z]{1,3}/i.exec(cell)?.[0].toUpperCase()??"";
  let n=0;
  for(const char of a)n=n*26+char.charCodeAt(0)-64;
  return n-1;
}
export function parseXlsxGrid(contents:Uint8Array):string[][]{
  const zip=unpackXlsx(contents);
  const shared=(zip.get("xl/sharedStrings.xml")??"");
  const strings=[...shared.matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m=>textFragments(m[1]));
  if(strings.length>200_000)throw new RangeError("XLSX obsahuje příliš mnoho sdílených textů.");
  const xml=zip.get("xl/worksheets/sheet1.xml")!;
  const output:string[][]=[];
  for(const m of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)){
    if(output.length>=ROW_LIMIT)throw new RangeError("Příliš mnoho řádků v XLSX.");
    const record:Array<string>=[],body=m[1];
    for(const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
      const attrs=c[1],value=c[2]??"";
      const cellRef=/\br="([A-Z]{1,3}\d+)"/i.exec(attrs)?.[1];
      if(!cellRef)throw new RangeError("XLSX obsahuje buňku bez adresy.");
      const index=columnIndex(cellRef);
      if(index<0||index>=COL_LIMIT)throw new RangeError("Nepodporovaný počet sloupců XLSX.");
      const type=/\bt="([^"]+)"/.exec(attrs)?.[1]??"n";
      const v=/<v>([\s\S]*?)<\/v>/.exec(value)?.[1]??"";
      if(type==="s"){
        const ref=Number(v);
        if(!Number.isSafeInteger(ref)||ref<0||ref>=strings.length)throw new RangeError("Neplatný odkaz na XLSX shared string.");
        record[index]=strings[ref];
      }else if(type==="inlineStr")record[index]=textFragments(value);
      else if(type==="n"||type==="str")record[index]=unescapeXml(v);
      else if(type==="b")record[index]=v==="1"?"TRUE":"FALSE";
      else record[index]="";
    }
    output.push(Array.from({length:Math.max(0,record.length)},(_,i)=>record[i]??""));
  }
  if(!output.length)throw new RangeError("Prázdný XLSX pracovní list.");
  return output;
}
