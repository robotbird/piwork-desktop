import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp=await mkdtemp(path.join(os.tmpdir(),'piwork-providers-e2e-'));
const profile=path.join(temp,'profile');

/* mock 供应商:max_tokens=1 探测返回 200 JSON,对话补全返回 SSE;记录鉴权与请求体 */
let lastAuth='';let lastBody='';
const provider=createServer((req,res)=>{
 let data='';req.on('data',chunk=>data+=chunk);req.on('end',()=>{
  lastAuth=String(req.headers.authorization??'');lastBody=data;
  if(!req.url?.includes('/chat/completions')){res.writeHead(404);res.end();return}
  const request=JSON.parse(data);
  if(request.stream!==true){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'ping',object:'chat.completion',choices:[]}));return}
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const [delta,finish] of [[{role:'assistant',content:'供应商回复正常'},null],[{},'stop']])res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:request.model,choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
  res.end('data: [DONE]\n\n');
 });
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const providerUrl=`http://127.0.0.1:${provider.address().port}/v1`;

/* 上传包 fixture:stored(zip method 0) 打包 provider.json + icon */
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer)crc=CRC_TABLE[(crc^byte)&0xff]^(crc>>>8);return (crc^0xffffffff)>>>0}
function makeZip(entries){
 const parts=[];const centrals=[];let offset=0;
 for(const [name,data] of entries){
  const nameBuf=Buffer.from(name);const crc=crc32(data);
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);
  local.writeUInt16LE(0,10);local.writeUInt16LE(0,12);local.writeUInt32LE(crc,14);
  local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(nameBuf.length,26);local.writeUInt16LE(0,28);
  parts.push(Buffer.concat([local,nameBuf,data]));
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt16LE(0,8);central.writeUInt16LE(0,10);central.writeUInt16LE(0,12);central.writeUInt16LE(0,14);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
  central.writeUInt16LE(nameBuf.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);central.writeUInt16LE(0,34);central.writeUInt16LE(0,36);
  central.writeUInt32LE(0,38);central.writeUInt32LE(offset,42);
  centrals.push(Buffer.concat([central,nameBuf]));
  offset+=30+nameBuf.length+data.length;
 }
 const centralBuf=Buffer.concat(centrals);
 const eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(0,4);eocd.writeUInt16LE(0,6);
 eocd.writeUInt16LE(entries.length,8);eocd.writeUInt16LE(entries.length,10);
 eocd.writeUInt32LE(centralBuf.length,12);eocd.writeUInt32LE(offset,16);eocd.writeUInt16LE(0,20);
 return Buffer.concat([...parts,centralBuf,eocd]);
}
const uploadZip=path.join(temp,'piwork-llm-demo.zip');
await writeFile(uploadZip,makeZip([
 ['provider.json',Buffer.from(JSON.stringify({
  packageId:'piwork-llm-demo',providerKey:'demo',version:'1.0.0',
  name:{'zh-CN':'示例供应商',en:'Demo provider'},
  description:{'zh-CN':'上传包测试供应商',en:'Uploaded fixture provider'},
  baseUrl:providerUrl,networkHosts:['127.0.0.1'],validationModel:'demo-mini',
  credentialFields:[{variable:'api_key',type:'secret-input',label:{en:'API Key'},required:true}],
  models:[{modelId:'demo-mini',label:{en:'Demo Mini'},vision:false,reasoning:false,toolCall:true,contextSize:131072,defaultMaxTokens:4096}],
 }))],
 ['assets/icon.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#5722d4"/></svg>')],
]));

const executable=path.resolve('apps/desktop/node_modules/.bin/electron');const appDir=path.resolve('apps/desktop');
let app;
try{
 app=await electron.launch({executablePath:executable,args:[appDir,`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_DEFAULT_SKILLS_DIR:path.join(temp,'no-default-skills')}});
 let page=await app.firstWindow();await page.waitForLoadState('load');
 await page.evaluate(()=>window.desktop.setPreferences({appearance:'light',language:'en'}));await page.reload();

 /* 设置 → 模型管理:来源卡 + 常驻 OpenAI 兼容网关(未配置) */
 await page.getByRole('button',{name:'Settings',exact:false}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Models',exact:true}).click();
 const models=page.getByRole('main',{name:'Settings'});
 await models.getByRole('heading',{name:'Installed providers (1)'}).waitFor();
 await models.getByText('OpenAI-compatible gateway').waitFor();
 await models.getByText('API key required').waitFor();
 await models.getByRole('heading',{name:'Discover more providers'}).waitFor();

 /* 模型来源切换为 custom,并确认偏好落盘 */
 await models.getByRole('button',{name:/Custom models/}).click();
 assert.equal((await page.evaluate(()=>window.desktop.getPreferences())).modelSource,'custom');

 /* 从目录安装 DeepSeek */
 const deepseekCard=models.getByRole('article').filter({hasText:/Official DeepSeek models/});
 await deepseekCard.getByRole('button',{name:'Install',exact:true}).click();
 const installDialog=page.getByRole('dialog',{name:'Install model provider'});
 await installDialog.getByText(/Package network access:/).waitFor();
 await installDialog.getByRole('button',{name:'Install provider'}).click();
 await models.getByRole('heading',{name:'Installed providers (2)'}).waitFor();
 await models.getByText('deepseek',{exact:true}).first().waitFor();
 await deepseekCard.getByRole('button',{name:'Installed',exact:true}).waitFor();

 /* 配置:端点指向 mock,填写 Key,启用并默认 deepseek-v4-flash,保存(保存时在线探测) */
 await models.getByRole('button',{name:'Add API key'}).first().click();
 const configure=page.getByRole('dialog',{name:/Configure provider · deepseek/});
 await configure.getByLabel('API endpoint').fill(providerUrl);
 await configure.locator('#provider-credential-api_key').fill('sk-e2e-test-key');
 await configure.getByRole('switch',{name:'deepseek-v4-flash',exact:true}).click();
 await configure.getByRole('button',{name:'Set default'}).click();
 await configure.getByRole('button',{name:'Save configuration'}).click();
 await models.getByText('Running normally').waitFor();
 await models.getByText('1 / 4 models enabled').waitFor();

 /* 上传插件包(mock 文件选择对话框) */
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},uploadZip);
 await models.getByRole('button',{name:'Upload package'}).first().click();
 await models.getByRole('heading',{name:'Installed providers (3)'}).waitFor();
 await models.getByText('Demo provider').waitFor();
 const uploaded=(await page.evaluate(()=>window.desktop.getModelProviders())).installations.find(item=>item.definition.providerKey==='demo');
 assert.ok(uploaded,'uploaded provider installed');
 assert.match(uploaded.iconDataUrl??'',/^data:image\/svg\+xml;base64,/);

 /* 卸载上传的供应商 */
 await models.getByRole('article').filter({hasText:'Demo provider'}).getByRole('button',{name:'More actions'}).click();
 await page.getByRole('menuitem',{name:'Uninstall'}).click();
 await page.getByRole('dialog',{name:'Uninstall model provider?'}).getByRole('button',{name:'Uninstall',exact:true}).click();
 await models.getByRole('heading',{name:'Installed providers (2)'}).waitFor();

 /* 凭据加密落盘:密文不含明文 key */
 const storeRaw=await page.evaluate(()=>window.desktop.getModelProviders());
 assert.ok(storeRaw.installations.every(item=>!JSON.stringify(item).includes('sk-e2e-test-key')));

 /* 回到应用:模型菜单出现 DeepSeek 模型,发送对话命中 mock 供应商 */
 await page.getByRole('button',{name:'Back to app'}).click();
 await page.locator('.composer-model-trigger').click();
 await page.getByRole('menuitemradio',{name:'deepseek-v4-flash'}).first().click();
 await page.getByPlaceholder('Ask anything').fill('你好');
 await page.getByPlaceholder('Ask anything').press('Enter');
 await page.getByText('供应商回复正常').waitFor({timeout:20000});
 assert.equal(lastAuth,'Bearer sk-e2e-test-key');
 assert.match(lastBody,/deepseek-v4-flash/);

 /* 旧 gateway shim:仍可读写,并映射为 openai-compat 安装项 */
 const legacy=await page.evaluate(url=>window.desktop.setGateway({baseUrl:url,modelId:'legacy-model',apiKey:'legacy-key',supportsImages:false}),providerUrl);
 assert.equal(legacy.modelId,'legacy-model');assert.equal(legacy.hasApiKey,true);
 const view=await page.evaluate(()=>window.desktop.getModelProviders());
 const compat=view.installations.find(item=>item.definition.providerKey==='openai-compat');
 assert.equal(compat.baseUrl,providerUrl);
 assert.deepEqual(view.defaultModel,{providerKey:'openai-compat',modelId:'legacy-model'});

 await app.close();app=undefined;
 console.log('Electron model providers: catalog install, endpoint+key configure with live ping, default model, package upload/uninstall, encrypted credentials, composer chat through installed provider and legacy gateway shim passed');
}finally{if(app)await app.close().catch(()=>{});await new Promise(resolve=>provider.close(resolve));await rm(temp,{recursive:true,force:true})}
