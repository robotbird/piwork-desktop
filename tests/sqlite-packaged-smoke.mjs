import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {requireSafeSqliteVersion} from '../apps/desktop/electron/sqlite-version.ts';
const require=createRequire(path.join(process.resourcesPath,'app.asar','package.json'));
const Database=require('better-sqlite3');const directory=await mkdtemp(path.join(os.tmpdir(),'piwork-sqlite-package-'));let db;
try{
 const probe=new Database(':memory:');const version=probe.prepare('select sqlite_version() as version').get().version;requireSafeSqliteVersion(version);probe.close();
 const file=path.join(directory,'probe.db');db=new Database(file);assert.equal(db.pragma('journal_mode = WAL',{simple:true}),'wal');db.exec('CREATE TABLE probe (value TEXT NOT NULL)');db.prepare('INSERT INTO probe VALUES (?)').run('打包验证');assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();db=new Database(file,{readonly:true});assert.equal(db.prepare('SELECT value FROM probe').get().value,'打包验证');console.log(`Packaged Electron ${process.versions.electron}, SQLite ${version}, WAL passed`);
}finally{db?.close();await rm(directory,{recursive:true,force:true})}
