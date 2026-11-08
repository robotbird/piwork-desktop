import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {allowedNavigation,developmentServerUrl} from '../apps/desktop/electron/navigation.ts';

test('permits only the packaged entry page and rejects arbitrary local or network destinations',()=>{
 const entry='/tmp/piwork app/dist/index.html';const url=pathToFileURL(entry).href;
 assert.equal(allowedNavigation(url,undefined,entry),true);assert.equal(allowedNavigation(`${url}#section`,undefined,entry),true);
 for(const target of ['file:///etc/passwd','https://example.com/','file:///tmp/piwork%20app/dist/other.html',`${url}?x=1`,'not a url'])assert.equal(allowedNavigation(target,undefined,entry),false);
});
test('development navigation accepts the dev origin, not a prefix lookalike',()=>{
 const dev='http://localhost:5173/';assert.equal(allowedNavigation('http://localhost:5173/path',dev,'/unused'),true);
 for(const target of ['http://localhost:5174/','http://localhost.evil:5173/','http://user@localhost:5173/','file:///etc/passwd'])assert.equal(allowedNavigation(target,dev,'/unused'),false);
});

test('packaged app ignores a development server override',()=>{assert.equal(developmentServerUrl(true,'https://example.com'),undefined);assert.equal(developmentServerUrl(false,'http://localhost:5173/'),'http://localhost:5173/');assert.equal(developmentServerUrl(false,''),undefined)});
