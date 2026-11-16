import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Converter, EnginePackageResolver } from '@deepseek-ai/libreoffice-kit';
import type { DocumentPreview } from '../shared/types.ts';
import { readOfficeZipFile } from './project-files.ts';

/* Office 文档高保真预览(对齐 dsh-desktop 的方案):
   pptx/docx/xlsx 交给 @deepseek-ai/libreoffice-kit(npm 分发的免安装 LibreOffice 衍生引擎,原生二进制)
   转 PDF,渲染端复用 PdfPreview 展示;引擎不可用或转换失败时回落 renderer 内 JS 解析器(原始字节)。
   本模块不顶层 import electron:缓存目录与打包态信息由 createOfficePreview 注入,便于 node:test 直测。 */

const MAX_INPUT_BYTES = 50 * 1024 * 1024;  // 引擎路径源文件上限(JS 兜底仍为 project-files 的 20MB)
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024; // 转换产物 PDF 上限(IPC 以 base64 传输)
const ENGINE_TIMEOUT_MS = 120_000;         // 单次转换超时(dsh 预览同款)
const IDLE_RELEASE_MS = 5 * 60 * 1000;     // 空闲后释放引擎进程
const CACHE_LIMIT_BYTES = 500 * 1024 * 1024;
const OFFICE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx']);
const RENDER_MAX_PAGES = 4;                // 单次渲染页数上限(agent 自检用量)
const RENDER_MAX_TOTAL_BYTES = 8 * 1024 * 1024; // 渲染图片总字节上限(以 base64 过 IPC/worker 消息)
const RENDER_DPI = 100;                    // 自检渲染 DPI(省 token;预览 PDF 仍走引擎默认 144)

/* ---- 纯函数(单测覆盖) ---- */

export function officeExtensionOf(filePath: string): '.docx' | '.xlsx' | '.pptx' | null {
  if (typeof filePath !== 'string') return null;
  const extension = path.extname(filePath).toLowerCase();
  return extension && OFFICE_EXTENSIONS.has(extension) ? extension as '.docx' | '.xlsx' | '.pptx' : null;
}

/** xlsx 是否需要重算:openpyxl/agent 生成的公式常无缓存值,LibreOffice 渲染会留空白。
    共享字符串中的字面 "<f>" 以 XML 转义存储,直接按字节扫描不会误报。 */
export function sheetFormulaDetected(bytes: Buffer): boolean {
  return bytes.includes('<f>') || bytes.includes('calcChain');
}

/** 缓存键 = 源文件 sha256 + 引擎版本:引擎升级自动失效旧产物 */
export function cacheFileName(digest: string, engineVersion: string): string {
  return `${digest}-v${engineVersion}.pdf`;
}

/** agent 自检的页码收敛:显式页码去重升序截到上限;缺省 'all'(maxPages 兜底,单页文档不会越界报错);
    xlsx 按工作表渲染不允许页码(undefined) */
export function clampRenderPages(pages: unknown, extension: '.docx' | '.xlsx' | '.pptx'): 'all' | number[] | undefined {
  if (extension === '.xlsx') return undefined;
  if (!Array.isArray(pages)) return 'all';
  const selected = [...new Set(pages
    .filter((page): page is number => typeof page === 'number' && Number.isInteger(page) && page >= 1))]
    .sort((a, b) => a - b)
    .slice(0, RENDER_MAX_PAGES);
  return selected.length ? selected : 'all';
}

/** 超出上限时按最旧优先淘汰(返回应删除的 pdf 文件名;同名 .json sidecar 由调用方一并清理) */
export function pruneSelection(entries: { name: string; size: number; mtimeMs: number }[], limitBytes: number): string[] {
  const ordered = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const removed: string[] = [];
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of ordered) {
    if (total <= limitBytes) break;
    removed.push(entry.name);
    total -= entry.size;
  }
  return removed;
}

/* ---- 字体选项(源自 dsh-desktop ppt-runtime office-font-options.js,MIT):
        保持 Office 度量兼容默认(Calibri→Carlito 等),并为缺失源字体补显式中文别名组,
        让引擎构建 fontconfig 替换以保住 CJK 字宽(源字体已安装时精确匹配优先)。 ---- */
const CJK_SANS = ['Microsoft YaHei', 'Microsoft YaHei UI', '微软雅黑', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'SimHei', '黑体', 'Heiti SC', 'STHeiti'];
const PINGFANG_ALIASES = ['PingFang SC Semibold', 'PingFangSC-Semibold', 'PingFang SC Regular', 'PingFangSC-Regular', 'PingFang SC Light', 'PingFangSC-Light'];
const previewFontOptions = {
  initialFontFamilies: ['Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC'],
  fontFallbacks: [
    ...PINGFANG_ALIASES.map(face => [face, 'PingFang SC', 'Heiti SC', 'STHeiti', 'Noto Sans CJK SC', ...CJK_SANS]),
    ['Calibri', 'Carlito'],
    ['Calibri Light', 'Carlito', 'Calibri'],
    ['Cambria', 'Caladea'],
    ['宋体', 'SimSun', 'NSimSun', 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Noto Serif SC', 'Source Han Serif SC'],
    ['黑体', 'SimHei', 'Heiti SC', 'STHeiti', 'Noto Sans CJK SC', 'Noto Sans SC'],
    ['微软雅黑', 'Microsoft YaHei', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans SC'],
    ['微软雅黑 Light', '微软雅黑Light', 'Microsoft YaHei Light', 'Microsoft YaHei UI Light', ...CJK_SANS],
    ['等线', '等线 Light', 'DengXian', 'DengXian Light', ...CJK_SANS],
    ['楷体', 'KaiTi', 'Kaiti SC', 'STKaiti', 'LXGW WenKai'],
    ['仿宋', 'FangSong', 'STFangsong', 'Songti SC', 'Noto Serif CJK SC'],
    ['sans-serif', 'Arial', 'Liberation Sans', 'Helvetica', 'DejaVu Sans', 'Calibri', 'Calibri Light', 'Carlito', ...CJK_SANS],
    ['serif', 'Times New Roman', 'Liberation Serif', 'Times', 'DejaVu Serif', 'Cambria', 'Caladea', 'SimSun', 'NSimSun', '宋体', 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Noto Serif SC', 'Source Han Serif SC'],
    ['monospace', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', 'Menlo', 'Monaco', 'Courier', 'NSimSun', 'Noto Sans Mono CJK SC', ...CJK_SANS],
  ],
};

/** 预览与 agent 自检渲染共用的源文件读取:有界读取 + NOFOLLOW + zip magic 校验 */
async function readOfficeBytes(absPath: string): Promise<Buffer> {
  const handle = await fs.open(absPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > MAX_INPUT_BYTES) throw new Error('Office file too large');
    bytes = Buffer.alloc(Math.min(MAX_INPUT_BYTES, stat.size));
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length < bytes.length) throw new Error('Office file changed while reading');
  } finally { await handle.close(); }
  if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('Invalid Office file');
  return bytes;
}

export interface OfficePreviewOptions {
  /** <userData>/preview-cache,由 main 注入(本模块不触碰 electron) */
  cacheDir: string;
  /** 打包态引擎位于 app.asar.unpacked(可执行文件不能住在 asar 里),需要显式解析;dev 走默认 Node 解析 */
  isPackaged?: boolean;
  /** 打包态的 app.getAppPath()(…/app.asar) */
  appPath?: string;
}

export function createOfficePreview(options: OfficePreviewOptions) {
  const { cacheDir } = options;
  type KitModule = typeof import('@deepseek-ai/libreoffice-kit');
  let kit: KitModule | null = null;
  let converter: Converter | null = null;
  let acquiring: Promise<Converter> | null = null;
  let idleTimer: NodeJS.Timeout | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const inflight = new Map<string, Promise<DocumentPreview>>();

  function engineResolver(): EnginePackageResolver | undefined {
    if (!options.isPackaged || !options.appPath) return undefined;
    const unpackedRoot = `${options.appPath}.unpacked`;
    return name => {
      const manifest = path.join(unpackedRoot, 'node_modules', name, 'package.json');
      if (!existsSync(manifest)) {
        const error = new Error(`Office engine package missing: ${name}`);
        (error as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND'; // 语义化缺失:引擎按协议回落 WASM
        throw error;
      }
      return manifest;
    };
  }

  async function acquireConverter(): Promise<Converter> {
    if (converter) return converter;
    if (!acquiring) {
      acquiring = (async () => {
        if (!kit) kit = await import('@deepseek-ai/libreoffice-kit');
        const created = await kit.createConverter({
          timeoutMs: ENGINE_TIMEOUT_MS,
          maxInputBytes: MAX_INPUT_BYTES,
          maxOutputBytes: MAX_OUTPUT_BYTES,
          resolveEnginePackage: engineResolver(),
          ...previewFontOptions,
        });
        converter = created;
        return created;
      })();
      acquiring.catch(() => { acquiring = null; }); // 失败允许下次重试
    }
    return acquiring;
  }

  async function releaseConverter(): Promise<void> {
    clearTimeout(idleTimer);
    const current = converter;
    converter = null;
    acquiring = null;
    if (current) await current.dispose().catch(() => {});
  }

  function scheduleRelease(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void releaseConverter(); }, IDLE_RELEASE_MS);
    idleTimer.unref();
  }

  /** 转换串行化:引擎进程按队列逐个消费,前一任务的失败不阻断后续 */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(() => job(), () => job());
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async function readCachedPdf(cachePath: string, sidecarPath: string): Promise<DocumentPreview | null> {
    try {
      const pdf = await fs.readFile(cachePath);
      if (pdf.length > MAX_OUTPUT_BYTES || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') return null;
      let missingFonts: string[] = [];
      try { missingFonts = JSON.parse(await fs.readFile(sidecarPath, 'utf8')).missingFonts ?? []; } catch { /* sidecar 缺失不影响展示 */ }
      return { kind: 'pdf', content: pdf.toString('base64'), missingFonts };
    } catch { return null; }
  }

  async function pruneCache(): Promise<void> {
    const names = await fs.readdir(cacheDir).catch(() => []);
    const entries: { name: string; size: number; mtimeMs: number }[] = [];
    for (const name of names) {
      if (!name.endsWith('.pdf')) continue;
      const stat = await fs.stat(path.join(cacheDir, name)).catch(() => null);
      if (stat?.isFile()) entries.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
    }
    for (const name of pruneSelection(entries, CACHE_LIMIT_BYTES)) {
      await fs.rm(path.join(cacheDir, name), { force: true }).catch(() => {});
      await fs.rm(`${path.join(cacheDir, name)}.json`, { force: true }).catch(() => {});
    }
  }

  async function convertAndCache(absPath: string, bytes: Buffer, extension: '.docx' | '.xlsx' | '.pptx', cachePath: string): Promise<DocumentPreview> {
    const tmpCache = `${cachePath}.tmp`;
    const sidecarPath = `${cachePath}.json`;
    try {
      const engine = await acquireConverter();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
      timer.unref();
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'piwork-office-'));
      try {
        let renderInput = absPath;
        if (extension === '.xlsx' && sheetFormulaDetected(bytes)) {
          // 重算到临时副本参与渲染,原文件(项目文件/附件缓存副本)绝不动
          renderInput = path.join(scratch, 'recalculated.xlsx');
          await engine.recalculate({ inputPath: absPath, outputPath: renderInput }, controller.signal);
        }
        const result = await engine.render({ inputPath: renderInput, outputPath: tmpCache }, controller.signal);
        const pdf = await fs.readFile(tmpCache);
        if (pdf.length > MAX_OUTPUT_BYTES) throw new Error('Converted PDF exceeds preview limit');
        if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Invalid converted PDF');
        await fs.rename(tmpCache, cachePath); // 原子落盘;半成品永远不会被当作缓存命中
        await fs.writeFile(sidecarPath, JSON.stringify({ missingFonts: result.missingFonts }), { flag: 'wx' }).catch(() => {});
        void pruneCache().catch(() => {});
        return { kind: 'pdf', content: pdf.toString('base64'), missingFonts: result.missingFonts };
      } finally {
        clearTimeout(timer);
        await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
      }
    } catch (error) {
      await fs.rm(tmpCache, { force: true }).catch(() => {});
      await releaseConverter(); // 引擎进程可能已损坏:释放,下次转换重建
      throw error;
    }
  }

  /** pptx/docx/xlsx → 高保真 PDF(base64);命中缓存直接返回,否则经队列转换后落缓存 */
  async function readPreviewPdf(absPath: string, extension: '.docx' | '.xlsx' | '.pptx'): Promise<DocumentPreview> {
    const bytes = await readOfficeBytes(absPath);
    if (!kit) kit = await import('@deepseek-ai/libreoffice-kit');
    const cachePath = path.join(cacheDir, cacheFileName(createHash('sha256').update(bytes).digest('hex'), kit.ENGINE_VERSION));
    await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const cached = await readCachedPdf(cachePath, `${cachePath}.json`);
    if (cached) {
      scheduleRelease();
      await fs.utimes(cachePath, new Date(), new Date()).catch(() => {}); // LRU 触点
      return cached;
    }
    const pending = inflight.get(cachePath);
    if (pending) return pending;
    const job = enqueue(() => convertAndCache(absPath, bytes, extension, cachePath));
    inflight.set(cachePath, job);
    const settled = job.then(
      value => { inflight.delete(cachePath); return value; },
      error => { inflight.delete(cachePath); throw error; },
    );
    scheduleRelease();
    return settled;
  }

  /** agent 视觉自检:Office → 指定页 PNG(base64),与预览共用引擎/字体回退(模型所见=用户所见)。
      输出进一次性临时目录,读出后即删;xlsx 按可见工作表渲染(clampRenderPages 返回 undefined) */
  async function renderPages(absPath: string, pages: unknown): Promise<{ pageCount: number; missingFonts: string[]; images: { data: string; mimeType: 'image/png'; width: number; height: number }[] }> {
    const extension = officeExtensionOf(absPath);
    if (!extension) throw new Error('Unsupported document type');
    await readOfficeBytes(absPath); // 复用预览同款上限/zip magic 校验
    // kit 契约:outputDir 必须不存在(引擎自建,失败/取消时整目录删除)
    const outputDir = path.join(os.tmpdir(), `piwork-render-${randomUUID().slice(0, 8)}`);
    try {
      const engine = await acquireConverter();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
      timer.unref();
      try {
        const result = await engine.renderImages({
          inputPath: absPath,
          outputDir,
          ...(extension === '.xlsx' ? {} : { pages: clampRenderPages(pages, extension) }),
          dpi: RENDER_DPI,
          maxPages: RENDER_MAX_PAGES,
        }, controller.signal);
        const images: { data: string; mimeType: 'image/png'; width: number; height: number }[] = [];
        let total = 0;
        for (const image of result.images) {
          const png = await fs.readFile(image.path);
          total += png.length;
          if (total > RENDER_MAX_TOTAL_BYTES) break; // 超限截尾,保留已读页
          images.push({ data: png.toString('base64'), mimeType: 'image/png', width: image.width, height: image.height });
        }
        return { pageCount: result.pageCount, missingFonts: result.missingFonts, images };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      await releaseConverter(); // 引擎进程可能已损坏:释放,下次转换重建
      throw error;
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** 三个 IPC 入口(项目文件/附件缓存/文档库)共用:高保真失败回落 JS 解析的原始字节 */
  async function readDocumentPreview(absPath: string): Promise<DocumentPreview> {
    const extension = officeExtensionOf(absPath);
    if (!extension) throw new Error('Unsupported document type');
    try {
      return await readPreviewPdf(absPath, extension);
    } catch { /* 引擎不可用/超时/超限:回落 renderer 内 JS 渲染器(project-files 的 20MB 上限) */ }
    return { kind: extension.slice(1) as 'docx' | 'xlsx' | 'pptx', content: await readOfficeZipFile(absPath, extension) };
  }

  return { readDocumentPreview, renderPages };
}
