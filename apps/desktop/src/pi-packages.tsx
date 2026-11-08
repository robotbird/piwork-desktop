import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PackageIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { InstalledPiPackage, PiCatalogItem } from '../shared/types';

/** 桌面端自研文案(设置页分区,不使用 Web 同步的 i18n 词库) */
const words = {
 'zh-CN': {
  installedTitle: '已安装插件',
  installedEmpty: '还没有安装插件。在下方官网目录中浏览并安装。',
  discoverTitle: '发现插件',
  catalogHint: '来自官网插件目录 pi.dev/packages',
  searchPlaceholder: '搜索名称、简介或作者',
  loadFailed: '无法连接插件目录，请检查网络后重试。',
  retry: '重试',
  noMatches: '没有匹配的插件',
  loadMore: '加载更多',
  showing: '已显示 {shown} / {total} 个',
  install: '安装',
  installedLabel: '已安装',
  installTitle: '安装插件',
  installNotice: '将从 npm 安装「{name}」。插件中的扩展代码将在本机运行，技能与提示词会加入对话，请仅安装信任来源的插件。',
  uninstallTitle: '卸载插件',
  uninstallNotice: '将卸载「{name}」并从对话中移除其技能与扩展。',
  installSuccess: '已安装 {name}',
  uninstallSuccess: '已卸载 {name}',
  errNpmUnavailable: '未检测到可用的 npm（需要 Node.js）。请安装 Node.js 后重试。',
  errNotFound: 'npm 上没有找到这个包',
  errAlreadyInstalled: '这个插件已经安装',
  errInvalidSource: '无效的插件源',
  errInstallFailed: '安装失败，请检查网络后重试。',
  errInUse: '对话正在进行，请等待结束后再管理插件。',
  actionFailed: '操作失败，请重试。',
  loadInstalledFailed: '无法读取已安装插件，请重启应用后重试。',
  resourceExtensions: '扩展',
  resourceSkills: '技能',
  resourcePrompts: '提示词',
  resourceThemes: '主题',
  cancel: '取消',
 },
 en: {
  installedTitle: 'Installed plugins',
  installedEmpty: 'No plugins installed yet. Browse the official catalog below.',
  discoverTitle: 'Discover plugins',
  catalogHint: 'From the official catalog at pi.dev/packages',
  searchPlaceholder: 'Search by name, description or author',
  loadFailed: 'Cannot reach the plugin catalog. Check your connection and retry.',
  retry: 'Retry',
  noMatches: 'No matching plugins',
  loadMore: 'Load more',
  showing: 'Showing {shown} of {total}',
  install: 'Install',
  installedLabel: 'Installed',
  installTitle: 'Install plugin',
  installNotice: '"{name}" will be installed from npm. Extension code in the plugin runs on this Mac, and its skills and prompts join your chats. Install plugins from trusted sources only.',
  uninstallTitle: 'Uninstall plugin',
  uninstallNotice: 'This uninstalls "{name}" and removes its skills and extensions from chats.',
  installSuccess: 'Installed {name}',
  uninstallSuccess: 'Uninstalled {name}',
  errNpmUnavailable: 'No usable npm found (Node.js required). Install Node.js and retry.',
  errNotFound: 'Package not found on npm',
  errAlreadyInstalled: 'This plugin is already installed',
  errInvalidSource: 'Invalid plugin source',
  errInstallFailed: 'Installation failed. Check your connection and retry.',
  errInUse: 'A chat is running. Wait for it to finish before managing plugins.',
  actionFailed: 'Action failed. Please try again.',
  loadInstalledFailed: 'Unable to read installed plugins. Restart the app and retry.',
  resourceExtensions: 'ext',
  resourceSkills: 'skill',
  resourcePrompts: 'prompt',
  resourceThemes: 'theme',
  cancel: 'Cancel',
 },
} as const;

type PiWords = { [K in keyof (typeof words)['zh-CN']]: string };

const CATALOG_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/** 目录条目是否已安装(忽略版本,与主进程 samePiPackage 同语义) */
function isInstalled(installed: InstalledPiPackage[], name: string): boolean {
 return installed.some(item => item.source.replace(/^npm:/, '').replace(/@[^/@]+$/, '') === name);
}

/** 主进程错误(PiPackageError 的 code 或 IPC 文案)→ 界面文案 */
function errorText(w: PiWords, error: unknown): string {
 const message = error instanceof Error ? error.message : '';
 const known: Record<string, string> = {
  npmUnavailable: w.errNpmUnavailable,
  notFound: w.errNotFound,
  alreadyInstalled: w.errAlreadyInstalled,
  invalidSource: w.errInvalidSource,
  installFailed: w.errInstallFailed,
  catalogUnavailable: w.loadFailed,
  'Pi package is in use': w.errInUse,
 };
 return known[message] ?? w.actionFailed;
}

export function PiPackages({ language }: { language: 'zh-CN' | 'en' }) {
 const w = words[language];
 const [installed, setInstalled] = useState<InstalledPiPackage[]>([]);
 const [installedError, setInstalledError] = useState(false);
 const [query, setQuery] = useState('');
 const [items, setItems] = useState<PiCatalogItem[]>([]);
 const [total, setTotal] = useState(0);
 const [offset, setOffset] = useState(0);
 const [catalogLoading, setCatalogLoading] = useState(true);
 const [loadingMore, setLoadingMore] = useState(false);
 const [catalogError, setCatalogError] = useState(false);
 const [installTarget, setInstallTarget] = useState<PiCatalogItem | null>(null);
 const [installing, setInstalling] = useState(false);
 const [uninstallTarget, setUninstallTarget] = useState<InstalledPiPackage | null>(null);
 const [uninstalling, setUninstalling] = useState(false);

 const refreshInstalled = useCallback(async () => {
  try {
   setInstalled(await window.desktop.listInstalledPiPackages());
   setInstalledError(false);
  } catch {
   setInstalledError(true);
  }
 }, []);

 const loadCatalog = useCallback(async (searchQuery: string, nextOffset: number, replace: boolean) => {
  if (replace) setCatalogLoading(true);
  else setLoadingMore(true);
  setCatalogError(false);
  try {
   const result = await window.desktop.searchPiPackages(searchQuery, nextOffset);
   setItems(current => (replace ? result.items : [...current, ...result.items]));
   setTotal(result.total);
   setOffset(nextOffset);
  } catch {
   setCatalogError(true);
  } finally {
   setCatalogLoading(false);
   setLoadingMore(false);
  }
 }, []);

 useEffect(() => {
  void refreshInstalled();
 }, [refreshInstalled]);

 // 防抖搜索:输入停顿 300ms 后重查目录首页
 useEffect(() => {
  const timer = setTimeout(() => {
   void loadCatalog(query, 0, true);
  }, SEARCH_DEBOUNCE_MS);
  return () => clearTimeout(timer);
 }, [loadCatalog, query]);

 async function handleConfirmInstall() {
  if (!installTarget) return;
  setInstalling(true);
  try {
   const source = installTarget.version ? `npm:${installTarget.name}@${installTarget.version}` : `npm:${installTarget.name}`;
   const item = await window.desktop.installPiPackage(source);
   setInstalled(current => [...current.filter(existing => existing.source !== item.source), item]);
   toast.success(w.installSuccess.replace('{name}', item.name));
   setInstallTarget(null);
  } catch (error) {
   toast.error(errorText(w, error));
  } finally {
   setInstalling(false);
  }
 }

 async function handleConfirmUninstall() {
  if (!uninstallTarget) return;
  setUninstalling(true);
  try {
   await window.desktop.uninstallPiPackage(uninstallTarget.source);
   setInstalled(current => current.filter(item => item.source !== uninstallTarget.source));
   toast.success(w.uninstallSuccess.replace('{name}', uninstallTarget.name));
   setUninstallTarget(null);
  } catch (error) {
   toast.error(errorText(w, error));
  } finally {
   setUninstalling(false);
  }
 }

 const resourceBadges = (counts: InstalledPiPackage['resources']) => [
  { count: counts.extensions, label: w.resourceExtensions },
  { count: counts.skills, label: w.resourceSkills },
  { count: counts.prompts, label: w.resourcePrompts },
  { count: counts.themes, label: w.resourceThemes },
 ].filter(entry => entry.count > 0);

 return (
  <div className="flex flex-col gap-3">
   <div className="overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4">
    <h3 className="text-sm font-medium leading-5 text-foreground">{w.installedTitle}</h3>
    {installedError ? (
     <p className="mt-2 text-[13px] text-destructive" role="alert">{w.loadInstalledFailed}</p>
    ) : installed.length ? (
     <ul className="mt-3 divide-y divide-border/70">
      {installed.map(item => (
       <li className="flex items-center gap-3 py-2.5" key={item.source}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
         <PackageIcon aria-hidden="true" className="size-4"/>
        </span>
        <div className="min-w-0 flex-1">
         <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium text-foreground">{item.name}</span>
          {item.version ? <span className="shrink-0 font-mono text-xs text-muted-foreground">v{item.version}</span> : null}
         </div>
         {item.description ? <p className="mt-0.5 line-clamp-1 text-[13px] leading-5 text-muted-foreground">{item.description}</p> : null}
        </div>
        {resourceBadges(item.resources).map(entry => (
         <Badge className="hidden shrink-0 sm:inline-flex" key={entry.label} variant="secondary">{entry.label} {entry.count}</Badge>
        ))}
        <Button aria-label={w.uninstallTitle} className="shrink-0" disabled={uninstalling} onClick={() => setUninstallTarget(item)} size="sm" variant="ghost">
         {uninstalling && uninstallTarget?.source === item.source ? <Spinner className="size-4"/> : <Trash2Icon/>}
         <span className="sr-only">{w.uninstallTitle}</span>
        </Button>
       </li>
      ))}
     </ul>
    ) : (
     <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{w.installedEmpty}</p>
    )}
   </div>
   <div className="overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
     <div className="min-w-0">
      <h3 className="text-sm font-medium leading-5 text-foreground">{w.discoverTitle}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{w.catalogHint}</p>
     </div>
     <div className="relative w-full shrink-0 sm:w-64">
      <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
      <Input aria-label={w.searchPlaceholder} className="h-9 pl-8" maxLength={200} onChange={event => setQuery(event.target.value)} placeholder={w.searchPlaceholder} value={query}/>
     </div>
    </div>
    <div aria-live="polite">
     {catalogLoading ? (
      <div className="mt-4 flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
       <Spinner className="size-4"/>
      </div>
     ) : catalogError ? (
      <div className="mt-4 flex flex-col items-center gap-2 py-8">
       <p className="text-[13px] text-destructive" role="alert">{w.loadFailed}</p>
       <Button onClick={() => void loadCatalog(query, 0, true)} size="sm" variant="outline">{w.retry}</Button>
      </div>
     ) : items.length ? (
      <>
       <ul className="mt-2 divide-y divide-border/70">
        {items.map(item => {
         const present = isInstalled(installed, item.name);
         return (
          <li className="flex items-center gap-3 py-2.5" key={item.name}>
           <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
             <span className="truncate font-mono text-[13px] font-medium text-foreground">{item.name}</span>
             {item.version ? <span className="shrink-0 font-mono text-xs text-muted-foreground">v{item.version}</span> : null}
             {item.publisher ? <span className="shrink-0 truncate text-xs text-muted-foreground">@{item.publisher}</span> : null}
            </div>
            {item.description ? <p className="mt-0.5 line-clamp-1 text-[13px] leading-5 text-muted-foreground">{item.description}</p> : null}
           </div>
           {present ? (
            <Badge className="shrink-0" variant="outline">{w.installedLabel}</Badge>
           ) : (
            <Button className="shrink-0" disabled={installing} onClick={() => setInstallTarget(item)} size="sm" variant="outline">
             <PlusIcon/>
             {w.install}
            </Button>
           )}
          </li>
         );
        })}
       </ul>
       {items.length < total ? (
        <div className="mt-3 flex flex-col items-center gap-1.5">
         <Button disabled={loadingMore} onClick={() => void loadCatalog(query, offset + CATALOG_PAGE_SIZE, false)} size="sm" variant="outline">
          {loadingMore ? <Spinner className="size-4"/> : null}
          {w.loadMore}
         </Button>
         <p className="text-xs text-muted-foreground">{w.showing.replace('{shown}', String(items.length)).replace('{total}', String(total))}</p>
        </div>
       ) : null}
      </>
     ) : (
      <p className={cn('mt-4 py-6 text-center text-[13px] text-muted-foreground')}>{w.noMatches}</p>
     )}
    </div>
   </div>
   <Dialog onOpenChange={open => { if (!open && !installing) setInstallTarget(null); }} open={Boolean(installTarget)}>
    <DialogContent className="sm:max-w-md">
     <DialogHeader>
      <DialogTitle>{w.installTitle}</DialogTitle>
      <DialogDescription>{w.installNotice.replace('{name}', installTarget?.name ?? '')}</DialogDescription>
     </DialogHeader>
     <DialogFooter>
      <Button disabled={installing} onClick={() => setInstallTarget(null)} variant="outline">{w.cancel}</Button>
      <Button disabled={installing} onClick={() => void handleConfirmInstall()}>
       {installing ? <Spinner className="size-4"/> : null}
       {w.install}
      </Button>
     </DialogFooter>
    </DialogContent>
   </Dialog>
   <Dialog onOpenChange={open => { if (!open && !uninstalling) setUninstallTarget(null); }} open={Boolean(uninstallTarget)}>
    <DialogContent className="sm:max-w-md">
     <DialogHeader>
      <DialogTitle>{w.uninstallTitle}</DialogTitle>
      <DialogDescription>{w.uninstallNotice.replace('{name}', uninstallTarget?.name ?? '')}</DialogDescription>
     </DialogHeader>
     <DialogFooter>
      <Button disabled={uninstalling} onClick={() => setUninstallTarget(null)} variant="outline">{w.cancel}</Button>
      <Button disabled={uninstalling} onClick={() => void handleConfirmUninstall()} variant="destructive">
       {uninstalling ? <Spinner className="size-4"/> : null}
       {w.uninstallTitle}
      </Button>
     </DialogFooter>
    </DialogContent>
   </Dialog>
  </div>
 );
}
