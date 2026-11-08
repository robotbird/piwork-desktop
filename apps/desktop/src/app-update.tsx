import { useCallback, useEffect, useState } from 'react';
import { ArrowUpCircleIcon, CheckIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { AppUpdateState } from '../shared/types';

/** 桌面端自研文案(设置-关于页软件更新卡片,仿 pi-packages.tsx 模式) */
const words = {
 'zh-CN': {
  title: '软件更新',
  statusIdle: '检查 GitHub 发布的更新。',
  statusUpToDate: '已是最新版本。',
  statusAvailable: '发现新版本 v{version}。',
  statusDownloading: '正在下载 v{version}…',
  statusDownloaded: 'v{version} 已下载完成，可以安装。',
  notesLabel: '更新内容',
  checkUpdates: '检查更新',
  downloadUpdate: '下载更新',
  cancelDownload: '取消',
  openInstaller: '打开安装包',
  installHint: '打开后请退出 PiWork，将 PiWork 拖入 Applications 完成安装；应用未签名，新版本首次打开可能需要在系统设置中允许。',
  errUpdatesDisabled: '开发模式未启用更新检查。',
  errCheckFailed: '检查更新失败，请检查网络后重试。',
  errDownloadFailed: '下载失败，请重试。',
  errHashMismatch: '安装包校验失败，请重新下载。',
  errInstallerUnavailable: '安装包不可用，请重新下载。',
 },
 en: {
  title: 'Software update',
  statusIdle: 'Checks GitHub releases for updates.',
  statusUpToDate: 'You are on the latest version.',
  statusAvailable: 'New version v{version} is available.',
  statusDownloading: 'Downloading v{version}…',
  statusDownloaded: 'v{version} is downloaded and ready to install.',
  notesLabel: 'Release notes',
  checkUpdates: 'Check for updates',
  downloadUpdate: 'Download update',
  cancelDownload: 'Cancel',
  openInstaller: 'Open installer',
  installHint: 'Quit PiWork, then drag PiWork into Applications to install. The app is unsigned; the first launch of the new version may need to be allowed in System Settings.',
  errUpdatesDisabled: 'Update checks are disabled in development mode.',
  errCheckFailed: 'Update check failed. Check your connection and retry.',
  errDownloadFailed: 'Download failed. Please retry.',
  errHashMismatch: 'Installer verification failed. Download it again.',
  errInstallerUnavailable: 'Installer unavailable. Download it again.',
 },
} as const;

type UpdateWords = { [K in keyof (typeof words)['zh-CN']]: string };

/** 主进程错误(AppUpdateError 的 code)→ 界面文案 */
function errorText(w: UpdateWords, error: unknown): string {
 const code = error instanceof Error ? error.message : '';
 const known: Record<string, string> = {
  updatesDisabled: w.errUpdatesDisabled,
  checkFailed: w.errCheckFailed,
  downloadFailed: w.errDownloadFailed,
  hashMismatch: w.errHashMismatch,
  installerUnavailable: w.errInstallerUnavailable,
 };
 return known[code] ?? w.errCheckFailed;
}

function fill(template: string, version: string): string {
 return template.replace('{version}', version);
}

export function AppUpdatePanel({ language }: { language: 'zh-CN' | 'en' }) {
 const w = words[language];
 const [state, setState] = useState<AppUpdateState | null>(null);
 const [checking, setChecking] = useState(false);
 const [error, setError] = useState('');

 const refresh = useCallback(async () => {
  try {
   setState(await window.desktop.getAppUpdateState());
  } catch {
   // 主进程不可达时保留上次快照
  }
 }, []);

 useEffect(() => {
  void refresh();
  return window.desktop.onAppUpdateChanged(() => void refresh());
 }, [refresh]);

 async function handleCheck() {
  setChecking(true);
  setError('');
  try {
   setState(await window.desktop.checkAppUpdate());
  } catch (cause) {
   setError(errorText(w, cause));
  } finally {
   setChecking(false);
  }
 }

 async function handleDownload() {
  setError('');
  try {
   setState(await window.desktop.downloadAppUpdate());
  } catch (cause) {
   setError(errorText(w, cause));
  }
 }

 async function handleCancel() {
  try {
   setState(await window.desktop.cancelAppUpdateDownload());
  } catch {
   // 取消失败(如下载已结束)由状态事件兜底刷新
  }
 }

 async function handleOpen() {
  setError('');
  try {
   await window.desktop.openAppUpdateInstaller();
  } catch (cause) {
   setError(errorText(w, cause));
   void refresh();
  }
 }

 const phase = state?.phase ?? 'idle';
 const info = state?.info;
 const progress = state?.progress;
 // content-length 与 feed size 均缺失时无法计算百分比,仅展示已下载字节数
 const percent = progress && progress.total > 0 ? Math.min(100, Math.floor((progress.received / progress.total) * 100)) : null;
 const statusText = phase === 'upToDate' ? w.statusUpToDate
  : phase === 'available' && info ? fill(w.statusAvailable, info.version)
  : phase === 'downloading' && info ? fill(w.statusDownloading, info.version)
  : phase === 'downloaded' && info ? fill(w.statusDownloaded, info.version)
  : w.statusIdle;
 return (
  <div className="mt-4 divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
   <div className="flex flex-col items-stretch justify-between gap-4 px-5 py-5 sm:flex-row sm:items-center">
    <div className="flex items-start gap-3.5">
     <ArrowUpCircleIcon aria-hidden="true" className="mt-0.5 size-[22px] shrink-0 text-muted-foreground"/>
     <div>
      <h3 className="text-[15px] font-medium leading-5 text-foreground">{w.title}</h3>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{statusText}</p>
     </div>
    </div>
    <div className="flex shrink-0 items-center gap-2">
     {phase === 'downloading' ? (
      <Button onClick={() => void handleCancel()} size="sm" variant="outline">{w.cancelDownload}</Button>
     ) : null}
     {phase === 'available' ? (
      <Button onClick={() => void handleDownload()} size="sm" variant="outline">{w.downloadUpdate}</Button>
     ) : null}
     {phase === 'downloaded' ? (
      <Button onClick={() => void handleOpen()} size="sm">{w.openInstaller}</Button>
     ) : null}
     <Button disabled={checking || phase === 'downloading'} onClick={() => void handleCheck()} size="sm" variant="outline">
      {checking ? <Spinner className="size-4"/> : phase === 'upToDate' ? <CheckIcon/> : <RefreshCwIcon/>}
      {w.checkUpdates}
     </Button>
    </div>
   </div>
   {phase === 'downloading' ? (
    <div aria-live="polite" className="flex flex-col gap-2 px-5 py-4">
     <div aria-label={statusText} aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent ?? undefined} className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar">
      <div className={cn('h-full rounded-full bg-primary', percent === null && 'w-1/3 animate-pulse')} style={percent === null ? undefined : { width: `${percent}%` }}/>
     </div>
     <p className="font-mono text-xs text-muted-foreground">{percent !== null ? `${percent}% · ` : ''}{progress ? `${Math.round(progress.received / 1024 / 1024)} MB${progress.total > 0 ? ` / ${Math.round(progress.total / 1024 / 1024)} MB` : ''}` : ''}</p>
    </div>
   ) : null}
   {phase === 'available' && info?.notes ? (
    <details className="px-5 py-4">
     <summary className="cursor-pointer text-[13px] font-medium leading-5 text-foreground">{w.notesLabel}</summary>
     <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-muted-foreground">{info.notes}</p>
    </details>
   ) : null}
   {phase === 'downloaded' ? (
    <p className="px-5 py-4 text-[13px] leading-5 text-muted-foreground">{w.installHint}</p>
   ) : null}
   {error ? <p className="px-5 py-4 text-[13px] leading-5 text-destructive" role="alert">{error}</p> : null}
  </div>
 );
}
