import test from 'node:test';import assert from 'node:assert/strict';
import { isNewerVersion, normalizeUpdateState, NOTES_LIMIT, parseReleasePayload, pickDmgAsset } from '../apps/desktop/electron/app-update-core.ts';

test('isNewerVersion compares semver with v prefix and prerelease tolerance', () => {
 assert.equal(isNewerVersion('v0.2.0', '0.1.0'), true);
 assert.equal(isNewerVersion('0.1.0', 'v0.1.0'), false);
 assert.equal(isNewerVersion('1.10.0', '1.9.9'), true);
 assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
 assert.equal(isNewerVersion('0.1.0', '0.2.0'), false);
 // 同号预发布不高于正式版;高一位的预发布视为可更新
 assert.equal(isNewerVersion('0.1.0-beta.1', '0.1.0'), false);
 assert.equal(isNewerVersion('0.1.1-beta.1', '0.1.0'), true);
 // 畸形输入一律不提示更新
 assert.equal(isNewerVersion('', '0.1.0'), false);
 assert.equal(isNewerVersion('latest', '0.1.0'), false);
 assert.equal(isNewerVersion('0.2', '0.1.0'), false);
 assert.equal(isNewerVersion('0.2.0.1', '0.1.0'), false);
});

test('pickDmgAsset prefers the exact artifact name then falls back by arch suffix', () => {
 const assets = [
  { name: 'PiWork-0.1.0-arm64.dmg', size: 100, browser_download_url: 'https://example.com/old', digest: 'sha256:AA' },
  { name: 'PiWork-0.2.0-arm64.dmg', size: 200, browser_download_url: 'https://example.com/new', digest: 'sha256:BB' },
  { name: 'PiWork-0.2.0-arm64.zip', size: 300, browser_download_url: 'https://example.com/zip' },
  { name: 'PiWork-0.2.0-x64.dmg', size: 400, browser_download_url: 'https://example.com/x64' },
 ];
 assert.deepEqual(
  pickDmgAsset(assets, 'PiWork', '0.2.0', 'arm64'),
  { assetName: 'PiWork-0.2.0-arm64.dmg', downloadUrl: 'https://example.com/new', size: 200, sha256: 'bb' },
 );
 // 无精确名时取任意 arm64 DMG 兜底;非数组/无匹配返回 null
 assert.equal(pickDmgAsset(assets.slice(0, 1), 'PiWork', '0.2.0', 'arm64')?.assetName, 'PiWork-0.1.0-arm64.dmg');
 assert.equal(pickDmgAsset(null, 'PiWork', '0.2.0', 'arm64'), null);
 assert.equal(pickDmgAsset([{}], 'PiWork', '0.2.0', 'arm64'), null);
 assert.equal(pickDmgAsset([{ name: 'PiWork-0.2.0-arm64.zip', browser_download_url: 'x' }], 'PiWork', '0.2.0', 'arm64'), null);
 // digest 缺失或算法不符时 sha256 为空(下载仅做 size 校验)
 const noDigest = pickDmgAsset([{ name: 'PiWork-0.2.0-arm64.dmg', size: 10, browser_download_url: 'x' }], 'PiWork', '0.2.0', 'arm64');
 assert.equal(noDigest.sha256, '');
 const otherDigest = pickDmgAsset([{ name: 'PiWork-0.2.0-arm64.dmg', size: 10, browser_download_url: 'x', digest: 'md5:aa' }], 'PiWork', '0.2.0', 'arm64');
 assert.equal(otherDigest.sha256, '');
});

test('parseReleasePayload maps a newer GitHub release to update info', () => {
 const payload = {
  tag_name: 'v0.2.0',
  body: '  修复与改进\n- 更新机制  ',
  assets: [{ name: 'PiWork-0.2.0-arm64.dmg', size: 2048, browser_download_url: 'https://example.com/PiWork-0.2.0-arm64.dmg', digest: 'sha256:ABCDEF' }],
 };
 assert.deepEqual(parseReleasePayload(payload, '0.1.0', 'PiWork', 'arm64'), {
  version: '0.2.0',
  notes: '修复与改进\n- 更新机制',
  assetName: 'PiWork-0.2.0-arm64.dmg',
  downloadUrl: 'https://example.com/PiWork-0.2.0-arm64.dmg',
  size: 2048,
  sha256: 'abcdef',
 });
 // 发布说明截断到上限
 const long = parseReleasePayload({ ...payload, body: 'x'.repeat(NOTES_LIMIT + 10) }, '0.1.0', 'PiWork', 'arm64');
 assert.equal(long.notes.length, NOTES_LIMIT);
});

test('parseReleasePayload returns null when not newer, missing dmg or malformed', () => {
 const older = { tag_name: 'v0.0.1', assets: [] };
 assert.equal(parseReleasePayload(older, '0.1.0', 'PiWork', 'arm64'), null);
 assert.equal(parseReleasePayload({ tag_name: 'v0.1.0', assets: [] }, '0.1.0', 'PiWork', 'arm64'), null);
 const newerNoDmg = { tag_name: 'v0.2.0', assets: [{ name: 'PiWork-0.2.0-arm64.zip', browser_download_url: 'x' }] };
 assert.equal(parseReleasePayload(newerNoDmg, '0.1.0', 'PiWork', 'arm64'), null);
 for (const bad of [null, 'x', [], {}, { assets: [] }, { tag_name: '' }]) {
  assert.equal(parseReleasePayload(bad, '0.1.0', 'PiWork', 'arm64'), null);
 }
});

test('normalizeUpdateState keeps a valid throttle timestamp and drops everything else', () => {
 assert.deepEqual(normalizeUpdateState({ lastAutoCheckAt: 1730000000123.7 }), { lastAutoCheckAt: 1730000000123 });
 assert.deepEqual(normalizeUpdateState({}), {});
 assert.deepEqual(normalizeUpdateState({ lastAutoCheckAt: 'yesterday' }), {});
 assert.deepEqual(normalizeUpdateState({ lastAutoCheckAt: -1 }), {});
 for (const bad of [null, 'x', 42, []]) assert.deepEqual(normalizeUpdateState(bad), {});
});
