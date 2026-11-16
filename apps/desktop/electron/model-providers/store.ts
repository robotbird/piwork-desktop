import type {LocalizedText,ProviderCompat,ProviderCredentialField,ProviderDefinition,ProviderInstallation,ProviderModelSpec,ProviderUpdateInput} from '../../shared/types';

/** 模型供应商存储的纯逻辑层:定义校验、安装/更新/卸载规则、旧 gateway 迁移与选择解析。
    不触碰 electron/fs,便于 node:test 直接覆盖(main 侧持久化见 service.ts)。 */

export const OPENAI_COMPAT_KEY='openai-compat';
export const OPENAI_COMPAT_PACKAGE='piwork-openai-compat';
const KEY_PATTERN=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN=/^\d+\.\d+\.\d+$/;
const MODEL_ID_PATTERN=/^[A-Za-z0-9._/-]{1,200}$/;
const VARIABLE_PATTERN=/^[a-z_][a-z0-9_]*$/;
const THINKING_FORMATS=['ant-ling','baseten','chat-template','deepseek','openai','openrouter','qwen','qwen-chat-template','string-thinking','together','zai'] as const;

function fail(message:string):never{throw new Error(message)}
function isObject(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)}

function localized(value:unknown):LocalizedText{
 if(!isObject(value))fail('localized text must be an object');
 const out:LocalizedText={};
 for(const [key,text] of Object.entries(value)){
  if(typeof text!=='string'||!text.trim())fail(`localized text "${key}" must be a non-empty string`);
  out[key]=text;
 }
 if(!out.en)fail('localized text requires an "en" entry');
 return out;
}
export function pickLocalized(text:LocalizedText|undefined,language:'zh-CN'|'en'):string{
 return text?.[language]??text?.en??'';
}

function parseBaseUrl(value:unknown):string{
 if(typeof value!=='string')fail('baseUrl must be a string');
 let url:URL;
 try{url=new URL(value)}catch{fail('baseUrl must be a valid URL')}
 if(url.protocol!=='https:'&&url.protocol!=='http:')fail('baseUrl must use http(s)');
 if(url.username||url.password||url.search||url.hash)fail('baseUrl must not carry credentials, query or hash');
 return value.trim().replace(/\/+$/,'');
}

function parseCompat(value:unknown):ProviderCompat|undefined{
 if(value===undefined)return undefined;
 if(!isObject(value))fail('compat must be an object');
 const out:ProviderCompat={};
 const keys=Object.keys(value);
 if(!keys.length)fail('compat must not be empty');
 for(const key of keys){
  if(key==='maxTokensField'){
   const field=value[key];
   if(field!=='max_tokens'&&field!=='max_completion_tokens')fail('compat.maxTokensField is invalid');
   out.maxTokensField=field;
  }else if(key==='thinkingFormat'){
   const format=value[key];
   if(!THINKING_FORMATS.includes(format as (typeof THINKING_FORMATS)[number]))fail('compat.thinkingFormat is invalid');
   out.thinkingFormat=format as ProviderCompat['thinkingFormat'];
  }else if(key==='supportsDeveloperRole'||key==='supportsReasoningEffort'||key==='supportsStore'){
   if(typeof value[key]!=='boolean')fail(`compat.${key} must be a boolean`);
   out[key]=value[key] as boolean;
  }else fail(`compat.${key} is not supported`);
 }
 return out;
}

function parseModel(value:unknown):ProviderModelSpec{
 if(!isObject(value))fail('model entry must be an object');
 if(typeof value.modelId!=='string'||!MODEL_ID_PATTERN.test(value.modelId))fail('model modelId is invalid');
 const features=['vision','reasoning','toolCall'] as const;
 for(const feature of features)if(typeof value[feature]!=='boolean')fail(`model ${value.modelId}: ${feature} must be a boolean`);
 const props=['contextSize','defaultMaxTokens'] as const;
 const numbers:Record<string,number>={};
 for(const prop of props){
  const num=value[prop];
  if(typeof num!=='number'||!Number.isInteger(num)||num<=0||num>10_000_000)fail(`model ${value.modelId}: ${prop} is invalid`);
  numbers[prop]=num;
 }
 return {modelId:value.modelId,label:localized(value.label),vision:value.vision===true,reasoning:value.reasoning===true,toolCall:value.toolCall===true,contextSize:numbers.contextSize!,defaultMaxTokens:numbers.defaultMaxTokens!};
}

function parseCredentialField(value:unknown):ProviderCredentialField{
 if(!isObject(value))fail('credential field must be an object');
 if(typeof value.variable!=='string'||!VARIABLE_PATTERN.test(value.variable))fail('credential variable is invalid');
 if(value.type!=='secret-input'&&value.type!=='text-input')fail('credential type must be secret-input or text-input');
 if(typeof value.required!=='boolean')fail('credential required must be a boolean');
 const field:ProviderCredentialField={variable:value.variable,type:value.type,label:localized(value.label),required:value.required};
 if(value.placeholder!==undefined)field.placeholder=localized(value.placeholder);
 return field;
}

/** 校验并规范化声明式定义(目录 JSON / 上传 provider.json / 持久化文件复检共用);失败抛带可读信息的 Error。
    emptyCatalogOk 供常驻 openai-compat(用户手填模型列表,初始为空)使用 */
export function validateProviderDefinition(value:unknown,options?:{emptyCatalogOk?:boolean}):ProviderDefinition{
 if(!isObject(value))fail('definition must be an object');
 if(typeof value.packageId!=='string'||!KEY_PATTERN.test(value.packageId.replace(/^piwork-llm-/,''))||!value.packageId)fail('packageId is invalid');
 if(typeof value.providerKey!=='string'||!KEY_PATTERN.test(value.providerKey))fail('providerKey is invalid');
 if(typeof value.version!=='string'||!VERSION_PATTERN.test(value.version))fail('version must be semver-like (x.y.z)');
 const emptyCatalogOk=options?.emptyCatalogOk===true;
 const definition:ProviderDefinition={
  packageId:value.packageId,providerKey:value.providerKey,version:value.version,
  name:localized(value.name),description:localized(value.description),
  baseUrl:parseBaseUrl(value.baseUrl),
  networkHosts:Array.isArray(value.networkHosts)&&value.networkHosts.every(host=>typeof host==='string'&&host)?value.networkHosts as string[]:fail('networkHosts must be a string array'),
  validationModel:typeof value.validationModel==='string'&&(value.validationModel||emptyCatalogOk)?value.validationModel:fail('validationModel is required'),
  credentialFields:Array.isArray(value.credentialFields)&&value.credentialFields.length?value.credentialFields.map(parseCredentialField):fail('credentialFields must be a non-empty array'),
  models:Array.isArray(value.models)&&(emptyCatalogOk||value.models.length)?value.models.map(parseModel):fail('models must be a non-empty array'),
 };
 if(value.helpUrl!==undefined&&typeof value.helpUrl==='string'&&value.helpUrl)definition.helpUrl=value.helpUrl;
 const compat=parseCompat(value.compat);
 if(compat)definition.compat=compat;
 const ids=new Set<string>();
 for(const model of definition.models){if(ids.has(model.modelId))fail(`duplicate model id "${model.modelId}"`);ids.add(model.modelId)}
 if(!definition.models.some(model=>model.modelId===definition.validationModel)&&definition.models.length>1)fail('validationModel must exist in models');
 return definition;
}

/** 常驻的「OpenAI 兼容网关」定义:承接旧 gateway.json 与任意 OpenAI 兼容端点;模型目录由用户编辑 */
export function openaiCompatDefinition():ProviderDefinition{
 return {
  packageId:OPENAI_COMPAT_PACKAGE,providerKey:OPENAI_COMPAT_KEY,version:'1.0.0',
  name:{'zh-CN':'OpenAI 兼容网关',en:'OpenAI-compatible gateway'},
  description:{'zh-CN':'接入任意 OpenAI 兼容端点(自定义网关、中转或本地服务),手动维护模型列表。',en:'Connect any OpenAI-compatible endpoint (custom gateway, proxy or local server) with a manually managed model list.'},
  baseUrl:'https://api.openai.com/v1',networkHosts:['*'],validationModel:'',
  credentialFields:[{variable:'api_key',type:'secret-input',label:{'zh-CN':'API Key',en:'API key'},required:true,placeholder:{'zh-CN':'在此输入您的 API Key',en:'Enter your API key'}}],
  models:[],
 };
}
export function openaiCompatModel(modelId:string,vision=false):ProviderModelSpec{
 return {modelId,label:{'zh-CN':modelId,en:modelId},vision,reasoning:false,toolCall:true,contextSize:128000,defaultMaxTokens:8192};
}

/** 持久化形状:encryptedCredentials 为 safeStorage base64;defaultModel 跨安装项唯一 */
export type StoredInstallation={id:string;source:'builtin'|'upload'|'openai-compat';definition:ProviderDefinition;baseUrl:string;enabled:boolean;enabledModels:string[];credentialsConfigured:boolean;credentialSummary:Record<string,string>;encryptedCredentials?:Record<string,string>;iconDataUrl?:string;updatedAt:number};
export type ModelProvidersStore={version:1;installations:StoredInstallation[];defaultModel:{providerKey:string;modelId:string}|null;legacyGatewayImported?:boolean};

export function validateStore(value:unknown):ModelProvidersStore{
 if(!isObject(value)||value.version!==1||!Array.isArray(value.installations))fail('Invalid model providers store');
 const installations=value.installations.map(item=>{
  if(!isObject(item)||typeof item.id!=='string'||!item.id)fail('Invalid installation');
  const source=item.source;
  if(source!=='builtin'&&source!=='upload'&&source!=='openai-compat')fail('Invalid installation source');
  const definition=validateProviderDefinition(item.definition,{emptyCatalogOk:source===OPENAI_COMPAT_KEY});
  const enabledModels=Array.isArray(item.enabledModels)&&item.enabledModels.every(id=>typeof id==='string')?item.enabledModels as string[]:fail('Invalid enabledModels');
  if(new Set(enabledModels).size!==enabledModels.length)fail('Duplicate enabledModels');
  for(const id of enabledModels)if(!definition.models.some(model=>model.modelId===id))fail(`Enabled model "${id}" not in catalog`);
  const credentialsConfigured=item.credentialsConfigured===true;
  if(item.encryptedCredentials!==undefined&&(!isObject(item.encryptedCredentials)||!Object.values(item.encryptedCredentials).every(entry=>typeof entry==='string')))fail('Invalid encryptedCredentials');
  const summary=isObject(item.credentialSummary)?Object.fromEntries(Object.entries(item.credentialSummary).filter(([,text])=>typeof text==='string')) as Record<string,string>:{};
  const installation:StoredInstallation={id:item.id,source,definition,baseUrl:parseBaseUrl(item.baseUrl),enabled:item.enabled===true,enabledModels,credentialsConfigured,credentialSummary:summary,updatedAt:typeof item.updatedAt==='number'?item.updatedAt:0};
  if(item.encryptedCredentials!==undefined)installation.encryptedCredentials=item.encryptedCredentials as Record<string,string>;
  if(typeof item.iconDataUrl==='string'&&item.iconDataUrl)installation.iconDataUrl=item.iconDataUrl;
  return installation;
 });
 const keys=new Set<string>();
 for(const item of installations){if(keys.has(item.definition.providerKey))fail(`Duplicate installation for "${item.definition.providerKey}"`);keys.add(item.definition.providerKey)}
 let defaultModel:ModelProvidersStore['defaultModel']=null;
 if(isObject(value.defaultModel)){
  if(typeof value.defaultModel.providerKey!=='string'||typeof value.defaultModel.modelId!=='string')fail('Invalid defaultModel');
  defaultModel={providerKey:value.defaultModel.providerKey,modelId:value.defaultModel.modelId};
 }
 const store:ModelProvidersStore={version:1,installations,defaultModel};
 if(value.legacyGatewayImported===true)store.legacyGatewayImported=true;
 validateDefaultModel(store);
 return store;
}

function validateDefaultModel(store:ModelProvidersStore){
 const {defaultModel}=store;
 if(!defaultModel)return;
 const installation=store.installations.find(item=>item.definition.providerKey===defaultModel.providerKey);
 if(!installation||!installation.enabled||!installation.enabledModels.includes(defaultModel.modelId))fail('defaultModel must reference an enabled model');
}

/** 旧 gateway.json(单自定义网关)→ openai-compat 安装项;密文迁移由 service 完成。
    空存储先 seed 了原始 openai-compat,此处原地填充;已配置过的 openai-compat 不再覆盖。 */
export function importLegacyGateway(store:ModelProvidersStore,gateway:{baseUrl:string;modelId:string;supportsImages?:boolean},encryptedApiKey?:string,updatedAt=Date.now()):ModelProvidersStore{
 const index=store.installations.findIndex(item=>item.definition.providerKey===OPENAI_COMPAT_KEY);
 const existing=index>=0?store.installations[index]!:undefined;
 if(existing&&(existing.credentialsConfigured||existing.enabledModels.length))return {...store,legacyGatewayImported:true};
 const definition=openaiCompatDefinition();
 definition.models=[openaiCompatModel(gateway.modelId,gateway.supportsImages===true)];
 const installation:StoredInstallation={id:existing?.id??crypto.randomUUID(),source:'openai-compat',definition,baseUrl:parseBaseUrl(gateway.baseUrl),enabled:true,enabledModels:[gateway.modelId],credentialsConfigured:false,credentialSummary:{},updatedAt};
 if(encryptedApiKey){installation.encryptedCredentials={api_key:encryptedApiKey};installation.credentialsConfigured=true;installation.credentialSummary={api_key:'••••••••'}}
 const installations=existing?store.installations.map((item,position)=>position===index?installation:item):[...store.installations,installation];
 const next:ModelProvidersStore={...store,installations,legacyGatewayImported:true};
 // 迁移后的单模型即自定义默认(与旧行为一致:该模型就是 custom 选择)
 if(!next.defaultModel)next.defaultModel={providerKey:OPENAI_COMPAT_KEY,modelId:gateway.modelId};
 return next;
}

/** 空存储初始化:常驻 openai-compat(空配置,待用户添加模型) */
export function emptyStore():ModelProvidersStore{
 const definition=openaiCompatDefinition();
 return {version:1,installations:[{id:crypto.randomUUID(),source:'openai-compat',definition,baseUrl:definition.baseUrl,enabled:true,enabledModels:[],credentialsConfigured:false,credentialSummary:{},updatedAt:Date.now()}],defaultModel:null};
}

/** 凭据摘要:key 含 key/secret 的值打码为 xxxxxx••••xxxx(对齐 web summarizeCredentials) */
export function summarizeCredentials(fields:ProviderCredentialField[],values:Record<string,string>):Record<string,string>{
 const summary:Record<string,string>={};
 for(const field of fields){
  const value=values[field.variable];
  if(typeof value!=='string'||!value)continue;
  summary[field.variable]=/key|secret|token/i.test(field.variable)?`${value.slice(0,4)}••••${value.slice(-4)}`:value;
 }
 return summary;
}

export function installProvider(store:ModelProvidersStore,definition:ProviderDefinition,source:'builtin'|'upload',iconDataUrl?:string):ModelProvidersStore{
 if(store.installations.some(item=>item.definition.providerKey===definition.providerKey))throw new Error('providerAlreadyInstalled');
 const installation:StoredInstallation={id:crypto.randomUUID(),source,definition,baseUrl:definition.baseUrl,enabled:true,enabledModels:[],credentialsConfigured:false,credentialSummary:{},updatedAt:Date.now(),...(iconDataUrl?{iconDataUrl}:{})};
 return {...store,installations:[...store.installations,installation]};
}

export function removeProvider(store:ModelProvidersStore,id:string):ModelProvidersStore{
 const installation=store.installations.find(item=>item.id===id);
 if(!installation)throw new Error('Provider unavailable');
 if(installation.source==='openai-compat')throw new Error('Built-in provider cannot be removed');
 const installations=store.installations.filter(item=>item.id!==id);
 let defaultModel=store.defaultModel;
 if(defaultModel&&defaultModel.providerKey===installation.definition.providerKey)defaultModel=null;
 return {...store,installations,defaultModel};
}

/** 应用更新规则(对齐 web PATCH 语义):
    - enabledModels 非空需凭据已配置(本次 patch 一并配置亦可);openai-compat 例外(本地/免密端点)
    - defaultModelId 必须属于更新后的 enabledModels;禁用安装项联动清默认
    - models 仅 openai-compat 可整表替换,替换后收剪 enabledModels/默认
    - credentialsConfigured/credentialSummary/encryptedCredentials 由 service 在凭据验证通过后传入 */
export function updateProvider(store:ModelProvidersStore,id:string,patch:ProviderUpdateInput&{credentialsConfigured?:boolean;credentialSummary?:Record<string,string>;encryptedCredentials?:Record<string,string>}):ModelProvidersStore{
 const index=store.installations.findIndex(item=>item.id===id);
 if(index<0)throw new Error('Provider unavailable');
 const current=store.installations[index]!;
 let definition=current.definition;
 if(patch.models!==undefined){
  if(current.source!=='openai-compat')throw new Error('Model catalog is read-only');
  const models=patch.models.map(parseModel);
  if(models.length>50)fail('Too many models');
  const ids=new Set<string>();
  for(const model of models){if(ids.has(model.modelId))fail(`duplicate model id "${model.modelId}"`);ids.add(model.modelId)}
  definition={...definition,models,validationModel:models[0]?.modelId??''};
 }
 let enabledModels=current.enabledModels;
 if(patch.enabledModels!==undefined){
  if(!Array.isArray(patch.enabledModels)||!patch.enabledModels.every(mid=>typeof mid==='string'&&definition.models.some(model=>model.modelId===mid)))fail('Unknown model in enabledModels');
  enabledModels=[...patch.enabledModels];
  if(new Set(enabledModels).size!==enabledModels.length)fail('Duplicate enabledModels');
 }
 // 目录替换后收剪遗留启用项
 enabledModels=enabledModels.filter(mid=>definition.models.some(model=>model.modelId===mid));
 const credentialsConfigured=patch.credentialsConfigured??current.credentialsConfigured;
 if(enabledModels.length&&!credentialsConfigured&&current.source!=='openai-compat')throw new Error('configureApiKeyFirst');
 const baseUrl=patch.baseUrl!==undefined?parseBaseUrl(patch.baseUrl):current.baseUrl;
 const enabled=patch.enabled??current.enabled;
 const credentialSummary=patch.credentialSummary??current.credentialSummary;
 const next:StoredInstallation={...current,definition,baseUrl,enabled,enabledModels,credentialsConfigured,credentialSummary,updatedAt:Date.now()};
 if(patch.encryptedCredentials!==undefined)next.encryptedCredentials=patch.encryptedCredentials;
 const installations=[...store.installations];
 installations[index]=next;
 let defaultModel=store.defaultModel;
 if(!enabled&&defaultModel?.providerKey===next.definition.providerKey)defaultModel=null;
 if(defaultModel&&defaultModel.providerKey===next.definition.providerKey&&!next.enabledModels.includes(defaultModel.modelId))defaultModel=null;
 if(patch.defaultModelId!==undefined){
  if(patch.defaultModelId===null){if(defaultModel?.providerKey===next.definition.providerKey)defaultModel=null}
  else{
   if(!next.enabledModels.includes(patch.defaultModelId))throw new Error('defaultModelMustBeEnabled');
   defaultModel={providerKey:next.definition.providerKey,modelId:patch.defaultModelId};
  }
 }
 const result={...store,installations,defaultModel};
 validateDefaultModel(result);
 return result;
}

export function setDefaultModel(store:ModelProvidersStore,value:{providerKey:string;modelId:string}|null):ModelProvidersStore{
 if(!value)return {...store,defaultModel:null};
 const installation=store.installations.find(item=>item.definition.providerKey===value.providerKey);
 if(!installation||!installation.enabled||!installation.enabledModels.includes(value.modelId))throw new Error('defaultModelMustBeEnabled');
 return {...store,defaultModel:value};
}

/** 解析 chat:send 的自定义选择:id 形如 '<providerKey>/<modelId>';旧格式(无 /)按 openai-compat 兼容。
    builtin/upload 供应商需已配置凭据;openai-compat 允许免密(本地端点,worker 侧回退 apiKey 'local') */
export function resolveCustomSelection(store:ModelProvidersStore,id:string):{installation:StoredInstallation;model:ProviderModelSpec}{
 const slash=id.indexOf('/');
 const providerKey=slash>0?id.slice(0,slash):OPENAI_COMPAT_KEY;
 const modelId=slash>0?id.slice(slash+1):id;
 const installation=store.installations.find(item=>item.definition.providerKey===providerKey&&item.enabled&&(item.source==='openai-compat'||item.credentialsConfigured));
 if(!installation)throw new Error('Model provider unavailable');
 const model=installation.enabledModels.includes(modelId)?installation.definition.models.find(entry=>entry.modelId===modelId):undefined;
 if(!model)throw new Error('Model not enabled');
 return {installation,model};
}

/** 定时任务按创建时固定的 baseUrl+modelId 解析(兼容旧 schedule 的 gateway 语义) */
export function resolveScheduleModel(store:ModelProvidersStore,gatewayUrl:string,modelId:string):{installation:StoredInstallation;model:ProviderModelSpec}|null{
 const installation=store.installations.find(item=>item.baseUrl===gatewayUrl&&item.enabled&&(item.source==='openai-compat'||item.credentialsConfigured)&&item.enabledModels.includes(modelId));
 if(!installation)return null;
 const model=installation.definition.models.find(entry=>entry.modelId===modelId);
 return model?{installation,model}:null;
}

/** chat worker 的模型注册载荷(providerId 唯一:providerKey 全局去重) */
export type WorkerModelInput={providerId:string;name:string;baseUrl:string;apiKey:string;api:'openai-completions'|'pi-messages';models:{id:string;name:string;reasoning:boolean;input:('text'|'image')[];contextWindow:number;maxTokens:number;compat?:ProviderCompat}[];modelId:string};

export function workerModelInput({installation,model,apiKey,models}:{installation:StoredInstallation;model:ProviderModelSpec;apiKey:string;models?:ProviderModelSpec[]}):WorkerModelInput{
 const catalog=models??installation.enabledModels.flatMap(mid=>installation.definition.models.filter(entry=>entry.modelId===mid));
 const compat=installation.definition.compat;
 return {
  providerId:`piwork-${installation.definition.providerKey}`,
  name:pickLocalized(installation.definition.name,'zh-CN')||installation.definition.providerKey,
  baseUrl:installation.baseUrl,apiKey,api:'openai-completions',modelId:model.modelId,
  models:catalog.map(entry=>({id:entry.modelId,name:pickLocalized(entry.label,'zh-CN')||entry.modelId,reasoning:entry.reasoning,input:entry.vision?['text','image']:['text'],contextWindow:entry.contextSize,maxTokens:entry.defaultMaxTokens,...(compat?{compat}:{})})),
 };
}

export function validateWorkerModel(input:WorkerModelInput):WorkerModelInput{
 if(typeof input.providerId!=='string'||!input.providerId)fail('Invalid model provider');
 if(typeof input.baseUrl!=='string')fail('Invalid model baseUrl');
 parseBaseUrl(input.baseUrl);
 if(typeof input.apiKey!=='string')fail('Invalid model apiKey');
 if(input.api!=='openai-completions'&&input.api!=='pi-messages')fail('Invalid model api');
 if(!Array.isArray(input.models)||!input.models.length)fail('Model list is empty');
 for(const model of input.models){
  if(typeof model.id!=='string'||!model.id||typeof model.name!=='string'||!model.name)fail('Invalid model entry');
  if(typeof model.reasoning!=='boolean')fail('Invalid model reasoning');
  if(!Array.isArray(model.input)||!model.input.every(kind=>kind==='text'||kind==='image'))fail('Invalid model input');
  if(!Number.isInteger(model.contextWindow)||model.contextWindow<=0||!Number.isInteger(model.maxTokens)||model.maxTokens<=0)fail('Invalid model window');
 }
 if(!input.models.some(model=>model.id===input.modelId))fail('Selected model missing from list');
 return input;
}

export function toPublicInstallation(installation:StoredInstallation,credentialReadable?:boolean):ProviderInstallation{
 const view:ProviderInstallation={id:installation.id,source:installation.source,definition:installation.definition,baseUrl:installation.baseUrl,enabled:installation.enabled,enabledModels:installation.enabledModels,credentialsConfigured:installation.credentialsConfigured,credentialSummary:installation.credentialSummary,updatedAt:installation.updatedAt};
 if(installation.iconDataUrl)view.iconDataUrl=installation.iconDataUrl;
 if(installation.credentialsConfigured&&credentialReadable===false)view.credentialReadable=false;
 return view;
}
