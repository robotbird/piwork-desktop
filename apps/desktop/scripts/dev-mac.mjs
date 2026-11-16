#!/usr/bin/env node
// macOS 标准开发启动器:让网站登录的 piwork:// 深度链接能送达开发实例。
//
// 背景:macOS 的自定义协议由 Launch Services 按 .app bundle 的 Info.plist
// (CFBundleURLTypes)路由,命令行 spawn 出来的 `electron .` 对 Launch Services
// 不可见。因此网页点"打开 PiWork 客户端"时会冷启动一个裸 Electron 欢迎页,
// 而不是回到正在运行的开发实例(main.ts:550 的带参注册只在 Windows/Linux 生效)。
//
// 标准做法:
//   1. 给开发用 Electron.app 的 Info.plist 注入 CFBundleURLTypes(piwork);
//   2. 把它的 CFBundleIdentifier 改为独立 id(net.piwork.desktop.dev)——
//      Launch Services 按 bundle id 路由,若与 npx 缓存等其他 Electron 共享
//      com.github.electron,deep link 仍会冷启动错误路径的裸实例;
//   3. 用 lsregister 向 Launch Services 重新登记该 bundle;
//   4. 以 external 模式启动 vite(插件不自行 spawn electron);
//   5. 用 `open -n` 启动应用 —— 实例对 Launch Services 可见后,后续
//      piwork:// 链接会以 open-url 事件送达运行中的实例(main.ts:549 已有处理)。
//
// 用法:cd apps/desktop && pnpm dev:mac
// 可选:PIWORK_DEV_ELECTRON_ARGS 追加传给 electron 的参数(默认 --no-sandbox,
// 与 vite-plugin-electron 的默认一致);PIWORK_DEV_PORT 指定 vite 端口(默认 5173,
// 被其他项目占用且校验失败时使用)。重新安装 electron 依赖后 Info.plist
// 补丁会丢失,脚本每次运行都会幂等地重新注入。

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scheme = 'piwork';
const log = (msg) => console.log(`[dev-mac] ${msg}`);
const die = (msg) => { console.error(`[dev-mac] ${msg}`); process.exit(1); };

if (process.platform !== 'darwin') die('此脚本仅用于 macOS(依赖 Launch Services 的标准做法)。');

// 与 vite-plugin-electron 使用同一份 electron 依赖,避免注册到别的 Electron.app
const require = createRequire(path.join(pkgRoot, 'package.json'));
let electronBin;
try { electronBin = require('electron'); } catch { die('未找到 electron 依赖,请先在 apps/desktop 执行 pnpm install / pnpm setup:electron。'); }
const appBundle = path.resolve(electronBin, '..', '..', '..'); // .../Electron.app/Contents/MacOS/Electron -> .../Electron.app
const plist = path.join(appBundle, 'Contents', 'Info.plist');
if (!existsSync(plist)) die(`未找到 ${plist}`);

// 已有同项目 dev 实例在跑时,新实例会因单实例锁静默退出,deep link 仍打到旧实例,先拦下
const findDevInstances = () => {
  const lines = spawnSync('pgrep', ['-fl', 'MacOS/Electron'], { encoding: 'utf8' }).stdout
    ?.split('\n').filter(Boolean)
    .filter((line) => !line.includes('--type=') && !line.includes('/Applications/')) ?? [];
  const found = [];
  for (const line of lines) {
    const pid = Number(line.split(' ', 1)[0]);
    if (!Number.isFinite(pid)) continue;
    const cwd = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout ?? '';
    const cwdPath = cwd.match(/^n(.+)$/m)?.[1];
    // CLI 启动的实例 argv 是 ".",靠 cwd 识别;open 启动的实例靠 argv 里的绝对路径识别
    if ((cwdPath && path.resolve(cwdPath) === pkgRoot) || line.includes(pkgRoot)) found.push(pid);
  }
  return found;
};
const stale = findDevInstances();
if (stale.length) die(`本项目的 dev 实例仍在运行(pid ${stale.join(', ')}),请先退出再执行 dev:mac,否则新实例会因单实例锁直接退出。`);

// 1. 幂等注入 CFBundleURLTypes
const pb = (cmd) => spawnSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { encoding: 'utf8' });
if (pb('Print :CFBundleURLTypes').status !== 0) {
  const added = pb('Add :CFBundleURLTypes array');
  if (added.status !== 0) die(`PlistBuddy 写入失败:${added.stderr}`);
}
const types = pb('Print :CFBundleURLTypes');
if (!`${types.stdout}`.includes(scheme)) {
  const count = `${types.stdout}`.split('\n').filter((line) => /^ {4}Dict {/.test(line)).length;
  const add = (cmd) => {
    const result = pb(cmd);
    if (result.status !== 0) die(`PlistBuddy 写入失败:${cmd}\n${result.stderr}`);
  };
  add(`Add :CFBundleURLTypes:${count} dict`);
  add(`Add :CFBundleURLTypes:${count}:CFBundleURLName string PiWork dev deep link`);
  add(`Add :CFBundleURLTypes:${count}:CFBundleURLSchemes array`);
  add(`Add :CFBundleURLTypes:${count}:CFBundleURLSchemes:0 string ${scheme}`);
  log(`已在 Electron.app 的 Info.plist 声明 ${scheme}:// 协议`);
} else {
  log(`Info.plist 已声明 ${scheme}:// 协议,跳过注入`);
}

// 2. 独立 bundle id,避免 Launch Services 把 deep link 路由到别的 Electron.app(如 npx 缓存)
const bundleId = `${pb('Print :CFBundleIdentifier').stdout}`.trim();
if (/^com\.github\.electron$/i.test(bundleId)) {
  const set = pb('Set :CFBundleIdentifier net.piwork.desktop.dev');
  if (set.status !== 0) die(`PlistBuddy 写入失败:${set.stderr}`);
  log('已将 dev Electron.app 的 CFBundleIdentifier 改为 net.piwork.desktop.dev');
}

// 3. 重新登记到 Launch Services(失败不阻塞:应用启动时 setAsDefaultProtocolClient 也会注册)
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
if (existsSync(lsregister)) {
  spawnSync(lsregister, ['-f', appBundle], { stdio: 'ignore' });
  log('已在 Launch Services 重新登记 dev Electron.app');
} else {
  log('未找到 lsregister,跳过登记(应用启动时会自行注册)');
}

// 4. external 模式启动 vite(vite.config.ts 检测 PIWORK_DEV_ELECTRON=external 后不 spawn electron)
process.env.PIWORK_DEV_ELECTRON = 'external';
const { createServer } = await import('vite');
const server = await createServer({
  root: pkgRoot,
  configFile: path.join(pkgRoot, 'vite.config.ts'),
  ...(process.env.PIWORK_DEV_PORT ? { server: { port: Number(process.env.PIWORK_DEV_PORT), strictPort: true } } : {}),
});
await server.listen();
const devUrl = server.resolvedUrls?.local?.[0];
if (!devUrl) { await server.close(); die('无法获取 vite dev server 地址'); }
log(`vite dev server 就绪:${devUrl}`);

// localhost:port 可能被其他项目的 dev server 以 IPv4 抢占(vite 会退而绑定 IPv6,
// 而 Chromium 解析 localhost 时可能打到错误页面),启动后逐一校验两个栈
const devPort = new URL(devUrl).port || '80';
for (const host of ['127.0.0.1', '[::1]']) {
  const body = await fetch(`http://${host}:${devPort}/`, { signal: AbortSignal.timeout(3000) }).then((res) => res.text()).catch(() => null);
  if (body !== null && !body.includes('src/main.tsx')) {
    await server.close();
    die(`端口 ${devPort} 上的 http://${host} 不是本应用(被其他 dev server 占用),请释放该端口或用 PIWORK_DEV_PORT=<端口> 指定其他端口。`);
  }
}

// 5. 通过 open 启动(Launch Services 可见,后续 deep link 走 open-url 事件)
const logDir = path.join(pkgRoot, 'node_modules', '.cache');
mkdirSync(logDir, { recursive: true });
const outLog = path.join(logDir, 'dev-mac-electron.out.log');
const errLog = path.join(logDir, 'dev-mac-electron.err.log');
for (const file of [outLog, errLog]) closeSync(openSync(file, 'a'));

const env = { VITE_DEV_SERVER_URL: devUrl, ELECTRON_ENABLE_LOGGING: '1' };
for (const key of Object.keys(process.env)) if (key.startsWith('PIWORK_') && key !== 'PIWORK_DEV_ELECTRON') env[key] = process.env[key];

const extraArgs = (process.env.PIWORK_DEV_ELECTRON_ARGS ?? '--no-sandbox').split(/\s+/).filter(Boolean);
const openArgs = ['-n', '-a', appBundle];
for (const [key, value] of Object.entries(env)) openArgs.push('--env', `${key}=${value}`);
openArgs.push('--stdout', outLog, '--stderr', errLog, '--args', pkgRoot, ...extraArgs);
const opened = spawnSync('open', openArgs, { encoding: 'utf8' });
if (opened.status !== 0) { await server.close(); die(`open 启动失败:${opened.stderr}`); }
log('应用已通过 open 启动,浏览器登录的 piwork:// 回调将以 open-url 事件送达本实例');
log(`Electron 日志:${errLog}`);

let watch = null;
let launched = false;
const shutdown = async () => {
  if (watch) clearInterval(watch);
  setTimeout(() => process.exit(0), 3000).unref(); // server.close() 偶发挂住,兜底强制退出
  for (const pid of findDevInstances()) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  try { await server.close(); } catch { /* already closed */ }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// 应用退出时同步结束 dev server(与 pnpm dev 的行为一致)
watch = setInterval(() => {
  if (launched && findDevInstances().length === 0) {
    log('应用已退出,结束 dev server');
    void shutdown();
  }
}, 2000);
setTimeout(() => { launched = true; }, 5000);

log('Ctrl+C 结束(会一并退出 App 与 dev server);主进程/preload 改动需重启 dev:mac');
