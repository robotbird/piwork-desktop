import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type {GatewayConfig,ModelProvidersView,ProviderInstallation,ProviderUpdateInput} from '../../shared/types';
import {validateGateway,type GatewayInput} from '../gateway';
import {builtinCatalog,catalogView} from './catalog';
import {
 OPENAI_COMPAT_KEY,emptyStore,importLegacyGateway,installProvider,openaiCompatModel,removeProvider,resolveCustomSelection,resolveScheduleModel,setDefaultModel as storeSetDefaultModelValue,summarizeCredentials,toPublicInstallation,updateProvider,validateStore,workerModelInput,
 type ModelProvidersStore,type StoredInstallation,type WorkerModelInput,
} from './store';
import {inspectProviderPackage} from './zip';
import {pingProviderCredentials} from './validate-credentials';

/** 模型供应商的 main 侧服务:持久化(<userData>/model-providers.json,原子写 0o600)、
    safeStorage 凭据加解密、内置目录安装、上传包安装、凭据探测与 gateway.json 迁移。 */

let store:ModelProvidersStore|null=null;
let loading:Promise<void>|null=null;
let notifier:(()=>void)|null=null;

export function setModelProvidersNotifier(value:()=>void){notifier=value}
function notify(){notifier?.()}
function storePath(){return path.join(app.getPath('userData'),'model-providers.json')}
function legacyGatewayPath(){return path.join(app.getPath('userData'),'gateway.json')}

async function writeStore(next:ModelProvidersStore){
 await fs.mkdir(app.getPath('userData'),{recursive:true});
 const target=storePath();
 await fs.writeFile(target+'.tmp',JSON.stringify(next),{mode:0o600});
 await fs.rename(target+'.tmp',target);
}

function encryptCredentials(values:Record<string,string>):Record<string,string>{
 const out:Record<string,string>={};
 for(const [key,value] of Object.entries(values))out[key]=safeStorage.encryptString(value).toString('base64');
 return out;
}
function decryptCredentials(map:Record<string,string>|undefined):Record<string,string>|null{
 if(!map)return {};
 try{return Object.fromEntries(Object.entries(map).map(([key,value])=>[key,safeStorage.decryptString(Buffer.from(value,'base64'))]))}catch{return null}
}

/** 旧 gateway.json 读取(与迁移前 main.ts 的 getGateway 同规则;ENOENT 返回 null) */
type LegacyGatewayFile={baseUrl:string;modelId:string;encryptedKey?:string;supportsImages?:boolean};
async function readLegacyGateway():Promise<LegacyGatewayFile|null>{
 try{
  const data=JSON.parse(await fs.readFile(legacyGatewayPath(),'utf8'));
  if(typeof data.baseUrl!=='string'||typeof data.modelId!=='string'||(data.encryptedKey!==undefined&&typeof data.encryptedKey!=='string')||(data.supportsImages!==undefined&&typeof data.supportsImages!=='boolean'))throw new Error('Invalid gateway data');
  return data;
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;return null}
}

/** 加载并迁移(幂等):损坏的存储文件改名旁置后重建,避免桌面端被单文件卡死 */
export async function loadModelProviders():Promise<void>{
 if(store)return;
 let next:ModelProvidersStore;
 try{
  next=validateStore(JSON.parse(await fs.readFile(storePath(),'utf8')));
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT'){
   await fs.rename(storePath(),`${storePath()}.invalid-${Date.now()}`).catch(()=>{});
  }
  next=emptyStore();
 }
 if(!next.legacyGatewayImported){
  const legacy=await readLegacyGateway();
  if(legacy)next=importLegacyGateway(next,{baseUrl:legacy.baseUrl,modelId:legacy.modelId,supportsImages:legacy.supportsImages},legacy.encryptedKey);
  else next={...next,legacyGatewayImported:true};
  await writeStore(next);
 }
 store=next;
}

/** 惰性加载:所有导出操作先确保 store 就绪(chat:send 可能在 init 竞态时先到) */
async function ensure():Promise<ModelProvidersStore>{
 if(store)return store;
 if(!loading)loading=loadModelProviders().catch(error=>{loading=null;throw error});
 await loading;
 if(!store)throw new Error('Model providers unavailable');
 return store;
}

async function commit(next:ModelProvidersStore):Promise<ModelProvidersView>{
 store=next;
 await writeStore(next);
 notify();
 return modelProvidersView();
}

function installationApiKey(installation:StoredInstallation):string{
 // openai-completions 探测/调用使用首个 secret 字段(三家供应商均为 api_key);
 // 已存密文但解密失败(系统钥匙串变更)按旧 schedule 语义报 credentials_unavailable
 if(installation.encryptedCredentials&&!decryptCredentials(installation.encryptedCredentials))throw new Error('credentials_unavailable');
 const field=installation.definition.credentialFields.find(entry=>entry.type==='secret-input')??installation.definition.credentialFields[0]!;
 const decrypted=decryptCredentials(installation.encryptedCredentials)??{};
 const value=decrypted[field.variable];
 return typeof value==='string'?value:'';
}

export async function modelProvidersView():Promise<ModelProvidersView>{
 const current=await ensure();
 return buildView(current);
}
function buildView(current:ModelProvidersStore):ModelProvidersView{
 const installations=current.installations.map(item=>toPublicInstallation(item,decryptCredentials(item.encryptedCredentials)!==null));
 return {installations,catalog:catalogView(new Set(current.installations.map(item=>item.definition.providerKey))),defaultModel:current.defaultModel};
}

export async function installFromCatalog(packageId:string):Promise<ModelProvidersView>{
 const current=await ensure();
 const definition=builtinCatalog.find(item=>item.packageId===packageId);
 if(!definition)throw new Error('Provider package unavailable');
 return commit(installProvider(current,definition,'builtin'));
}

export async function installFromBuffer(fileName:string,buffer:Buffer):Promise<ModelProvidersView>{
 const current=await ensure();
 const inspection=await inspectProviderPackage(fileName,buffer);
 return commit(installProvider(current,inspection.definition,'upload',inspection.iconDataUrl));
}

export async function removeInstallation(id:string):Promise<ModelProvidersView>{
 const current=await ensure();
 return commit(removeProvider(current,id));
}

export async function setDefaultModelValue(value:{providerKey:string;modelId:string}|null):Promise<ModelProvidersView>{
 const current=await ensure();
 return commit(storeSetDefaultModelValue(current,value));
}

function validUpdatePatch(patch:unknown):ProviderUpdateInput{
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Invalid provider update');
 const value=patch as Record<string,unknown>;
 const out:ProviderUpdateInput={};
 if(value.enabled!==undefined){if(typeof value.enabled!=='boolean')throw new Error('Invalid provider update');out.enabled=value.enabled}
 if(value.enabledModels!==undefined){if(!Array.isArray(value.enabledModels)||!value.enabledModels.every(id=>typeof id==='string'))throw new Error('Invalid provider update');out.enabledModels=value.enabledModels}
 if(value.baseUrl!==undefined){if(typeof value.baseUrl!=='string')throw new Error('Invalid provider update');out.baseUrl=value.baseUrl}
 if(value.defaultModelId!==undefined){if(value.defaultModelId!==null&&typeof value.defaultModelId!=='string')throw new Error('Invalid provider update');out.defaultModelId=value.defaultModelId}
 if(value.models!==undefined){if(!Array.isArray(value.models))throw new Error('Invalid provider update');out.models=value.models}
 if(value.credentials!==undefined){
  if(!value.credentials||typeof value.credentials!=='object'||Array.isArray(value.credentials)||!Object.values(value.credentials).every(entry=>typeof entry==='string'))throw new Error('Invalid provider update');
  out.credentials=Object.fromEntries(Object.entries(value.credentials).filter(([,text])=>text!==''));
 }
 return out;
}

/** 安装项更新:凭据合并(空串=保留)→ 必填校验 → 连通性探测 → 加密落盘。
    skipPing 供旧 gateway shim 复用(旧保存不做在线验证)。 */
export async function updateInstallation(id:string,patchInput:unknown,options?:{skipPing?:boolean}):Promise<ModelProvidersView>{
 const patch=validUpdatePatch(patchInput);
 const current=await ensure();
 const installation=current.installations.find(item=>item.id===id);
 if(!installation)throw new Error('Provider unavailable');
 const fields=installation.definition.credentialFields;
 let credentialsConfigured=installation.credentialsConfigured;
 let credentialSummary=installation.credentialSummary;
 let encryptedCredentials=installation.encryptedCredentials;
 if(patch.credentials&&Object.keys(patch.credentials).length){
  const existing=decryptCredentials(installation.encryptedCredentials);
  if(existing===null&&!fields.every(field=>typeof patch.credentials![field.variable]==='string'&&patch.credentials![field.variable]))throw new Error('credentialRecoveryRequired');
  const merged:Record<string,string>={...(existing??{})};
  for(const field of fields){
   const value=patch.credentials[field.variable];
   if(typeof value==='string'&&value.trim())merged[field.variable]=value.trim();
  }
  for(const field of fields)if(field.required&&!(typeof merged[field.variable]==='string'&&merged[field.variable]))throw new Error('credentialRequired');
  if(!options?.skipPing){
   const secret=fields.find(field=>field.type==='secret-input')??fields[0]!;
   const apiKey=merged[secret.variable]??'';
   // 校验模型取替换目录后的首模型(openai-compat 目录可编辑),目录供应商固定 validationModel
   const validationModel=patch.models?.[0]?.modelId??installation.definition.validationModel;
   const baseUrl=(patch.baseUrl??installation.baseUrl).replace(/\/+$/,'');
   if(validationModel)await pingProviderCredentials({baseUrl,apiKey,model:validationModel});
  }
  if(!safeStorage.isEncryptionAvailable())throw new Error('Secure storage unavailable');
  encryptedCredentials=encryptCredentials(merged);
  credentialsConfigured=true;
  credentialSummary=summarizeCredentials(fields,merged);
 }
 return commit(updateProvider(current,id,{...patch,credentialsConfigured,credentialSummary,...(encryptedCredentials?{encryptedCredentials}:{})}));
}

/** chat:send 自定义模型解析:返回含解密后 API key 的 worker 载荷原料 */
export async function resolveCustomModel(selectionId:string):Promise<WorkerModelInput>{
 const current=await ensure();
 const {installation,model}=resolveCustomSelection(current,selectionId);
 return workerModelInput({installation,model,apiKey:installationApiKey(installation)});
}

/** 定时任务按创建时固定的 baseUrl+modelId 解析;未命中返回 null(→ gateway_changed) */
export async function resolveScheduledModel(gatewayUrl:string,modelId:string):Promise<WorkerModelInput|null>{
 const current=await ensure();
 const resolved=resolveScheduleModel(current,gatewayUrl,modelId);
 if(!resolved)return null;
 return workerModelInput({installation:resolved.installation,model:resolved.model,apiKey:installationApiKey(resolved.installation)});
}

/** 新建定时任务捕获的当前自定义模型:默认模型优先,否则首个可用安装项的首个启用模型 */
export async function defaultCustomModel():Promise<{baseUrl:string;modelId:string}|null>{
 const current=await ensure();
 const usable=(installation:StoredInstallation)=>installation.enabled&&(installation.source==='openai-compat'||installation.credentialsConfigured)&&installation.enabledModels.length>0;
 if(current.defaultModel){
  const installation=current.installations.find(item=>item.definition.providerKey===current.defaultModel!.providerKey&&usable(item));
  const model=installation?installation.definition.models.find(entry=>entry.modelId===current.defaultModel!.modelId):undefined;
  if(installation&&model)return {baseUrl:installation.baseUrl,modelId:model.modelId};
 }
 for(const installation of current.installations){
  if(!usable(installation))continue;
  const modelId=installation.enabledModels.find(id=>installation.definition.models.some(entry=>entry.modelId===id));
  if(modelId)return {baseUrl:installation.baseUrl,modelId};
 }
 return null;
}

/* ---------- 旧 gateway:get/set IPC 的兼容 shim(指向常驻 openai-compat 安装项) ---------- */

export async function legacyGatewayGet():Promise<GatewayConfig|null>{
 const current=await ensure();
 const installation=current.installations.find(item=>item.definition.providerKey===OPENAI_COMPAT_KEY);
 if(!installation||!installation.enabledModels.length)return null;
 const modelId=current.defaultModel?.providerKey===OPENAI_COMPAT_KEY&&installation.enabledModels.includes(current.defaultModel.modelId)?current.defaultModel.modelId:installation.enabledModels[0]!;
 const model=installation.definition.models.find(entry=>entry.modelId===modelId)!;
 return {baseUrl:installation.baseUrl,modelId:model.modelId,hasApiKey:installation.credentialsConfigured,supportsImages:model.vision};
}

export async function legacyGatewaySet(input:GatewayInput):Promise<GatewayConfig>{
 const valid=validateGateway(input);
 const current=await ensure();
 const installation=current.installations.find(item=>item.definition.providerKey===OPENAI_COMPAT_KEY);
 if(!installation)throw new Error('Gateway unavailable');
 // 旧网关语义:单模型 + 可选密钥(空=保留已存);不做在线验证
 const model=openaiCompatModel(valid.modelId,valid.supportsImages===true);
 let next=updateProvider(current,installation.id,{baseUrl:valid.baseUrl,models:[model],enabledModels:[valid.modelId],defaultModelId:valid.modelId});
 if(valid.apiKey){
  if(!safeStorage.isEncryptionAvailable())throw new Error('Secure storage unavailable');
  next=updateProvider(next,installation.id,{credentialsConfigured:true,credentialSummary:summarizeCredentials(installation.definition.credentialFields,{api_key:valid.apiKey}),encryptedCredentials:encryptCredentials({api_key:valid.apiKey})});
 }
 store=next;
 await writeStore(next);
 notify();
 const result=await legacyGatewayGet();
 if(!result)throw new Error('Gateway unavailable');
 return result;
}
