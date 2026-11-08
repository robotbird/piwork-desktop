import test from 'node:test';import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogUrl, countPackageResourceFiles, countPackageResources, PiPackageError, readPiManifest, samePiPackage, toCatalogItem, validatePiPackageSource } from '../apps/desktop/electron/pi-package-registry.ts';

const fixtureRoot = join(import.meta.dirname, 'fixtures', 'pi-package-demo');

test('validates and normalizes npm package sources', () => {
 assert.equal(validatePiPackageSource('npm:foo'), 'npm:foo');
 assert.equal(validatePiPackageSource('  npm:foo@1.2.3 '), 'npm:foo@1.2.3');
 assert.equal(validatePiPackageSource('npm:@scope/name@0.1.0'), 'npm:@scope/name@0.1.0');
 assert.equal(validatePiPackageSource('npm:@scope/name'), 'npm:@scope/name');
 assert.equal(validatePiPackageSource('npm:foo@^1.0.0'), 'npm:foo@^1.0.0');
 for (const source of ['foo', 'npm:', 'git:github.com/user/repo', '/local/path', 'npm:has space', `npm:${'x'.repeat(215)}`, 'npm:foo@bad version!', 'npm:@']) {
  assert.throws(() => validatePiPackageSource(source), PiPackageError);
 }
});

test('samePiPackage ignores versions but keeps scope names intact', () => {
 assert.equal(samePiPackage('npm:foo@1.0.0', 'npm:foo'), true);
 assert.equal(samePiPackage('npm:@scope/name@2.0.0', 'npm:@scope/name'), true);
 assert.equal(samePiPackage('npm:foo', 'npm:bar'), false);
 assert.equal(samePiPackage('npm:@scope/name', 'npm:scope/name'), false);
});

test('builds catalog search urls with the pi-package keyword baseline', () => {
 assert.equal(buildCatalogUrl('', 0), 'https://registry.npmjs.org/-/v1/search?text=keywords%3Api-package&size=20&offset=0');
 assert.equal(buildCatalogUrl('web access', 20), 'https://registry.npmjs.org/-/v1/search?text=keywords%3Api-package%20web%20access&size=20&offset=20');
 assert.equal(buildCatalogUrl('q', -5).endsWith('offset=0'), true);
});

test('maps npm search objects to catalog items with fallbacks', () => {
 const item = toCatalogItem({ package: { name: 'pi-demo', version: '1.0.0', description: 'Demo', publisher: { username: 'alice' }, date: '2026-01-01', keywords: ['pi-package'], links: { npm: 'https://www.npmjs.com/package/pi-demo', repository: 'https://github.com/a/pi-demo' } } });
 assert.deepEqual(item, { name: 'pi-demo', version: '1.0.0', description: 'Demo', publisher: 'alice', date: '2026-01-01', keywords: ['pi-package'], links: { npm: 'https://www.npmjs.com/package/pi-demo', repository: 'https://github.com/a/pi-demo' } });
 const sparse = toCatalogItem({ package: { name: 'pi-bare' } });
 assert.equal(sparse.version, '');
 assert.equal(sparse.publisher, '');
 assert.deepEqual(sparse.keywords, []);
 assert.throws(() => toCatalogItem({ package: {} }), PiPackageError);
 assert.throws(() => toCatalogItem(null), PiPackageError);
});

test('reads the pi manifest and counts package resources by manifest entries', async () => {
 const manifest = await readPiManifest(fixtureRoot);
 assert.deepEqual(manifest, { extensions: ['src/ext/main.ts', 'src/ext/extra.js'], skills: ['skills'], prompts: ['prompts/report.md'] });
 assert.equal(await countPackageResourceFiles(fixtureRoot, 'extensions', manifest), 2);
 assert.equal(await countPackageResourceFiles(fixtureRoot, 'skills', manifest), 2);
 assert.equal(await countPackageResourceFiles(fixtureRoot, 'prompts', manifest), 1);
 assert.equal(await countPackageResourceFiles(fixtureRoot, 'themes', manifest), 0);
 assert.deepEqual(await countPackageResources(fixtureRoot, manifest), { extensions: 2, skills: 2, prompts: 1, themes: 0 });
 assert.equal(await readPiManifest(join(import.meta.dirname, 'fixtures', 'missing-package')), null);
});

test('falls back to conventional resource directories without a manifest', async () => {
 const root = await mkdtemp(join(tmpdir(), 'pi-package-registry-'));
 await mkdir(join(root, 'extensions'), { recursive: true });
 await mkdir(join(root, 'skills/nested'), { recursive: true });
 await mkdir(join(root, 'themes'), { recursive: true });
 await writeFile(join(root, 'extensions', 'tool.ts'), 'export const t = 1;');
 await writeFile(join(root, 'extensions', '.hidden.ts'), 'ignored');
 await writeFile(join(root, 'skills/nested', 'SKILL.md'), '# skill');
 await writeFile(join(root, 'themes', 'dark.json'), '{}');
 assert.equal(await countPackageResourceFiles(root, 'extensions', null), 1);
 assert.equal(await countPackageResourceFiles(root, 'skills', null), 1);
 assert.equal(await countPackageResourceFiles(root, 'themes', null), 1);
 assert.equal(await countPackageResourceFiles(root, 'prompts', null), 0);
});
