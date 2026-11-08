import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const packaged=process.env.PIWORK_PACKAGED_APP==='1';
const url=name=>packaged?pathToFileURL(path.join(process.resourcesPath,'app.asar','dist-electron',name+'.js')).href:new URL('../apps/desktop/electron/'+name+'.ts',import.meta.url).href;
const {MetadataStore}=await import(url('metadata-store'));
const {createMetadataBackup,validateMetadataBackup,listMetadataBackups,prepareMetadataRestore,planBackupRetention,classifyStorageError}=await import(url('metadata-backup'));
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-backup-'));let store,restored;
try{
 const db=path.join(root,'metadata.sqlite'),backups=path.join(root,'backups'),staging=path.join(root,'staging');store=new MetadataStore(db,{allowCreate:true});
 store.importSnapshot({preferences:{appearance:'dark',language:'en'},projects:[],chats:[{id:'c',title:'before',updatedAt:1}]},{kind:'fresh',sourceSha256:null});
 store.saveChat({id:'c',title:'from WAL',updatedAt:2});assert.ok((await stat(db+'-wal')).size>0);
 const manifest=await createMetadataBackup(db,backups);assert.equal(manifest.scope,'metadata-only');assert.equal((await stat(path.join(backups,manifest.id,'metadata.sqlite'))).mode&0o077,0);
 store.saveChat({id:'c',title:'after backup',updatedAt:3});assert.deepEqual(await validateMetadataBackup(backups,manifest.id),manifest);
 const candidate=await prepareMetadataRestore(backups,manifest.id,staging);restored=new MetadataStore(path.join(candidate.directory,'metadata.sqlite'));assert.equal(restored.getChat('c').title,'from WAL');restored.close();restored=undefined;assert.equal(store.getChat('c').title,'after backup');
 await assert.rejects(createMetadataBackup(db,backups,{onStage(stage){if(stage==='validated')throw new Error('interrupt')}}),/interrupt/);let entries=await listMetadataBackups(backups);assert.equal(entries.filter(e=>e.status==='valid').length,1);assert.equal(entries.filter(e=>e.status==='invalid').length,1);
 const retention=planBackupRetention(entries,1);assert.deepEqual(retention.keep,[manifest.id]);assert.equal(retention.unverified.length,1);assert.deepEqual(retention.candidates,[]);assert.throws(()=>planBackupRetention(entries,0));
 assert.equal(classifyStorageError({code:'ENOSPC'}),'space');assert.equal(classifyStorageError({code:'EACCES'}),'permission');assert.equal(classifyStorageError({code:'SQLITE_CORRUPT_INDEX'}),'corrupt');assert.equal(classifyStorageError({code:'SQLITE_IOERR'}),'io');
 await assert.rejects(validateMetadataBackup(backups,'../../elsewhere'),/Invalid backup id/);
 await writeFile(path.join(backups,manifest.id,'metadata.sqlite'),'corrupt');await assert.rejects(validateMetadataBackup(backups,manifest.id),/checksum/);await assert.rejects(prepareMetadataRestore(backups,manifest.id,staging),/checksum/);assert.equal(store.getChat('c').title,'after backup');
 const evil=path.join(root,'evil');await mkdir(evil,{mode:0o700});const link=path.join(root,'link');await symlink(evil,link);await assert.rejects(createMetadataBackup(db,link),/Unsafe backup directory/);
 const missing=path.join(root,'missing');await assert.rejects(createMetadataBackup(missing,backups));assert.equal(store.getChat('c').title,'after backup');
 console.log(`Metadata backup ${packaged?'packaged':'development'}: WAL snapshot, validation, staging, interruptions and corruption passed`);
}finally{restored?.close();store?.close();await rm(root,{recursive:true,force:true})}
