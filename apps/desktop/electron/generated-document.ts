import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {ChatMessage} from '../shared/types.ts';

/** Only cache the exact local document referenced by an assistant in this chat. */
export async function cacheGeneratedDocument(target:string,messages:Pick<ChatMessage,'role'|'text'>[],cacheDir:string):Promise<{name:string;cache:string}>{
  if(typeof target!=='string'||!path.isAbsolute(target)||target.includes('\0')||! /\.(?:pptx?|docx?|xlsx?|pdf|odt|ods|odp|rtf|txt|md|markdown|csv|tsv|html?|json|xml|ya?ml|svg|png|jpe?g|webp|gif)$/i.test(target))throw new Error('Invalid document path');
  const candidates=[target,encodeURI(target),encodeURIComponent(target),`file://${target}`,`file://${encodeURI(target)}`];
  const referenced=messages.some(message=>message.role==='assistant'&&candidates.some(candidate=>{
    const escaped=candidate.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp("(?:^|[\\s`(<\"'])"+escaped+"(?=$|[\\s`)>\"'*，。；])",'u').test(message.text);
  }));
  if(!referenced)throw new Error('Document is not referenced by this chat');
  const file=await fs.open(target,'r');
  const token=randomUUID();
  const name=path.basename(target);
  const destination=path.join(cacheDir,token);
  try{
    const info=await file.stat();
    if(!info.isFile()||info.size>20*1024*1024)throw new Error('Document exceeds preview limits');
    await fs.mkdir(destination,{recursive:true,mode:0o700});
    // Read from the verified handle, so replacing the path cannot change the copied file.
    const content=await file.readFile();
    if(content.byteLength>20*1024*1024)throw new Error('Document exceeds preview limits');
    await fs.writeFile(path.join(destination,name),content,{mode:0o600,flag:'wx'});
    return {name,cache:`${token}/${name}`};
  }catch(error){await fs.rm(destination,{recursive:true,force:true});throw error}
  finally{await file.close()}
}
