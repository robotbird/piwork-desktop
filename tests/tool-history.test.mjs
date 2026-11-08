import test from 'node:test';import assert from 'node:assert/strict';
import {extractToolActivity,toolFailureReason} from '../apps/desktop/electron/tool-history.ts';
test('restores tool names, paths and outcomes from the persisted Pi message sequence',()=>{
 const events=extractToolActivity([{role:'assistant',content:[{type:'toolCall',id:'1',name:'project_write',arguments:{path:'result.md',content:'private'}}]},{role:'toolResult',toolCallId:'1',isError:true,content:[{type:'text',text:'File write not approved'}]},{role:'assistant',content:[{type:'toolCall',id:'2',name:'project_read',arguments:{path:'notes.md'}}]},{role:'toolResult',toolCallId:'2',isError:false,content:[{type:'text',text:'private file contents'}]}]);assert.deepEqual(events,[{type:'tool',id:'1',name:'project_write',path:'result.md',status:'failed',reason:'denied'},{type:'tool',id:'2',name:'project_read',path:'notes.md',status:'completed',reason:undefined}]);assert.doesNotMatch(JSON.stringify(events),/private/);assert.equal(toolFailureReason('File changed while writing'),'changed');
});

test('projects tool results into the right assistant turns without exposing raw arguments',async()=>{
 const {projectChatHistory}=await import('../apps/desktop/electron/tool-history.ts');
 const history=projectChatHistory([
  {role:'user',content:'First'},
  {role:'assistant',content:[{type:'text',text:'I will check'},{type:'toolCall',id:'1',name:'project_read',arguments:{path:'notes.md'}}]},
  {role:'toolResult',toolCallId:'1',isError:false,content:[{type:'text',text:'private'}]},
  {role:'assistant',content:[{type:'text',text:'Checked'}]},
  {role:'user',content:'Second'},
  {role:'assistant',content:[{type:'toolCall',id:'2',name:'project_list',arguments:{}}]},
 ]);
 assert.equal(history.length,4);
 assert.equal(history[1].text,'I will check\n\nChecked');
 assert.deepEqual(history[1].toolEvents.map(event=>[event.id,event.status]),[['1','completed']]);
 assert.deepEqual(history[3].toolEvents.map(event=>[event.id,event.reason]),[['2','interrupted']]);
 assert.doesNotMatch(JSON.stringify(history),/private/);
});

test('hides only protocol tool blocks and incomplete streaming fragments outside fenced code',async()=>{
 const {visibleAssistantText}=await import('../apps/desktop/src/chat/assistant-text.ts');
 const wire='<tool_call> {"name":"bash","arguments":{"command":"pwd"}} </tool_call> </tool_call>';
 const malformed='<tool_call> {"name":"bash","arguments":{"command":"ls test\\ path"}} </tool_call>';
 assert.deepEqual(visibleAssistantText(`Start\n\n${wire}\n${malformed}\n\nFinished`),{text:'Start\n\nFinished',hiddenToolRequest:true});
 assert.equal(visibleAssistantText('Start\n\n<tool_ca',true).text.trim(),'Start');
 assert.equal(visibleAssistantText('Start\n\n<tool_call> {"name":"bash"',true).text,'Start');
 const example='~~~xml\n'+wire+'\n~~~\nMention `<tool_call>` in prose.';
 assert.equal(visibleAssistantText(example).text,example);
});

test('extracts HTML deliverables while leaving Markdown and ordinary code intact',async()=>{
 const {splitAssistantHtml}=await import('../apps/desktop/src/chat/assistant-html.ts');
 const html='<!doctype html>\n<html><body>report</body></html>';
 const result=splitAssistantHtml('Intro\n\n'+html+'\n\n```js\nconst tag = "<html>";\n```\n\nDone');
 assert.deepEqual(result.html,[html]);
 assert.match(result.text,/Intro/);
 assert.match(result.text,/const tag = "<html>"/);
 assert.doesNotMatch(result.text,/report/);
 assert.deepEqual(splitAssistantHtml('~~~html\n<div>private source</div>',true),{text:'',html:[]});
 assert.deepEqual(splitAssistantHtml('~~~html\n<div>file</div>\n~~~'),{text:'',html:['<div>file</div>']});
 assert.equal(splitAssistantHtml('Intro\n<!doc',true).text.trim(),'Intro');
});
