import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import test from 'node:test';
import {accountAddress,beginAccountLogin,callbackCode} from '../apps/desktop/electron/account-login.ts';

test('browser login validates origins and sends a challenge without exposing the verifier',()=>{
 for(const input of ['http://piwork.net','https://user:pass@piwork.net','https://piwork.net/other','https://piwork.net/?a=b','javascript:alert(1)'])assert.throws(()=>accountAddress(input));
 for(const input of ['https://piwork.net','http://localhost:3000','http://127.0.0.1:3000','http://[::1]:3000'])assert.equal(accountAddress(input),new URL(input).origin);
 const {pending,url}=beginAccountLogin('https://piwork.net');const link=new URL(url);
 assert.equal(link.origin,'https://piwork.net');assert.equal(link.pathname,'/desktop-login');
 assert.equal(link.searchParams.get('state'),pending.state);
 assert.equal(link.searchParams.get('challenge'),createHash('sha256').update(pending.verifier).digest('base64url'));
 assert.ok(!url.includes(pending.verifier));assert.notEqual(beginAccountLogin('https://piwork.net').pending.state,pending.state);
});

test('callbacks require a matching active state and exact scheme, path and parameters',()=>{
 const {pending}=beginAccountLogin('https://piwork.net');const code=randomBytes(32).toString('base64url');
 const link=`piwork://auth/callback?code=${code}&state=${pending.state}`;
 assert.equal(callbackCode(link,pending),code);
 for(const input of [link.replace('piwork:','https:'),link.replace('auth/','other/'),link.replace('/callback?','/callback/extra?'),link.replace(pending.state,randomBytes(32).toString('base64url')),link+'&code='+code,link+'&extra=1',link+'#fragment',link.replace('auth/','user@auth/'),link.replace(code,'invalid'),'invalid'])assert.equal(callbackCode(input,pending),null,input);
 assert.equal(callbackCode(link,{...pending,expiresAt:Date.now()-1}),null);
});
