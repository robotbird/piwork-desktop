import {useEffect,useState} from 'react';
import {ChevronDownIcon,FileTextIcon,FilePlus2Icon,Loader2Icon,SearchIcon,TerminalIcon,WrenchIcon,XCircleIcon} from 'lucide-react';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '@/components/ui/collapsible';
import {FileTypeIcon} from '@/components/documents/file-type-icon';
import type {ToolEvent} from '../../shared/types';

export type ToolGroupCopy={
  browse:string;
  run:string;
  write:string;
  tools:string;
  files:(count:number)=>string;
  searches:(count:number)=>string;
  fetches:(count:number)=>string;
  commands:(count:number)=>string;
  writes:(count:number)=>string;
  calls:(count:number)=>string;
  join:(parts:string[])=>string;
};
export type ToolActivityCopy={
  label:string;
  running:string;
  completed:string;
  failed:string;
  reasons:Record<NonNullable<ToolEvent['reason']>,string>;
  names:Record<string,string>;
  params:string;
  output:string;
  expandAll:string;
  collapseAll:string;
  showLess:string;
  moreLines:(count:number)=>string;
  groups:ToolGroupCopy;
};

function toolDisplayName(event:ToolEvent,copy:ToolActivityCopy):string{
  return copy.names[event.name]??(event.name.startsWith('mcp__')?event.name.slice(5).replaceAll('__','/'):event.name);
}
function safeJson(value:unknown):string{
  try{const text=JSON.stringify(value,null,2);return text===undefined?String(value):text}catch{return String(value)}
}
function firstLine(text:string):string{const index=text.indexOf('\n');return index===-1?text:text.slice(0,index)}
function truncate(text:string,max:number):string{return text.length<=max?text:`${text.slice(0,Math.max(max-3,1))}...`}
/* Keep the first command line; CSS clips the summary to the available width. */
function summarize(event:ToolEvent):string{
  const args=event.args;
  if(typeof args?.command==='string'&&args.command)return `$ ${firstLine(args.command)}`;
  if(typeof args?.path==='string'&&args.path)return args.path;
  if(typeof args?.query==='string'&&args.query)return args.query;
  if(typeof args?.pattern==='string'&&args.pattern)return args.pattern;
  if(args){
    const joined=Object.entries(args).filter(([,value])=>value!==undefined&&value!==null)
      .map(([key,value])=>`${key}="${typeof value==='string'?value:safeJson(value)}"`).join(' ');
    if(joined)return truncate(joined,100);
  }
  return '';
}
/* 耗时格式对齐 pi 的 formatToolDuration:4.2s / 1m 30s / 2h 3m 4s */
function formatDuration(ms:number):string{
  if(ms<1000)return `${Math.max(Math.round(ms),0)}ms`;
  const seconds=ms/1000;
  if(seconds<60)return `${seconds.toFixed(1)}s`;
  const total=Math.floor(seconds);
  const hours=Math.floor(total/3600);
  const minutes=Math.floor(total%3600/60);
  return hours?`${hours}h ${minutes}m ${total%60}s`:`${minutes}m ${total%60}s`;
}
/* 运行中行每秒刷新已耗时(pi 的 Elapsed 计时);结束后停表改用 durationMs */
function useElapsed(startedAt:number|undefined,active:boolean):number|undefined{
  const [,setTick]=useState(0);
  useEffect(()=>{
    if(!active||!startedAt)return;
    const timer=window.setInterval(()=>setTick(value=>value+1),1000);
    return()=>window.clearInterval(timer);
  },[active,startedAt]);
  return active&&startedAt?Date.now()-startedAt:undefined;
}

/* 工具分组分类与 ZCode 式组标签:统一查阅类→「查阅 · 2 文件」;含命令→「执行 · …」;含写入→「写入 · …」;
   未知工具或命令+写入混合→「工具执行 · N」 */
type ToolCategory='files'|'searches'|'fetches'|'commands'|'writes'|'calls';
const CATEGORY_ORDER:ToolCategory[]=['files','searches','fetches','commands','writes','calls'];
function categorize(event:ToolEvent):ToolCategory{
  const name=event.name;
  if(name==='skill_bash'||name==='bash'||name==='powershell')return 'commands';
  if(name==='skill_read'||name==='project_read'||name==='project_list')return 'files';
  if(name==='project_write'||name==='project_create_office')return 'writes';
  const lower=name.toLowerCase();
  if(typeof event.args?.query==='string'||lower.includes('search'))return 'searches';
  if(typeof event.args?.url==='string'||/fetch|reader|extract|browse/.test(lower))return 'fetches';
  return 'calls';
}
function groupPrefix(events:ToolEvent[]):'browse'|'run'|'write'|'tools'{
  const categories=new Set(events.map(categorize));
  const hasCommands=categories.has('commands');
  const hasWrites=categories.has('writes');
  if(categories.has('calls')||(hasCommands&&hasWrites))return 'tools';
  if(categories.size>0&&[...categories].every(category=>category==='files'||category==='searches'||category==='fetches'))return 'browse';
  if(hasCommands)return 'run';
  return 'write';
}
function groupLabel(events:ToolEvent[],copy:ToolGroupCopy):string{
  const prefix=groupPrefix(events);
  if(prefix==='tools')return `${copy.tools} · ${events.length}`;
  const counts=new Map<ToolCategory,number>();
  for(const event of events){const category=categorize(event);counts.set(category,(counts.get(category)??0)+1)}
  const units={files:copy.files,searches:copy.searches,fetches:copy.fetches,commands:copy.commands,writes:copy.writes,calls:copy.calls};
  const parts=CATEGORY_ORDER.filter(category=>counts.has(category)).map(category=>units[category](counts.get(category)!));
  const word=prefix==='browse'?copy.browse:prefix==='run'?copy.run:copy.write;
  return `${word} · ${parts.length===1?parts[0]!:copy.join(parts)}`;
}

function ToolRow({event,copy,open,onToggle,onOpenFile}:{
  event:ToolEvent;copy:ToolActivityCopy;open:boolean;onToggle:(id:string,open:boolean)=>void;onOpenFile?:(path:string)=>void;
}){
  const [fullOutput,setFullOutput]=useState(false);
  const args=event.args;
  const entries=Object.entries(args??{}).filter(([key,value])=>value!==undefined&&key!=='command');
  const command=typeof args?.command==='string'?args.command:'';
  const failed=event.status==='failed';
  const elapsed=useElapsed(event.startedAt,event.status==='running');
  const duration=event.status==='running'?elapsed:event.durationMs;
  const summary=summarize(event);
  const result=event.result;
  const lines=result?result.split('\n'):[];
  const previewLines=command?5:10;
  const preview=command?lines.slice(-previewLines):lines.slice(0,previewLines);
  const hiddenLines=lines.length-preview.length;
  const shownLines=fullOutput?lines:preview;
  const path=event.path;
  const canOpen=path&&onOpenFile&&event.status==='completed'&&
    (event.name==='project_write'||event.name==='project_create_office');
  const category=categorize(event);
  const ActionIcon=category==='commands'?TerminalIcon:category==='writes'?FilePlus2Icon:category==='files'?FileTextIcon:category==='searches'||category==='fetches'?SearchIcon:WrenchIcon;
  const statusText=event.status==='running'?copy.running:failed?(event.reason?copy.reasons[event.reason]:copy.failed):copy.completed;
  return (
    <li>
      <Collapsible className="conversation-tool-item" data-status={event.status} onOpenChange={next=>onToggle(event.id,next)} open={open}>
        <CollapsibleTrigger className="conversation-tool-item-trigger group" title={statusText}>
          {event.status==='running'
            ?<Loader2Icon aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-muted-foreground"/>
            :failed
              ?<XCircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-destructive"/>
              :<ActionIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground"/>}
          <span className="conversation-tool-name">{toolDisplayName(event,copy)}</span>
          {summary&&<code className="conversation-tool-summary">{summary}</code>}
          <span className="conversation-tool-duration">
            {duration!==undefined&&formatDuration(duration)}
            <span className="sr-only"> · {statusText}</span>
          </span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"/>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="conversation-tool-detail">
            {failed&&<p className="conversation-tool-error">{statusText}</p>}
            {(command||entries.length>0)&&(
              <section className="conversation-tool-io">
                <p className="conversation-tool-io-label">{copy.params}</p>
                {command&&<pre className="conversation-tool-code">$ {command}</pre>}
                {entries.length>0&&(
                  <dl className="conversation-tool-args">
                    {entries.map(([key,value])=>(
                      <div className="conversation-tool-arg" key={key}>
                        <dt>{key}</dt>
                        <dd>
                          {key==='path'&&canOpen
                            ?<button className="tool-file-link inline-flex items-center gap-1" type="button" onClick={()=>onOpenFile(path)}>
                                <FileTypeIcon className="size-3.5 shrink-0" filename={path}/>
                                <span>{path}</span>
                              </button>
                            :<pre className="conversation-tool-code">{typeof value==='string'?value:safeJson(value)}</pre>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )}
            {result&&(
              <section className="conversation-tool-io">
                <p className="conversation-tool-io-label">{copy.output}</p>
                <pre className="conversation-tool-code" data-failed={failed||undefined}>{shownLines.join('\n')}</pre>
                {fullOutput
                  ?<button className="conversation-tool-more" type="button" onClick={()=>setFullOutput(false)}>{copy.showLess}</button>
                  :hiddenLines>0&&<button className="conversation-tool-more" type="button" onClick={()=>setFullOutput(true)}>{copy.moreLines(hiddenLines)}</button>}
              </section>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/* 工具组(ZCode 式):组头一行「查阅 · 2 文件 ⌄」,展开为子工具行(子行可再展开参数/输出) */
export function ToolActivity({events,copy,onOpenFile}:{
  events:ToolEvent[];
  copy:ToolActivityCopy;
  onOpenFile?:(path:string)=>void;
}) {
  const [openIds,setOpenIds]=useState<ReadonlySet<string>>(()=>new Set());
  const toggle=(id:string,open:boolean)=>setOpenIds(current=>{
    const next=new Set(current);
    if(open)next.add(id);else next.delete(id);
    return next;
  });
  const running=events.some(event=>event.status==='running');
  const prefix=groupPrefix(events);
  const HeaderIcon=running?Loader2Icon:prefix==='browse'?SearchIcon:prefix==='run'?TerminalIcon:prefix==='write'?FilePlus2Icon:WrenchIcon;
  const label=groupLabel(events,copy.groups);

  return (
    <div className="conversation-tools">
      <Collapsible aria-label={label} className="conversation-tool-panel group" role="group">
        <CollapsibleTrigger className="conversation-tool-trigger">
          <HeaderIcon aria-hidden="true" className={running?'animate-spin':''} size={15}/>
          <span>{label}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 transition-transform group-data-[state=open]:rotate-180"/>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="conversation-tool-list">
            {events.map(event=>(
              <ToolRow copy={copy} event={event} key={event.id} onOpenFile={onOpenFile}
                onToggle={toggle} open={openIds.has(event.id)}/>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
