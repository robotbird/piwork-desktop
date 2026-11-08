import {fromBuffer,type Entry,type ZipFile} from 'yauzl';
import {SaxesParser} from 'saxes';
const MAX_XML=8*1024*1024,MAX_TOTAL=128*1024*1024;
function openArchive(bytes:Buffer):Promise<ZipFile>{return new Promise((resolve,reject)=>fromBuffer(bytes,{lazyEntries:true,autoClose:false,validateEntrySizes:true},(error,zip)=>error?reject(error):resolve(zip)))}
/** Read only the main Word document part with bounded ZIP expansion. */
export async function extractDocxText(bytes:Buffer):Promise<string>{
 const zip=await openArchive(bytes);
 try{
  const entry=await new Promise<Entry>((resolve,reject)=>{let found:Entry|undefined,total=0;zip.on('error',reject);zip.on('entry',item=>{total+=item.uncompressedSize;if(zip.entryCount>10000||!Number.isSafeInteger(total)||total>MAX_TOTAL){reject(new Error('Document too large'));return}if(item.fileName==='word/document.xml'){if(found||item.uncompressedSize>MAX_XML){reject(new Error('Invalid document'));return}found=item}zip.readEntry()});zip.on('end',()=>found?resolve(found):reject(new Error('Missing document')));zip.readEntry()});
  const xml=await new Promise<Buffer>((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>{if(error){reject(error);return}const chunks:Buffer[]=[];let size=0;stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_XML){stream.destroy(new Error('Document too large'));return}chunks.push(chunk)});stream.on('error',reject);stream.on('end',()=>resolve(Buffer.concat(chunks)))}));
  const parser=new SaxesParser({xmlns:true});let inText=false;let out='';let truncated=false;const add=(value:string)=>{if(out.length+value.length>64000){out+=(value.slice(0,Math.max(0,64000-out.length)));truncated=true}else out+=value};
  parser.on('doctype',()=>{throw new Error('Unsupported document declaration')});parser.on('opentag',tag=>{if(tag.local==='t'&&tag.uri==='http://schemas.openxmlformats.org/wordprocessingml/2006/main')inText=true;else if(tag.uri==='http://schemas.openxmlformats.org/wordprocessingml/2006/main'&&tag.local==='tab')add('\t');else if(tag.uri==='http://schemas.openxmlformats.org/wordprocessingml/2006/main'&&tag.local==='br')add('\n')});parser.on('text',text=>{if(inText)add(text)});parser.on('closetag',tag=>{if(tag.uri!=='http://schemas.openxmlformats.org/wordprocessingml/2006/main')return;if(tag.local==='t')inText=false;else if(tag.local==='p')add('\n');else if(tag.local==='tc')add('\t')});parser.write(new TextDecoder('utf-8',{fatal:true}).decode(xml)).close();return out.trim()+(truncated?'\n[Text truncated]':'');
 }finally{zip.close()}
}
