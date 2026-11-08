import {useEffect, useState, type FormEvent} from 'react';
import {FolderIcon, FolderPlusIcon, XIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {cn} from '@/lib/utils';
import type {Project} from '../../shared/types';

/** 创建/编辑项目弹窗文案(桌面端 words 字典注入) */
export type ProjectDialogCopy = {
  createTitle: string;
  editTitle: string;
  nameLabel: string;
  sourceFolders: string;
  addFromComputer: string;
  addFolder: string;
  mainBadge: string;
  setMain: string;
  removeFolder: string;
  removeLocalProject: string;
  cancel: string;
  create: string;
  save: string;
  existingProject: string;
  saveFailed: string;
  confirmRemove: string;
  writeHint: string;
};

type DraftFolder = {token?: string; path: string; label: string; main: boolean};

/** 把原生选择器结果累计进草稿列表;撞车文件夹返回 existing 由调用方提示 */
async function pickIntoFolders(folders: DraftFolder[]): Promise<{folders: DraftFolder[]; duplicate: boolean} | null> {
  let picks;
  try {
    picks = await window.desktop.pickProject();
  } catch {
    return {folders, duplicate: false};
  }
  if (!picks) return null;
  let duplicate = false;
  const next = [...folders];
  for (const pick of picks) {
    if (pick.existing) { duplicate = true; continue; }
    if (next.some(folder => folder.path === pick.path)) continue;
    next.push({token: pick.token, path: pick.path, label: pick.name, main: next.length === 0});
  }
  return {folders: next, duplicate};
}

function SourceFolderRows({copy, folders, onSetMain, onRemove, canRemove}: {
  copy: ProjectDialogCopy; folders: DraftFolder[];
  onSetMain: (folder: DraftFolder) => void; onRemove: (folder: DraftFolder) => void; canRemove: boolean;
}) {
  if (!folders.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <ul className="divide-y divide-[var(--hairline-soft)]">
        {folders.map(folder => (
          <li className="group flex items-center gap-3 px-3 py-2.5" key={folder.path}>
            <button
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
              onClick={() => !folder.main && onSetMain(folder)}
              title={folder.main ? undefined : copy.setMain}
              type="button"
            >
              <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground"/>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{folder.label}</span>
                <span className="block truncate text-xs text-muted-foreground" title={folder.path}>{folder.path}</span>
              </span>
            </button>
            {folder.main
              ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{copy.mainBadge}</span>
              : <button className="shrink-0 rounded-full px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100" onClick={() => onSetMain(folder)} type="button">{copy.setMain}</button>}
            <Button
              aria-label={copy.removeFolder}
              className="size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
              disabled={!canRemove}
              onClick={() => onRemove(folder)}
              size="icon-sm"
              title={copy.removeFolder}
              type="button"
              variant="ghost"
            >
              <XIcon aria-hidden="true" className="size-4"/>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddFolderButton({copy, onClick}: {copy: ProjectDialogCopy; onClick: () => void}) {
  return (
    <button
      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--hairline-strong)] px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      <FolderPlusIcon aria-hidden="true" className="size-4"/>
      {copy.addFolder}
    </button>
  );
}

export function CreateProjectDialog({copy, open, onClose, onCreated}: {
  copy: ProjectDialogCopy; open: boolean; onClose: () => void; onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<DraftFolder[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setName(''); setFolders([]); setError(''); setBusy(false); }
  }, [open]);
  async function addFolders() {
    setError('');
    const result = await pickIntoFolders(folders);
    if (!result) return;
    setFolders(result.folders);
    if (result.duplicate) setError(copy.existingProject);
  }
  async function cancel() {
    onClose();
    if (folders.length) await window.desktop.cancelProject(folders.filter(folder => folder.token).map(folder => folder.token!)).catch(() => {});
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !folders.length || busy) return;
    setBusy(true);
    try {
      onCreated(await window.desktop.createProject(folders.map(folder => folder.token!), {name: name.trim(), description: ''}));
    } catch {
      setError(copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog onOpenChange={value => { if (!value) void cancel(); }} open={open}>
      <DialogContent aria-label={copy.createTitle} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{copy.createTitle}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">{copy.nameLabel}</span>
            <span className="relative">
              <FolderIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"/>
              <input
                aria-label={copy.nameLabel}
                autoFocus
                className="h-10 w-full rounded-lg border border-border bg-background pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-[var(--hairline-strong)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--link)_50%,transparent)]"
                maxLength={100}
                onChange={event => setName(event.target.value)}
                placeholder={copy.nameLabel}
                value={name}
              />
            </span>
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-foreground">{copy.sourceFolders}</span>
            {folders.length
              ? <SourceFolderRows
                  canRemove={folders.length > 1}
                  copy={copy}
                  folders={folders}
                  onRemove={folder => setFolders(current => {
                    const next = current.filter(item => item.path !== folder.path);
                    if (next.length && !next.some(item => item.main)) next[0] = {...next[0], main: true};
                    return next;
                  })}
                  onSetMain={folder => setFolders(current => current.map(item => ({...item, main: item.path === folder.path})))}
                />
              : <button
                  aria-label={copy.addFromComputer}
                  className="grid min-h-28 place-items-center gap-3 rounded-2xl border border-dashed border-[var(--hairline-strong)] text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={addFolders}
                  type="button"
                >
                  <span>{copy.addFromComputer}</span>
                </button>}
            <AddFolderButton copy={copy} onClick={addFolders}/>
          </div>
          <p className="text-xs text-muted-foreground">{copy.writeHint}</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button onClick={() => void cancel()} type="button" variant="ghost">{copy.cancel}</Button>
            <Button disabled={!name.trim() || !folders.length || busy} type="submit">{copy.create}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditProjectDialog({copy, project, open, onClose, onSaved, onRemoved}: {
  copy: ProjectDialogCopy; project: Project; open: boolean; onClose: () => void;
  onSaved: () => void; onRemoved: (project: Project) => void;
}) {
  const [name, setName] = useState(project.name);
  const [folders, setFolders] = useState<DraftFolder[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(project.name);
      setFolders(project.folders.map(folder => ({path: folder.path, label: folder.label, main: folder.main})));
      setError('');
      setBusy(false);
    }
  }, [open, project]);
  async function addFolders() {
    setError('');
    const result = await pickIntoFolders(folders);
    if (!result) return;
    setFolders(result.folders);
    if (result.duplicate) setError(copy.existingProject);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !folders.length || busy) return;
    setBusy(true);
    try {
      await window.desktop.updateProject(project.id, {
        name: name.trim(),
        description: project.description ?? '',
        folders: folders.map(folder => folder.token
          ? {token: folder.token, main: folder.main}
          : {path: folder.path, main: folder.main}),
      });
      onSaved();
    } catch {
      setError(copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  async function removeLocal() {
    if (!confirm(copy.confirmRemove)) return;
    try {
      await window.desktop.removeProject(project.id);
      onRemoved(project);
    } catch {
      setError(copy.saveFailed);
    }
  }
  return (
    <Dialog onOpenChange={value => { if (!value) onClose(); }} open={open}>
      <DialogContent aria-label={copy.editTitle} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{copy.editTitle}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">{copy.nameLabel}</span>
            <span className="relative">
              <FolderIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"/>
              <input
                aria-label={copy.nameLabel}
                autoFocus
                className={cn(
                  'h-10 w-full rounded-lg border border-border bg-background pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground',
                  'focus-visible:border-[var(--hairline-strong)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--link)_50%,transparent)]',
                )}
                maxLength={100}
                onChange={event => setName(event.target.value)}
                placeholder={copy.nameLabel}
                value={name}
              />
            </span>
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-foreground">{copy.sourceFolders}</span>
            <SourceFolderRows
              canRemove={folders.length > 1}
              copy={copy}
              folders={folders}
              onRemove={folder => setFolders(current => {
                const next = current.filter(item => item.path !== folder.path);
                if (next.length && !next.some(item => item.main)) next[0] = {...next[0], main: true};
                return next;
              })}
              onSetMain={folder => setFolders(current => current.map(item => ({...item, main: item.path === folder.path})))}
            />
            <AddFolderButton copy={copy} onClick={addFolders}/>
          </div>
          <p className="text-xs text-muted-foreground">{copy.writeHint}</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex flex-col-reverse items-center gap-2 sm:flex-row sm:justify-between">
            <Button className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => void removeLocal()} type="button" variant="ghost">{copy.removeLocalProject}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={onClose} type="button" variant="ghost">{copy.cancel}</Button>
              <Button disabled={!name.trim() || !folders.length || busy} type="submit">{copy.save}</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
