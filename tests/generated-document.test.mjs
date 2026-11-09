import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {cacheGeneratedDocument} from '../apps/desktop/electron/generated-document.ts';

test('historical documents can preview without a project, including encoded Markdown paths',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'piwork-generated-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'技术 报告.pptx');await writeFile(file,'fixture bytes');
  for(const text of [`报告已生成：\`${file}\`。`,`**[报告](<${file}>)**`,`[报告](${encodeURI(file)})`,`[报告](file://${encodeURI(file)})`]){
    const result=await cacheGeneratedDocument(file,[{role:'assistant',text}],path.join(root,'cache'));
    assert.equal(result.name,'技术 报告.pptx');assert.equal(await readFile(path.join(root,'cache',result.cache),'utf8'),'fixture bytes');
  }
});

test('preview rejects unreferenced paths, user references and file-prefix matches',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'piwork-generated-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'private.pdf');await writeFile(file,'private');
  for(const messages of [[],[{role:'user',text:file}],[{role:'assistant',text:`\`${file}.other\``}],[{role:'assistant',text:`https://example.com${file}`}]] )await assert.rejects(cacheGeneratedDocument(file,messages,root),/not referenced/);
  await assert.rejects(cacheGeneratedDocument('report.pdf',[],root),/Invalid document/);
});

test('missing outputs and directories fail explicitly',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'piwork-generated-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'missing.pdf');
  await assert.rejects(cacheGeneratedDocument(file,[{role:'assistant',text:file}],root),/ENOENT/);
  const dir=path.join(root,'directory.pdf');await mkdir(dir);
  await assert.rejects(cacheGeneratedDocument(dir,[{role:'assistant',text:dir}],root),/preview limits/);
});
