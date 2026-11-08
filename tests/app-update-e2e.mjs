import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,stat,readdir,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/* 客户端自动更新 e2e:本地 mock 扮演 GitHub Releases(PIWORK_UPDATE_API 注入),
 覆盖 启动自动发现 → 主界面提示 → 下载(sha256 校验/取消/坏摘要拒绝/重复下载跳过)
 → 打开安装包(stub shell.openPath)→ 无新版回退。 */
const temp=await mkdtemp(path.join(os.tmpdir(),'piwork-update-'));const profile=path.join(temp,'profile');const noSkills=path.join(temp,'no-skills');await mkdir(noSkills);
const dmgBuffer=Buffer.concat([Buffer.from('PIWORK-FAKE-DMG\n'),randomBytes(512*1024)]);
const dmgSha256=createHash('sha256').update(dmgBuffer).digest('hex');
const dmgPath=`/download/PiWork-9.9.9-arm64.dmg`;
let releaseBody='修复与改进\n- 自动更新机制';
let releaseTag='v9.9.9';
let releaseDigest=`sha256:${dmgSha256}`;
let slowDownload=false;
let dmgDownloads=0;
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/releases/latest'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({tag_name:releaseTag,body:releaseBody,assets:[{name:'PiWork-9.9.9-arm64.dmg',size:dmgBuffer.length,browser_download_url:`http://127.0.0.1:${server.address().port}${dmgPath}`,digest:releaseDigest}]}));
  return;
 }
 if(url.pathname===dmgPath){
  dmgDownloads++;
  res.writeHead(200,{'content-type':'application/octet-stream','content-length':String(dmgBuffer.length)});
  if(!slowDownload){res.end(dmgBuffer);return}
  // 慢速分片写出,保证取消用例能命中 downloading 阶段
  let offset=0;const chunk=Math.ceil(dmgBuffer.length/16);
  const timer=setInterval(()=>{res.write(dmgBuffer.subarray(offset,offset+chunk));offset+=chunk;if(offset>=dmgBuffer.length){clearInterval(timer);res.end()}},100);
  req.on('close',()=>clearInterval(timer));
  return;
 }
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const waitFor=async(fn,timeout=25000,interval=200)=>{const end=Date.now()+timeout;for(;;){const value=await fn();if(value)return value;if(Date.now()>end)throw new Error('waitFor timeout');await new Promise(r=>setTimeout(r,interval))}};
const state=page=>page.evaluate(()=>window.desktop.getAppUpdateState());
let app;
try{
 app=await electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_UPDATE_API:`http://127.0.0.1:${server.address().port}/releases/latest`,PIWORK_DEFAULT_SKILLS_DIR:noSkills}});
 const page=await app.firstWindow();await page.waitForLoadState('load');

 // 启动自动检查(约 3s 延迟)发现 v9.9.9,主界面侧栏露出更新入口
 const available=await waitFor(async()=>{const value=await state(page);return value.phase==='available'?value:null});
 assert.equal(available.info.version,'9.9.9');
 assert.equal(available.info.sha256,dmgSha256);
 await page.locator('.update-hint').filter({hasText:'9.9.9'}).waitFor();

 // 取消下载:慢速服务下进入 downloading 后取消,回到 available 且不报错
 slowDownload=true;
 const downloadPromise=page.evaluate(()=>window.desktop.downloadAppUpdate().then(value=>({phase:value.phase})));
 await waitFor(async()=>(await state(page)).phase==='downloading');
 await page.evaluate(()=>window.desktop.cancelAppUpdateDownload());
 assert.equal((await downloadPromise).phase,'available');
 slowDownload=false;

 // sha256 不符:拒绝并删除临时文件,状态回到 available
 releaseDigest='sha256:'+'0'.repeat(64);
 await page.evaluate(()=>window.desktop.checkAppUpdate());
 await assert.rejects(()=>page.evaluate(()=>window.desktop.downloadAppUpdate()),/hashMismatch/);
 assert.equal((await state(page)).phase,'available');
 const leftovers=(await readdir(path.join(profile,'updates')).catch(()=>[])).filter(name=>name.includes('9.9.9'));
 assert.deepEqual(leftovers,[]);

 // 正常下载:校验通过落盘,再点下载直接复用本地文件(网络请求数不增)
 releaseDigest=`sha256:${dmgSha256}`;
 await page.evaluate(()=>window.desktop.checkAppUpdate());
 assert.equal((await state(page)).phase,'available');
 const downloaded=await waitFor(async()=>{try{const value=await page.evaluate(()=>window.desktop.downloadAppUpdate());return value.phase==='downloaded'?value:null}catch{return null}},20000);
 assert.equal(downloaded.info.version,'9.9.9');
 const file=path.join(profile,'updates','PiWork-9.9.9-arm64.dmg');
 assert.equal((await stat(file)).size,dmgBuffer.length);
 const downloadsAfterFirst=dmgDownloads;
 assert.equal((await page.evaluate(()=>window.desktop.downloadAppUpdate())).phase,'downloaded');
 assert.equal(dmgDownloads,downloadsAfterFirst);

 // 打开安装包:stub shell.openPath 断言路径,避免测试中真实挂载 DMG
 await app.evaluate(({shell},target)=>{shell.openPath=async opened=>{globalThis.__piworkOpenedInstaller=opened;return ''}},file);
 await page.evaluate(()=>window.desktop.openAppUpdateInstaller());
 // userData 路径经主进程 realpath 化(/var → /private/var),两侧统一取真实路径比较
 assert.equal(await app.evaluate(()=>globalThis.__piworkOpenedInstaller),await realpath(file));

 // 无新版:回退 upToDate,主界面提示消失
 releaseTag='v0.0.1';
 assert.equal((await page.evaluate(()=>window.desktop.checkAppUpdate())).phase,'upToDate');
 await page.locator('.update-hint').waitFor({state:'detached'});

 console.log('App update e2e: auto discovery, sidebar hint, cancel, hash mismatch, download, installer open, up-to-date all passed');
}finally{
 if(app)await app.close().catch(()=>{});
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await rm(temp,{recursive:true,force:true});
}
