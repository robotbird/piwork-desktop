import test from 'node:test';
import assert from 'node:assert/strict';
import {isSafeSqliteVersion,requireSafeSqliteVersion} from '../apps/desktop/electron/sqlite-version.ts';
test('SQLite WAL version gate accepts only fixed releases and rejects malformed versions',()=>{
 for(const version of ['3.51.3','3.53.4','3.50.7','3.44.6','4.0.0'])assert.equal(isSafeSqliteVersion(version),true,version);
 for(const version of ['3.51.2','3.51.0','3.50.6','3.49.99','3.44.5','3.0.0','2.99.99','3.53.4-extra','',null,'3.999999999999999999999.1'])assert.equal(isSafeSqliteVersion(version),false,String(version));
 assert.throws(()=>requireSafeSqliteVersion('3.51.2'));assert.doesNotThrow(()=>requireSafeSqliteVersion('3.53.4'));
});
