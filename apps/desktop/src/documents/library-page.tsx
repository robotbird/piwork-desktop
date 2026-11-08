// 我的文档 library page, ported from piwork/components/documents/document-library.tsx.
// Desktop adaptations: SWR fetches the Electron library IPC instead of
// /api/library, entries are path-addressed (real folders/files under
// userData/library), the download action becomes export/open/reveal, a trash
// action is added, and clicking a file opens the in-page preview panel that
// reuses the desktop PDF/DOCX/XLSX/PPTX preview components.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Folder,
  Grid2X2,
  ImageIcon,
  List,
  Loader2,
  MoreHorizontal,
  Plus,
  Presentation,
  Search,
  Sheet,
  Sparkles,
  Trash2,
  Upload,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileTypeIcon } from '@/components/documents/file-type-icon';
import { fileCategory, formatFileSize } from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import type { LibraryEntry } from '../../shared/types';
import { isHtmlFile } from '../chat/assistant-html';
import { isImageName, LibraryThumb } from './library-thumb';
import { libraryStrings, type LibraryLanguage } from './strings';
import { usePreviewWidth } from '../preview-resizer';
import styles from './library-page.module.css';

const PptxPreview = lazy(() => import('../pptx-preview').then(module => ({ default: module.PptxPreview })));
const XlsxPreview = lazy(() => import('../xlsx-preview').then(module => ({ default: module.XlsxPreview })));
const DocxPreview = lazy(() => import('../docx-preview').then(module => ({ default: module.DocxPreview })));
const PdfPreview = lazy(() => import('../pdf-preview').then(module => ({ default: module.PdfPreview })));
const HtmlPreview = lazy(() => import('../html-preview').then(module => ({ default: module.HtmlPreview })));

const tabs = [
  'all',
  'folders',
  'documents',
  'images',
  'spreadsheets',
  'presentations',
  'aiGenerated',
] as const;
const UPLOAD_LIMIT_MB = 100;
const IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

type PreviewKind = 'text' | 'html' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx';
type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; kind: PreviewKind; content: string }
  | { status: 'unsupported' }
  | { status: 'failed' };

function dateLabel(value: number, language: string) {
  return new Date(value).toLocaleString(language, {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
function fileStyle(item: LibraryEntry) {
  const category = fileCategory(item.name, item.contentType);
  if (category === 'images') {
    return { color: 'text-violet-500 bg-violet-50 dark:bg-violet-950/30', Icon: ImageIcon, label: 'documents.coverImage' };
  }
  if (category === 'spreadsheets') {
    return { color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30', Icon: Sheet, label: 'documents.coverSheet' };
  }
  if (category === 'presentations') {
    return { color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/30', Icon: Presentation, label: 'documents.coverSlides' };
  }
  return {
    color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/30',
    Icon: FileText,
    label: item.name.split('.').pop()?.toUpperCase() ?? 'documents.coverFile',
  };
}
function coverText(label: string, t: (key: string) => string) {
  return label.startsWith('documents.') ? t(label) : label;
}

export function DocumentLibrary({ language, onClose }: { language: LibraryLanguage; onClose: () => void }) {
  const t = useTranslations();
  const strings = libraryStrings[language];
  const dateLocale = language === 'zh-CN' ? 'zh-CN' : 'en';
  // No SWR cache: the library folder is real user data that can also change
  // from the Finder or chat saves, so every page open fetches fresh.
  const [items, setItems] = useState<LibraryEntry[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRequest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const fetched = await window.desktop.libraryList();
      if (request === listRequest.current) {
        setItems(fetched);
        setError(false);
      }
    } catch {
      if (request === listRequest.current) setError(true);
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, []);
  const [tab, setTab] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<{ mode: 'folder' | 'rename' | 'note' | 'move'; item?: LibraryEntry } | null>(null);
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<{ path: string; name: string } | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' });
  const { width: previewWidth, resizer: previewResizer } = usePreviewWidth();
  const previewRequest = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
    const onChanged = () => { void refresh(); };
    window.addEventListener('piwork:library-changed', onChanged);
    return () => window.removeEventListener('piwork:library-changed', onChanged);
  }, [refresh]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const scoped = items.filter(item =>
    search ? item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) : item.parentPath === parentId
  );
  const folders = scoped.filter(item => item.kind === 'folder' && ['all', 'folders'].includes(tab));
  const files = scoped.filter(item =>
    item.kind === 'file' &&
    (tab === 'all' ||
      (tab === 'aiGenerated' ? item.source === 'ai' : fileCategory(item.name, item.contentType) === tab))
  );
  const breadcrumbs: LibraryEntry[] = [];
  let current = items.find(item => item.path === parentId);
  while (current && !breadcrumbs.some(item => item.path === current?.path)) {
    breadcrumbs.unshift(current);
    current = items.find(item => item.path === current?.parentPath);
  }
  function navigate(id: string) {
    setParentId(id);
    setSearch('');
    setTab('all');
    setPreview(null);
  }
  function openDialog(mode: 'folder' | 'rename' | 'note' | 'move', item?: LibraryEntry) {
    setName(item?.name ?? '');
    setContent('');
    setDestination(item?.parentPath ?? '');
    setDialog({ item, mode });
  }
  function errorText(err: unknown, fallback: string) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Already exists|Too many copies/.test(message)) return strings.nameInUse;
    if (/Invalid name|Invalid path|Invalid content|Invalid destination/.test(message)) return strings.invalidInput;
    return fallback;
  }
  async function uploadFiles(selected: File[]) {
    if (busy || !selected.length) return;
    setBusy(true);
    let success = 0;
    for (const file of selected) {
      const source = window.desktop.pathForFile(file);
      if (!source) {
        toast.error(t('documents.uploadFailed'));
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: bound upload memory and report each file failure independently.
      try {
        await window.desktop.libraryUpload([source], parentId);
        success += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        toast.error(/File too large/.test(message)
          ? t('documents.fileLimit', { maxMB: UPLOAD_LIMIT_MB, name: file.name })
          : t('documents.uploadFailed'));
      }
    }
    if (success) toast.success(t('documents.archived', { count: success }));
    await refresh();
    setBusy(false);
  }
  async function submit() {
    if (!name.trim() || !dialog) return;
    setBusy(true);
    try {
      if (dialog.mode === 'note') {
        await window.desktop.librarySaveNote(parentId, name.trim(), content);
      } else if (dialog.mode === 'folder') {
        await window.desktop.libraryCreateFolder(parentId, name.trim());
      } else if (dialog.mode === 'rename' && dialog.item) {
        await window.desktop.libraryRename(dialog.item.path, name.trim());
      } else if (dialog.mode === 'move' && dialog.item) {
        await window.desktop.libraryMove(dialog.item.path, destination);
      }
      setDialog(null);
      await refresh();
      toast.success(t('documents.saved'));
    } catch (err) {
      toast.error(errorText(err, t('documents.saveFailed')));
    } finally {
      setBusy(false);
    }
  }
  async function removeItem(item: LibraryEntry) {
    const message = item.kind === 'folder' ? strings.deleteFolderConfirm : strings.deleteFileConfirm;
    if (!confirm(message.replace('{name}', item.name))) return;
    try {
      await window.desktop.libraryTrash(item.path);
      if (preview && (preview.path === item.path || item.path.startsWith(`${preview.path}/`))) setPreview(null);
      await refresh();
      toast.success(strings.deleted);
    } catch {
      toast.error(t('documents.operationFailed'));
    }
  }
  async function openPreview(item: LibraryEntry) {
    if (item.kind !== 'file') return;
    const request = ++previewRequest.current;
    setPreview({ path: item.path, name: item.name });
    setPreviewState({ status: 'loading' });
    let next: PreviewState;
    try {
      if (isHtmlFile(item.name)) {
        // 文本仅供静态模式清洗展示;超大或损坏时降级为空内容,交互模式经 preview:// 协议按路径加载仍可用
        next = { status: 'ready', kind: 'html', content: await window.desktop.libraryReadText(item.path).catch(() => '') };
      } else {
        const isImage = isImageName(item.name);
        const isPptx = /\.pptx$/i.test(item.name);
        const isXlsx = /\.xlsx$/i.test(item.name);
        const isDocx = /\.docx$/i.test(item.name);
        const isPdf = /\.pdf$/i.test(item.name);
        const content = isPptx ? await window.desktop.libraryReadPptx(item.path)
          : isXlsx ? await window.desktop.libraryReadXlsx(item.path)
          : isDocx ? await window.desktop.libraryReadDocx(item.path)
          : isPdf ? await window.desktop.libraryReadPdf(item.path)
          : isImage ? await window.desktop.libraryReadImage(item.path).then(image => `data:${image.mime};base64,${image.base64}`)
          : await window.desktop.libraryReadText(item.path);
        next = { status: 'ready', kind: isPptx ? 'pptx' : isXlsx ? 'xlsx' : isDocx ? 'docx' : isPdf ? 'pdf' : isImage ? 'image' : 'text', content };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      next = /Unsupported/.test(message) ? { status: 'unsupported' } : { status: 'failed' };
    }
    if (request === previewRequest.current) setPreviewState(next);
  }
  function actions(item: LibraryEntry) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t('documents.itemActions', { name: item.name })}
            className="size-8 shrink-0 text-muted-foreground"
            size="icon"
            variant="ghost"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openDialog('rename', item)}>
            {t('documents.rename')}
          </DropdownMenuItem>
          {item.kind === 'file' && (
            <DropdownMenuItem onClick={() => openDialog('move', item)}>
              {t('documents.move')}
            </DropdownMenuItem>
          )}
          {item.kind === 'file' && (
            <DropdownMenuItem onClick={() => void window.desktop.libraryExport(item.path).catch(() => toast.error(t('documents.operationFailed')))}>
              <Download className="mr-2 size-4" />
              {strings.exportCopy}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void window.desktop.libraryOpen(item.path).catch(() => toast.error(t('documents.operationFailed')))}>
            <ExternalLink className="mr-2 size-4" />
            {strings.openExternally}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void window.desktop.libraryReveal(item.path).catch(() => toast.error(t('documents.operationFailed')))}>
            <FolderOpen className="mr-2 size-4" />
            {strings.revealInFinder}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void removeItem(item)}>
            <Trash2 className="mr-2 size-4" />
            {strings.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const moveItem = dialog?.item;
  const moveTargets = moveItem
    ? items.filter(item => item.kind === 'folder' && item.path !== moveItem.path &&
        !item.path.startsWith(`${moveItem.path}/`) && item.path !== moveItem.parentPath)
    : [];
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: drag/drop supplements the keyboard-accessible upload button.
    <main
      aria-label={t('documents.title')}
      className={cn('relative', styles.page)}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDragOver={event => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDrop={event => {
        event.preventDefault();
        setDragging(false);
        void uploadFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className={styles.header}>
        <div>
          <div className="flex items-center gap-3">
            <h1 className={styles.heading}>{t('documents.title')}</h1>
            <Button aria-label={t('common.close')} onClick={onClose} size="icon-sm" variant="ghost">
              <XIcon />
            </Button>
          </div>
          <p className={styles.subtitle}>{t('documents.description')}</p>
        </div>
        <div className={styles.toolbar}>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label={t('documents.gridView')}
              aria-pressed={view === 'grid'}
              className={cn('rounded-full', view === 'grid' && 'bg-muted')}
              onClick={() => setView('grid')}
              size="icon"
              variant="ghost"
            >
              <Grid2X2 className="size-5" />
            </Button>
            <Button
              aria-label={t('documents.listView')}
              aria-pressed={view === 'list'}
              className={cn('rounded-full', view === 'list' && 'bg-muted')}
              onClick={() => setView('list')}
              size="icon"
              variant="ghost"
            >
              <List className="size-5" />
            </Button>
          </div>
          <label className={styles.search}>
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label={t('documents.search')}
              className="w-full bg-transparent text-sm outline-none"
              onChange={event => setSearch(event.target.value)}
              placeholder={t('documents.searchPlaceholder')}
              value={search}
            />
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-[42px] shrink-0 rounded-full px-5 text-[13px] shadow-none" disabled={busy}>
                {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {busy ? t('documents.uploading') : t('documents.new')}
                <ChevronDown className="ml-2 size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 rounded-2xl border-border bg-card p-2.5 shadow-lg [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:rounded-lg [&_[role=menuitem]]:px-3 [&_[role=menuitem]]:py-2.5"
            >
              <DropdownMenuItem onClick={() => openDialog('note')}>
                <FileText className="mr-2 size-4" />
                {t('documents.note')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openDialog('folder')}>
                <Folder className="mr-2 size-4" />
                {t('documents.folders')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => input.current?.click()}>
                <Upload className="mr-2 size-4" />
                {t('documents.upload')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            aria-label={t('documents.selectUpload')}
            className="hidden"
            multiple
            onChange={event => {
              void uploadFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
            ref={input}
            type="file"
          />
        </div>
      </div>
      <nav aria-label={t('documents.categories')} className={styles.tabs}>
        {tabs.map(label => (
          <button
            aria-pressed={tab === label}
            className={cn(
              'shrink-0 rounded-full px-[18px] py-2 text-[14px] leading-5 transition-colors',
              tab === label ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60'
            )}
            key={label}
            onClick={() => setTab(label)}
            type="button"
          >
            {t(`documents.${label}`)}
          </button>
        ))}
      </nav>
      {parentId && !search && (
        <nav aria-label={t('documents.folderPath')} className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <button className="text-muted-foreground hover:text-foreground" onClick={() => navigate('')} type="button">
            {t('documents.title')}
          </button>
          {breadcrumbs.map(folder => (
            <span className="flex items-center gap-2" key={folder.path}>
              <ChevronRight className="size-3 text-muted-foreground" />
              <button onClick={() => navigate(folder.path)} type="button">
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      {error ? (
        <div className="mt-12 rounded-xl border p-8 text-center" role="alert">
          <p>{t('documents.loadFailed')}</p>
          <Button className="mt-4" onClick={() => void refresh()} variant="outline">
            {t('documents.reload')}
          </Button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-5 pt-10 lg:grid-cols-4">
          {[1, 2, 3, 4].map(n => (
            <div className="h-52 animate-pulse rounded-2xl bg-muted" key={n} />
          ))}
        </div>
      ) : (
        <>
          {folders.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t('documents.folders')} <span className="ml-1 font-normal text-muted-foreground">({folders.length})</span>
              </h2>
              <div className={styles.folderGrid}>
                {folders.map((folder, index) => (
                  <div className={styles.folderCard} key={folder.path}>
                    <button
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                      onClick={() => navigate(folder.path)}
                      type="button"
                    >
                      <Folder
                        className={cn(
                          'size-11 shrink-0 stroke-[1.2]',
                          ['fill-blue-400 text-blue-500', 'fill-violet-400 text-violet-500', 'fill-amber-300 text-amber-400'][index % 3]
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{folder.name}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t('documents.folderCounts', {
                            files: items.filter(item => item.parentPath === folder.path && item.kind === 'file').length,
                            folders: items.filter(item => item.parentPath === folder.path && item.kind === 'folder').length,
                          })}
                        </span>
                      </span>
                    </button>
                    {actions(folder)}
                  </div>
                ))}
              </div>
            </section>
          )}
          {files.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {search ? t('documents.results') : t('documents.recent')}{' '}
                <span className="ml-1 font-normal text-muted-foreground">({files.length})</span>
              </h2>
              <div className={view === 'grid' ? styles.fileGrid : styles.fileList}>
                {view === 'list' && (
                  <div aria-hidden="true" className={styles.listHeader}>
                    <span>{t('documents.filename')}</span>
                    <span>{t('documents.size')}</span>
                    <span>{t('documents.updated')}</span>
                    <span>{t('documents.source')}</span>
                    <span />
                  </div>
                )}
                {files.map(item => {
                  const { Icon, color, label } = fileStyle(item);
                  const image = IMAGE_CONTENT_TYPES.has(item.contentType ?? '') || isImageName(item.name);
                  return (
                    <article className={cn('group', view === 'grid' ? styles.card : styles.row)} key={item.path}>
                      {view === 'grid' && (
                        <button
                          aria-label={t('documents.previewFile', { name: item.name })}
                          className={cn(styles.preview, color)}
                          onClick={() => void openPreview(item)}
                          type="button"
                        >
                          {image ? (
                            <LibraryThumb
                              className="size-full object-cover transition-transform group-hover:scale-[1.03]"
                              name={item.name}
                              path={item.path}
                            >
                              <div className={styles.cover}>
                                <FileTypeIcon className={styles.coverIcon} contentType={item.contentType} fallback={<Icon className={styles.coverIcon} />} filename={item.name} />
                                <span className={styles.coverLabel}>{coverText(label, t)}</span>
                              </div>
                            </LibraryThumb>
                          ) : (
                            <div className={styles.cover}>
                              <FileTypeIcon className={styles.coverIcon} contentType={item.contentType} fallback={<Icon className={styles.coverIcon} />} filename={item.name} />
                              <span className={styles.coverLabel}>{coverText(label, t)}</span>
                            </div>
                          )}
                          {item.source === 'ai' && <span className={styles.aiBadge}>{t('documents.aiGenerated')}</span>}
                        </button>
                      )}
                      <div className={styles.fileInfo}>
                        <span className={cn('mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-[5px]', color)}>
                          <FileTypeIcon className="size-4" contentType={item.contentType} fallback={<Icon className="size-4" />} filename={item.name} />
                        </span>
                        <div className={styles.fileDetails}>
                          <button
                            className={cn(styles.fileName, 'hover:underline')}
                            onClick={() => void openPreview(item)}
                            title={item.name}
                            type="button"
                          >
                            {item.name}
                          </button>
                          <p className={styles.meta}>
                            <span>{item.size ? formatFileSize(item.size) : '—'}</span>
                            <span className={styles.metaDot}>·</span>
                            <span>{dateLabel(item.updatedAt, dateLocale)}</span>
                          </p>
                        </div>
                        {view === 'list' && (
                          <span className={cn(styles.listSource, item.source === 'ai' && styles.listSourceAi)}>
                            {item.source === 'ai' ? t('documents.aiGenerated') : t('documents.myFiles')}
                          </span>
                        )}
                        {actions(item)}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {!folders.length && !files.length && (
            <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
              <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-muted">
                <Folder className="size-8 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-medium">{search ? t('documents.noMatches') : t('documents.empty')}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {search ? t('documents.trySearch') : t('documents.emptyHint')}
              </p>
              {!search && (
                <Button className="mt-6 rounded-full" disabled={busy} onClick={() => input.current?.click()}>
                  <Plus className="mr-2 size-4" />
                  {t('documents.upload')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <p className={styles.hint}>
        <Sparkles className="size-3.5" />
        {t('documents.limits', { maxMB: UPLOAD_LIMIT_MB })}
      </p>
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-blue-400 bg-background/95">
          <div className="text-center">
            <Upload className="mx-auto mb-4 size-10 text-blue-500" />
            <p className="text-xl font-medium">{t('documents.dropHint')}</p>
          </div>
        </div>
      )}
      {preview && (
        <aside aria-label={t('documents.previewFile', { name: preview.name })} className={styles.previewPanel} style={{ width: previewWidth }}>
          {previewResizer}
          <div className={styles.previewPanelHeader}>
            <div className={styles.previewPanelTitle}>
              <strong>{preview.name}</strong>
              <p>{preview.path}</p>
            </div>
            <Button aria-label={t('common.close')} onClick={() => setPreview(null)} size="icon-sm" variant="ghost">
              <XIcon />
            </Button>
          </div>
          <div className={styles.previewPanelActions}>
            <Button onClick={() => void window.desktop.libraryExport(preview.path).catch(() => toast.error(t('documents.operationFailed')))} size="sm" variant="outline">
              <Download className="mr-2 size-4" />
              {strings.exportCopy}
            </Button>
            <Button onClick={() => void window.desktop.libraryOpen(preview.path).catch(() => toast.error(t('documents.operationFailed')))} size="sm" variant="outline">
              <ExternalLink className="mr-2 size-4" />
              {strings.openExternally}
            </Button>
            <Button onClick={() => void window.desktop.libraryReveal(preview.path).catch(() => toast.error(t('documents.operationFailed')))} size="sm" variant="outline">
              <FolderOpen className="mr-2 size-4" />
              {strings.revealInFinder}
            </Button>
          </div>
          <div className={styles.previewPanelBody}>
            {previewState.status === 'loading' ? (
              <p>{strings.previewLoading}</p>
            ) : previewState.status === 'unsupported' ? (
              <p>{strings.previewUnsupported}</p>
            ) : previewState.status === 'failed' ? (
              <p className={styles.previewError} role="alert">{strings.previewFailed}</p>
            ) : previewState.kind === 'html' ? (
              <Suspense fallback={<p>{strings.previewLoading}</p>}><HtmlPreview source={{ kind: 'library', path: preview.path }} content={previewState.content} language={language} /></Suspense>
            ) : previewState.kind === 'pptx' ? (
              <Suspense fallback={<p>{strings.previewLoading}</p>}><PptxPreview data={previewState.content} language={language} /></Suspense>
            ) : previewState.kind === 'xlsx' ? (
              <Suspense fallback={<p>{strings.previewLoading}</p>}><XlsxPreview data={previewState.content} language={language} /></Suspense>
            ) : previewState.kind === 'docx' ? (
              <Suspense fallback={<p>{strings.previewLoading}</p>}><DocxPreview data={previewState.content} language={language} /></Suspense>
            ) : previewState.kind === 'pdf' ? (
              <Suspense fallback={<p>{strings.previewLoading}</p>}><PdfPreview data={previewState.content} language={language} /></Suspense>
            ) : previewState.kind === 'image' ? (
              <img alt={preview.name} className={styles.previewPanelImage} src={previewState.content} />
            ) : (
              <pre>{previewState.content}</pre>
            )}
          </div>
        </aside>
      )}
      <Dialog
        onOpenChange={open => {
          if (!open && !busy) setDialog(null);
        }}
        open={Boolean(dialog)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'move' ? t('documents.move')
                : dialog?.mode === 'rename' ? t('documents.rename')
                : dialog?.mode === 'note' ? t('documents.newNote')
                : t('documents.newFolder')}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'note' ? t('documents.noteHint') : t('documents.nameHint')}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              void submit();
            }}
          >
            {dialog?.mode === 'move' ? (
              <label className="block text-sm">
                {t('documents.destination')}
                <select
                  className="mt-2 w-full rounded-lg border bg-background p-2"
                  onChange={event => setDestination(event.target.value)}
                  value={destination}
                >
                  <option value="">{t('documents.root')}</option>
                  {moveTargets.map(folder => (
                    <option key={folder.path} value={folder.path}>
                      {folder.path}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block text-sm">
                {t('documents.name')}
                <input
                  autoFocus
                  className="mt-2 w-full rounded-lg border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
                  maxLength={180}
                  onChange={event => setName(event.target.value)}
                  required
                  value={name}
                />
              </label>
            )}
            {dialog?.mode === 'note' && (
              <label className="block text-sm">
                {t('documents.content')}
                <textarea
                  className="mt-2 min-h-48 w-full rounded-lg border bg-background p-3"
                  onChange={event => setContent(event.target.value)}
                  value={content}
                />
              </label>
            )}
            <DialogFooter>
              <Button disabled={busy} onClick={() => setDialog(null)} type="button" variant="outline">
                {t('documents.cancel')}
              </Button>
              <Button disabled={busy || !name.trim()} type="submit">
                {busy ? t('documents.saving') : t('documents.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
