import {useEffect,useState,type ReactNode} from 'react';
import {ChevronRightIcon} from 'lucide-react';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '@/components/ui/collapsible';
import {formatThinkingDuration} from '@/lib/chat/reasoning-duration';

export type ProcessCopy={processing:string;processed:string;processLabel:string;stepLabel:string};

export function Processing({startedAt,durationMs,active,copy,children}:{
  startedAt?:number;durationMs?:number;active:boolean;copy:ProcessCopy;children?:ReactNode;
}){
  const [,tick]=useState(0);
  const [open,setOpen]=useState(active);
  useEffect(()=>setOpen(active),[active]);
  useEffect(()=>{
    if(!active||startedAt===undefined)return;
    const timer=window.setInterval(()=>tick(value=>value+1),1000);
    return()=>window.clearInterval(timer);
  },[active,startedAt]);
  const elapsed=active&&startedAt!==undefined?Math.max(0,Date.now()-startedAt):durationMs;
  const label=elapsed===undefined?copy.processLabel:(active?copy.processing:copy.processed).replace('{duration}',formatThinkingDuration(elapsed));
  return <Collapsible className="conversation-processing" open={open} onOpenChange={setOpen}>
    {children?<CollapsibleTrigger className="conversation-processing-trigger">
      <span>{label}</span><ChevronRightIcon aria-hidden="true" className="conversation-disclosure size-3.5"/>
    </CollapsibleTrigger>:<div className="conversation-processing-trigger">{label}</div>}
    {children&&<CollapsibleContent className="conversation-processing-steps" aria-label={copy.processLabel}>{children}</CollapsibleContent>}
  </Collapsible>;
}
