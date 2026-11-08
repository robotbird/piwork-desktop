import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';

/** Keep the last committed value until an atomic replacement succeeds. */
export class SettingsStorage<T> {
 private writes:Promise<void>=Promise.resolve();
 private filename:string;private current:T;private validate:(value:unknown)=>value is T;
 constructor(filename:string,current:T,validate:(value:unknown)=>value is T){this.filename=filename;this.current=current;this.validate=validate}
 async load():Promise<T>{
  try{const value:unknown=JSON.parse(await fs.readFile(this.filename,'utf8'));if(!this.validate(value))throw new Error('Invalid settings data');this.current=value}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  return this.current;
 }
 update(change:(current:T)=>T):Promise<T>{
  const operation=this.writes.then(async()=>{
   const next=change(this.current);if(!this.validate(next))throw new Error('Invalid settings data');
   await fs.mkdir(path.dirname(this.filename),{recursive:true});
   const temp=`${this.filename}.${randomUUID()}.tmp`;
   try{await fs.writeFile(temp,JSON.stringify(next,null,2),{mode:0o600,flag:'wx'});await fs.rename(temp,this.filename)}catch(error){await fs.unlink(temp).catch(()=>{});throw error}
   this.current=next;return next;
  });
  this.writes=operation.then(()=>{},()=>{});return operation;
 }
}
