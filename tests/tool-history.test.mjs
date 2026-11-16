import test from 'node:test';import assert from 'node:assert/strict';
import {locateUserEntry,projectChatHistory,toolFailureReason,userMessageText} from '../apps/desktop/electron/tool-history.ts';
test('restores tool names, paths, outcomes and display copies from the persisted Pi message sequence',()=>{
 const history=projectChatHistory([{role:'user',content:'go'},{role:'assistant',content:[{type:'toolCall',id:'1',name:'project_write',arguments:{path:'result.md',content:'private'}}]},{role:'toolResult',toolCallId:'1',isError:true,content:[{type:'text',text:'File write not approved'}]},{role:'assistant',content:[{type:'toolCall',id:'2',name:'project_read',arguments:{path:'notes.md'}}]},{role:'toolResult',toolCallId:'2',isError:false,content:[{type:'text',text:'private file contents'}]}]);
 const events=history[1].toolEvents;
 assert.deepEqual(events.map(event=>({type:event.type,id:event.id,name:event.name,path:event.path,status:event.status,reason:event.reason})),[{type:'tool',id:'1',name:'project_write',path:'result.md',status:'failed',reason:'denied'},{type:'tool',id:'2',name:'project_read',path:'notes.md',status:'completed',reason:undefined}]);
 /* 工具过程按用户要求可见:入参以展示副本携带(长内容截断),输出文本可展开查看 */
 assert.equal(events[0].args.content,'private');
 assert.equal(events[1].result,'private file contents');
 assert.equal(toolFailureReason('File changed while writing'),'changed');
});

test('projects tool results into the right assistant turns as interleaved text/tool segments',async()=>{
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
 /* 分段保持 pi 轮次顺序:text → tools → text,工具结果按 id 回填 */
 assert.deepEqual(history[1].segments.map(segment=>segment.kind),['text','tools','text']);
 assert.deepEqual(history[1].segments.map(segment=>segment.kind==='text'?segment.text:segment.tools.map(event=>event.id)),['I will check',['1'],'Checked']);
 assert.deepEqual(history[1].toolEvents.map(event=>[event.id,event.status]),[['1','completed']]);
 assert.deepEqual(history[3].toolEvents.map(event=>[event.id,event.reason]),[['2','interrupted']]);
 assert.equal(history[1].toolEvents[0].result,'private');
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

test('restores whole-turn timing by user timestamp without inventing timing for old turns',()=>{
 const messages=[
  {role:'user',timestamp:100,content:'First'},
  {role:'assistant',content:[{type:'text',text:'First answer'}]},
  {role:'user',timestamp:200,content:'Second'},
  {role:'assistant',content:[{type:'text',text:'Second answer'}]},
 ];
 const history=projectChatHistory(messages,new Map([[100,{startedAt:90,durationMs:4500}]]));
 assert.equal(history[1].startedAt,90);
 assert.equal(history[1].durationMs,4500);
 assert.equal(history[3].startedAt,undefined);
 assert.equal(history[3].durationMs,undefined);
});

test('attaches web sources extracted from search tool results',()=>{
 const payload=JSON.stringify({results:[{title:'Pi News',url:'https://news.example.com/a',snippet:'Pi  ships'},{title:'Intranet',url:'http://192.168.1.1/x'}]});
 const history=projectChatHistory([
  {role:'user',content:'search'},
  {role:'assistant',content:[{type:'toolCall',id:'1',name:'mcp__search__web_search',arguments:{query:'pi agent'}}]},
  {role:'toolResult',toolCallId:'1',isError:false,content:[{type:'text',text:payload}]},
  {role:'assistant',content:[{type:'text',text:'Answer'}]},
 ]);
 /* 来源挂在 ToolEvent 上(与 live 流共用 tool-sources 抽取),非法 URL 被过滤 */
 assert.deepEqual(history[1].toolEvents[0].sources,[
  {url:'https://news.example.com/a',title:'Pi News',snippet:'Pi ships'},
 ]);
 /* 非联网工具不产生来源 */
 const local=projectChatHistory([
  {role:'user',content:'write'},
  {role:'assistant',content:[{type:'toolCall',id:'2',name:'project_write',arguments:{path:'a.md'}}]},
  {role:'toolResult',toolCallId:'2',isError:false,content:[{type:'text',text:'See https://example.com/a'}]},
 ]);
 assert.equal(local[1].toolEvents[0].sources,undefined);
});

test('strips skill prefixes from user messages for bubble text and edit location',()=>{
 /* pi 展开格式:<skill name="...">...</skill>\n\n 前缀块 */
 assert.deepEqual(userMessageText('<skill name="code-review" path="/tmp/SKILL.md">\ninstructions\n</skill>\n\n请审查这段代码'),{text:'请审查这段代码',skillName:'code-review'});
 /* 旧格式:未展开的 /skill:NAME 前缀 */
 assert.deepEqual(userMessageText('/skill:code-review 请审查这段代码'),{text:'请审查这段代码',skillName:'code-review'});
 assert.deepEqual(userMessageText('普通问题'),{text:'普通问题',skillName:undefined});
});

test('locates the user entry for edit truncation with the same skip rules as the projection',()=>{
 const entries=[
  {type:'session',id:'h',parentId:null},
  {type:'message',id:'u0',parentId:'h',message:{role:'user',content:'First'}},
  {type:'message',id:'a0',parentId:'u0',message:{role:'assistant',content:[{type:'text',text:'First answer'}]}},
  /* 图片-only 用户条目(空文本):投影跳过,不消耗 index */
  {type:'message',id:'u1',parentId:'a0',message:{role:'user',content:[{type:'image',mime:'image/png',data:'xxx'}]}},
  {type:'message',id:'a1',parentId:'u1',message:{role:'assistant',content:[{type:'text',text:'...'}]}},
  {type:'message',id:'u2',parentId:'a1',message:{role:'user',content:'<skill name="x">\nbody\n</skill>\n\n带技能的第二问'}},
  {type:'message',id:'a2',parentId:'u2',message:{role:'assistant',content:[{type:'text',text:'Second answer'}]}},
  {type:'message',id:'u3',parentId:'a2',message:{role:'user',content:'Third'}},
 ];
 assert.deepEqual(locateUserEntry(entries,0),{id:'u0',parentId:'h'});
 assert.deepEqual(locateUserEntry(entries,1),{id:'u2',parentId:'a1'});
 assert.deepEqual(locateUserEntry(entries,2),{id:'u3',parentId:'a2'});
 assert.equal(locateUserEntry(entries,3),undefined);
 /* 与投影对齐:第 index 条投影用户消息文本 == 定位条目剥离前缀后的文本 */
 const messages=entries.filter(entry=>entry.type==='message').map(entry=>entry.message);
 const history=projectChatHistory(messages);
 assert.equal(history.filter(message=>message.role==='user').length,3);
 assert.equal(history.find(message=>message.role==='user'&&message.text==='带技能的第二问')?.skillName,'x');
});

test('branching to the located parent truncates trailing messages for edit regeneration',async()=>{
 const {SessionManager}=await import('../apps/desktop/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js');
 const manager=SessionManager.inMemory();
 manager.appendMessage({role:'user',content:'First'});
 manager.appendMessage({role:'assistant',content:[{type:'text',text:'First answer'}]});
 manager.appendMessage({role:'user',content:'Second'});
 manager.appendMessage({role:'assistant',content:[{type:'text',text:'Second answer'}]});
 assert.equal(manager.buildSessionContext().messages.length,4);
 const target=locateUserEntry(manager.getBranch(),1);
 assert.deepEqual(target,{id:manager.getBranch()[2].id,parentId:manager.getBranch()[1].id});
 /* 截断:leaf 移到第二条用户消息的父节点(首条回答),新叶子下追加编辑后的消息 */
 manager.branch(target.parentId);
 manager.appendMessage({role:'user',content:'Second (edited)'});
 const context=manager.buildSessionContext().messages;
 assert.equal(context.length,3);
 assert.deepEqual(context.map(message=>message.role),['user','assistant','user']);
 assert.equal(context[2].content,'Second (edited)');
 /* 编辑首条消息:首条用户消息无父条目(parentId 为 null),走 resetLeaf 从头重建 */
 const first=locateUserEntry(manager.getBranch(),0);
 assert.equal(first.parentId,null);
 manager.resetLeaf();
 manager.appendMessage({role:'user',content:'First (edited)'});
 const afterFirst=manager.buildSessionContext().messages;
 assert.deepEqual(afterFirst.map(message=>message.role),['user']);
 assert.equal(afterFirst[0].content,'First (edited)');
});

test('workspace office results restore the absolute path so reopened chats keep one file card',()=>{
 const history=projectChatHistory([
  {role:'user',content:'生成文档'},
  {role:'assistant',content:[{type:'toolCall',id:'1',name:'project_create_office',arguments:{path:'报告.docx',title:'T'}}]},
  {role:'toolResult',toolCallId:'1',isError:false,content:[{type:'text',text:'Created 报告.docx\n/ Users/abs/报告.docx'.replace('/ Users','/Users')}]},
  {role:'assistant',content:[{type:'text',text:'done **[报告.docx](/Users/abs/报告.docx)**'}]},
 ]);
 const event=history.at(-1)?.toolEvents?.[0];
 assert.equal(event?.path,'/Users/abs/报告.docx');
 // 项目模式(结果无绝对路径尾行)保持原始相对路径
 const project=projectChatHistory([
  {role:'user',content:'go'},
  {role:'assistant',content:[{type:'toolCall',id:'1',name:'project_create_office',arguments:{path:'main/报告.docx',title:'T'}}]},
  {role:'toolResult',toolCallId:'1',isError:false,content:[{type:'text',text:'Created main/报告.docx'}]},
 ]);
 assert.equal(project.at(-1)?.toolEvents?.[0]?.path,'main/报告.docx');
});
