import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {chromium} from '@playwright/test';

/** A mock website issuer for account, history and sync integration tests. */
export function mockBrowserLogin(){
 const grants=new Map();
 return (req,res)=>{
  if(!['/api/auth/desktop/authorize','/api/auth/desktop/exchange'].includes(req.url))return false;
  (async()=>{
   let text='';for await(const part of req)text+=part;const body=JSON.parse(text);
   if(req.url.endsWith('/authorize')){
    const code=randomBytes(32).toString('base64url');grants.set(code,body.challenge);
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({callback:`piwork://auth/callback?${new URLSearchParams({code,state:body.state})}`}));
   }else{
    const challenge=createHash('sha256').update(body.verifier).digest('base64url');
    if(grants.get(body.code)!==challenge){res.writeHead(401);res.end();return}
    grants.delete(body.code);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({name:'authjs.session-token',value:'test',expires:Math.floor(Date.now()/1000)+3600}));
   }
  })().catch(()=>{res.writeHead(500);res.end()});return true;
 };
}
async function browserUrl(app,settings){
 await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.__browserLoginUrl=url}});
 await settings.getByRole('button',{name:'Sign in with browser'}).click();
 const url=await app.evaluate(()=>globalThis.__browserLoginUrl);assert.ok(url);return url;
}
export async function loginWithMockBrowser(app,settings,base){
 const url=new URL(await browserUrl(app,settings));assert.equal(url.origin,base);
 const response=await fetch(base+'/api/auth/desktop/authorize',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({state:url.searchParams.get('state'),challenge:url.searchParams.get('challenge')})});
 assert.equal(response.status,200);const {callback}=await response.json();
 await app.evaluate(({app},link)=>app.emit('open-url',{preventDefault(){}},link),callback);
}
export async function loginWithBrowser(app,settings,base,email,password){
 const url=await browserUrl(app,settings);const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();await page.goto(url);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('form button[type="submit"]').click();
  await page.waitForLoadState('networkidle');const authorized=page.waitForResponse(r=>r.url().endsWith('/api/auth/desktop/authorize')&&r.request().method()==='POST');
  await page.getByRole('button',{name:/登录并打开|Sign in and open/}).click();
  const {callback}=await(await authorized).json();await app.evaluate(({app},link)=>app.emit('open-url',{preventDefault(){}},link),callback);
 }finally{await browser.close()}
}
