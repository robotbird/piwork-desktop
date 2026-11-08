/** pi 官方插件(pi.dev/packages = npm keyword `pi-package`)安装/卸载/目录检索。
 安装走 SDK DefaultPackageManager.installAndPersist(受管 agentDir),与 pi CLI
 `pi install` 同一落盘布局;agentDir 隔离在 <userData>/pi,避免与桌面端自身的
 settings.json(userData 根)互相覆盖。 */
import { app } from 'electron';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DefaultPackageManager, SettingsManager, type PackageManager } from '@earendil-works/pi-coding-agent';
import type { InstalledPiPackage, PiCatalogResult } from '../shared/types';
import { buildCatalogUrl, countPackageResources, PiPackageError, readPiManifest, samePiPackage, toCatalogItem, validatePiPackageSource } from './pi-package-registry';

export function piAgentDir(): string {
 return join(app.getPath('userData'), 'pi');
}

let packageManagerPromise: Promise<PackageManager> | null = null;
/** 受管 agentDir 下的 PackageManager 单例 */
function getPiPackageManager(): Promise<PackageManager> {
 if (!packageManagerPromise) {
  packageManagerPromise = (async () => {
   const agentDir = piAgentDir();
   await fs.mkdir(agentDir, { recursive: true });
   const cwd = app.getPath('userData');
   return new DefaultPackageManager({ agentDir, cwd, settingsManager: SettingsManager.create(cwd, agentDir) });
  })();
 }
 return packageManagerPromise;
}

/** 串行变更队列:install/uninstall 全走此队列,防 settings.json 并发写坏 */
let mutationQueue: Promise<unknown> = Promise.resolve();
function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
 const next = mutationQueue.then(operation, operation);
 mutationQueue = next.catch(() => undefined);
 return next;
}

const COMMON_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
function userBinDirs(): string[] {
 const home = process.env.HOME ?? '';
 return home ? [join(home, '.volta/bin'), join(home, '.npm-global/bin'), join(home, '.local/bin'), join(home, 'bin')] : [];
}
function appendPathEntries(entries: string[]) {
 const current = (process.env.PATH ?? '').split(':').filter(Boolean);
 for (const entry of entries) if (entry && !current.includes(entry)) current.push(entry);
 process.env.PATH = current.join(':');
}
/** GUI 启动的 PATH 通常不含 homebrew/npm 位置;SDK 安装时 spawn npm 需要补齐 */
export function ensureNpmPath() {
 appendPathEntries([...COMMON_BIN_DIRS, ...userBinDirs()]);
}
function resolveShellPath(): boolean {
 const result = spawnSync('/bin/zsh', ['-lc', 'echo __PIWORK_PATH__=$PATH'], { timeout: 5000 });
 const match = result.stdout?.toString().match(/__PIWORK_PATH__=([^\n]+)/);
 if (!match) return false;
 appendPathEntries(match[1].split(':'));
 return true;
}
function npmAvailable(): boolean {
 const probe = spawnSync('npm', ['--version'], { timeout: 15000 });
 return !probe.error && probe.status === 0;
}
function assertNpmAvailable() {
 if (npmAvailable()) return;
 // nvm 等版本管理器的 npm 只出现在 login shell PATH 里,解析一次再重试
 if (resolveShellPath() && npmAvailable()) return;
 throw new PiPackageError('npmUnavailable');
}

export async function searchPiPackageCatalog(query: string, offset = 0): Promise<PiCatalogResult> {
 if (typeof query !== 'string' || query.length > 200) throw new PiPackageError('invalidSource');
 const response = await fetch(buildCatalogUrl(query, offset), { signal: AbortSignal.timeout(10000) });
 if (!response.ok) throw new PiPackageError('catalogUnavailable');
 const payload = (await response.json()) as { objects?: unknown[]; total?: number };
 return { items: (payload.objects ?? []).map(toCatalogItem), total: payload.total ?? 0 };
}

/** 从安装目录组装展示信息;package.json 缺失字段回退为空 */
async function describeInstalled(source: string, installedPath: string): Promise<InstalledPiPackage> {
 const manifest = await readPiManifest(installedPath);
 let pkg: Record<string, unknown> = {};
 try {
  pkg = JSON.parse(await fs.readFile(join(installedPath, 'package.json'), 'utf-8')) as Record<string, unknown>;
 } catch {
  // 安装损坏时保留条目(name 回退为去版本的源名),便于卸载清理
 }
 return {
  source,
  name: typeof pkg.name === 'string' && pkg.name ? pkg.name : source.replace(/^npm:/, ''),
  version: typeof pkg.version === 'string' ? pkg.version : '',
  description: typeof pkg.description === 'string' ? pkg.description : '',
  resources: await countPackageResources(installedPath, manifest),
 };
}

function classifyInstallError(error: unknown): PiPackageError {
 const message = error instanceof Error ? error.message.toLowerCase() : '';
 if (message.includes('e404') || message.includes('not found')) return new PiPackageError('notFound');
 return new PiPackageError('installFailed');
}

export async function listInstalledPiPackages(): Promise<InstalledPiPackage[]> {
 const manager = await getPiPackageManager();
 const entries = manager.listConfiguredPackages();
 const items: InstalledPiPackage[] = [];
 for (const entry of entries) {
  const installedPath = entry.installedPath ?? manager.getInstalledPath(entry.source, 'user');
  if (!installedPath) continue;
  items.push(await describeInstalled(entry.source, installedPath));
 }
 return items;
}

export async function installPiPackage(rawSource: string): Promise<InstalledPiPackage> {
 const source = validatePiPackageSource(rawSource);
 ensureNpmPath();
 const manager = await getPiPackageManager();
 return enqueueMutation(async () => {
  if (manager.listConfiguredPackages().some(entry => samePiPackage(entry.source, source))) throw new PiPackageError('alreadyInstalled');
  assertNpmAvailable();
  try {
   await manager.installAndPersist(source);
  } catch (error) {
   throw error instanceof PiPackageError ? error : classifyInstallError(error);
  }
  const installedPath = manager.getInstalledPath(source, 'user');
  if (!installedPath) {
   await manager.removeAndPersist(source).catch(() => undefined);
   throw new PiPackageError('installFailed');
  }
  try {
   return await describeInstalled(source, installedPath);
  } catch {
   await manager.removeAndPersist(source).catch(() => undefined);
   throw new PiPackageError('installFailed');
  }
 });
}

export async function uninstallPiPackage(rawSource: string): Promise<void> {
 const source = validatePiPackageSource(rawSource);
 ensureNpmPath();
 const manager = await getPiPackageManager();
 await enqueueMutation(async () => {
  if (!manager.listConfiguredPackages().some(entry => entry.source === source)) throw new PiPackageError('notFound');
  try {
   const removed = await manager.removeAndPersist(source);
   if (!removed) throw new PiPackageError('notFound');
  } catch (error) {
   throw error instanceof PiPackageError ? error : classifyInstallError(error);
  }
 });
}
