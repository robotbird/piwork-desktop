import {createHash,randomUUID} from 'node:crypto';
import {promises as fs,constants} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {MetadataStore,inspectPublishedDatabase} from './metadata-store.ts';
import {preflightLegacy} from './legacy-preflight.ts';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function syncFile(file:string){const handle=await fs.open(file,'r');try{await handle.sync()}finally{await handle.close()}}
async function syncDirectory(dir:string){const handle=await fs.open(dir,'r');try{await handle.sync()}finally{await handle.close()}}
async function exists(file:string){try{await fs.lstat(file);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}}

/** Isolated migration primitive. Caller must hold the application single-instance lock. */
export async function migrateLegacyMetadata(directory:string,options:{onStage?:(stage:string)=>void}={}){
 const source=path.join(directory,'settings.json'),target=path.join(directory,'metadata.sqlite');
 if(await exists(target)){
  const info=await fs.lstat(target);if(!info.isFile()||info.isSymbolicLink())throw new Error('Invalid metadata target');
  const receipt=inspectPublishedDatabase(target);
  if(receipt.kind!=='legacy'||!await exists(source)||digest(await fs.readFile(source))!==receipt.sourceSha256)throw new Error('Metadata source conflict');
  return {status:'already-migrated' as const};
 }
 if(!await exists(source))throw new Error('Legacy metadata missing; recovery required');
 const bytes=await fs.readFile(source);let parsed:unknown;try{parsed=JSON.parse(bytes.toString('utf8'))}catch{throw new Error('Invalid legacy JSON')}
 const snapshot=preflightLegacy(parsed),sha=digest(bytes);
 const backupDirectory=path.join(directory,'migration-backups');await fs.mkdir(backupDirectory,{recursive:true,mode:0o700});
 const backupDirInfo=await fs.lstat(backupDirectory);if(!backupDirInfo.isDirectory()||backupDirInfo.isSymbolicLink()||(backupDirInfo.mode&0o077)!==0)throw new Error('Unsafe backup directory');
 const backup=path.join(backupDirectory,`settings-${sha}.json`);
 try{const handle=await fs.open(backup,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
 const backupInfo=await fs.lstat(backup);if(!backupInfo.isFile()||backupInfo.isSymbolicLink()||backupInfo.nlink!==1||(backupInfo.mode&0o077)!==0)throw new Error('Unsafe metadata backup');
 if(!bytes.equals(await fs.readFile(backup))||!bytes.equals(await fs.readFile(source)))throw new Error('Legacy backup verification failed');
 await syncDirectory(backupDirectory);options.onStage?.('backup');
 const temporary=path.join(directory,`.metadata-migration-${randomUUID()}.sqlite`);
 let store:MetadataStore|undefined;
 try{
  store=new MetadataStore(temporary,{allowCreate:true});store.importSnapshot(snapshot,{kind:'legacy',sourceSha256:sha});
  if(!store.integrityCheck()||!isDeepStrictEqual(store.snapshot(),snapshot))throw new Error('Metadata migration validation failed');
  options.onStage?.('import');store.preparePublication();store.close();store=undefined;
  await syncFile(temporary);
  if(!bytes.equals(await fs.readFile(source)))throw new Error('Metadata source changed during migration');
  options.onStage?.('before-publish');
  await fs.link(temporary,target);await syncDirectory(directory);options.onStage?.('publish');
  await fs.unlink(temporary);await syncDirectory(directory);
  return {status:'migrated' as const};
 }finally{store?.close()}
}
