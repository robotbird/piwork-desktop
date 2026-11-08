export type McpConfig={id:string;name:string;type:'stdio'|'http';command?:string;args?:string[];url?:string;enabled:boolean;description?:string;env?:Record<string,string>;headers?:Record<string,string>};
export type McpInput={name:string;type:'stdio'|'http';command?:string;args?:string[];url?:string;description?:string;env?:Record<string,string>;headers?:Record<string,string>};
const MAX_ENV_KEYS=64;
const MAX_ENV_VALUE_LENGTH=4000;
const MAX_DESCRIPTION_LENGTH=1024;
function validateKeyValue(value:unknown):Record<string,string>|null{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const result:Record<string,string>={};
 for(const [key,entry] of Object.entries(value as Record<string,unknown>)){
  if(!key||key.length>200||typeof entry!=='string'||entry.length>MAX_ENV_VALUE_LENGTH)return null;
  result[key]=entry;
 }
 if(Object.keys(result).length>MAX_ENV_KEYS)return null;
 return result;
}
export function validateMcp(input:McpInput):McpInput {
 if(!input||typeof input.name!=='string'||!/^[-a-zA-Z0-9_]{1,64}$/.test(input.name)||!['stdio','http'].includes(input.type))throw new Error('Invalid MCP');
 if(input.description!==undefined&&(typeof input.description!=='string'||input.description.length>MAX_DESCRIPTION_LENGTH))throw new Error('Invalid description');
 const description=typeof input.description==='string'&&input.description.trim()?input.description.trim():undefined;
 if(input.type==='stdio'){
  if(typeof input.command!=='string'||!input.command.trim()||input.command.length>1000||!Array.isArray(input.args)||input.args.length>50||input.args.some(arg=>typeof arg!=='string'||arg.length>4000))throw new Error('Invalid command');
  const env=validateKeyValue(input.env);
  if(env===null)throw new Error('Invalid env');
  const result:McpInput={name:input.name,type:'stdio',command:input.command.trim(),args:input.args};
  if(description!==undefined)result.description=description;
  if(Object.keys(env).length)result.env=env;
  return result;
 }
 if(typeof input.url!=='string')throw new Error('Invalid URL');const url=new URL(input.url.trim());
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Invalid URL');
 const headers=validateKeyValue(input.headers);
 if(headers===null)throw new Error('Invalid headers');
 const result:McpInput={name:input.name,type:'http',url:url.toString()};
 if(description!==undefined)result.description=description;
 if(Object.keys(headers).length)result.headers=headers;
 return result;
}
