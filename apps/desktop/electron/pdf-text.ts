import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {promises as fs} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const pdfRoot=path.resolve(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')),'../..');
class LocalCMapReaderFactory {async fetch({name}:{name:string}){if(!/^[A-Za-z0-9_-]+$/.test(name))throw new Error('Invalid CMap name');return {cMapData:new Uint8Array(await fs.readFile(path.join(pdfRoot,'cmaps',`${name}.bcmap`))),isCompressed:true}}}
class LocalStandardFontDataFactory {async fetch({filename}:{filename:string}){if(!/^[A-Za-z0-9_.-]+$/.test(filename))throw new Error('Invalid font name');return new Uint8Array(await fs.readFile(path.join(pdfRoot,'standard_fonts',filename)))}}

/** Extract searchable text only; scanned pages require OCR and are not interpreted here. */
export async function extractPdfText(bytes:Uint8Array):Promise<string>{
 const {getDocument,GlobalWorkerOptions}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 GlobalWorkerOptions.workerSrc=pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
 const task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,cMapUrl:'local/',cMapPacked:true,standardFontDataUrl:'local/',CMapReaderFactory:LocalCMapReaderFactory,StandardFontDataFactory:LocalStandardFontDataFactory});
 try{
  const document=await task.promise;const limit=Math.min(document.numPages,100);let output='';let hasText=false;let truncated=document.numPages>limit;
  for(let index=1;index<=limit;index++){
   const page=await document.getPage(index);try{const content=await page.getTextContent();const text=content.items.map(item=>'str' in item?item.str:'').join(' ');if(text.trim())hasText=true;const next=`## Page ${index}\n${text}\n\n`;if(output.length+next.length>64000){output+=next.slice(0,Math.max(0,64000-output.length));truncated=true;break}output+=next}finally{page.cleanup()}
  }
  return output.trim()+(hasText?'':'\n[No extractable text; scanned pages may require OCR.]')+(truncated?'\n[Text truncated]':'');
 }finally{await task.destroy()}
}
