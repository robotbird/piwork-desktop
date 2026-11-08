export type GatewayInput={baseUrl:string;modelId:string;apiKey:string;supportsImages?:boolean;api?:'openai-completions'|'pi-messages'};
export type GatewayConfig={baseUrl:string;modelId:string;hasApiKey:boolean;supportsImages:boolean};
export function validateGateway(input:GatewayInput):GatewayInput {
 if(!input||typeof input.baseUrl!=='string'||typeof input.modelId!=='string'||typeof input.apiKey!=='string')throw new Error('Invalid gateway');
 if(input.api!==undefined&&!['openai-completions','pi-messages'].includes(input.api))throw new Error('Invalid gateway');
 if(input.supportsImages!==undefined&&typeof input.supportsImages!=='boolean')throw new Error('Invalid gateway');
 const address=new URL(input.baseUrl.trim());
 if(!['https:','http:'].includes(address.protocol)||address.username||address.password||address.search||address.hash)throw new Error('Invalid URL');
 const modelId=input.modelId.trim();if(!modelId||modelId.length>200||input.apiKey.length>8192)throw new Error('Invalid gateway');
 return {baseUrl:address.toString().replace(/\/$/,''),modelId,apiKey:input.apiKey,...(input.api?{api:input.api}:{}),...(input.supportsImages===undefined?{}:{supportsImages:input.supportsImages})};
}
