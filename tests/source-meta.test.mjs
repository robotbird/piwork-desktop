import test from 'node:test';import assert from 'node:assert/strict';
import {pageMeta} from '../apps/desktop/electron/source-meta.ts';

test('parses og:title/og:description ahead of fallback tags',()=>{
 const html=`<head>
  <meta property="og:title" content="Pi 1.0 发布">
  <meta name="description" content="旧描述">
  <meta property="og:description" content="Pi 1.0  是一个  精简的编码 agent。">
  <title>Pi</title>
 </head>`;
 assert.deepEqual(pageMeta(html),{title:'Pi 1.0 发布',description:'Pi 1.0 是一个 精简的编码 agent。'});
});

test('falls back to meta description and title tag',()=>{
 const html=`<html><head><meta name="description" content="Plain page summary">
  <title >The Agent Times</title></head><body>ignore</body></html>`;
 assert.deepEqual(pageMeta(html),{title:'The Agent Times',description:'Plain page summary'});
});

test('caps long values and returns empty for bare html',()=>{
 const long='x'.repeat(300);
 const meta=pageMeta(`<meta property="og:title" content="${long}"><meta property="og:description" content="${long}">`);
 assert.equal(meta.title.length,120);
 assert.equal(meta.description.length,200);
 assert.equal(meta.title.endsWith('…'),true);
 assert.deepEqual(pageMeta('<p>no meta</p>'),{});
});
