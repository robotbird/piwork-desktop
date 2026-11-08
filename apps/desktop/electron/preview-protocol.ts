import { protocol } from 'electron';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { splitProjectPath, resolveInside, type ProjectRoot } from './project-files';

/* 交互式 HTML 预览协议:preview://project/<projectId>/<相对路径> 与 preview://library/<相对路径>。
   standard scheme 让 iframe 内的相对引用(js/css/图片)解析回同一协议,由主进程按项目根防逃逸校验后回源。 */
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const PREVIEW_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** 必须在 app ready 之前调用:standard/secure 才能正确解析相对路径并被 CSP frame-src 识别。 */
export function registerPreviewScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

/** app ready 后调用;项目根沿用 projectRoots(含对话冻结文件夹),库根与 library:read* 一致,附件根为聊天附件缓存目录。 */
export function handlePreviewProtocol(options: {
  getProjectRoots: (projectId: string) => ProjectRoot[];
  getLibraryRoot: () => string;
  getAttachmentRoot: () => string;
}) {
  protocol.handle('preview', async (request) => {
    if (request.method !== 'GET') return notFound();
    let root: string;
    let relative: string;
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
      if (url.hostname === 'project' && segments.length >= 2) {
        const target = splitProjectPath(options.getProjectRoots(segments[0]), segments.slice(1).join('/'));
        root = target.root;
        relative = target.relative;
      } else if (url.hostname === 'library' && segments.length >= 1) {
        root = options.getLibraryRoot();
        relative = segments.join('/');
      } else if (url.hostname === 'attachment' && segments.length >= 2) {
        root = options.getAttachmentRoot();
        relative = segments.join('/');
      } else return notFound();
      const type = PREVIEW_TYPES[path.extname(relative).toLowerCase()];
      if (!type) return notFound();
      // resolveInside 复用项目文件读取的防逃逸与 symlink 拒绝逻辑
      const target = await resolveInside(root, relative);
      const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_PREVIEW_BYTES) return notFound();
        const bytes = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
        let length = 0;
        while (length < bytes.length) {
          const chunk = await handle.read(bytes, length, bytes.length - length, length);
          if (!chunk.bytesRead) break;
          length += chunk.bytesRead;
        }
        if (length > MAX_PREVIEW_BYTES) return notFound();
        return new Response(new Uint8Array(bytes.buffer, bytes.byteOffset, length), {
          headers: {
            'Content-Type': type,
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } finally {
        await handle.close();
      }
    } catch {
      return notFound();
    }
  });
}
