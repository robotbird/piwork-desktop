/** pi 插件源校验/目录条目映射/包内资源清点(纯 node 模块,可被 node --test 直接运行)。
 语义对齐 piwork lib/pi-packages/{catalog,resources}.ts 与 pi 的 collectDefaultResources;
 仅覆盖官网画廊(pi.dev/packages = npm keyword `pi-package`)的 npm 源,不接受 git/本地路径。 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PiCatalogItem } from '../shared/types';

export type PiResourceType = 'extensions' | 'skills' | 'prompts' | 'themes';
export type PiResourceCounts = Record<PiResourceType, number>;
/** pi package.json 的 `pi` 键清单(仅接受字符串数组字段) */
export type PiManifest = Partial<Record<PiResourceType, string[]>>;

export type PiPackageErrorCode = 'invalidSource' | 'alreadyInstalled' | 'notFound' | 'installFailed' | 'npmUnavailable' | 'catalogUnavailable';
export class PiPackageError extends Error {
 readonly code: PiPackageErrorCode;
 constructor(code: PiPackageErrorCode, message?: string) {
  super(message ?? code);
  this.code = code;
  this.name = 'PiPackageError';
 }
}

const NPM_NAME_PATTERN = /^@?[a-z0-9][a-z0-9._/-]*$/i;
const NPM_VERSION_PATTERN = /^[\w.+\-^~*<>=]+$/;

/** 校验并规范化安装源:「npm:<name>[@<version>]」(官网画廊 `pi install npm:<name>` 的安装形态) */
export function validatePiPackageSource(raw: string): string {
 const source = raw.trim();
 if (!source.startsWith('npm:')) throw new PiPackageError('invalidSource');
 const spec = source.slice('npm:'.length);
 let name = spec;
 let version = '';
 // @scope/name@version:跳过开头 scope 的 @ 再找版本分隔符
 const separator = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.indexOf('@');
 if (separator > 0) {
  name = spec.slice(0, separator);
  version = spec.slice(separator + 1);
 }
 if (
  !name ||
  name.length > 214 ||
  !NPM_NAME_PATTERN.test(name) ||
  (version && (version.length > 64 || !NPM_VERSION_PATTERN.test(version)))
 ) {
  throw new PiPackageError('invalidSource');
 }
 return version ? `npm:${name}@${version}` : `npm:${name}`;
}

/** 两个源是否指向同一个包(忽略版本):installed 判断与已装目录徽标用 */
export function samePiPackage(configured: string, candidate: string): boolean {
 return stripVersion(configured) === stripVersion(candidate);
}
function stripVersion(source: string): string {
 return source.replace(/@[^/@]+$/, '');
}

const CATALOG_PAGE_SIZE = 20;
const CATALOG_ENDPOINT = 'https://registry.npmjs.org/-/v1/search';

/** npm search 请求 URL;keyword 限定 pi-package(画廊收录条件),q 为空也保留 keyword 基线 */
export function buildCatalogUrl(query: string, offset: number): string {
 const text = query.trim() ? `keywords:pi-package ${query.trim()}` : 'keywords:pi-package';
 return `${CATALOG_ENDPOINT}?text=${encodeURIComponent(text)}&size=${CATALOG_PAGE_SIZE}&offset=${Math.max(0, Math.floor(offset))}`;
}

/** npm registry search 对象 → 目录条目(缺省字段回退为空,渲染层自行展示) */
export function toCatalogItem(object: unknown): PiCatalogItem {
 if (!object || typeof object !== 'object') throw new PiPackageError('invalidSource');
 const pkg = (object as { package?: Record<string, unknown> }).package;
 if (!pkg || typeof pkg.name !== 'string') throw new PiPackageError('invalidSource');
 const links = (pkg.links ?? {}) as Record<string, unknown>;
 return {
  name: pkg.name,
  version: typeof pkg.version === 'string' ? pkg.version : '',
  description: typeof pkg.description === 'string' ? pkg.description : '',
  publisher: typeof (pkg.publisher as { username?: unknown } | undefined)?.username === 'string' ? (pkg.publisher as { username: string }).username : '',
  date: typeof pkg.date === 'string' ? pkg.date : '',
  keywords: Array.isArray(pkg.keywords) ? pkg.keywords.filter((item): item is string => typeof item === 'string') : [],
  links: {
   ...(typeof links.npm === 'string' ? { npm: links.npm } : {}),
   ...(typeof links.repository === 'string' ? { repository: links.repository } : {}),
  },
 };
}

async function safeStat(target: string) {
 try {
  return await stat(target);
 } catch {
  return null;
 }
}

async function listVisibleEntries(dir: string) {
 const entries = await readdir(dir, { withFileTypes: true });
 return entries
  .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
  .sort((left, right) => left.name.localeCompare(right.name));
}

/** 读取包根 package.json 的 `pi` 键清单;无文件或格式不符返回 null(回退约定目录) */
export async function readPiManifest(packageRoot: string): Promise<PiManifest | null> {
 let raw: string;
 try {
  raw = await readFile(join(packageRoot, 'package.json'), 'utf-8');
 } catch {
  return null;
 }
 let parsed: unknown;
 try {
  parsed = JSON.parse(raw.charCodeAt(0) === 0xfe_ff ? raw.slice(1) : raw);
 } catch {
  return null;
 }
 if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
 const piKey = (parsed as { pi?: unknown }).pi;
 if (typeof piKey !== 'object' || piKey === null || Array.isArray(piKey)) return null;
 const manifest: PiManifest = {};
 for (const type of ['extensions', 'skills', 'prompts', 'themes'] as const) {
  const entries = (piKey as Record<string, unknown>)[type];
  if (Array.isArray(entries) && entries.every(entry => typeof entry === 'string')) manifest[type] = entries as string[];
 }
 return manifest;
}

/** manifest 条目里的覆盖型 pattern(!/+/- 前缀)不是来源路径,清点时排除 */
function isOverridePattern(entry: string) {
 return entry.startsWith('!') || entry.startsWith('+') || entry.startsWith('-');
}

async function listResourceFiles(dir: string, type: PiResourceType): Promise<string[]> {
 const info = await safeStat(dir);
 if (!info?.isDirectory()) return [];
 const files: string[] = [];
 for (const entry of await listVisibleEntries(dir)) {
  const fullPath = join(dir, entry.name);
  if (entry.isDirectory()) {
   files.push(...(await listResourceFiles(fullPath, type)));
   continue;
  }
  if (matchesResourceFile(entry.name, type)) files.push(fullPath);
 }
 return files;
}

function matchesResourceFile(name: string, type: PiResourceType) {
 if (type === 'extensions') return /\.(ts|js)$/.test(name);
 if (type === 'themes') return /\.json$/.test(name);
 return /\.md$/.test(name);
}

/** 汇总一个包内某类资源文件数(manifest 条目优先,无条目回退约定目录) */
export async function countPackageResourceFiles(packageRoot: string, type: PiResourceType, manifest: PiManifest | null): Promise<number> {
 const entries = manifest?.[type]?.filter(entry => !isOverridePattern(entry));
 if (entries && entries.length > 0) {
  let count = 0;
  for (const entry of entries) {
   const target = resolve(packageRoot, entry);
   const info = await safeStat(target);
   if (!info) continue;
   if (info.isFile()) {
    count += 1;
    continue;
   }
   count += (await listResourceFiles(target, type)).length;
  }
  return count;
 }
 return (await listResourceFiles(join(packageRoot, type), type)).length;
}

/** 清点一个已安装包的四类资源计数(用于列表徽标) */
export async function countPackageResources(packageRoot: string, manifest: PiManifest | null): Promise<PiResourceCounts> {
 const counts: PiResourceCounts = { extensions: 0, skills: 0, prompts: 0, themes: 0 };
 for (const type of ['extensions', 'skills', 'prompts', 'themes'] as const) {
  counts[type] = await countPackageResourceFiles(packageRoot, type, manifest);
 }
 return counts;
}
