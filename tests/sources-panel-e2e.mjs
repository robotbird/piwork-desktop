import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
/* 可视验证:种一条带 web_search 工具结果的历史会话,打开聊天点击来源 chip,
   断言面板与聊天内容并排平铺(不覆盖),并截图留档 .visual-tmp/sources-docked.png */
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-sources-'));
const profile=path.join(root,'profile');
const chatId='3f1d2c94-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
await mkdir(path.join(profile,'sessions'),{recursive:true});
await mkdir(path.join(root,'no-skills'),{recursive:true});
await writeFile(path.join(profile,'settings.json'),JSON.stringify({
  preferences:{appearance:'light',language:'zh-CN'},
  projects:[],
  chats:[{id:chatId,title:'搜索 pi agent 最新消息',updatedAt:Date.now(),projectId:null,projectPath:null}],
},null,2));
const now=new Date().toISOString();
const results={results:[
 {title:'Pi Network Ships Local AI Agents to 420,000 Node Operators via SoloHost',url:'https://www.theagenttimes.net/news/pi-network-local-agents',snippet:'Pi Network ships local AI agents to 420,000 node operators via SoloHost. The Atlassian MCP Server integration is rolling out to all validators this week.'},
 {title:'GitHub2.1K星!AI直接操控桌面软件,没有API的老ERP也能自动化',url:'https://www.163.com/dy/article/ai-erp-desktop',snippet:'GitHub2.1K星!AI直接操控桌面软件,没有API的老ERP也能自动化。同时搭配状态快照、操作校验、界面变化对比机制,每一步执行完成后立即确认。'},
 {title:"Oh My Pi changelog: what's new each month",url:'https://agentgid.com/oh-my-pi/changelog',snippet:"Oh My Pi changelog: what's new each month. Every stable Oh My Pi release summarised in one place. Fixed session reuse and relaunch, now decided in one place in the daemon. A connection test helps debugging."},
 {title:'Goodbye Claude, Hello Pi: How to Switch [2026]',url:'https://www.qweaiacademy.com/guides/goodbye-claude-hello-pi',snippet:'Goodbye Claude, Hello Pi is blowing up after developers ditch Claude Code for the minimalist Pi agent. Here is how to switch your workflow in one afternoon.'},
 {title:'Pi 1.0: The Minimalist Coding Agent That Redefined AI Development',url:'https://amk.news/2026/pi-1-0-minimalist-coding-agent',snippet:'Earendil has released Pi 1.0, a streamlined coding agent that has redefined AI development with a thin harness and 31 built-in tools.'},
]};
const session=[
 {type:'session',version:3,id:chatId,timestamp:now,cwd:profile},
 {type:'message',id:'aa000001',parentId:null,timestamp:now,message:{role:'user',content:[{type:'text',text:'搜索 pi agent 最新消息'}]}},
 /* 答案文本放在工具调用之后(尾随 text 段才算回答,前面的归入「处理过程」) */
 {type:'message',id:'aa000002',parentId:'aa000001',timestamp:now,message:{role:'assistant',content:[
   {type:'toolCall',id:'call_aa000001',name:'mcp__search__web_search',arguments:{query:'pi agent 最新消息'}}]}},
 {type:'message',id:'aa000003',parentId:'aa000002',timestamp:now,message:{role:'toolResult',toolCallId:'call_aa000001',toolName:'mcp__search__web_search',isError:false,content:[{type:'text',text:JSON.stringify(results)}]}},
 {type:'message',id:'aa000004',parentId:'aa000003',timestamp:now,message:{role:'assistant',content:[
   {type:'text',text:'## 本周 pi 生态动态\n\nPi Desktop 增强远程连接与应用保护,面向 42 万节点。11 月 17—19 日首届生态峰会,18 日整天讲 AI,19 日开 Pi Next 大赛。\n\n值得注意的是反方观点也很有市场:Pi 的薄 harness 并没有让模型变便宜,它只是把「重复发给模型的系统提示、子代理扇出、用不上的工具定义」这类固定开销砍掉了。\n\n配套生态也在长:pi-computer-use 扩展让 Pi 直接操作桌面 GUI 和老 ERP。'}]}},
];
await writeFile(path.join(profile,'sessions',`${chatId}.jsonl`),session.map(line=>JSON.stringify(line)).join('\n')+'\n');
let app;
try{
  app=await electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_DEFAULT_SKILLS_DIR:path.join(root,'no-skills')}});
  const page=await app.firstWindow();await page.waitForLoadState('load');
  await page.getByRole('button',{name:'搜索 pi agent 最新消息'}).first().click();
  try{
    await page.locator('.conversation-reply').waitFor({timeout:15000});
  }catch{
    await mkdir('.visual-tmp',{recursive:true});
    await page.screenshot({path:'.visual-tmp/sources-fail.png'});
    throw new Error('conversation did not open; see .visual-tmp/sources-fail.png — error banner: '+await page.locator('.error-banner').textContent().catch(()=>'none'));
  }
  const chip=page.locator('.conversation-sources-chip');
  await chip.waitFor();
  await chip.click();
  await page.locator('.sources-panel').waitFor();
  const reply=await page.locator('.conversation-reply').first().boundingBox();
  const panel=await page.locator('.sources-panel').boundingBox();
  assert.ok(reply&&panel&&reply.x+reply.width<=panel.x+1,`sources panel must sit beside the conversation (reply right ${reply&&reply.x+reply.width}, panel left ${panel&&panel.x})`);
  assert.match(await page.locator('.sources-panel-header h2').textContent(),/引用来源/);
  const items=await page.locator('.sources-panel-item').count();
  assert.ok(items>=4,`expected >=4 source items, got ${items}`);
  const favicons=await page.locator('.sources-panel-favicon').count();
  assert.equal(favicons,items,'every item renders a favicon slot');
  await mkdir('.visual-tmp',{recursive:true});
  await page.screenshot({path:'.visual-tmp/sources-docked.png'});
  // 关闭按钮回到平铺前的全宽内容
  await page.locator('.sources-panel-close').click();
  await page.locator('.sources-panel').waitFor({state:'detached'});
  console.log('Sources panel: docked beside content with favicon/site/title/snippet items; close restores full-width chat');
}catch(error){
  console.error(error);
  process.exitCode=1;
}finally{
  await app?.close();
  await rm(root,{recursive:true,force:true});
}
