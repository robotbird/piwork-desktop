import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGateway} from '../apps/desktop/electron/gateway.ts';
test('validates a custom gateway and normalizes its URL',()=>{assert.deepEqual(validateGateway({baseUrl:' https://example.com/v1/ ',modelId:' model ',apiKey:'key'}),{baseUrl:'https://example.com/v1',modelId:'model',apiKey:'key'})});
test('rejects credentials, query strings, invalid protocols and empty models',()=>{for(const baseUrl of ['file:///tmp/a','https://u:p@example.com','https://example.com/?key=secret','https://example.com/#secret'])assert.throws(()=>validateGateway({baseUrl,modelId:'m',apiKey:''}));assert.throws(()=>validateGateway({baseUrl:'https://example.com',modelId:' ',apiKey:''}))});
