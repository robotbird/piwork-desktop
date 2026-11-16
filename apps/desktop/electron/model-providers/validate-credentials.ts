/** 凭据连通性验证:对 openai-completions 端点发送 max_tokens=1 的最小补全
    (与 web 插件 validateCredentials 的探测行为一致)。
    判定语义:401/403 → Key 无效;429 → 限流,说明请求已携 Key 到达网关,视为可用;
    其余非 2xx → 服务端/网关问题;网络失败 → validationUnreachable。 */

export async function pingProviderCredentials({baseUrl,apiKey,model,timeoutMs=20000}:{baseUrl:string;apiKey:string;model:string;timeoutMs?:number}):Promise<void>{
 if(!apiKey)throw new Error('api_key is required');
 let response:Response;
 try{
  response=await fetch(`${baseUrl.replace(/\/+$/,'')}/chat/completions`,{
   method:'POST',
   headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
   body:JSON.stringify({model,max_tokens:1,messages:[{role:'user',content:'ping'}],stream:false}),
   signal:AbortSignal.timeout(timeoutMs),
  });
 }catch{
  throw new Error('validationUnreachable');
 }
 if(response.ok||response.status===429)return;
 if(response.status===401||response.status===403)throw new Error(`invalidApiKey (HTTP ${response.status})`);
 if(response.status>=500)throw new Error(`providerUnavailable (HTTP ${response.status} ${response.statusText})`);
 throw new Error(`validationFailed (HTTP ${response.status} ${response.statusText})`);
}
