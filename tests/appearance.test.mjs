import test from 'node:test';
import assert from 'node:assert/strict';
import { APPEARANCE_KEY, LEGACY_KEY, readAppearance, resolveAppearance, saveAppearance } from '../prototype/appearance.mjs';
function storage(initial = {}) { const values = new Map(Object.entries(initial)); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }; }
test('defaults to system and follows system changes', () => {
  assert.equal(readAppearance(storage()), 'system');
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
});
test('explicit choice survives reload and ignores system', () => {
  const store = storage(); assert.equal(saveAppearance(store, 'dark'), true);
  assert.equal(readAppearance(store), 'dark'); assert.equal(resolveAppearance(readAppearance(store), false), 'dark');
  saveAppearance(store, 'light'); assert.equal(resolveAppearance(readAppearance(store), true), 'light');
});
test('supports existing preference and invalid stored values', () => {
  assert.equal(readAppearance(storage({[LEGACY_KEY]:'dark'})), 'dark');
  assert.equal(readAppearance(storage({[APPEARANCE_KEY]:'invalid'})), 'system');
  assert.throws(() => saveAppearance(storage(), 'invalid'), TypeError);
});
test('works when storage is blocked', () => {
  const blocked = {getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  assert.equal(readAppearance(blocked), 'system'); assert.equal(saveAppearance(blocked, 'light'), false);
});
