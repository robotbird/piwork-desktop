import test from 'node:test';
import assert from 'node:assert/strict';
import { addProject, removeProject, updateProject, preserveChatProjectPaths, normalizeFolders, normalizeStoredProject } from '../apps/desktop/electron/project-state.ts';
const project = {id:'a', name:'Original', folders:[{path:'/work/a',label:'a',main:true}]};
const another = {id:'b', name:'Other', folders:[{path:'/work/b',label:'b',main:true}]};

test('folder labels derive from basename and dedupe within a project', () => {
  assert.deepEqual(normalizeFolders([{path:'/work/piwork',main:true},{path:'/other/piwork',main:false}]),
    [{path:'/work/piwork',label:'piwork',main:true},{path:'/other/piwork',label:'piwork (2)',main:false}]);
  assert.throws(()=>normalizeFolders([]), /at least one/);
  assert.throws(()=>normalizeFolders([{path:'relative',main:true}]), /Invalid/);
  assert.throws(()=>normalizeFolders([{path:'/work/a',main:true},...Array.from({length:20},(_,i)=>({path:`/work/${i}`,main:false}))]), /Too many/);
});
test('normalization keeps exactly one main folder (first marked wins, moves first)', () => {
  assert.deepEqual(normalizeFolders([{path:'/one',main:false},{path:'/two',main:true}]).map(f=>[f.label,f.main]),
    [['two',true],['one',false]]);
  assert.deepEqual(normalizeFolders([{path:'/one',main:false},{path:'/two',main:false}]).map(f=>f.main),[true,false]);
});
test('legacy single-path projects upgrade to one main folder', () => {
  assert.deepEqual(normalizeStoredProject({id:'p',name:'资料',path:'/work/资料',description:'说明'}),
    {id:'p',name:'资料',description:'说明',folders:[{path:'/work/资料',label:'资料',main:true}]});
  assert.deepEqual(normalizeStoredProject({id:'p',name:'资料',folders:[{path:'/work/x',label:'x',main:true}]}).folders,
    [{path:'/work/x',label:'x',main:true}]);
});

test('adding with any duplicate folder selects the existing project without changing it', () => {
  const result = addProject([project, another], {id:'new',name:'New',folders:[{path:'/work/new',label:'new',main:true},{path:'/work/b',label:'b',main:false}]});
  assert.equal(result.selected.id, 'b');
  assert.deepEqual(result.projects, [project, another]);
});

test('removing a project affects only its record', () => {
  assert.deepEqual(removeProject([project,another], 'a'), [another]);
  assert.deepEqual(project, {id:'a',name:'Original',folders:[{path:'/work/a',label:'a',main:true}]});
});

test('updateProject renames and replaces folders with cross-project duplicate rejection', () => {
  const renamed = updateProject([project,another],'a',{name:' Research ',description:' Notes '});
  assert.deepEqual(renamed, [{...project,name:'Research',description:'Notes'},another]);
  const multi = updateProject([project,another],'a',{name:'Research',description:'',folders:[{path:'/work/a2',main:true},{path:'/work/a',main:false}]});
  assert.deepEqual(multi[0].folders, [{path:'/work/a2',label:'a2',main:true},{path:'/work/a',label:'a',main:false}]);
  assert.throws(()=>updateProject([project,another],'a',{name:'N',description:'',folders:[{path:'/work/b',main:true}]}), /Directory already used/);
  assert.throws(()=>updateProject([project],'a',{name:'N',description:'',folders:[]}), /at least one/);
  assert.throws(()=>updateProject([project],'a',{name:' ',description:''}),/Invalid/);
  assert.throws(()=>updateProject([project],'missing',{name:'Name',description:''}),/not found/);
});

test('folder changes preserve original directories for existing and legacy conversations',()=>{
  const chats=[{id:'legacy',title:'legacy',updatedAt:1,projectId:'a'},{id:'snapshot',title:'snapshot',updatedAt:1,projectId:'a',projectPath:'/previous'},{id:'other',title:'other',updatedAt:1,projectId:'b'}];
  const next={...project,folders:[{path:'/work/moved',label:'moved',main:true},{path:'/work/a',label:'a',main:false}]};
  assert.deepEqual(preserveChatProjectPaths(chats,next),
    [{...chats[0],projectPath:'/work/moved',projectFolders:['/work/moved','/work/a']},chats[1],chats[2]]);
});
