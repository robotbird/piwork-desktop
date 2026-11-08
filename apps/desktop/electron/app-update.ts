/** 客户端自动更新:GitHub Releases 版本发现 → 应用内下载(size+sha256 校验)
 → 打开 DMG 安装。应用未签名(identity:null),Squirrel 自动替换不可用,安装由
 用户在挂载的 DMG 中拖入 Applications 完成(与 docs/macos-distribution.md 的
 手动流程一致)。检查/下载只走主进程,渲染层经 app-update:* IPC 与
 app-update:changed 事件交互(仿 sync 模式)。 */
import { app, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { join } from 'node:path';
import type { AppUpdateInfo, AppUpdateProgress, AppUpdateState } from '../shared/types';
import { normalizeUpdateState, parseReleasePayload, type StoredUpdateState } from './app-update-core';

export type AppUpdateErrorCode = 'updatesDisabled' | 'checkFailed' | 'downloadFailed' | 'hashMismatch' | 'installerUnavailable';
/** 错误形态与 PiPackageError 一致:message 即 code,渲染层据此映射文案 */
export class AppUpdateError extends Error {
 readonly code: AppUpdateErrorCode;
 constructor(code: AppUpdateErrorCode) {
  super(code);
  this.code = code;
  this.name = 'AppUpdateError';
 }
}

const DEFAULT_FEED_URL = 'https://api.github.com/repos/robotbird/piwork-desktop/releases/latest';
const PRODUCT_NAME = 'PiWork';
const ARCH = 'arm64';
const AUTO_CHECK_DELAY_MS = 3000;
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const PROGRESS_INTERVAL_MS = 500;

/** PIWORK_UPDATE_API 覆盖更新源(e2e 注入本地 mock);未打包应用仅在该变量存在时启用检查 */
function feedUrl(): string {
 return process.env.PIWORK_UPDATE_API || DEFAULT_FEED_URL;
}
function updatesEnabled(): boolean {
 return app.isPackaged || Boolean(process.env.PIWORK_UPDATE_API);
}
function updatesDir(): string {
 return join(app.getPath('userData'), 'updates');
}
function statePath(): string {
 return join(app.getPath('userData'), 'app-update-state.json');
}

type Phase = AppUpdateState['phase'];
let phase: Phase = 'idle';
let info: AppUpdateInfo | null = null;
let progress: AppUpdateProgress | null = null;
let downloadedPath: string | null = null;
let notifier: (() => void) | null = null;
let abortController: AbortController | null = null;
let checkInFlight: Promise<AppUpdateState> | null = null;
let downloadInFlight: Promise<AppUpdateState> | null = null;
let autoChecked = false;

/** register(window) 挂载:状态变化时通知渲染层重新拉快照 */
export function setAppUpdateNotifier(listener: (() => void) | null): void {
 notifier = listener;
}
function broadcast(): void {
 notifier?.();
}
export function getAppUpdateState(): AppUpdateState {
 return { phase, ...(info ? { info } : {}), ...(progress ? { progress } : {}) };
}

async function readStoredState(): Promise<StoredUpdateState> {
 try {
  return normalizeUpdateState(JSON.parse(await fs.readFile(statePath(), 'utf-8')));
 } catch {
  return {};
 }
}
async function writeStoredState(value: StoredUpdateState): Promise<void> {
 try {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(value), 'utf-8');
 } catch {
  // 节流记录写失败不影响检查结果,下次启动会多查一次
 }
}

function sha256File(file: string): Promise<string> {
 return new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
 });
}

/** 已下载且校验通过(size 一致;feed 提供 digest 时 sha256 一致)的同版本 DMG 路径,无则 null */
async function verifiedExistingDownload(target: AppUpdateInfo): Promise<string | null> {
 try {
  const file = join(updatesDir(), target.assetName);
  const stats = await fs.stat(file);
  if (!stats.isFile()) return null;
  if (target.size > 0 && stats.size !== target.size) return null;
  if (target.sha256 && (await sha256File(file)) !== target.sha256) return null;
  return file;
 } catch {
  return null;
 }
}

async function fetchLatestRelease(): Promise<unknown> {
 // GitHub API 要求 User-Agent;无 token 匿名限额 60 次/时,远超 24h 一次+手动检查
 const response = await fetch(feedUrl(), {
  headers: { accept: 'application/vnd.github+json', 'user-agent': 'piwork-desktop-updater' },
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
 });
 if (!response.ok) throw new AppUpdateError('checkFailed');
 return response.json();
}

/** 并发去重:自动检查与手动检查同时发起时共享一次网络请求 */
export function checkForAppUpdate(): Promise<AppUpdateState> {
 if (!checkInFlight) checkInFlight = runCheck().finally(() => { checkInFlight = null; });
 return checkInFlight;
}
async function runCheck(): Promise<AppUpdateState> {
 if (!updatesEnabled()) throw new AppUpdateError('updatesDisabled');
 const payload = parseReleasePayload(await fetchLatestRelease(), app.getVersion(), PRODUCT_NAME, ARCH);
 info = payload;
 progress = null;
 if (!payload) {
  phase = 'upToDate';
  downloadedPath = null;
 } else {
  phase = 'available';
  // 同版本安装包此前已下载且校验通过 → 直接进入已就绪,免去重复下载
  downloadedPath = await verifiedExistingDownload(payload);
  if (downloadedPath) phase = 'downloaded';
 }
 broadcast();
 return getAppUpdateState();
}

/** 启动自动检查:延迟数秒避开启动高峰;24h 节流记录落盘;失败静默不打扰 */
export function scheduleAppUpdateAutoCheck(): void {
 if (!updatesEnabled()) return;
 const timer = setTimeout(() => { void runAutoCheck(); }, AUTO_CHECK_DELAY_MS);
 timer.unref?.();
}
async function runAutoCheck(): Promise<void> {
 if (autoChecked) return;
 autoChecked = true;
 const stored = await readStoredState();
 if (typeof stored.lastAutoCheckAt === 'number' && Date.now() - stored.lastAutoCheckAt < AUTO_CHECK_INTERVAL_MS) return;
 try {
  await checkForAppUpdate();
  await writeStoredState({ lastAutoCheckAt: Date.now() });
 } catch {
  // 无网络/无 Release 时静默跳过
 }
}

/** 下载 DMG 到 <userData>/updates/:流式落盘 + 边下边算 sha256;校验通过才 rename */
export function downloadAppUpdate(): Promise<AppUpdateState> {
 if (!downloadInFlight) downloadInFlight = runDownload().finally(() => { downloadInFlight = null; });
 return downloadInFlight;
}
async function runDownload(): Promise<AppUpdateState> {
 if (!updatesEnabled()) throw new AppUpdateError('updatesDisabled');
 if (!info || phase === 'upToDate' || phase === 'idle') throw new AppUpdateError('checkFailed');
 if (phase === 'downloading') return getAppUpdateState();
 const existing = await verifiedExistingDownload(info);
 if (existing) {
  downloadedPath = existing;
  phase = 'downloaded';
  progress = null;
  broadcast();
  return getAppUpdateState();
 }
 await fs.mkdir(updatesDir(), { recursive: true });
 const target = join(updatesDir(), info.assetName);
 const temp = `${target}.tmp`;
 abortController = new AbortController();
 phase = 'downloading';
 progress = { received: 0, total: info.size };
 broadcast();
 try {
  const response = await fetch(info.downloadUrl, { headers: { 'user-agent': 'piwork-desktop-updater' }, signal: abortController.signal });
  if (!response.ok || !response.body) throw new AppUpdateError('downloadFailed');
  const total = Number(response.headers.get('content-length')) || info.size;
  const hash = createHash('sha256');
  const writer = createWriteStream(temp);
  let received = 0;
  let lastEmit = 0;
  const emitProgress = (force = false) => {
   const now = Date.now();
   if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
   lastEmit = now;
   progress = { received, total };
   broadcast();
  };
  await new Promise<void>((resolve, reject) => {
   const stream = Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>);
   stream.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    received += chunk.length;
    emitProgress();
   });
   stream.on('error', reject);
   writer.on('error', reject);
   writer.on('finish', () => resolve());
   stream.pipe(writer);
  });
  emitProgress(true);
  if (info.size > 0 && received !== info.size) throw new AppUpdateError('downloadFailed');
  const digest = hash.digest('hex');
  if (info.sha256 && digest !== info.sha256) throw new AppUpdateError('hashMismatch');
  await fs.rm(target, { force: true });
  await fs.rename(temp, target);
  downloadedPath = target;
  phase = 'downloaded';
  progress = { received, total: received };
  broadcast();
  await cleanupStaleDownloads(target);
  return getAppUpdateState();
 } catch (error) {
  await fs.rm(temp, { force: true }).catch(() => undefined);
  progress = null;
  if (abortController.signal.aborted) {
   // 用户取消:回到可下载状态,不视为错误
   phase = 'available';
   broadcast();
   return getAppUpdateState();
  }
  phase = 'available';
  broadcast();
  throw error instanceof AppUpdateError ? error : new AppUpdateError('downloadFailed');
 } finally {
  abortController = null;
 }
}

export function cancelAppUpdateDownload(): AppUpdateState {
 abortController?.abort();
 return getAppUpdateState();
}

/** 清掉旧版本残留的 DMG,updates/ 只保留最新一份 */
async function cleanupStaleDownloads(keep: string): Promise<void> {
 try {
  for (const entry of await fs.readdir(updatesDir())) {
   if (entry.endsWith('.dmg') && join(updatesDir(), entry) !== keep) await fs.rm(join(updatesDir(), entry), { force: true });
  }
 } catch {
  // 清理失败不阻塞安装流程
 }
}

/** 打开已下载 DMG(挂载后用户拖入 Applications);文件缺失/被改动则回到 available */
export async function openAppUpdateInstaller(): Promise<void> {
 if (!info || phase !== 'downloaded' || !downloadedPath) throw new AppUpdateError('installerUnavailable');
 const verified = await verifiedExistingDownload(info);
 if (!verified) {
  downloadedPath = null;
  phase = 'available';
  broadcast();
  throw new AppUpdateError('installerUnavailable');
 }
 if (await shell.openPath(verified)) throw new AppUpdateError('installerUnavailable');
}
