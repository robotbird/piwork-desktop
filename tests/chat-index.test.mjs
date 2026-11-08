import test from 'node:test';
import assert from 'node:assert/strict';
import {isChatId,renameChat} from '../apps/desktop/electron/chat-index.ts';
const id='0fa85613-a875-4e12-a677-d93f75655723';
test('renames only the selected conversation and preserves identity',()=>{const chats=[{id,title:'old',updatedAt:1}];assert.deepEqual(renameChat(chats,id,' 新标题 '),[{id,title:'新标题',updatedAt:1}]);assert.equal(chats[0].title,'old')});
test('rejects invalid IDs, blank or overly long titles and missing chats',()=>{assert.equal(isChatId('../x'),false);for(const title of ['', ' ', 'a'.repeat(81)])assert.throws(()=>renameChat([{id,title:'old',updatedAt:1}],id,title));assert.throws(()=>renameChat([],id,'new'))});

test('project binding is fixed for an existing conversation',async()=>{
 const {validateChatProject}=await import('../apps/desktop/electron/chat-index.ts');const projects=[{id:'project-a'},{id:'project-b'}];
 assert.equal(validateChatProject('project-a',projects),'project-a');assert.equal(validateChatProject(null,projects),null);assert.throws(()=>validateChatProject('missing',projects),/Project not found/);
 const chat={id,title:'test',updatedAt:1,projectId:'project-a'};assert.equal(validateChatProject('project-a',[],chat),'project-a');assert.throws(()=>validateChatProject('project-b',projects,chat),/cannot change/);assert.throws(()=>validateChatProject(null,projects,chat),/cannot change/);
});
