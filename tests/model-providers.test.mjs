import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 OPENAI_COMPAT_KEY,emptyStore,importLegacyGateway,installProvider,openaiCompatModel,removeProvider,
 resolveCustomSelection,resolveScheduleModel,setDefaultModel,summarizeCredentials,updateProvider,
 validateProviderDefinition,validateStore,workerModelInput,validateWorkerModel,
} from '../apps/desktop/electron/model-providers/store.ts';
import {inspectProviderPackage} from '../apps/desktop/electron/model-providers/zip.ts';

const dirname=path.dirname(fileURLToPath(import.meta.url));

function definition(overrides={}) {
 return validateProviderDefinition({
  packageId:'piwork-llm-demo',providerKey:'demo',version:'1.2.3',
  name:{'zh-CN':'示例',en:'Demo'},description:{'zh-CN':'示例供应商',en:'Demo provider'},
  baseUrl:'https://api.demo.com',networkHosts:['api.demo.com'],validationModel:'demo-mini',
  credentialFields:[{variable:'api_key',type:'secret-input',label:{en:'API Key','zh-CN':'API Key'},required:true}],
  models:[
   {modelId:'demo-mini',label:{en:'Demo Mini','zh-CN':'Demo Mini'},vision:false,reasoning:false,toolCall:true,contextSize:128000,defaultMaxTokens:8192},
   {modelId:'demo-max',label:{en:'Demo Max','zh-CN':'Demo Max'},vision:true,reasoning:true,toolCall:true,contextSize:1000000,defaultMaxTokens:65536},
  ],
  ...overrides,
 });
}

/* ---------- 最小 stored(zip method 0) 打包器:构造上传包 fixture ---------- */
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer)crc=CRC_TABLE[(crc^byte)&0xff]^(crc>>>8);return (crc^0xffffffff)>>>0}
function makeZip(entries){
 const parts=[];const centrals=[];let offset=0;
 for(const [name,data] of entries){
  const nameBuf=Buffer.from(name);const crc=crc32(data);
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);
  local.writeUInt16LE(0,10);local.writeUInt16LE(0,12);local.writeUInt32LE(crc,14);
  local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);
  local.writeUInt16LE(nameBuf.length,26);local.writeUInt16LE(0,28);
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
const providerJson=JSON.stringify({
 packageId:'piwork-llm-demo',providerKey:'demo',version:'1.0.0',
 name:{'zh-CN':'示例',en:'Demo'},description:{'zh-CN':'示例供应商',en:'Demo provider'},
 baseUrl:'https://api.demo.com',networkHosts:['api.demo.com'],validationModel:'demo-mini',
 credentialFields:[{variable:'api_key',type:'secret-input',label:{en:'API Key'},required:true}],
 compat:{maxTokensField:'max_tokens',thinkingFormat:'deepseek'},
 models:[{modelId:'demo-mini',label:{en:'Demo Mini'},vision:false,reasoning:true,toolCall:true,contextSize:131072,defaultMaxTokens:4096}],
});

test('内置目录 JSON(由 web 插件生成)通过定义校验',async()=>{
 for(const key of ['deepseek','tongyi','zhipuai']){
  const raw=JSON.parse(await readFile(path.join(dirname,'../apps/desktop/electron/model-providers/catalog',`${key}.json`),'utf8'));
  const parsed=validateProviderDefinition(raw);
  assert.equal(parsed.providerKey,key);
  assert.ok(parsed.models.length>0);
 }
 const tongyi=JSON.parse(await readFile(path.join(dirname,'../apps/desktop/electron/model-providers/catalog/tongyi.json'),'utf8'));
 assert.equal(tongyi.compat.thinkingFormat,'qwen');
 assert.equal(tongyi.models.length,98);
});

test('validateProviderDefinition 拒绝不合规定义',()=>{
 assert.throws(()=>definition({baseUrl:'ftp://x'}));
 assert.throws(()=>definition({version:'1.0'}));
 assert.throws(()=>definition({compat:{unknownFlag:true}}));
 assert.throws(()=>definition({models:[]}));
 assert.throws(()=>definition({credentialFields:[]}));
});

test('安装/重复安装/卸载',()=>{
 let store=emptyStore();
 store=installProvider(store,definition(),'builtin');
 assert.throws(()=>installProvider(store,definition(),'builtin'),/providerAlreadyInstalled/);
 const id=store.installations.find(item=>item.definition.providerKey==='demo').id;
 store=removeProvider(store,id);
 assert.ok(!store.installations.some(item=>item.definition.providerKey==='demo'));
 // 常驻 openai-compat 不可卸载
 assert.throws(()=>removeProvider(store,store.installations[0].id),/cannot be removed/);
});

test('启用模型需凭据;openai-compat 豁免(本地免密端点)',()=>{
 let store=emptyStore();
 store=installProvider(store,definition(),'builtin');
 const id=store.installations.find(item=>item.definition.providerKey==='demo').id;
 assert.throws(()=>updateProvider(store,id,{enabledModels:['demo-mini']}),/configureApiKeyFirst/);
 store=updateProvider(store,id,{enabledModels:['demo-mini'],credentialsConfigured:true,credentialSummary:{api_key:'abcd••••efgh'}});
 assert.deepEqual(store.installations.find(item=>item.id===id).enabledModels,['demo-mini']);
 // openai-compat 无凭据也可启用
 const compatId=store.installations.find(item=>item.source==='openai-compat').id;
 store=updateProvider(store,compatId,{models:[openaiCompatModel('llama-3')],enabledModels:['llama-3']});
 assert.equal(store.installations.find(item=>item.id===compatId).definition.models[0].modelId,'llama-3');
});

test('默认模型规则:须启用;禁用/移除联动清默认;跨安装项唯一',()=>{
 let store=emptyStore();
 store=installProvider(store,definition(),'builtin');
 const id=store.installations.find(item=>item.definition.providerKey==='demo').id;
 store=updateProvider(store,id,{enabledModels:['demo-mini','demo-max'],credentialsConfigured:true});
 assert.throws(()=>updateProvider(store,id,{defaultModelId:'demo-mini',enabledModels:['demo-max']}),/defaultModelMustBeEnabled/);
 store=updateProvider(store,id,{defaultModelId:'demo-max'});
 assert.deepEqual(store.defaultModel,{providerKey:'demo',modelId:'demo-max'});
 store=updateProvider(store,id,{enabled:false});
 assert.equal(store.defaultModel,null);
 store=updateProvider(store,id,{enabled:true,defaultModelId:'demo-mini'});
 store=updateProvider(store,id,{enabledModels:['demo-max']});
 assert.equal(store.defaultModel,null);
 assert.throws(()=>setDefaultModel(store,{providerKey:'demo',modelId:'demo-mini'}),/defaultModelMustBeEnabled/);
});

test('openai-compat 模型目录可编辑,其余只读;替换后收剪启用项',()=>{
 let store=emptyStore();
 store=installProvider(store,definition(),'builtin');
 const demoId=store.installations.find(item=>item.definition.providerKey==='demo').id;
 assert.throws(()=>updateProvider(store,demoId,{models:[]}),/read-only/);
 const compatId=store.installations.find(item=>item.source==='openai-compat').id;
 store=updateProvider(store,compatId,{models:[openaiCompatModel('gpt-x'),openaiCompatModel('gpt-y',true)],enabledModels:['gpt-x','gpt-y'],credentialsConfigured:true,defaultModelId:'gpt-y'});
 store=updateProvider(store,compatId,{models:[openaiCompatModel('gpt-x')]});
 const compat=store.installations.find(item=>item.id===compatId);
 assert.deepEqual(compat.enabledModels,['gpt-x']);
 assert.equal(store.defaultModel,null);
});

test('旧 gateway.json 迁移:填充常驻 openai-compat 并设默认;已配置不覆盖',()=>{
 const fresh=emptyStore();
 const migrated=importLegacyGateway(fresh,{baseUrl:'https://gw.example.com/v1',modelId:'gpt-4o',supportsImages:true},'enc==');
 const installation=migrated.installations.find(item=>item.definition.providerKey===OPENAI_COMPAT_KEY);
 assert.equal(installation.baseUrl,'https://gw.example.com/v1');
 assert.equal(installation.credentialsConfigured,true);
 assert.deepEqual(migrated.defaultModel,{providerKey:OPENAI_COMPAT_KEY,modelId:'gpt-4o'});
 assert.equal(installation.definition.models[0].vision,true);
 assert.equal(installation.encryptedCredentials?.api_key,'enc==');
 // 已配置过的 openai-compat 不再被迁移覆盖
 const again=importLegacyGateway(migrated,{baseUrl:'https://other.example.com',modelId:'other'});
 assert.equal(again.installations.find(item=>item.definition.providerKey===OPENAI_COMPAT_KEY).baseUrl,'https://gw.example.com/v1');
 // store 序列化往返
 assert.equal(validateStore(JSON.parse(JSON.stringify(migrated))).defaultModel.modelId,'gpt-4o');
});

test('chat 选择解析:providerKey/modelId 与旧格式;定时任务按 baseUrl+modelId',()=>{
 let store=emptyStore();
 store=installProvider(store,definition(),'builtin');
 const id=store.installations.find(item=>item.definition.providerKey==='demo').id;
 assert.throws(()=>resolveCustomSelection(store,'demo/demo-mini'),/unavailable|not enabled/);
 store=updateProvider(store,id,{enabledModels:['demo-mini'],credentialsConfigured:true});
 const resolved=resolveCustomSelection(store,'demo/demo-mini');
 assert.equal(resolved.model.modelId,'demo-mini');
 assert.equal(resolved.installation.baseUrl,'https://api.demo.com');
 // 旧格式(无 /)落到 openai-compat
 const compatId=store.installations.find(item=>item.source==='openai-compat').id;
 store=updateProvider(store,compatId,{models:[openaiCompatModel('legacy-model')],enabledModels:['legacy-model']});
 assert.equal(resolveCustomSelection(store,'legacy-model').model.modelId,'legacy-model');
 assert.throws(()=>resolveCustomSelection(store,'demo/demo-max'),/not enabled/);
 // 定时任务
 const schedule=resolveScheduleModel(store,'https://api.demo.com','demo-mini');
 assert.ok(schedule);
 assert.equal(resolveScheduleModel(store,'https://api.demo.com','demo-max'),null);
 assert.equal(resolveScheduleModel(store,'https://other.example.com','demo-mini'),null);
});

test('凭据摘要打码 key/secret 词',()=>{
 const fields=definition().credentialFields;
 assert.deepEqual(summarizeCredentials(fields,{api_key:'sk1234567890abcd'}),{api_key:'sk12••••abcd'});
 assert.deepEqual(summarizeCredentials(fields,{}),{});
});

test('worker 载荷:目录映射(含 compat/视觉),选中模型必须存在',()=>{
 let store=emptyStore();
 store=installProvider(store,definition(),'builtin');
 const id=store.installations.find(item=>item.definition.providerKey==='demo').id;
 store=updateProvider(store,id,{enabledModels:['demo-mini','demo-max'],credentialsConfigured:true});
 const installation=store.installations.find(item=>item.id===id);
 const payload=workerModelInput({installation,model:installation.definition.models[1],apiKey:'sk-test'});
 assert.equal(payload.providerId,'piwork-demo');
 assert.equal(payload.modelId,'demo-max');
 assert.equal(payload.models.length,2);
 assert.deepEqual(payload.models[1].input,['text','image']);
 assert.equal(payload.models[1].reasoning,true);
 const bad={...payload,modelId:'missing'};
 assert.throws(()=>validateWorkerModel(bad));
 assert.equal(validateWorkerModel(payload).baseUrl,'https://api.demo.com');
});

test('上传插件包检查:合法包/图标;拒绝命名不符、缺 provider.json、夹带与键不一致',async()=>{
 const ok=await inspectProviderPackage('piwork-llm-demo.zip',makeZip([['provider.json',Buffer.from(providerJson)],['assets/icon.svg',Buffer.from('<svg xmlns="a" viewBox="0 0 1 1"></svg>')]]));
 assert.equal(ok.definition.providerKey,'demo');
 assert.equal(ok.definition.models[0].reasoning,true);
 assert.equal(ok.definition.compat?.thinkingFormat,'deepseek');
 assert.match(ok.iconDataUrl ?? '',/^data:image\/svg\+xml;base64,/);
 await assert.rejects(inspectProviderPackage('demo.zip',makeZip([['provider.json',Buffer.from(providerJson)]])),/invalidPackageName/);
 await assert.rejects(inspectProviderPackage('piwork-llm-demo.zip',makeZip([['readme.txt',Buffer.from('x')]])),/providerJsonMissing/);
 await assert.rejects(inspectProviderPackage('piwork-llm-demo.zip',makeZip([['provider.json',Buffer.from(providerJson)],['extra.txt',Buffer.from('x')]])),/unexpectedEntry/);
 const mismatch=JSON.parse(providerJson);mismatch.providerKey='other';
 await assert.rejects(inspectProviderPackage('piwork-llm-demo.zip',makeZip([['provider.json',Buffer.from(JSON.stringify(mismatch))]])),/providerKeyMismatch/);
 await assert.rejects(inspectProviderPackage('piwork-llm-demo.zip',makeZip([['provider.json',Buffer.from(providerJson)],['assets/icon.svg',Buffer.from('<svg><script>alert(1)</script></svg>')]])),/iconInvalid/);
});

test('凭据探测语义:2xx/429 通过,401/403 Key 无效,4xx 失败,5xx 服务不可用',async t=>{
 const {createServer}=await import('node:http');
 const {pingProviderCredentials}=await import('../apps/desktop/electron/model-providers/validate-credentials.ts');
 const status=t=>new Promise(resolve=>{
  const server=createServer((req,res)=>{res.writeHead(t);res.end('x')});
  server.listen(0,'127.0.0.1',()=>resolve([server,`http://127.0.0.1:${server.address().port}/v1`]));
 });
 const close=([server])=>new Promise(r=>{server.closeAllConnections?.();server.close(r)});
 const ok=await status(200);
 await pingProviderCredentials({baseUrl:ok[1],apiKey:'k',model:'m'});
 const throttle=await status(429);
 await pingProviderCredentials({baseUrl:throttle[1],apiKey:'k',model:'m'});
 const bad=await status(401);
 await assert.rejects(pingProviderCredentials({baseUrl:bad[1],apiKey:'k',model:'m'}),/invalidApiKey \(HTTP 401\)/);
 const forbidden=await status(403);
 await assert.rejects(pingProviderCredentials({baseUrl:forbidden[1],apiKey:'k',model:'m'}),/invalidApiKey \(HTTP 403\)/);
 const unsupported=await status(400);
 await assert.rejects(pingProviderCredentials({baseUrl:unsupported[1],apiKey:'k',model:'m'}),/validationFailed \(HTTP 400/);
 const down=await status(502);
 await assert.rejects(pingProviderCredentials({baseUrl:down[1],apiKey:'k',model:'m'}),/providerUnavailable \(HTTP 502/);
 await assert.rejects(pingProviderCredentials({baseUrl:'http://127.0.0.1:9/v1',apiKey:'k',model:'m',timeoutMs:1500}),/validationUnreachable/);
 await Promise.all([ok,throttle,bad,forbidden,unsupported,down].map(close));
});
