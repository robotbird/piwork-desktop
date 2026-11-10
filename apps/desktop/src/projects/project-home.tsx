import {useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent} from 'react';
import {
  FolderIcon, FolderPlusIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon, XIcon,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {AttachmentsMenu} from '../chat/composer-menus';
import {ArrowUpIcon} from '@/components/chat/icons';
import type {ChatSummary, Project, ProjectFolder, ChatAttachmentRef} from '../../shared/types';
import {FileTypeIcon} from '@/components/documents/file-type-icon';
import {isImageAttachment,AttachmentThumb} from '../chat/attachment-image';
import type enMessages from '@/i18n/messages/en.json';

type WebChatCopy = typeof enMessages.chat;
type WebProjectsCopy = typeof enMessages.projects;

/** 项目主页文案:web projects 命名空间 + 桌面端 words 字典注入 */
export type ProjectHomeCopy = {
  webChat: WebChatCopy;
  web: WebProjectsCopy;
  editProject: string;
  removeProject: string;
  removeProjectConfirm: string;
  renameChat: string;
  deleteChat: string;
  deleteChatConfirm: string;
  failed: string;
  unavailable: string;
  reveal: string;
  setMain: string;
  removeFolder: string;
  addFolder: string;
  mainBadge: string;
  existingProject: string;
  writeHint: string;
  removeAttachment: string;
  dateLocale: string;
};

/** 与 web shared.ts 的 formatShortDate 一致:numeric 月/日(如 10/11),跨年带年份 */
function formatShortDate(timestamp: number, locale: string) {
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'numeric',
    ...(sameYear ? {} : {year: 'numeric'}),
  });
}

export function ProjectHome({project, chats, copy, busy, attachmentReady, attachments, feedback, onOpenAttachment, onRemoveAttachment, onOpenChat, onRenameChat, onDeleteChat, onSend, onPickAttachment, onOpenLibrary, onEditProject, onRemoveProject, onProjectChanged, onPasteImage}: {
  project: Project;
  chats: ChatSummary[];
  copy: ProjectHomeCopy;
  busy: boolean;
  attachmentReady: boolean;
  attachments?: {name: string; ref?: ChatAttachmentRef}[];
  feedback?: string;
  onOpenAttachment: (ref: ChatAttachmentRef) => void;
  onOpenChat: (id: string) => void;
  onRenameChat: (chat: ChatSummary) => void;
  onDeleteChat: (chat: ChatSummary) => void;
  onSend: (text: string) => void;
  onPickAttachment: () => void;
  /** 输入框粘贴事件:剪贴板图片/拷贝文件批量经主进程校验后占用多附件槽位 */
  onPasteImage?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onOpenLibrary: () => void;
  onEditProject: () => void;
  onRemoveProject: (project: Project) => void;
  onProjectChanged: () => void;
  onRemoveAttachment: (index: number) => void;
}) {
  const [tab, setTab] = useState<'chats' | 'sources'>('chats');
  const [draft, setDraft] = useState('');
  const [multiline, setMultiline] = useState(false);
  const [folderError, setFolderError] = useState('');
  const composerRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projectChats = chats.filter(chat => chat.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const main = project.folders.find(folder => folder.main) ?? project.folders[0];

  // 与 web project-home 一致:按外框宽度测量切换单行/多行布局,高度封顶 240px
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const composer = composerRef.current;
    if (!textarea || !composer) return;
    const resize = () => {
      textarea.style.width = `${Math.max(composer.clientWidth - 104, 1)}px`;
      textarea.style.paddingInline = '0px';
      textarea.style.height = '0px';
      const needsMultiline = textarea.scrollHeight > 40;
      textarea.style.width = '';
      textarea.style.paddingInline = '';
      const height = textarea.scrollHeight;
      textarea.style.height = `${Math.min(height, 240)}px`;
      textarea.style.overflowY = height > 240 ? 'auto' : 'hidden';
      setMultiline(needsMultiline);
    };
    resize();
    let width = composer.clientWidth;
    const observer = new ResizeObserver(() => {
      if (composer.clientWidth !== width) {
        width = composer.clientWidth;
        resize();
      }
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, [draft, multiline]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    onSend(text);
  }

  /** 来源 tab 的文件夹增删/设主:直接落 updateProject 后通知父级刷新 */
  async function saveFolders(folders: {token?: string; path: string; main: boolean}[]) {
    setFolderError('');
    try {
      await window.desktop.updateProject(project.id, {
        name: project.name,
        description: project.description ?? '',
        folders: folders.map(folder => folder.token ? {token: folder.token, main: folder.main} : {path: folder.path, main: folder.main}),
      });
      onProjectChanged();
    } catch {
      setFolderError(copy.failed);
    }
  }
  async function addFolder() {
    setFolderError('');
    let picks;
    try {
      picks = await window.desktop.pickProject();
    } catch {
      setFolderError(copy.failed);
      return;
    }
    if (!picks) return;
    const current = project.folders.map(folder => ({path: folder.path, main: folder.main}));
    const added: {token: string; path: string; main: boolean}[] = [];
    let duplicate = false;
    for (const pick of picks) {
      if (pick.existing) { duplicate = true; continue; }
      if (current.some(folder => folder.path === pick.path) || added.some(folder => folder.path === pick.path)) continue;
      added.push({token: pick.token, path: pick.path, main: false});
    }
    if (added.length) await saveFolders([...current, ...added]);
    if (duplicate) setFolderError(copy.existingProject);
  }
  async function setMainFolder(folder: ProjectFolder) {
    await saveFolders(project.folders.map(item => ({path: item.path, main: item.path === folder.path})));
  }
  async function removeFolder(folder: ProjectFolder) {
    if (project.folders.length <= 1) return;
    const remaining = project.folders.filter(item => item.path !== folder.path).map(item => ({path: item.path, main: item.main}));
    if (remaining.length && !remaining.some(item => item.main)) remaining[0] = {...remaining[0], main: true};
    await saveFolders(remaining);
  }

  const inputPlaceholder = copy.web.inputPlaceholder.replace('{name}', project.name);
  // 附件占行时保持多行外框;否则按测量切换(web 同款)
  const composerMultiline = (attachments?.length ?? 0) > 0 || multiline;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-6 pb-16 pt-12 md:px-8">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <FolderIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground"/>
          <h1 className="truncate text-heading-lg text-foreground">{project.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={copy.web.moreActions}
                className="size-10 cursor-pointer rounded-full border-[var(--hairline-strong)] bg-transparent shadow-none hover:bg-muted"
                size="icon"
                variant="outline"
              >
                <MoreHorizontalIcon className="size-5"/>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={onEditProject}>
                <PencilIcon className="size-4"/>
                {copy.editProject}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onRemoveProject(project)}>
                <Trash2Icon className="size-4"/>
                {copy.removeProject}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {!project.available && main && <p className="mt-3 text-sm text-destructive" role="alert">{copy.unavailable}</p>}

      <form
        className={`composer-plain mt-8 grid min-h-14 grid-cols-[40px_minmax(0,1fr)_32px] items-center gap-x-2 border border-[var(--hairline-strong)] bg-card px-2 py-[7px] shadow-[var(--shadow-whisper)] ${composerMultiline ? 'gap-y-2 rounded-[28px]' : 'rounded-full'}`}
        onSubmit={submit}
        ref={composerRef}
      >
        {(attachments?.length ?? 0) > 0 && (
          <div className="col-span-3 col-start-1 row-start-1 flex flex-col gap-2">
            {attachments!.map((attachment, index) => (
              <span className="attachment-chip flex min-h-9 items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground" key={`${attachment.name}:${index}`}>
                {(() => {
                  const icon = attachment.ref && isImageAttachment(attachment.ref)
                    ? <AttachmentThumb cache={attachment.ref.cachePath!} name={attachment.name}
                        className="size-6 shrink-0 rounded-md object-cover"
                        fallbackClassName="grid size-6 shrink-0 place-items-center rounded-md bg-muted"/>
                    : <FileTypeIcon className="size-4 shrink-0" filename={attachment.name}/>;
                  return attachment.ref ? (
                    <button className="flex min-w-0 flex-1 items-center gap-2 text-left underline decoration-transparent underline-offset-2 transition-colors hover:decoration-foreground" onClick={() => onOpenAttachment(attachment.ref!)} title={attachment.name} type="button">
                      {icon}
                      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                    </button>
                  ) : (
                    <>{icon}<span className="min-w-0 flex-1 truncate">{attachment.name}</span></>
                  );
                })()}
                <Button aria-label={copy.removeAttachment} className="size-6 shrink-0 rounded-full" onClick={() => onRemoveAttachment(index)} size="icon-xs" type="button" variant="ghost">
                  <XIcon aria-hidden="true" className="size-3.5"/>
                </Button>
              </span>
            ))}
          </div>
        )}
        <div className="col-start-1 row-start-2">
          <AttachmentsMenu
            copy={copy.webChat}
            disabled={busy || !attachmentReady}
            onComputer={onPickAttachment}
            onLibrary={onOpenLibrary}
          />
        </div>
        <textarea
          aria-label={copy.web.startChatAction}
          className={`min-w-0 w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words bg-transparent py-2 text-base leading-6 outline-none placeholder:text-muted-foreground ${
            multiline && !attachments?.length ? 'col-span-3 col-start-1 row-start-1 px-3' : 'col-start-2 row-start-2'
          }`}
          maxLength={2000}
          onChange={event => setDraft(event.target.value)}
          onPaste={onPasteImage}
          onKeyDown={event => {
            // 显式处理 Enter:IME 组合中的 Enter 不触发发送
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          placeholder={inputPlaceholder}
          ref={textareaRef}
          rows={1}
          value={draft}
        />
        <Button
          aria-label={copy.web.startChatAction}
          className="col-start-3 row-start-2 size-8 shrink-0 rounded-full"
          disabled={!draft.trim() || busy}
          type="submit"
        >
          <ArrowUpIcon aria-hidden="true" className="size-4"/>
        </Button>
      </form>

      {feedback && <p className="mt-3 text-sm text-muted-foreground" role="status">{feedback}</p>}

      <nav className="mt-8 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-full bg-muted p-1">
          {([['chats', copy.web.chatsTab], ['sources', copy.web.sourcesTab]] as const).map(([value, label]) => (
            <button
              className={`cursor-pointer rounded-full px-4 py-1.5 text-sm transition-colors ${
                tab === value
                  ? 'bg-card font-medium text-foreground shadow-[var(--shadow-whisper)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              key={value}
              onClick={() => setTab(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'sources' && (
          <Button className="gap-1.5 text-muted-foreground" onClick={() => void addFolder()} size="sm" variant="ghost">
            <FolderPlusIcon aria-hidden="true" className="size-4"/>
            {copy.addFolder}
          </Button>
        )}
      </nav>

      {tab === 'chats' ? (
        <section className="mt-6">
          {projectChats.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{copy.web.emptyChatsHint}</p>
          ) : (
            <ul className="flex flex-col">
              {projectChats.map(chat => (
                <li key={chat.id}>
                  <div className="group flex items-center gap-4 border-b border-[var(--hairline-soft)] px-3 py-4 transition-colors hover:bg-muted/50">
                    <button className="min-w-0 flex-1 text-left" onClick={() => onOpenChat(chat.id)} type="button">
                      <span className="block truncate text-base font-medium text-foreground">{chat.title}</span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">{chat.summary ?? '—'}</span>
                    </button>
                    <span className="shrink-0 text-sm text-muted-foreground">{formatShortDate(chat.updatedAt, copy.dateLocale)}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label={copy.web.moreActions}
                          className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                          size="icon-sm"
                          variant="ghost"
                        >
                          <MoreHorizontalIcon className="size-4"/>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onSelect={() => onOpenChat(chat.id)}>{copy.web.openAction}</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onRenameChat(chat)}>{copy.renameChat}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteChat(chat)}>{copy.deleteChat}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="mt-6">
          <ul className="flex flex-col">
            {project.folders.map(folder => (
              <li key={folder.path}>
                <div className="group flex items-center gap-4 border-b border-[var(--hairline-soft)] px-3 py-4 transition-colors hover:bg-muted/50">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted">
                    <FolderIcon aria-hidden="true" className="size-5 text-muted-foreground"/>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-medium text-foreground">{folder.label}</span>
                      {folder.main && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{copy.mainBadge}</span>}
                      {!folder.available && <span className="shrink-0 text-xs text-destructive">{copy.unavailable}</span>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground" title={folder.path}>{folder.path}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {!folder.main && (
                      <Button className="h-8 px-2 text-[13px]" disabled={busy} onClick={() => void setMainFolder(folder)} size="sm" variant="ghost">{copy.setMain}</Button>
                    )}
                    <Button
                      aria-label={copy.reveal}
                      className="h-8 px-2 text-[13px]"
                      onClick={() => void window.desktop.revealProjectFolder(project.id, folder.path).catch(() => setFolderError(copy.failed))}
                      size="sm"
                      variant="ghost"
                    >
                      {copy.reveal}
                    </Button>
                    <Button
                      aria-label={copy.removeFolder}
                      className="h-8 px-2 text-[13px] text-muted-foreground hover:text-destructive"
                      disabled={busy || project.folders.length <= 1}
                      onClick={() => void removeFolder(folder)}
                      size="sm"
                      variant="ghost"
                    >
                      {copy.removeFolder}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">{copy.writeHint}</p>
          {folderError && <p className="mt-2 text-sm text-destructive" role="alert">{folderError}</p>}
        </section>
      )}
    </section>
  );
}
