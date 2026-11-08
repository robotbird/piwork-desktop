import {app} from 'electron';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openValidatedDatabase} from '../apps/desktop/electron/sqlite.ts';
import {requireSafeSqliteVersion} from '../apps/desktop/electron/sqlite-version.ts';
app.whenReady().then(async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'piwork-sqlite-'));let db;
 try{
  const file=path.join(dir,'test.db');assert.throws(()=>openValidatedDatabase(file),/open database/i);db=openValidatedDatabase(file,{allowCreate:true});const version=db.prepare('select sqlite_version() as v').get().v;requireSafeSqliteVersion(version);
  assert.equal(db.pragma('journal_mode = WAL',{simple:true}),'wal');db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');db.transaction(()=>db.prepare('INSERT INTO probe (value) VALUES (?)').run('中文记录'))();assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();db=openValidatedDatabase(file);assert.equal(db.prepare('SELECT value FROM probe').get().value,'中文记录');db.close();db=undefined;
  console.log(`Electron ${process.versions.electron} SQLite ${version} WAL probe passed`);
 }catch(error){console.error(error);process.exitCode=1}finally{db?.close();await rm(dir,{recursive:true,force:true});app.exit(process.exitCode??0)}
}).catch(error=>{console.error(error);app.exit(1)});
