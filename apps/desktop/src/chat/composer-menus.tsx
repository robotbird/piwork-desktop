import {useRef, useState} from 'react';
import {
  CheckIcon, ChevronDownIcon, CpuIcon, FolderIcon, HandIcon, LibraryBigIcon, PaperclipIcon,
  PlusIcon, ShieldCheckIcon, ZapIcon,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {DropdownMenu as DropdownMenuPrimitive} from 'radix-ui';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {cn} from '@/lib/utils';
import enMessages from '@/i18n/messages/en.json';
import type {PermissionMode} from '../../shared/types';

type Copy = typeof enMessages.chat;
type Model = {value:string;name:string;providerKey?:string};
export type PermissionMenuCopy={
  label:string;
  modes:{value:PermissionMode;title:string;hint:string}[];
};

const providerIcons = import.meta.glob<string>('../brand/images/model-providers/*.svg', {
  eager: true, query: '?url', import: 'default',
});

export function AttachmentsMenu({copy, disabled, onComputer, onLibrary}: {
  copy:Copy; disabled:boolean; onComputer:()=>void; onLibrary:()=>void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={copy.uploadMenu}
          className="composer-plus size-10 rounded-full p-0 text-foreground hover:bg-muted focus-visible:bg-muted data-[state=open]:bg-muted"
          disabled={disabled}
          size="icon"
          type="button"
          variant="ghost"
        >
          <PlusIcon className="size-5"/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(420px,calc(100vw-32px))] rounded-2xl p-2" side="bottom" sideOffset={12}>
        <DropdownMenuItem className="gap-3 rounded-xl px-3 py-3" onSelect={onComputer}>
          <PaperclipIcon className="size-5"/>
          <span>{copy.uploadMenu}</span>
          <span className="text-muted-foreground">{copy.uploadFromComputer}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-3 rounded-xl px-3 py-3" onSelect={onLibrary}>
          <LibraryBigIcon className="size-5"/>
          <span>{copy.pickDocuments}</span>
          <span className="text-muted-foreground">{copy.browseDocuments}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* 工具权限模式下拉(对齐 ZCode 权限选择器):pill 触发器显示当前档位,菜单项为图标+标题+副标题两行 */
const permissionIcons={confirm:HandIcon,auto:ShieldCheckIcon,full:ZapIcon} as const;

export function ComposerPermissionMenu({copy, disabled, value, onChange, onFocusInput}: {
  copy:PermissionMenuCopy; disabled?:boolean; value:PermissionMode;
  onChange:(mode:PermissionMode)=>void; onFocusInput:()=>void;
}) {
  const focusInputOnClose=useRef(false);
  const selected=copy.modes.find(mode=>mode.value===value)??copy.modes[0]!;
  const SelectedIcon=permissionIcons[selected.value];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`${copy.label}: ${selected.title}`}
          className="h-8 max-w-[150px] gap-1.5 rounded-full border-0 bg-muted px-3 text-[13px] font-normal text-foreground shadow-none hover:bg-secondary aria-expanded:bg-muted focus-visible:bg-muted dark:bg-transparent dark:hover:bg-white/5 dark:aria-expanded:bg-transparent"
          disabled={disabled}
          title={selected.title}
          type="button"
          variant="ghost"
        >
          <SelectedIcon aria-hidden="true" className="size-[15px] shrink-0"/>
          <span className="min-w-0 flex-1 truncate text-left">{selected.title}</span>
          <ChevronDownIcon className="size-[13px] shrink-0 text-muted-foreground"/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={copy.label}
        className="w-[min(300px,calc(100vw-2rem))] rounded-2xl border-border/60 bg-card/95 p-2.5 shadow-[var(--shadow-float)] backdrop-blur-xl"
        onCloseAutoFocus={event=>{
          if (!focusInputOnClose.current) return;
          focusInputOnClose.current=false;
          event.preventDefault();
          onFocusInput();
        }}
        side="top"
        sideOffset={8}
      >
        <DropdownMenuRadioGroup onValueChange={next=>onChange(next as PermissionMode)} value={value}>
          {copy.modes.map(mode=>{
            const Icon=permissionIcons[mode.value];
            return (
              <DropdownMenuPrimitive.RadioItem
                className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] outline-none data-[highlighted]:bg-muted data-[state=checked]:bg-muted"
                key={mode.value}
                onSelect={()=>{focusInputOnClose.current=true}}
                textValue={mode.title}
                value={mode.value}
              >
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0"/>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                  <span className="font-medium">{mode.title}</span>
                  <span className="text-muted-foreground">{mode.hint}</span>
                </span>
                <DropdownMenuPrimitive.ItemIndicator>
                  <CheckIcon aria-hidden="true" className="mt-0.5 size-4"/>
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.RadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ComposerModelMenu({copy, disabled, label, models, value, configure, onConfigure, onChange, onFocusInput}: {
  copy:Copy; disabled:boolean; label:string; models:Model[]; value:string; configure:string;
  onConfigure:()=>void; onChange:(value:string)=>void; onFocusInput:()=>void;
}) {
  const focusInputOnClose=useRef(false);
  const selected=models.find(model=>model.value===value);
  const name=selected?.name ?? copy.noModelConfigured;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`${label}: ${name}`}
          className="composer-model-trigger ml-auto h-8 max-w-[156px] gap-1 rounded-full border-0 bg-muted px-3 text-[13px] font-normal text-foreground shadow-none hover:bg-secondary aria-expanded:bg-muted dark:bg-transparent dark:hover:bg-white/5 dark:aria-expanded:bg-transparent"
          disabled={disabled}
          title={name}
          type="button"
          variant="ghost"
        >
          <span className="min-w-0 flex-1 truncate text-left">{name}</span>
          <ChevronDownIcon className="size-[13px] text-muted-foreground"/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={label}
        className="max-h-[min(410px,60vh,var(--radix-dropdown-menu-content-available-height))] w-[min(288px,calc(100vw-2rem))] rounded-2xl border-border/60 bg-card/95 p-2.5 shadow-[var(--shadow-float)] backdrop-blur-xl"
        onCloseAutoFocus={event=>{
          if (!focusInputOnClose.current) return;
          focusInputOnClose.current=false;
          event.preventDefault();
          onFocusInput();
        }}
        side="top"
        sideOffset={8}
      >
        {models.length ? (
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {models.map(model=>{
              const icon=providerIcons[`../brand/images/model-providers/${model.providerKey}.svg`];
              return (
                <DropdownMenuPrimitive.RadioItem
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none data-[highlighted]:bg-muted data-[state=checked]:bg-muted"
                  key={model.value}
                  onSelect={()=>{focusInputOnClose.current=true}}
                  textValue={model.name}
                  value={model.value}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-muted ring-1 ring-border/50">
                    {icon ? <img alt="" className="size-full" src={icon}/> : <CpuIcon aria-hidden="true" className="size-3 text-muted-foreground"/>}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left font-medium">{model.name}</span>
                  <DropdownMenuPrimitive.ItemIndicator><CheckIcon aria-hidden="true" className="size-4"/></DropdownMenuPrimitive.ItemIndicator>
                </DropdownMenuPrimitive.RadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        ) : (
          <>
            <p className="px-3 py-3 text-center text-[13px] text-muted-foreground">{copy.noModelConfigured}</p>
            <DropdownMenuItem onSelect={onConfigure}>{configure}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ComposerProjectMenu({copy, disabled, projects, selected, onChange}: {
  copy:Copy; disabled:boolean; projects:{id:string;name:string}[];
  selected:{id:string;name:string}|undefined; onChange:(id:string|null)=>void;
}) {
  const [open,setOpen]=useState(false);
  function pick(id:string|null) {
    setOpen(false);
    if (id!==selected?.id) onChange(id);
  }
  return (
    <div className="composer-project">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            aria-label={copy.chooseProject}
            className={cn(
              'flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-background hover:text-foreground data-[state=open]:bg-background data-[state=open]:text-foreground',
              selected && 'bg-background/70 font-medium text-foreground',
            )}
            disabled={disabled}
            type="button"
          >
            <FolderIcon aria-hidden="true" className="size-[18px] shrink-0"/>
            <span className="max-w-[180px] truncate">{selected?.name ?? copy.project}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={copy.chooseProject} className="composer-project-panel w-72 p-1.5" side="top" sideOffset={8}>
          {projects.length ? (
            <div className="max-h-[260px] overflow-y-auto">
              {projects.map(project=>(
                <button
                  aria-pressed={project.id===selected?.id}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted aria-pressed:bg-muted"
                  key={project.id}
                  onClick={()=>pick(project.id)}
                  type="button"
                >
                  <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground"/>
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {project.id===selected?.id && <CheckIcon aria-hidden="true" className="size-4 shrink-0"/>}
                </button>
              ))}
            </div>
          ) : <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{copy.noProjectsYet}</p>}
          {selected && (
            <>
              <div className="mx-2 my-1 h-px bg-border"/>
              <button className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={()=>pick(null)} type="button">
                {copy.clearProjectSelection}
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
