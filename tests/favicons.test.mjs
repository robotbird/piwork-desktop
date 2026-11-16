import test from 'node:test';import assert from 'node:assert/strict';
import {pageIconUrls} from '../apps/desktop/electron/favicons.ts';

test('parses icon link hrefs and resolves them against the origin',()=>{
 const html=`<head>
  <link rel="stylesheet" href="/style.css">
  <link rel="shortcut icon" href="/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/touch-icon.png">
  <link rel="icon" href="https://cdn.example.com/icon.svg">
 </head>`;
 assert.deepEqual(pageIconUrls(html,'https://site.example.com'),[
  'https://site.example.com/favicon-32.png',
  'https://site.example.com/touch-icon.png',
  'https://cdn.example.com/icon.svg',
 ]);
});

test('resolves relative and root-relative hrefs and dedupes',()=>{
 const html=`<link rel="icon" href="icons/a.ico"><link rel="icon" href="/deep/icons/a.ico"><link rel="ICON" href="/deep/icons/a.ico">`;
 assert.deepEqual(pageIconUrls(html,'https://site.example.com/blog/'),[
  'https://site.example.com/blog/icons/a.ico',
  'https://site.example.com/deep/icons/a.ico',
 ]);
});

test('skips data: and non-http(s) hrefs and tags without icon rel',()=>{
 const html=`<link rel="icon" href="data:image/png;base64,AAAA"><link rel="mask-icon" href="javascript:alert(1)"><link rel="preload" href="/x.png"><link rel="icon">`;
 assert.deepEqual(pageIconUrls(html,'https://site.example.com'),[]);
});

test('tolerates unquoted href and empty html',()=>{
 assert.deepEqual(pageIconUrls('<link rel=icon href=/f.ico>','https://site.example.com'),['https://site.example.com/f.ico']);
 assert.deepEqual(pageIconUrls('','https://site.example.com'),[]);
});
