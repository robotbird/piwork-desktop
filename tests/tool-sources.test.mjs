import test from 'node:test';import assert from 'node:assert/strict';
import {extractToolSources,isWebTool} from '../apps/desktop/electron/tool-sources.ts';

test('extracts sources from JSON search results with titles and snippets',()=>{
 const result={content:[{type:'text',text:JSON.stringify({provider:'tavily',results:[
  {title:'Pi News',url:'https://news.example.com/a',snippet:'Pi  ships  agents'},
  {title:'Agent Times',url:'https://times.example.org/pi',snippet:'Local AI agents ship'},
 ]})}]};
 assert.deepEqual(extractToolSources('mcp__search__web_search',{query:'pi agent'},result),[
  {url:'https://news.example.com/a',title:'Pi News',snippet:'Pi ships agents'},
  {url:'https://times.example.org/pi',title:'Agent Times',snippet:'Local AI agents ship'},
 ]);
});

test('parses JSON embedded after a text prefix (platform tool result shape)',()=>{
 const text='Untrusted public web search results...: '+JSON.stringify([{title:'Doc',url:'https://docs.example.com/guide',content:'Full page body'}]);
 assert.deepEqual(extractToolSources('web_search',{query:'guide'},text),[
  {url:'https://docs.example.com/guide',title:'Doc',snippet:'Full page body'},
 ]);
});

test('falls back to plain-text URL scanning with hostname titles',()=>{
 const text='Read more at https://blog.example.com/post-1, and https://wiki.example.org/A_(b) for details.';
 assert.deepEqual(extractToolSources('mcp__browser__extract',{url:'https://blog.example.com'},text),[
  {url:'https://blog.example.com/',title:'blog.example.com'},
  {url:'https://blog.example.com/post-1',title:'blog.example.com'},
  {url:'https://wiki.example.org/A_(b',title:'wiki.example.org'},
 ]);
});

test('uses <title> or heading of the fetched page when the fetched URL is not in the result',()=>{
 const html={content:[{type:'text',text:'<html><head><title>Release Notes</title></head><body>text</body></html>'}]};
 assert.deepEqual(extractToolSources('fetch_page',{url:'https://example.com/releases'},html),[
  {url:'https://example.com/releases',title:'Release Notes'},
 ]);
});

test('filters non-public URLs and dedupes across fragments, capping at 20',()=>{
 const results=Array.from({length:25},(_,index)=>({title:`S${index}`,url:`https://s${index}.example.com/x`}));
 results.unshift({title:'Local',url:'http://192.168.1.1/secret'},{title:'Loop',url:'https://localhost:3000/a'},{title:'Port',url:'https://host.example.com:8443/a'},{title:'Frag',url:'https://s0.example.com/x#section'});
 const sources=extractToolSources('web_search',{query:'q'},{content:[{type:'text',text:JSON.stringify(results)}]});
 /* 非法来源(内网 IP/localhost/带端口)被过滤;S0 与带 fragment 的重复项去重后合并 */
 assert.equal(sources.length,20);
 assert.deepEqual(sources.map(source=>source.title).slice(0,2),['Frag','S1']);
});

test('skips local/interaction tools even when their results contain links',()=>{
 const linky='See https://example.com/a';
 assert.deepEqual(extractToolSources('project_write',{path:'a.md'},linky),[]);
 assert.deepEqual(extractToolSources('skill_read',{path:'a.md'},linky),[]);
 assert.deepEqual(extractToolSources('ask_user',{questions:['https://example.com/a']},linky),[]);
 assert.deepEqual(extractToolSources('mcp__fs__read_file',{path:'a.md'},linky),[]);
});

test('classifies web tools by name or query/url-like arguments',()=>{
 assert.equal(isWebTool('mcp__tavily__search',{query:'x'}),true);
 assert.equal(isWebTool('mcp__fs__read_file',{path:'a.md'}),false);
 assert.equal(isWebTool('mcp__custom__lookup',{query:'pi'}),true);
 assert.equal(isWebTool('mcp__custom__lookup',{path:'a.md'}),false);
});

test('returns nothing for empty or error-like results of web tools',()=>{
 assert.deepEqual(extractToolSources('web_search',{query:'q'},''),[]);
 assert.deepEqual(extractToolSources('web_search',{query:'q'},{content:[{type:'image',data:'x'}]}),[]);
});

test('uses markdown link text as title before bare-URL fallback',()=>{
 const text='阅读 [Pi 1.0 发布说明](https://pi.dev/blog/release) 与 [Oh My Pi](https://agentgid.com/oh-my-pi) 的更新,另见 https://example.org/plain';
 assert.deepEqual(extractToolSources('mcp__browser__open',{url:'https://pi.dev'},text),[
  {url:'https://pi.dev/',title:'pi.dev'},
  {url:'https://pi.dev/blog/release',title:'Pi 1.0 发布说明'},
  {url:'https://agentgid.com/oh-my-pi',title:'Oh My Pi'},
  {url:'https://example.org/plain',title:'example.org'},
 ]);
});

test('ignores markdown image alt text as title',()=>{
 const text='![logo](https://example.org/logo.png)';
 assert.deepEqual(extractToolSources('mcp__browser__open',{url:'https://example.org'},text),[
  {url:'https://example.org/',title:'example.org'},
  {url:'https://example.org/logo.png',title:'example.org'},
 ]);
});
