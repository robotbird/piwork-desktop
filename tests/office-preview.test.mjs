import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cacheFileName,clampRenderPages,createOfficePreview,officeExtensionOf,pruneSelection,sheetFormulaDetected} from '../apps/desktop/electron/office-preview.ts';

test('officeExtensionOf 只认 office 三件套(大小写不敏感,其余为 null)',()=>{
 assert.equal(officeExtensionOf('/a/b/报告.DOCX'),'.docx');
 assert.equal(officeExtensionOf('/a/b/x.pptx'),'.pptx');
 assert.equal(officeExtensionOf('/a/b/x.xlsx'),'.xlsx');
 assert.equal(officeExtensionOf('/a/b/x.pdf'),null);
 assert.equal(officeExtensionOf('/a/b/x.docx.tmp'),null);
 assert.equal(officeExtensionOf(undefined),null);
});

test('sheetFormulaDetected 按字节扫描公式标记;共享字符串中的转义文本不误报',()=>{
 assert.equal(sheetFormulaDetected(Buffer.from('<worksheet><f>A1</f></worksheet>')),true);
 assert.equal(sheetFormulaDetected(Buffer.from('xl/calcChain.xml')),true);
 assert.equal(sheetFormulaDetected(Buffer.from('<t>普通文本 &lt;f&gt; 转义</t>')),false);
 assert.equal(sheetFormulaDetected(Buffer.from('<worksheet><v>42</v></worksheet>')),false);
});

test('cacheFileName 以 sha256+引擎版本命名,升级引擎自动失效旧缓存',()=>{
 assert.equal(cacheFileName('abc','0.2.3'),'abc-v0.2.3.pdf');
});

test('pruneSelection 超限按最旧优先淘汰到限额内,未超限不动',()=>{
 const entries=[
  {name:'new.pdf',size:400,mtimeMs:300},
  {name:'old.pdf',size:400,mtimeMs:100},
  {name:'mid.pdf',size:400,mtimeMs:200},
 ];
 assert.deepEqual(pruneSelection(entries,2000),[]);
 assert.deepEqual(pruneSelection(entries,900),['old.pdf']);
 assert.deepEqual(pruneSelection(entries,400),['old.pdf','mid.pdf']);
});

/* ---- 引擎集成:手工构造最小 OOXML(stored zip + crc32),命中真实 LibreOffice 转换 ---- */
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0});
function crc32(buffer){let c=0xFFFFFFFF;for(const byte of buffer)c=CRC_TABLE[(c^byte)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
/** 无依赖的最小 zip(stored 不压缩):office-security e2e 用 jszip,这里保持单测零第三方依赖 */
function zipStore(entries){
 const chunks=[];const central=[];let offset=0;
 for(const [name,raw] of Object.entries(entries)){
  const data=Buffer.isBuffer(raw)?raw:Buffer.from(raw,'utf8');
  const nameBytes=Buffer.from(name);const crc=crc32(data);const size=data.length;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,8);local.writeUInt16LE(0,10);local.writeUInt16LE(0,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(size,18);local.writeUInt32LE(size,22);local.writeUInt16LE(nameBytes.length,26);
  chunks.push(local,nameBytes,data);
  const centralEntry=Buffer.alloc(46);centralEntry.writeUInt32LE(0x02014b50,0);centralEntry.writeUInt16LE(20,4);centralEntry.writeUInt16LE(20,6);centralEntry.writeUInt16LE(0,10);centralEntry.writeUInt16LE(0,12);centralEntry.writeUInt32LE(crc,16);centralEntry.writeUInt32LE(size,20);centralEntry.writeUInt32LE(size,24);centralEntry.writeUInt16LE(nameBytes.length,28);centralEntry.writeUInt32LE(offset,42);
  central.push(centralEntry,nameBytes);
  offset+=30+nameBytes.length+size;
 }
 const centralStart=offset;let centralSize=0;for(const chunk of central)centralSize+=chunk.length;
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(centralStart,16);
 return Buffer.concat([...chunks,...central,end]);
}
function minimalDocx(text){
 return zipStore({
  '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
 });
}

test('readDocumentPreview 高保真路径:docx 转 PDF、缓存命中、缓存文件落盘',async()=>{
 const cacheDir=await mkdtemp(path.join(tmpdir(),'piwork-office-preview-'));
 try{
  const office=createOfficePreview({cacheDir});
  const docxPath=path.join(cacheDir,'sample.docx');
  await writeFile(docxPath,minimalDocx('piwork 预览测试'));
  const first=await office.readDocumentPreview(docxPath);
  assert.equal(first.kind,'pdf');
  assert.match(Buffer.from(first.content,'base64').subarray(0,5).toString('ascii'),/^%PDF-/);
  // 缓存命中:同内容第二次直接读缓存(仍为 pdf),缓存目录出现 v<引擎版本>.pdf 产物
  const second=await office.readDocumentPreview(docxPath);
  assert.equal(second.kind,'pdf');
  const produced=(await readdir(cacheDir)).filter(name=>/-v\d+\.\d+\.\d+\.pdf$/.test(name));
  assert.equal(produced.length,1);
 }finally{await rm(cacheDir,{recursive:true,force:true})}
});

test('readDocumentPreview 兜底路径:引擎失败回落原始字节(JS 渲染器接管)',async()=>{
 const cacheDir=await mkdtemp(path.join(tmpdir(),'piwork-office-fallback-'));
 try{
  const office=createOfficePreview({cacheDir});
  // PK 魔数合法但内容不是 zip:引擎解析失败,回落读取原始字节
  await writeFile(path.join(cacheDir,'broken.docx'),Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(8)]));
  const fallback=await office.readDocumentPreview(path.join(cacheDir,'broken.docx'));
  assert.equal(fallback.kind,'docx');
  assert.equal(Buffer.from(fallback.content,'base64').length,12);
  // 非 office 扩展名直接拒绝
  await assert.rejects(office.readDocumentPreview(path.join(cacheDir,'note.txt')),/Unsupported document type/);
  // PK 魔数非法:连兜底也拒绝
  await writeFile(path.join(cacheDir,'fake.docx'),'not a zip');
  await assert.rejects(office.readDocumentPreview(path.join(cacheDir,'fake.docx')),/Invalid Office file/);
 }finally{await rm(cacheDir,{recursive:true,force:true})}
});

test('clampRenderPages 收敛页码:默认前两页、去重升序截断;xlsx 忽略页码',()=>{
 assert.equal(clampRenderPages(undefined,'.docx'),'all');
 assert.deepEqual(clampRenderPages([3,1,3,7],'.docx'),[1,3,7]);
 assert.equal(clampRenderPages([0,-2,1.5],'.pptx'),'all');
 assert.deepEqual(clampRenderPages([2,4,6,8,10],'.docx'),[2,4,6,8]);
 assert.equal(clampRenderPages([1,2],'.xlsx'),undefined);
});
