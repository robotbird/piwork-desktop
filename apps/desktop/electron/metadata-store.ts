import Database from 'better-sqlite3';
import {existsSync} from 'node:fs';
import type {ChatSummary,LocalSkill,McpServer,Preferences,Project,Schedule,ScheduleRun} from '../shared/types.ts';
import {openValidatedDatabase} from './sqlite.ts';
import {preflightLegacy,type LegacyState} from './legacy-preflight.ts';
import {normalizeStoredProject} from './project-state.ts';

type StoredProject=Omit<Project,'available'>;
type EntityKind='projects'|'chats'|'skills'|'mcp_servers'|'schedules'|'schedule_runs';
type Entity=StoredProject|ChatSummary|LocalSkill|McpServer|Schedule|ScheduleRun;
const SCHEMA_VERSION=2;
const SCHEMA_SQL=`
 CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT;
 CREATE TABLE preferences (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
 CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
 CREATE TABLE chats (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
 CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, file_path TEXT NOT NULL UNIQUE, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
 CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
 CREATE TABLE schedules (id TEXT PRIMARY KEY, next_at INTEGER NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
 CREATE TABLE schedule_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, planned_at INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
 CREATE INDEX schedule_due_idx ON schedules(enabled,next_at);
 CREATE INDEX schedule_run_idx ON schedule_runs(schedule_id,planned_at DESC);
`;
function checkBeforeWal(db:Database.Database,allowCreate:boolean){
 const version=db.pragma('user_version',{simple:true});if(typeof version!=='number'||version>SCHEMA_VERSION||version<0)throw new Error('Unsupported metadata schema version');
 if(version===0){const row=db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get() as {n:number};if(!allowCreate||row.n!==0)throw new Error('Unversioned metadata database');return}
 const migrations=db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all() as {version:number;name:string}[];
 if(migrations.length!==version||migrations[0]?.version!==1||migrations[0]?.name!=='initial'||(version===2&&(migrations[1]?.version!==2||migrations[1]?.name!=='migration-receipt')))throw new Error('Invalid metadata schema');
 if(version===2)db.prepare('SELECT id,kind,source_sha256 FROM migration_receipt LIMIT 0');
 for(const query of ['SELECT id,payload FROM preferences LIMIT 0','SELECT id,path,payload FROM projects LIMIT 0','SELECT id,payload FROM chats LIMIT 0','SELECT id,name,file_path,payload FROM skills LIMIT 0','SELECT id,name_key,payload FROM mcp_servers LIMIT 0','SELECT id,next_at,enabled,payload FROM schedules LIMIT 0','SELECT id,schedule_id,planned_at,payload FROM schedule_runs LIMIT 0'])db.prepare(query);

}
function migrate(db:Database.Database){
 const version=db.pragma('user_version',{simple:true});
 if(version===0)db.transaction(()=>{db.exec(SCHEMA_SQL);db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)').run(1,'initial',Date.now());db.pragma('user_version = 1')})();
 if(version===0||version===1)db.transaction(()=>{db.exec("CREATE TABLE migration_receipt (id INTEGER PRIMARY KEY CHECK(id=1), kind TEXT NOT NULL CHECK(kind IN ('legacy','fresh')), source_sha256 TEXT) STRICT");db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)').run(2,'migration-receipt',Date.now());db.pragma('user_version = 2')})();
}
function encode(value:unknown):string{const text=JSON.stringify(value);if(typeof text!=='string')throw new Error('Invalid metadata');return text}
function assertId(value:unknown):asserts value is string{if(typeof value!=='string'||!value.trim())throw new Error('Invalid id')}
function decode<T>(row:unknown):T|undefined{return row?(JSON.parse((row as {payload:string}).payload) as T):undefined}
const TABLES:Record<EntityKind,string>={projects:'projects',chats:'chats',skills:'skills',mcp_servers:'mcp_servers',schedules:'schedules',schedule_runs:'schedule_runs'};

/** Inspect an existing published database without enabling WAL or running migrations. */
export function inspectPublishedDatabase(filename:string){
 const db=new Database(filename,{readonly:true,fileMustExist:true});
 try{checkBeforeWal(db,false);if(db.pragma('user_version',{simple:true})!==SCHEMA_VERSION||db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Invalid published metadata');
  const receipt=db.prepare('SELECT kind,source_sha256 AS sourceSha256 FROM migration_receipt WHERE id=1').get() as {kind:string;sourceSha256:string|null}|undefined;
  if(!receipt||!((receipt.kind==='legacy'&&typeof receipt.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(receipt.sourceSha256))||(receipt.kind==='fresh'&&receipt.sourceSha256===null)))throw new Error('Invalid migration receipt');
  return receipt;
 }finally{db.close()}
}

export class MetadataStore {
 private readonly db:Database.Database;
 constructor(filename:string,options:{allowCreate?:boolean}={}){
  const allowCreate=options.allowCreate===true;if(filename!==':memory:'&&existsSync(filename)){const inspection=new Database(filename,{readonly:true,fileMustExist:true});try{checkBeforeWal(inspection,allowCreate)}finally{inspection.close()}}const db=openValidatedDatabase(filename,{allowCreate,beforeEnableWal:db=>checkBeforeWal(db,allowCreate)});
  try{migrate(db);this.db=db}catch(error){db.close();throw error}
 }
 close(){this.db.close()}
 schemaVersion(){return this.db.pragma('user_version',{simple:true}) as number}
 migrationReceipt(){return this.db.prepare('SELECT kind,source_sha256 AS sourceSha256 FROM migration_receipt WHERE id=1').get() as {kind:'legacy'|'fresh';sourceSha256:string|null}|undefined}
 /** Populate a new isolated database and record its source in the same transaction. */
 importSnapshot(input:unknown,receipt:{kind:'legacy'|'fresh';sourceSha256:string|null}){
  const value=preflightLegacy(input);
  if((receipt.kind==='legacy'&&!/^[a-f0-9]{64}$/.test(receipt.sourceSha256??''))||(receipt.kind==='fresh'&&receipt.sourceSha256!==null))throw new Error('Invalid migration receipt');
  this.db.transaction(()=>{
   if(this.migrationReceipt()||this.getPreferences()||Object.keys(TABLES).some(kind=>this.list(kind as EntityKind).length))throw new Error('Metadata database is not empty');
   this.setPreferences(value.preferences);for(const x of value.projects)this.saveProject(x);for(const x of value.chats)this.saveChat(x);for(const x of value.skills)this.saveSkill(x);for(const x of value.mcpServers)this.saveMcp(x);for(const x of value.schedules)this.saveSchedule(x);for(const x of [...value.scheduleRuns].reverse())this.saveRun(x);
   this.db.prepare('INSERT INTO migration_receipt(id,kind,source_sha256) VALUES(1,?,?)').run(receipt.kind,receipt.sourceSha256);
  })();
 }
 snapshot():LegacyState{const preferences=this.getPreferences();if(!preferences)throw new Error('Missing metadata preferences');return preflightLegacy({preferences,projects:this.listProjects(),chats:this.listChats(),skills:this.listSkills(),mcpServers:this.listMcp(),schedules:this.listSchedules(),scheduleRuns:this.listRuns()})}
 integrityCheck(){return this.db.pragma('integrity_check',{simple:true})==='ok'}
 /** Prepare an isolated WAL database for publication as a single file. */
 preparePublication(){const result=this.db.pragma('wal_checkpoint(TRUNCATE)') as {busy:number}[];if(result[0]?.busy!==0)throw new Error('SQLite checkpoint busy');if(this.db.pragma('journal_mode = DELETE',{simple:true})!=='delete')throw new Error('SQLite journal switch failed')}

 getPreferences():Preferences|undefined{return decode<Preferences>(this.db.prepare('SELECT payload FROM preferences WHERE id=1').get())}
 setPreferences(value:Preferences){if(!value||!['system','light','dark'].includes(value.appearance)||!['system','zh-CN','en'].includes(value.language))throw new Error('Invalid preferences');this.db.prepare('INSERT INTO preferences(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(encode(value))}
 private list<T>(kind:EntityKind):T[]{return this.db.prepare(`SELECT payload FROM ${TABLES[kind]} ORDER BY rowid`).all().map(row=>decode<T>(row)!)}
 private get<T>(kind:EntityKind,id:string):T|undefined{assertId(id);return decode<T>(this.db.prepare(`SELECT payload FROM ${TABLES[kind]} WHERE id=?`).get(id))}
 private remove(kind:EntityKind,id:string):boolean{assertId(id);return this.db.prepare(`DELETE FROM ${TABLES[kind]} WHERE id=?`).run(id).changes===1}
 private save(kind:EntityKind,value:Entity){
  if(!value||typeof value!=='object')throw new Error('Invalid entity');assertId(value.id);const payload=encode(value);
  switch(kind){
   case 'projects':{const item=value as StoredProject;const folders=item.folders;if(!Array.isArray(folders)||!folders.length)throw new Error('Invalid project');const main=folders.find(folder=>folder.main)??folders[0];this.db.prepare('INSERT INTO projects(id,path,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,payload=excluded.payload').run(item.id,main.path,payload);break}
   case 'skills':{const item=value as LocalSkill;if(typeof item.name!=='string'||!item.name||typeof item.filePath!=='string'||!item.filePath)throw new Error('Invalid skill');this.db.prepare('INSERT INTO skills(id,name,file_path,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,file_path=excluded.file_path,payload=excluded.payload').run(item.id,item.name,item.filePath,payload);break}
   case 'mcp_servers':{const item=value as McpServer;if(typeof item.name!=='string'||!item.name)throw new Error('Invalid MCP');this.db.prepare('INSERT INTO mcp_servers(id,name_key,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name_key=excluded.name_key,payload=excluded.payload').run(item.id,item.name.replace(/-/g,'_'),payload);break}
   case 'schedules':{const item=value as Schedule;if(!Number.isSafeInteger(item.nextAt)||typeof item.enabled!=='boolean')throw new Error('Invalid schedule');this.db.prepare('INSERT INTO schedules(id,next_at,enabled,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at,enabled=excluded.enabled,payload=excluded.payload').run(item.id,item.nextAt,item.enabled?1:0,payload);break}
   case 'schedule_runs':{const item=value as ScheduleRun;assertId(item.scheduleId);if(!Number.isSafeInteger(item.plannedAt))throw new Error('Invalid run');this.db.prepare('INSERT INTO schedule_runs(id,schedule_id,planned_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET schedule_id=excluded.schedule_id,planned_at=excluded.planned_at,payload=excluded.payload').run(item.id,item.scheduleId,item.plannedAt,payload);break}
   case 'chats':this.db.prepare('INSERT INTO chats(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id,payload);break;
  }
 }
 listProjects(){return this.list<StoredProject>('projects')} getProject(id:string){return this.get<StoredProject>('projects',id)} saveProject(v:StoredProject){const item=normalizeStoredProject(v);const existing=this.getProject(v.id);for(const other of this.listProjects())if(other.id!==item.id&&other.folders.some(folder=>item.folders.some(candidate=>candidate.path===folder.path)))throw new Error('Directory already used');if(existing)this.preservePaths(existing);this.save('projects',item)}
 private preservePaths(project:StoredProject){const main=project.folders.find(folder=>folder.main)??project.folders[0];const paths=project.folders.map(folder=>folder.path);for(const chat of this.listChats())if(chat.projectId===project.id&&chat.projectPath===undefined)this.saveChat({...chat,projectPath:main?.path??null,projectFolders:paths})}
 removeProject(id:string){return this.db.transaction(()=>{const project=this.getProject(id);if(!project)return false;this.preservePaths(project);return this.remove('projects',id)})()}
 listChats(){return this.list<ChatSummary>('chats')} getChat(id:string){return this.get<ChatSummary>('chats',id)} saveChat(v:ChatSummary){const existing=this.getChat(v.id);if(existing&&((existing.projectId??null)!==(v.projectId??null)||(existing.projectPath!==undefined&&existing.projectPath!==v.projectPath)))throw new Error('Chat project binding cannot change');this.save('chats',v)} removeChat(id:string){return this.remove('chats',id)}
 listSkills(){return this.list<LocalSkill>('skills')} getSkill(id:string){return this.get<LocalSkill>('skills',id)} saveSkill(v:LocalSkill){this.save('skills',v)} removeSkill(id:string){return this.remove('skills',id)}
 listMcp(){return this.list<McpServer>('mcp_servers')} getMcp(id:string){return this.get<McpServer>('mcp_servers',id)} saveMcp(v:McpServer){this.save('mcp_servers',v)} removeMcp(id:string){return this.remove('mcp_servers',id)}
 listSchedules(){return this.list<Schedule>('schedules')} getSchedule(id:string){return this.get<Schedule>('schedules',id)} saveSchedule(v:Schedule){this.save('schedules',v)} removeSchedule(id:string){return this.remove('schedules',id)}
 listRuns(){return this.db.prepare('SELECT payload FROM schedule_runs ORDER BY rowid DESC').all().map(row=>decode<ScheduleRun>(row)!)} getRun(id:string){return this.get<ScheduleRun>('schedule_runs',id)} saveRun(v:ScheduleRun){const existing=this.getRun(v.id);if(existing&&(existing.scheduleId!==v.scheduleId||existing.plannedAt!==v.plannedAt))throw new Error('Run identity cannot change');this.save('schedule_runs',v)} removeRun(id:string){return this.remove('schedule_runs',id)}
 /** Atomically advances a due plan and creates one execution record. */
 claimSchedule(id:string,expectedAt:number,nextAt:number,run:ScheduleRun):boolean{
  assertId(id);if(!Number.isSafeInteger(expectedAt)||!Number.isSafeInteger(nextAt)||nextAt<=expectedAt||run.scheduleId!==id||run.plannedAt!==expectedAt)throw new Error('Invalid schedule claim');
  return this.db.transaction(()=>{const current=this.getSchedule(id);if(!current||!current.enabled||current.nextAt!==expectedAt)return false;
   const result=this.db.prepare('UPDATE schedules SET next_at=?,payload=? WHERE id=? AND enabled=1 AND next_at=?').run(nextAt,encode({...current,nextAt}),id,expectedAt);if(result.changes!==1)return false;
   assertId(run.id);this.db.prepare('INSERT INTO schedule_runs(id,schedule_id,planned_at,payload) VALUES(?,?,?,?)').run(run.id,run.scheduleId,run.plannedAt,encode(run));return true;
  })();
 }
}
