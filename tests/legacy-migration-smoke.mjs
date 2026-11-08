import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const packaged=process.env.PIWORK_PACKAGED_APP==='1';
const moduleUrl=packaged?pathToFileURL(path.join(process.resourcesPath,'app.asar','dist-electron','legacy-migration.js')).href:new URL('../apps/desktop/electron/legacy-migration.ts',import.meta.url).href;
const {migrateLegacyMetadata}=await import(moduleUrl);
const storeUrl=packaged?pathToFileURL(path.join(process.resourcesPath,'app.asar','dist-electron','metadata-store.js')).href:new URL('../apps/desktop/electron/metadata-store.ts',import.meta.url).href;
const {MetadataStore}=await import(storeUrl);
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-migration-'));
const source={preferences:{appearance:'system',language:'zh-CN',extra:'kept'},projects:[{id:'p',name:'资料',folders:[{path:'/original',label:'original',main:true}],description:'说明'}],chats:[{id:'c',title:'任务',updatedAt:1,projectId:'deleted',extra:{kept:true}}],skills:[{id:'k',name:'writer',description:'说明',filePath:'/skill',enabled:true}],mcpServers:[{id:'m',name:'local',type:'stdio',command:'node',args:[],enabled:true}],schedules:[{id:'s',name:'计划',prompt:'test',cron:'0 9 * * 1',timezone:'UTC',projectId:'p',skillId:'k',enabled:true,nextAt:1000,gatewayUrl:'http://localhost',modelId:'model'}],scheduleRuns:[{id:'r2',scheduleId:'s',plannedAt:2,status:'missed'},{id:'r1',scheduleId:'deleted',plannedAt:1,status:'completed'}]};
try{
 for(const stage of ['backup','import','before-publish','publish']){
  const dir=path.join(root,stage);await mkdir(dir);const bytes=Buffer.from(JSON.stringify(source));await writeFile(path.join(dir,'settings.json'),bytes);await mkdir(path.join(dir,'sessions'));await writeFile(path.join(dir,'sessions','c.jsonl'),'untouched');await writeFile(path.join(dir,'gateway.json'),'untouched');
  await assert.rejects(migrateLegacyMetadata(dir,{onStage(current){if(current===stage)throw new Error('simulated interruption')}}),/simulated interruption/);
  assert.deepEqual(await readFile(path.join(dir,'settings.json')),bytes);assert.equal(await readFile(path.join(dir,'sessions','c.jsonl'),'utf8'),'untouched');assert.equal(await readFile(path.join(dir,'gateway.json'),'utf8'),'untouched');
  const result=await migrateLegacyMetadata(dir);assert.equal(result.status,stage==='publish'?'already-migrated':'migrated');assert.equal((await migrateLegacyMetadata(dir)).status,'already-migrated');
  const backups=await readdir(path.join(dir,'migration-backups'));assert.equal(backups.length,1);const backup=path.join(dir,'migration-backups',backups[0]);assert.deepEqual(await readFile(backup),bytes);assert.equal((await stat(backup)).mode&0o077,0);
  const store=new MetadataStore(path.join(dir,'metadata.sqlite'));assert.deepEqual(store.snapshot(),source);store.close();
  await writeFile(path.join(dir,'settings.json'),'{}');await assert.rejects(migrateLegacyMetadata(dir),/source conflict/);
 }
 const invalid=path.join(root,'invalid');await mkdir(invalid);await writeFile(path.join(invalid,'settings.json'),'{');await assert.rejects(migrateLegacyMetadata(invalid),/Invalid legacy JSON/);
 const targetConflict=path.join(root,'target-conflict');await mkdir(targetConflict);await writeFile(path.join(targetConflict,'settings.json'),JSON.stringify(source));await writeFile(path.join(targetConflict,'metadata.sqlite'),'unrecognized');await assert.rejects(migrateLegacyMetadata(targetConflict));assert.equal(await readFile(path.join(targetConflict,'metadata.sqlite'),'utf8'),'unrecognized');
 const missing=path.join(root,'missing');await mkdir(missing);await assert.rejects(migrateLegacyMetadata(missing),/recovery required/);
 console.log('Legacy migration: isolated interruption, retry, round trip and conflict checks passed');
}finally{await rm(root,{recursive:true,force:true})}
