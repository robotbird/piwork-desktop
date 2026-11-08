import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {listProjectFiles,readProjectText} from '../apps/desktop/electron/project-files.ts';

test('browses files and safely reads bounded UTF-8 text within a project', async t=>{
 const base=await mkdtemp(path.join(tmpdir(),'piwork-files-')); t.after(()=>rm(base,{recursive:true,force:true}));
 const root=path.join(base,'root'); await mkdir(root);await mkdir(path.join(root,'nested'));await writeFile(path.join(root,'hello.md'),'你好');await writeFile(path.join(root,'large.txt'),Buffer.alloc(1024*1024+1));await writeFile(path.join(base,'secret.txt'),'secret');await symlink(base,path.join(root,'outside'));
 const files=await listProjectFiles(root);assert.deepEqual(files.map(f=>f.name),['nested','hello.md','large.txt']);assert.equal(await readProjectText(root,'hello.md'),'你好');
 await assert.rejects(readProjectText(root,'../secret.txt'));await assert.rejects(listProjectFiles(root,'outside'));await assert.rejects(readProjectText(root,'large.txt'),/File too large/);await assert.rejects(readProjectText(root,'hello.pdf'),/Unsupported/);
});

test('reads supported images and rejects mismatched or oversized files', async t=>{
 const base=await mkdtemp(path.join(tmpdir(),'piwork-images-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const {readProjectImage}=await import('../apps/desktop/electron/project-files.ts');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 await writeFile(path.join(base,'image.png'),png);await writeFile(path.join(base,'fake.png'),'not an image');await writeFile(path.join(base,'huge.png'),Buffer.alloc(10*1024*1024+1));
 assert.deepEqual(await readProjectImage(base,'image.png'),{mime:'image/png',base64:png.toString('base64')});
 await assert.rejects(readProjectImage(base,'fake.png'),/Invalid image/);await assert.rejects(readProjectImage(base,'huge.png'),/Image too large/);await assert.rejects(readProjectImage(base,'../image.png'));
});

test('reads bounded PDFs within the project', async t=>{
 const base=await mkdtemp(path.join(tmpdir(),'piwork-pdf-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const {readProjectPdf}=await import('../apps/desktop/electron/project-files.ts');
 await writeFile(path.join(base,'ok.pdf'),'%PDF-1.7\n%%EOF');await writeFile(path.join(base,'bad.pdf'),'wrong');await writeFile(path.join(base,'big.pdf'),Buffer.alloc(20*1024*1024+1));
 assert.equal(Buffer.from(await readProjectPdf(base,'ok.pdf'),'base64').toString(),'%PDF-1.7\n%%EOF');
 await assert.rejects(readProjectPdf(base,'bad.pdf'),/Invalid PDF/);await assert.rejects(readProjectPdf(base,'big.pdf'),/PDF too large/);await assert.rejects(readProjectPdf(base,'../ok.pdf'));
});

test('reads bounded DOCX data and rejects invalid paths and headers', async t=>{
 const base=await mkdtemp(path.join(tmpdir(),'piwork-docx-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const {readProjectDocx}=await import('../apps/desktop/electron/project-files.ts');
 const data=Buffer.from([0x50,0x4b,0x03,0x04,0,0]);await writeFile(path.join(base,'ok.docx'),data);await writeFile(path.join(base,'bad.docx'),'bad');await writeFile(path.join(base,'big.docx'),Buffer.alloc(20*1024*1024+1));
 assert.equal(await readProjectDocx(base,'ok.docx'),data.toString('base64'));
 await assert.rejects(readProjectDocx(base,'bad.docx'),/Invalid Office file/);await assert.rejects(readProjectDocx(base,'big.docx'),/Office file too large/);await assert.rejects(readProjectDocx(base,'../ok.docx'));
});

test('reads XLSX only from the selected project', async t=>{
 const base=await mkdtemp(path.join(tmpdir(),'piwork-xlsx-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const {readProjectXlsx}=await import('../apps/desktop/electron/project-files.ts');
 const data=Buffer.from([0x50,0x4b,0x03,0x04,0,0]);await writeFile(path.join(base,'ok.xlsx'),data);await writeFile(path.join(base,'bad.xlsx'),'bad');
 assert.equal(await readProjectXlsx(base,'ok.xlsx'),data.toString('base64'));
 await assert.rejects(readProjectXlsx(base,'bad.xlsx'),/Invalid Office file/);await assert.rejects(readProjectXlsx(base,'../ok.xlsx'));
});

test('reads PPTX data only within project', async t=>{
 const base=await mkdtemp(path.join(tmpdir(),'piwork-pptx-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const {readProjectPptx}=await import('../apps/desktop/electron/project-files.ts');const data=Buffer.from([0x50,0x4b,0x03,0x04,0]);await writeFile(path.join(base,'ok.pptx'),data);await writeFile(path.join(base,'bad.pptx'),'bad');
 assert.equal(await readProjectPptx(base,'ok.pptx'),data.toString('base64'));await assert.rejects(readProjectPptx(base,'bad.pptx'),/Invalid Office file/);await assert.rejects(readProjectPptx(base,'../ok.pptx'));
});

test('saves a new Markdown result in the project without overwriting files or following links',async t=>{
 const base=await mkdtemp(path.join(tmpdir(),'piwork-result-'));t.after(()=>rm(base,{recursive:true,force:true}));const root=path.join(base,'root');await mkdir(root);await mkdir(path.join(root,'nested'));await symlink(base,path.join(root,'outside'));
 const {saveProjectMarkdown}=await import('../apps/desktop/electron/project-files.ts');
 await saveProjectMarkdown(root,'nested/result.md','会议摘要');assert.equal(await readProjectText(root,'nested/result.md'),'会议摘要');
 await assert.rejects(saveProjectMarkdown(root,'nested/result.md','overwrite'));assert.equal(await readProjectText(root,'nested/result.md'),'会议摘要');
 await assert.rejects(saveProjectMarkdown(root,'../escape.md','escape'));await assert.rejects(saveProjectMarkdown(root,'outside/escape.md','escape'));await assert.rejects(saveProjectMarkdown(root,'result.txt','wrong type'));
});

test('searches project filenames recursively without following symlinks',async t=>{
 const {searchProjectFiles}=await import('../apps/desktop/electron/project-files.ts');const base=await mkdtemp(path.join(tmpdir(),'piwork-search-'));t.after(()=>rm(base,{recursive:true,force:true}));const root=path.join(base,'root');await mkdir(root);await mkdir(path.join(root,'nested'));await writeFile(path.join(root,'nested','会议摘要.MD'),'content');await writeFile(path.join(base,'secret-summary.md'),'secret');await symlink(base,path.join(root,'link'));
 assert.deepEqual(await searchProjectFiles(root,'摘要'),[{name:'会议摘要.MD',path:'nested/会议摘要.MD',kind:'file'}]);assert.deepEqual(await searchProjectFiles(root,'secret'),[]);assert.deepEqual(await searchProjectFiles(root,'.md'),[{name:'会议摘要.MD',path:'nested/会议摘要.MD',kind:'file'}]);await assert.rejects(searchProjectFiles(root,'   '));
});

test('multi-root projects route label paths and fall back to the main folder',async t=>{
 const {splitProjectPath,splitWritePath,listProjectEntries,searchProjectEntries,resolveProjectPath}=await import('../apps/desktop/electron/project-files.ts');
 const base=await mkdtemp(path.join(tmpdir(),'piwork-multiroot-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const main=path.join(base,'main');const second=path.join(base,'second');await mkdir(main);await mkdir(second);
 await writeFile(path.join(main,'note.md'),'main note');await writeFile(path.join(second,'data.csv'),'x,y');
 const roots=[{root:main,label:'main'},{root:second,label:'second'}];
 // 裸相对路径落到主文件夹(兼容旧提示词),label 前缀进入对应文件夹
 assert.deepEqual(splitProjectPath(roots,'note.md'),{root:main,relative:'note.md'});
 assert.deepEqual(splitProjectPath(roots,'second/data.csv'),{root:second,relative:'data.csv'});
 assert.deepEqual(splitWritePath(roots,'note.md'),{root:main,relative:'note.md'});
 assert.deepEqual(splitWritePath(roots,'main/nested/out.md'),{root:main,relative:'nested/out.md'});
 assert.throws(()=>splitWritePath(roots,'second/out.md'),/main folder/);
 await assert.rejects(resolveProjectPath(roots,'../escape'),/Invalid path/);
 // 根层列出源文件夹,进入 label 后为该文件夹内容
 assert.deepEqual(await listProjectEntries(roots),[{name:'main',path:'main',kind:'directory'},{name:'second',path:'second',kind:'directory'}]);
 assert.deepEqual(await listProjectEntries(roots,'main'),[{name:'note.md',path:'note.md',kind:'file'}]);
 assert.deepEqual(await listProjectEntries(roots,'second'),[{name:'data.csv',path:'data.csv',kind:'file'}]);
 // 搜索覆盖所有源文件夹,结果带 label 前缀
 assert.deepEqual(await searchProjectEntries(roots,'.md'),[{name:'note.md',path:'main/note.md',kind:'file'}]);
 assert.deepEqual(await searchProjectEntries(roots,'.csv'),[{name:'data.csv',path:'second/data.csv',kind:'file'}]);
 assert.deepEqual(await searchProjectEntries(roots,'nothing'),[]);
});
