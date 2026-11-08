import {ChevronDownIcon, Clock3Icon, WrenchIcon} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {FileTypeIcon} from '@/components/documents/file-type-icon';
import type {ToolEvent} from '../../shared/types';

export type ToolActivityCopy={
  label:string;
  running:string;
  completed:string;
  failed:string;
  reasons:Record<NonNullable<ToolEvent['reason']>,string>;
  names:Record<string,string>;
};

export function ToolActivity({events,copy,onOpenFile}:{
  events:ToolEvent[];
  copy:ToolActivityCopy;
  onOpenFile?:(path:string)=>void;
}) {
  const active=events.findLast(event=>event.status==='running');
  const name=(event:ToolEvent)=>copy.names[event.name]??
    (event.name.startsWith('mcp__')?event.name.slice(5).replaceAll('__','/'):event.name);

  return (
    <div className="conversation-tools">
      {active&&(
        <p className="conversation-tool-progress" role="status">
          <Clock3Icon aria-hidden="true" size={14}/>
          <span>{copy.running} · {name(active)}{active.path&&' · '+active.path}</span>
        </p>
      )}
      <Collapsible aria-label={copy.label} className="conversation-tool-panel group" role="group">
        <CollapsibleTrigger className="conversation-tool-trigger">
          <WrenchIcon aria-hidden="true" size={15}/>
          <span>{copy.label}</span>
          <Badge variant="secondary" className="rounded-full">{events.length}</Badge>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 transition-transform group-data-[state=open]:rotate-180"/>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="conversation-tool-list">
            {events.map(event=>{
              const path=event.path;
              const canOpen=path&&onOpenFile&&event.status==='completed'&&
                (event.name==='project_write'||event.name==='project_create_office');
              return (
                <li key={event.id}>
                  <span>{name(event)}</span>
                  {path&&(canOpen
                    ? <button className="tool-file-link inline-flex items-center gap-1" type="button" onClick={()=>onOpenFile(path)}>
                        <FileTypeIcon className="size-3.5 shrink-0" filename={path}/>
                        <span>{path}</span>
                      </button>
                    : <span className="text-muted-foreground">{path}</span>)}
                  <Badge variant={event.status==='failed'?'destructive':'secondary'} className="ml-auto rounded-full">
                    {event.status==='failed'&&event.reason?copy.reasons[event.reason]:copy[event.status]}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
