import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { resolveInside, saveProjectMarkdown } from './project-files.ts';

/** One entry of the 我的文档 library: a real file or folder inside the library root. */
export type LibraryEntry = {
  path: string;
  parentPath: string;
  name: string;
  kind: 'file' | 'folder';
  source: 'upload' | 'ai' | 'manual';
  contentType: string | null;
  size: number;
  updatedAt: number;
};

export const LIBRARY_INDEX_FILE = '.piwork-library.json';
const MAX_SCAN_ENTRIES = 10000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_NAME_LENGTH = 180;

const CONTENT_TYPES: Record<string, string> = {
  '.csv': 'text/csv', '.css': 'text/css', '.htm': 'text/html', '.html': 'text/html',
  '.json': 'application/json', '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.txt': 'text/plain', '.xml': 'application/xml', '.yaml': 'application/yaml', '.yml': 'application/yaml',
  '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.rtf': 'application/rtf', '.odt': 'application/vnd.oasis.opendocument.text',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.tsv': 'text/tab-separated-values',
};

function contentTypeFor(name: string): string | null {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? null;
}

export function validLibraryName(name: unknown): asserts name is string {
  if (typeof name !== 'string') throw new Error('Invalid name');
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH || trimmed.startsWith('.') ||
    trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0') ||
    [...trimmed].some(char => char < ' ' || char === '\u007f')) throw new Error('Invalid name');
}

function validRelative(itemPath: unknown): asserts itemPath is string {
  if (typeof itemPath !== 'string' || itemPath.includes('\0') || itemPath.includes('\\') ||
    path.isAbsolute(itemPath)) throw new Error('Invalid path');
  const pieces = itemPath ? itemPath.split('/') : [];
  if (pieces.some(piece => !piece || piece === '.' || piece === '..' || piece.startsWith('.'))) {
    throw new Error('Invalid path');
  }
}

export async function ensureLibrary(root: string): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  return root;
}

/** The AI-source index lives at the library root as a hidden JSON sidecar. */
async function readAiPaths(root: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, LIBRARY_INDEX_FILE), 'utf8'));
    if (raw && typeof raw === 'object' && Array.isArray((raw as { ai?: unknown }).ai) &&
      (raw as { version?: unknown }).version === 1 &&
      (raw as { ai: unknown[] }).ai.every(item => typeof item === 'string')) {
      return new Set((raw as { ai: string[] }).ai);
    }
  } catch {
    // Missing or damaged index: treat as empty rather than failing the page.
  }
  return new Set();
}

async function writeAiPaths(root: string, aiPaths: Set<string>): Promise<void> {
  const target = path.join(root, LIBRARY_INDEX_FILE);
  const payload = JSON.stringify({ version: 1, ai: [...aiPaths].sort() });
  await fs.writeFile(target + '.tmp', payload, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(target + '.tmp', target);
}

/** Mark a file (usually saved from a chat answer) as AI generated. */
export async function registerAiFile(root: string, itemPath: string): Promise<void> {
  validRelative(itemPath);
  await ensureLibrary(root);
  const aiPaths = await readAiPaths(root);
  if (!aiPaths.has(itemPath)) {
    aiPaths.add(itemPath);
    await writeAiPaths(root, aiPaths);
  }
}

/** Drop index entries for a removed item and everything inside it. */
export async function forgetLibraryItem(root: string, itemPath: string): Promise<void> {
  validRelative(itemPath);
  const aiPaths = await readAiPaths(root);
  const prefix = `${itemPath}/`;
  const kept = [...aiPaths].filter(entry => entry !== itemPath && !entry.startsWith(prefix));
  if (kept.length !== aiPaths.size) await writeAiPaths(root, new Set(kept));
}

async function rewriteAiPrefixes(root: string, fromPath: string, toPath: string): Promise<void> {
  const aiPaths = await readAiPaths(root);
  const prefix = `${fromPath}/`;
  let changed = false;
  const next = [...aiPaths].map(entry => {
    if (entry === fromPath) { changed = true; return toPath; }
    if (entry.startsWith(prefix)) { changed = true; return `${toPath}${entry.slice(fromPath.length)}`; }
    return entry;
  });
  if (changed) await writeAiPaths(root, new Set(next));
}

export async function listLibrary(root: string): Promise<LibraryEntry[]> {
  const aiPaths = await readAiPaths(root);
  const entries: LibraryEntry[] = [];
  const pending: string[] = [''];
  let visited = 0;
  while (pending.length && visited < MAX_SCAN_ENTRIES) {
    const parent = pending.shift()!;
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(await resolveInside(root, parent), { withFileTypes: true });
    } catch {
      if (!parent) return [];
      continue;
    }
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.') || dirent.isSymbolicLink()) continue;
      if (++visited > MAX_SCAN_ENTRIES) break;
      const itemPath = parent ? `${parent}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        const stat = await fs.stat(await resolveInside(root, itemPath));
        entries.push({
          path: itemPath, parentPath: parent, name: dirent.name, kind: 'folder',
          source: 'manual', contentType: null, size: 0, updatedAt: stat.mtimeMs,
        });
        pending.push(itemPath);
      } else if (dirent.isFile()) {
        const stat = await fs.stat(await resolveInside(root, itemPath));
        entries.push({
          path: itemPath, parentPath: parent, name: dirent.name, kind: 'file',
          source: aiPaths.has(itemPath) ? 'ai' : 'upload',
          contentType: contentTypeFor(dirent.name), size: stat.size, updatedAt: stat.mtimeMs,
        });
      }
    }
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

async function existingName(parentAbs: string, name: string): Promise<string> {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let counter = 2; counter < 100; counter++) {
    const candidate = `${stem} (${counter})${extension}`;
    if (!await fs.stat(path.join(parentAbs, candidate)).then(() => true).catch(() => false)) return candidate;
  }
  throw new Error('Too many copies');
}

export async function createLibraryFolder(root: string, parentPath: string, name: string): Promise<string> {
  validRelative(parentPath);
  validLibraryName(name);
  await ensureLibrary(root);
  const parentAbs = await resolveInside(root, parentPath);
  if (parentPath && !(await fs.stat(parentAbs)).isDirectory()) throw new Error('Folder not found');
  const folder = name.trim();
  await fs.mkdir(path.join(parentAbs, folder));
  return parentPath ? `${parentPath}/${folder}` : folder;
}

export async function saveLibraryNote(root: string, parentPath: string, name: string, content: string): Promise<string> {
  validRelative(parentPath);
  validLibraryName(name);
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
    throw new Error('Invalid content');
  }
  await ensureLibrary(root);
  const parentAbs = await resolveInside(root, parentPath);
  let fileName = name.trim();
  if (!fileName.toLowerCase().endsWith('.md')) fileName = `${fileName}.md`;
  if (await fs.stat(path.join(parentAbs, fileName)).then(() => true).catch(() => false)) {
    fileName = await existingName(parentAbs, fileName);
  }
  const itemPath = parentPath ? `${parentPath}/${fileName}` : fileName;
  await saveProjectMarkdown(await resolveInside(root, parentPath), fileName, content);
  return itemPath;
}

export async function uploadLibraryFiles(root: string, sources: string[], parentPath: string): Promise<{ name: string; path: string }[]> {
  validRelative(parentPath);
  if (!Array.isArray(sources) || !sources.length || sources.length > 50 || sources.some(item => typeof item !== 'string' || !path.isAbsolute(item) || item.includes('\0'))) {
    throw new Error('Invalid upload');
  }
  await ensureLibrary(root);
  const parentAbs = await resolveInside(root, parentPath);
  const uploaded: { name: string; path: string }[] = [];
  for (const source of sources) {
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > MAX_UPLOAD_BYTES) throw new Error('File too large');
    let fileName = path.basename(source);
    const destination = path.join(parentAbs, fileName);
    if (path.resolve(destination) === path.resolve(source)) {
      uploaded.push({ name: fileName, path: parentPath ? `${parentPath}/${fileName}` : fileName });
      continue;
    }
    if (await fs.stat(destination).then(() => true).catch(() => false)) {
      fileName = await existingName(parentAbs, fileName);
    }
    await fs.copyFile(source, path.join(parentAbs, fileName));
    uploaded.push({ name: fileName, path: parentPath ? `${parentPath}/${fileName}` : fileName });
  }
  return uploaded;
}

export async function renameLibraryItem(root: string, itemPath: string, newName: string): Promise<string> {
  validRelative(itemPath);
  validLibraryName(newName);
  const parentPath = itemPath.split('/').slice(0, -1).join('/');
  const parentAbs = await resolveInside(root, parentPath);
  const target = path.join(parentAbs, itemPath.split('/').at(-1)!);
  if (!await fs.stat(target).then(stat => stat.isFile() || stat.isDirectory()).catch(() => false)) throw new Error('Item not found');
  const destination = path.join(parentAbs, newName.trim());
  if (destination !== target && await fs.stat(destination).then(() => true).catch(() => false)) throw new Error('Already exists');
  await fs.rename(target, destination);
  const nextPath = parentPath ? `${parentPath}/${newName.trim()}` : newName.trim();
  await rewriteAiPrefixes(root, itemPath, nextPath);
  return nextPath;
}

export async function moveLibraryItem(root: string, itemPath: string, targetFolderPath: string): Promise<string> {
  validRelative(itemPath);
  validRelative(targetFolderPath);
  if (targetFolderPath === itemPath || targetFolderPath.startsWith(`${itemPath}/`)) throw new Error('Invalid destination');
  const parentPath = itemPath.split('/').slice(0, -1).join('/');
  if (targetFolderPath === parentPath) throw new Error('Already in folder');
  const source = await resolveInside(root, itemPath);
  if (!await fs.stat(source).then(stat => stat.isFile()).catch(() => false)) throw new Error('Item not found');
  if (targetFolderPath) {
    const targetFolder = await resolveInside(root, targetFolderPath);
    if (!(await fs.stat(targetFolder)).isDirectory()) throw new Error('Folder not found');
  }
  const name = itemPath.split('/').at(-1)!;
  const parentAbs = await resolveInside(root, targetFolderPath);
  const destination = path.join(parentAbs, name);
  if (await fs.stat(destination).then(() => true).catch(() => false)) throw new Error('Already exists');
  await fs.rename(source, destination);
  const nextPath = targetFolderPath ? `${targetFolderPath}/${name}` : name;
  await rewriteAiPrefixes(root, itemPath, nextPath);
  return nextPath;
}
