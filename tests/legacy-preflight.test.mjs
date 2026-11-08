import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightLegacy} from '../apps/desktop/electron/legacy-preflight.ts';
const base=()=>({preferences:{appearance:'system',language:'system'},projects:[]});
test('legacy preflight preserves complete entries and permits missing optional collections',()=>{
 const input=base();input.projects.push({id:'p',name:'项目',path:'/old',extra:'retained'});input.chats=[{id:'c',title:'任务',updatedAt:1,projectId:'deleted',projectPath:'/prior'}];input.scheduleRuns=[{id:'r',scheduleId:'deleted-schedule',plannedAt:2,status:'missed'}];
 const value=preflightLegacy(input);assert.deepEqual(value.projects,input.projects);assert.deepEqual(value.chats,input.chats);assert.deepEqual(value.scheduleRuns,input.scheduleRuns);assert.deepEqual(value.skills,[]);
});
test('legacy preflight rejects corrupt, duplicate and unexpected root data without rewriting',()=>{
 for(const change of [x=>x.projects.push({id:'a',name:'n',path:'/x'},{id:'b',name:'m',path:'/x'}),x=>x.chats=[{id:'c',title:'bad',updatedAt:-1}],x=>x.unexpected={value:1},x=>x.preferences.language='invalid',x=>x.skills=[{id:'a',name:'s',description:'',filePath:'/s',enabled:true},{id:'b',name:'s',description:'',filePath:'/t',enabled:true}],x=>x.scheduleRuns=[{id:'r',scheduleId:'gone',plannedAt:2,status:'unknown'}]]){const input=base();change(input);const before=JSON.stringify(input);assert.throws(()=>preflightLegacy(input),/Invalid legacy/);assert.equal(JSON.stringify(input),before)}
});
