import Database from 'better-sqlite3';
import {requireSafeSqliteVersion} from './sqlite-version.ts';

/** Probes the loaded native library before opening a file or enabling WAL. */
export function openValidatedDatabase(filename:string,options:{allowCreate?:boolean;beforeEnableWal?:(db:Database.Database)=>void}={}):Database.Database {
 const probe=new Database(':memory:');
 try{const row=probe.prepare('SELECT sqlite_version() AS version').get() as {version:unknown};requireSafeSqliteVersion(row.version)}finally{probe.close()}
 const db=new Database(filename,{fileMustExist:!options.allowCreate,timeout:5000});
 try{options.beforeEnableWal?.(db);if(db.pragma('journal_mode = WAL',{simple:true})!=='wal')throw new Error('SQLite WAL unavailable');return db}catch(error){db.close();throw error}
}
