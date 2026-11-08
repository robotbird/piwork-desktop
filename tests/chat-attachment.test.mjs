import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,copyFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {addProjectTextAttachment,readChatAttachment,splitChatAttachment} from '../apps/desktop/electron/chat-attachment.ts';

test('only an explicitly selected bounded project text file is added to the message',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-attachment-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'notes.md'),'会议记录：你好');
 const roots=[{root,label:'main'}];
 const message=await addProjectTextAttachment('请总结',roots,'notes.md');
 assert.match(message,/请总结/);assert.match(message,/会议记录：你好/);assert.match(message,/notes\.md/);
 await assert.rejects(addProjectTextAttachment('hello',roots,'../notes.md'));
 await writeFile(path.join(root,'large.txt'),'a'.repeat(64*1024+1));await assert.rejects(addProjectTextAttachment('hello',roots,'large.txt'),/too large/);
 await symlink('/etc/hosts',path.join(root,'link.txt'));await assert.rejects(addProjectTextAttachment('hello',roots,'link.txt'));
});

test('picked attachments accept any local text file regardless of extension',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-picked-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'snippet.go'),'package main\n');
 const picked=await readChatAttachment(root,'snippet.go');
 assert.equal(picked.kind,'text');assert.match(picked.content,/package main/);
 await writeFile(path.join(root,'Makefile'),'all: build\n');
 assert.match((await readChatAttachment(root,'Makefile')).content,/all: build/);
});

test('picked PDF and Office attachments are attached as extracted text',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-picked-office-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await copyFile(new URL('./fixtures/chinese-text.pdf',import.meta.url),path.join(root,'doc.pdf'));
 assert.match((await readChatAttachment(root,'doc.pdf')).content,/中文办公测试/);
 await copyFile(new URL('./fixtures/office-basic.docx',import.meta.url),path.join(root,'doc.docx'));
 const docx=await readChatAttachment(root,'doc.docx');assert.equal(docx.kind,'text');assert.match(docx.content,/项目/);
});

test('picked binary files are rejected and long text is truncated',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-picked-binary-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'payload.zip'),Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(64)]));
 await assert.rejects(readChatAttachment(root,'payload.zip'));
 await writeFile(path.join(root,'big.txt'),'x'.repeat(70000));
 const big=await readChatAttachment(root,'big.txt');
 assert.equal(big.kind,'text');assert.equal(big.content.length,64000+'\n[Text truncated]'.length);assert.match(big.content,/\[Text truncated\]$/);
});

test('history restore exposes previewable attachment refs',()=>{
 // 旧版 picked 文本附件(marker 只有 name+content,无 cache):还原 textContent 供纯文本预览
 const legacy=splitChatAttachment('hi\n\nFile selected by the user (JSON data):\n'+JSON.stringify({name:'old-notes.md',content:'legacy body'}));
 assert.equal(legacy.attachmentName,'old-notes.md');
 assert.equal(legacy.attachment?.name,'old-notes.md');
 assert.equal(legacy.attachment?.textContent,'legacy body');
 assert.equal(legacy.attachment?.cachePath,undefined);
 // 新版 picked 附件(cache):还原 cachePath,不重复携带 textContent
 const cached=splitChatAttachment('hi\n\nFile selected by the user (JSON data):\n'+JSON.stringify({name:'a.pdf',content:'x',cache:'11111111-2222-3333-4444-555555555555/a.pdf'}));
 assert.equal(cached.attachment?.cachePath,'11111111-2222-3333-4444-555555555555/a.pdf');
 assert.equal(cached.attachment?.textContent,undefined);
 // 项目附件:还原完整项目相对路径
 const project=splitChatAttachment('q\n\nProject file selected by the user (JSON data):\n'+JSON.stringify({path:'main/a.md',content:'c'}));
 assert.equal(project.attachment?.projectPath,'main/a.md');
 // 旧版图片附件(仅 name,无内容)无可预览引用
 const image=splitChatAttachment('pic\n\nFile selected by the user (JSON data):\n'+JSON.stringify({name:'old.png'}));
 assert.equal(image.attachment?.textContent,undefined);
 assert.equal(image.attachment?.cachePath,undefined);
});
