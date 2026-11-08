import Database from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,promises as fs,constants} from 'node:fs';
import path from 'node:path';
import {inspectPublishedDatabase} from './metadata-store.ts';
import {requireSafeSqliteVersion} from './sqlite-version.ts';

class BackupInvalidError extends Error {}
type Manifest={version:1;id:string;createdAt:string;schemaVersion:number;sha256:string;bytes:number;scope:'metadata-only';integrity:'ok'};
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function hashFile(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk as Buffer);return hash.digest('hex')}
async function syncPath(file:string){const fd=await fs.open(file,'r');try{await fd.sync()}finally{await fd.close()}}
async function privateDirectory(dir:string,create=false){if(create)await fs.mkdir(dir,{mode:0o700,recursive:true});const info=await fs.lstat(dir);if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))throw new Error('Unsafe backup directory')}
async function privateFile(file:string){const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))throw new Error('Unsafe backup file');return info}
function probeSqlite(){const db=new Database(':memory:');try{const row=db.prepare('SELECT sqlite_version() AS version').get() as {version:unknown};requireSafeSqliteVersion(row.version)}finally{db.close()}}
function checkId(id:string){if(!idPattern.test(id))throw new Error('Invalid backup id')}
function parseManifest(input:unknown,id:string):Manifest{const m=input as Partial<Manifest>|null;if(!m||typeof m!=='object'||m.version!==1||m.id!==id||m.scope!=='metadata-only'||m.integrity!=='ok'||m.schemaVersion!==2||typeof m.createdAt!=='string'||!Number.isFinite(Date.parse(m.createdAt))||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isSafeInteger(m.bytes)||Number(m.bytes)<=0)throw new BackupInvalidError('Invalid backup manifest');return m as Manifest}

/** The caller controls all writers when cross-file consistency is required; this is metadata only. */
export async function createMetadataBackup(source:string,root:string,options:{onStage?:(stage:string)=>void}={}):Promise<Manifest>{
 probeSqlite();inspectPublishedDatabase(source);await privateDirectory(root,true);
 const id=randomUUID(),dir=path.join(root,id);await fs.mkdir(dir,{mode:0o700});await privateDirectory(dir);await syncPath(root);
 const target=path.join(dir,'metadata.sqlite');const fd=await fs.open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);await fd.close();
 const sourceDb=new Database(source,{readonly:true,fileMustExist:true});try{await sourceDb.backup(target)}finally{sourceDb.close()}
 options.onStage?.('snapshot');const info=await privateFile(target);inspectPublishedDatabase(target);await syncPath(target);
 const manifest:Manifest={version:1,id,createdAt:new Date().toISOString(),schemaVersion:2,sha256:await hashFile(target),bytes:info.size,scope:'metadata-only',integrity:'ok'};
 options.onStage?.('validated');const marker=path.join(dir,'manifest.json');const out=await fs.open(marker,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);try{await out.writeFile(JSON.stringify(manifest));await out.sync()}finally{await out.close()};await syncPath(dir);
 return manifest;
}

/** Validate the file and manifest without changing the original or opening a writable database. */
export async function validateMetadataBackup(root:string,id:string):Promise<Manifest>{
 checkId(id);await privateDirectory(root);const dir=path.join(root,id);await privateDirectory(dir);const marker=path.join(dir,'manifest.json'),target=path.join(dir,'metadata.sqlite');const markerInfo=await privateFile(marker);if(markerInfo.size>8192)throw new BackupInvalidError('Invalid backup manifest');const content=await fs.readFile(marker,'utf8');let value:unknown;try{value=JSON.parse(content)}catch{throw new BackupInvalidError('Invalid backup manifest')};const manifest=parseManifest(value,id);const info=await privateFile(target);if(info.size!==manifest.bytes||await hashFile(target)!==manifest.sha256)throw new BackupInvalidError('Backup checksum mismatch');probeSqlite();inspectPublishedDatabase(target);return manifest;
}

/** List only recognizable IDs; incomplete or damaged backups remain visible and are never deleted. */
export async function listMetadataBackups(root:string){
 await privateDirectory(root);const ids=(await fs.readdir(root)).filter(id=>idPattern.test(id)).sort();const entries=[];
 for(const id of ids){try{entries.push({id,status:'valid' as const,manifest:await validateMetadataBackup(root,id)})}catch(error){const category=classifyStorageError(error);if(error instanceof BackupInvalidError||category==='missing'||category==='corrupt')entries.push({id,status:'invalid' as const});else entries.push({id,status:'unavailable' as const,category})}}
 return entries;
}

/** Prepare a verified independent restore candidate; does not replace the live database. */
export async function prepareMetadataRestore(root:string,id:string,stagingRoot:string){
 const manifest=await validateMetadataBackup(root,id);await privateDirectory(stagingRoot,true);const dir=path.join(stagingRoot,randomUUID());await fs.mkdir(dir,{mode:0o700});await syncPath(stagingRoot);
 const source=path.join(root,id,'metadata.sqlite'),target=path.join(dir,'metadata.sqlite');await fs.copyFile(source,target,constants.COPYFILE_EXCL);await fs.chmod(target,0o600);await privateFile(target);await syncPath(target);
 if(await hashFile(target)!==manifest.sha256)throw new Error('Restore candidate checksum mismatch');inspectPublishedDatabase(target);await syncPath(dir);return {directory:dir,backupId:id,createdAt:manifest.createdAt,scope:manifest.scope};
}

/** Suggest older verified snapshots for a later explicit cleanup; never deletes files. */
export function planBackupRetention(entries:{id:string;status:'valid'|'invalid'|'unavailable';manifest?:Manifest}[],maximum:number){
 if(!Number.isSafeInteger(maximum)||maximum<1)throw new Error('Invalid backup retention limit');
 const valid=entries.filter((entry):entry is {id:string;status:'valid';manifest:Manifest}=>entry.status==='valid'&&!!entry.manifest).slice().sort((a,b)=>b.manifest.createdAt.localeCompare(a.manifest.createdAt)||a.id.localeCompare(b.id));
 return {keep:valid.slice(0,maximum).map(item=>item.id),candidates:valid.slice(maximum).map(item=>item.id),unverified:entries.filter(item=>item.status!=='valid'||!item.manifest).map(item=>item.id)};
}

/** Keep I/O, capacity and permissions distinct from proven SQLite corruption. */
export function classifyStorageError(error:unknown):'permission'|'space'|'missing'|'corrupt'|'busy'|'io'{
 const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
 if(['EACCES','EPERM','EROFS','SQLITE_PERM','SQLITE_READONLY'].some(value=>code===value||code.startsWith(value+'_')))return 'permission';
 if(['ENOSPC','EDQUOT','SQLITE_FULL'].includes(code))return 'space';
 if(code==='ENOENT')return 'missing';
 if(code==='SQLITE_CORRUPT'||code.startsWith('SQLITE_CORRUPT_')||code==='SQLITE_NOTADB')return 'corrupt';
 if(code==='SQLITE_BUSY'||code.startsWith('SQLITE_BUSY_')||code==='SQLITE_LOCKED'||code.startsWith('SQLITE_LOCKED_'))return 'busy';
 return 'io';
}
