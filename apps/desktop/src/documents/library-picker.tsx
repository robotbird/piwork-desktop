// 从我的文档选择附件的弹窗，移植自 piwork/components/chat/library-file-picker.tsx。
// 桌面端适配：数据来自 Electron 文档库 IPC；点击即作为本条消息的唯一附件。
// 类型不在此处限制：任意文件都可选择，能否读取由主进程 readChatAttachment 决定
// （文本/代码/PDF/Office 提取文字，图片 ≤10 MB；不可提取的二进制会提示失败）。
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckIcon, FileTextIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { PickedAttachment } from '../../shared/types';
import { formatFileSize } from '@/lib/documents/types';
import { isImageName, LibraryThumb } from './library-thumb';

export function LibraryFilePicker({ open, onOpenChange, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (file: { library: string }) => Promise<PickedAttachment | null>;
}) {
  const t = useTranslations('chat');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [items, setItems] = useState<import('../../shared/types').LibraryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setItems(null);
    setFailed(false);
    window.desktop.libraryList()
      .then(list => { if (active) setItems(list); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [open, reload]);
  const term = query.trim().toLocaleLowerCase();
  const files = (items ?? []).filter(item => item.kind === 'file' && item.name.toLocaleLowerCase().includes(term));
  async function pick(path: string) {
    if (pending) return;
    setPending(path);
    try {
      const picked = await onPick({ library: path });
      if (picked) onOpenChange(false);
    } catch {
      toast.error(t('librarySelectFailed'));
    } finally {
      setPending(null);
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[70dvh] max-h-[640px] w-[calc(100vw-2rem)] max-w-none flex-col gap-3 overflow-hidden rounded-2xl p-4 sm:h-[58dvh] sm:w-[min(640px,calc(100vw-3rem))] sm:max-w-none sm:p-6 lg:w-[40vw] lg:max-w-[800px]"
        data-testid="library-file-browser"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('chooseLibraryFiles')}</DialogTitle>
        </DialogHeader>
        <div className="relative m-2 shrink-0">
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input aria-label={t('searchLibraryFiles')} className="h-10 pl-9" onChange={event => setQuery(event.target.value)} placeholder={t('searchLibraryFiles')} value={query} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {failed ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <p>{t('libraryLoadFailed')}</p>
              <Button className="mt-2" onClick={() => setReload(value => value + 1)} type="button" variant="outline">
                {t('libraryRetry')}
              </Button>
            </div>
          ) : items === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('libraryLoading')}</p>
          ) : files.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('libraryEmpty')}</p>
          ) : (
            files.map(item => (
              <button
                className="flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted disabled:opacity-50"
                data-file-path={item.path}
                disabled={pending !== null}
                key={item.path}
                onClick={() => void pick(item.path)}
                title={item.name}
                type="button"
              >
                {isImageName(item.name) ? (
                  <LibraryThumb className="size-10 shrink-0 rounded-md border border-border object-cover" name={item.name} path={item.path}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                      <FileTextIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                    </span>
                  </LibraryThumb>
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <FileTextIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">{formatFileSize(item.size)}</span>
                </span>
                {pending === item.path ? <CheckIcon aria-hidden="true" className="size-4 shrink-0" /> : null}
              </button>
            ))
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-border pt-3">
          <Button onClick={() => onOpenChange(false)} type="button">
            {t('libraryDone')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
