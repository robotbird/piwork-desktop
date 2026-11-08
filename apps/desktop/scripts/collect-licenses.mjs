import {execFileSync} from 'node:child_process';
import {copyFile,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'build','third-party');
const inventory=JSON.parse(execFileSync('pnpm',['licenses','list','--prod','--json'],{cwd:root,encoding:'utf8',maxBuffer:20_000_000}));
await rm(out,{recursive:true,force:true});
await mkdir(path.join(out,'packages'),{recursive:true});
const rows=[];let counter=0;
for(const [license,packages] of Object.entries(inventory))for(const item of packages){
 for(const dir of item.paths){
  const info=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
  const names=(await readdir(dir,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^(licen[cs]e|copying|notice)(\.|$)/i.test(entry.name)).map(entry=>entry.name).sort();
  const folder=String(++counter).padStart(4,'0');
  if(names.length){await mkdir(path.join(out,'packages',folder));for(const name of names)await copyFile(path.join(dir,name),path.join(out,'packages',folder,name))}
  rows.push({name:item.name,version:info.version,license,homepage:item.homepage??'',files:names.map(name=>`packages/${folder}/${name}`)});
 }
}
rows.sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
const missing=rows.filter(row=>!row.files.length);
const escape=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ');
const lines=['# Third-party notices / 第三方许可','',
 'This inventory is generated from the installed production dependency graph. Bundled dependencies are included conservatively. Package metadata is not a substitute for verification.','',
 `Packages: ${rows.length}; packages with no local license or notice file: ${missing.length}.`,
 'Entries without files require upstream version and distribution review before release.','',
 'Electron: see [LICENSE](electron-LICENSE) and [Chromium notices](chromium-LICENSES.html).','',
 '| Package | Version | Declared license | Included local notice files |','| --- | --- | --- | --- |',
 ...rows.map(row=>`| ${escape(row.name)} | ${escape(row.version)} | ${escape(row.license)} | ${row.files.length?row.files.map(f=>`[${escape(path.basename(f))}](${f})`).join(', '):'NOT FOUND — review required'} |`),''];
await writeFile(path.join(out,'README.md'),lines.join('\n'));
await copyFile(path.join(root,'node_modules','electron','dist','LICENSE'),path.join(out,'electron-LICENSE'));
await copyFile(path.join(root,'node_modules','electron','dist','LICENSES.chromium.html'),path.join(out,'chromium-LICENSES.html'));
console.log(`Collected ${rows.length} package entries; ${missing.length} require further license review.`);
