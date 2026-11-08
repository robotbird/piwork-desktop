import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  listLibrary,createLibraryFolder,saveLibraryNote,uploadLibraryFiles,
  renameLibraryItem,moveLibraryItem,registerAiFile,forgetLibraryItem,
} from '../apps/desktop/electron/library-store.ts';

const root=async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'piwork-library-'));
  return {base,library:path.join(base,'library')};
};

test('lists an empty or missing library and skips hidden index files', async t=>{
  const {library}=await root();t.after(()=>rm(path.dirname(library),{recursive:true,force:true}));
  assert.deepEqual(await listLibrary(library),[]);
  await mkdir(library);
  await writeFile(path.join(library,'.piwork-library.json'),'{"version":1,"ai":[]}');
  await writeFile(path.join(library,'.DS_Store'),'junk');
  await writeFile(path.join(library,'hello.md'),'你好');
  const items=await listLibrary(library);
  assert.equal(items.length,1);
  assert.equal(items[0].name,'hello.md');
  assert.equal(items[0].kind,'file');
  assert.equal(items[0].parentPath,'');
  assert.equal(items[0].source,'upload');
  assert.equal(items[0].contentType,'text/markdown');
  assert.ok(items[0].size>0);
});

test('creates folders and notes, walking nested parents', async t=>{
  const {library}=await root();t.after(()=>rm(path.dirname(library),{recursive:true,force:true}));
  const folder=await createLibraryFolder(library,'','研究');
  assert.equal(folder,'研究');
  const nested=await createLibraryFolder(library,'研究','资料');
  assert.equal(nested,'研究/资料');
  const note=await saveLibraryNote(library,'研究','会议记录','内容');
  assert.equal(note,'研究/会议记录.md');
  const explicit=await saveLibraryNote(library,'研究','摘要.md','x');
  assert.equal(explicit,'研究/摘要.md');
  const items=await listLibrary(library);
  assert.deepEqual(items.map(item=>item.path).sort(),['研究','研究/会议记录.md','研究/摘要.md','研究/资料']);
  assert.equal(items.find(item=>item.path==='研究').kind,'folder');
  assert.equal(items.find(item=>item.path==='研究').source,'manual');
  // Same-name note gets a numbered copy instead of overwriting.
  const copy=await saveLibraryNote(library,'研究','会议记录','again');
  assert.equal(copy,'研究/会议记录 (2).md');
  await assert.rejects(saveLibraryNote(library,'研究','big','x'.repeat(1024*1024+1)),/Invalid content/);
  await assert.rejects(saveLibraryNote(library,'研究','.hidden','x'),/Invalid name/);
});

test('uploads copy files with collision-avoiding names', async t=>{
  const {base,library}=await root();t.after(()=>rm(base,{recursive:true,force:true}));
  await mkdir(library);
  const source=path.join(base,'report.pdf');
  await writeFile(source,'%PDF-1.7');
  const uploaded=await uploadLibraryFiles(library,[source],'');
  assert.equal(uploaded[0].name,'report.pdf');
  const again=await uploadLibraryFiles(library,[source],'');
  assert.equal(again[0].name,'report (2).pdf');
  await assert.rejects(uploadLibraryFiles(library,['relative.pdf'],''),/Invalid upload/);
  await mkdir(path.join(base,'adir'));
  await assert.rejects(uploadLibraryFiles(library,[path.join(base,'adir')],''),/Not a file/);
  const items=await listLibrary(library);
  assert.equal(items.find(item=>item.name==='report.pdf').contentType,'application/pdf');
});

test('marks AI files and rewrites the index through rename, move and forget', async t=>{
  const {base,library}=await root();t.after(()=>rm(base,{recursive:true,force:true}));
  await mkdir(library);
  const folder=await createLibraryFolder(library,'','归档');
  const source=path.join(base,'answer.md');
  await writeFile(source,'# hi');
  await uploadLibraryFiles(library,[source],'归档');
  await registerAiFile(library,'归档/answer.md');
  let items=await listLibrary(library);
  assert.equal(items.find(item=>item.path==='归档/answer.md').source,'ai');

  await renameLibraryItem(library,'归档/answer.md','答案');
  items=await listLibrary(library);
  assert.equal(items.find(item=>item.path==='归档/答案').source,'ai');

  await moveLibraryItem(library,'归档/答案','');
  items=await listLibrary(library);
  assert.equal(items.find(item=>item.path==='答案').source,'ai');

  await forgetLibraryItem(library,'归档');
  items=await listLibrary(library);
  assert.equal(items.find(item=>item.path==='答案').source,'ai');
  await forgetLibraryItem(library,'答案');
  items=await listLibrary(library);
  assert.equal(items.find(item=>item.path==='答案').source,'upload');
});

test('rename and move validate names, targets and containment', async t=>{
  const {base,library}=await root();t.after(()=>rm(base,{recursive:true,force:true}));
  await mkdir(library);
  const folder=await createLibraryFolder(library,'','文件夹');
  const source=path.join(base,'a.txt');
  await writeFile(source,'x');
  await uploadLibraryFiles(library,[source],'');
  await assert.rejects(renameLibraryItem(library,'a.txt','../逃逸'),/Invalid name/);
  await assert.rejects(renameLibraryItem(library,'a.txt','.dot'),/Invalid name/);
  await assert.rejects(renameLibraryItem(library,'missing.txt','新名'),/Item not found/);
  await assert.rejects(renameLibraryItem(library,'a.txt','x'.repeat(200)),/Invalid name/);
  await renameLibraryItem(library,'a.txt','b.txt');
  await assert.rejects(moveLibraryItem(library,'b.txt','文件夹/../..'),/Invalid path/);
  // Renaming onto an existing name is refused.
  await assert.rejects(renameLibraryItem(library,'b.txt','文件夹'),/Already exists/);
  await moveLibraryItem(library,'b.txt','文件夹');
  const items=await listLibrary(library);
  assert.ok(items.some(item=>item.path==='文件夹/b.txt'));
  await assert.rejects(moveLibraryItem(library,'文件夹','文件夹'),/Invalid destination/);
  // A folder cannot be moved into its own descendant.
  const inner=await createLibraryFolder(library,'文件夹','内层');
  await assert.rejects(moveLibraryItem(library,'文件夹',inner),/Invalid destination/);
});

test('listLibrary rejects escaping paths and ignores a damaged index', async t=>{
  const {base,library}=await root();t.after(()=>rm(base,{recursive:true,force:true}));
  await mkdir(library);
  await writeFile(path.join(library,'.piwork-library.json'),'not json');
  await writeFile(path.join(library,'ok.txt'),'ok');
  const items=await listLibrary(library);
  assert.equal(items.find(item=>item.name==='ok.txt').source,'upload');
  await assert.rejects(createLibraryFolder(library,'../outside','x'),/Invalid path/);
  await assert.rejects(createLibraryFolder(library,'','a/b'),/Invalid name/);
});
