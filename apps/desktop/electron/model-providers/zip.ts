import yauzl from 'yauzl';
import type {ProviderDefinition} from '../../shared/types';
import {validateProviderDefinition} from './store.ts';

/** 桌面端模型供应商插件包检查:纯数据声明式格式,不执行任何插件代码。
    包结构:piwork-llm-<provider>.zip 内含 provider.json(必需)与 assets/icon.svg(可选)。 */

export const PACKAGE_NAME_PATTERN=/^piwork-llm-[a-z0-9]+(?:-[a-z0-9]+)*\.zip$/;
export const MAX_PACKAGE_BYTES=20*1024*1024;
const MAX_FILE_BYTES=2*1024*1024;
const MAX_ICON_BYTES=256*1024;
const MAX_ENTRIES=32;

/** yauzl 回调式 API 的 Promise 封装:解出全部常规文件条目(path→bytes);任一条目异常即拒绝 */
function readEntries(buffer:Buffer):Promise<Map<string,Buffer>>{
 return new Promise((resolve,reject)=>{
  yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zipfile)=>{
   if(error||!zipfile){reject(new Error('invalidPackage'));return}
   let settled=false;
   const files=new Map<string,Buffer>();
   const finish=()=>{if(settled)return;settled=true;resolve(files)};
   const fail=(message:string)=>{if(settled)return;settled=true;try{zipfile.close()}catch{}reject(new Error(message))};
   zipfile.on('error',()=>fail('invalidPackage'));
   zipfile.on('end',finish);
   zipfile.on('entry',(entry:yauzl.Entry)=>{
    if(settled)return;
    if(entry.fileName.endsWith('/')||!entry.fileName||entry.fileName.startsWith('/')||entry.fileName.includes('..')){fail('unsafePath');return}
    if(files.size>=MAX_ENTRIES){fail('tooManyEntries');return}
    if(entry.uncompressedSize>MAX_FILE_BYTES){fail('fileTooLarge');return}
    zipfile.openReadStream(entry,(streamError,stream)=>{
     if(streamError||!stream){fail('invalidPackage');return}
     const chunks:Buffer[]=[];
     stream.on('data',(chunk:Buffer)=>chunks.push(chunk));
     stream.on('error',()=>fail('invalidPackage'));
     stream.on('end',()=>{
      if(settled)return;
      files.set(entry.fileName,Buffer.concat(chunks));
      zipfile.readEntry();
     });
    });
   });
   zipfile.readEntry();
  });
 });
}

function dataUrlForSvg(bytes:Buffer):string|null{
 // 仅接受 <svg 开头的纯文本(经 <img> data URL 渲染,脚本不会执行;仍限定体积)
 const text=bytes.toString('utf8').trim();
 if(!text.startsWith('<svg')||/<script/i.test(text))return null;
 return `data:image/svg+xml;base64,${bytes.toString('base64')}`;
}

export type PackageInspection={definition:ProviderDefinition;iconDataUrl?:string;fileName:string;sizeBytes:number};

/** 检查上传的插件包字节;错误消息为稳定标识符,由渲染层转文案 */
export async function inspectProviderPackage(fileName:string,buffer:Buffer):Promise<PackageInspection>{
 if(!PACKAGE_NAME_PATTERN.test(fileName))throw new Error('invalidPackageName');
 if(buffer.length===0||buffer.length>MAX_PACKAGE_BYTES)throw new Error('invalidPackageSize');
 const files=await readEntries(buffer);
 const providerRaw=files.get('provider.json');
 if(!providerRaw)throw new Error('providerJsonMissing');
 let parsed:unknown;
 try{parsed=JSON.parse(providerRaw.toString('utf8'))}catch{throw new Error('providerJsonInvalid')}
 const definition=validateProviderDefinition(parsed);
 const expectedKey=fileName.replace(/^piwork-llm-/,'').replace(/\.zip$/,'');
 if(definition.providerKey!==expectedKey)throw new Error('providerKeyMismatch');
 const icon=files.get('assets/icon.svg');
 let iconDataUrl:string|undefined;
 if(icon){
  if(icon.length>MAX_ICON_BYTES)throw new Error('iconTooLarge');
  const url=dataUrlForSvg(icon);
  if(!url)throw new Error('iconInvalid');
  iconDataUrl=url;
 }
 // 只允许白名单条目,防止夹带
 for(const name of files.keys())if(name!=='provider.json'&&name!=='assets/icon.svg')throw new Error('unexpectedEntry');
 return {definition,...(iconDataUrl?{iconDataUrl}:{}),fileName,sizeBytes:buffer.length};
}
