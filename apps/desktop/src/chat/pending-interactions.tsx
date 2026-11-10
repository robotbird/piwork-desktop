import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {CheckIcon,ChevronDownIcon,ChevronLeftIcon,ChevronRightIcon,MessageCircleQuestionIcon,PencilIcon,ShieldAlertIcon,XIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {AgentQuestion,ApprovalDecision,ApprovalRequest,QuestionRequest,QuestionResponse} from '../../shared/types';
import './pending-interactions.css';

type InteractionDraft={approval?:string;question?:{index:number;drafts:Record<string,AnswerDraft>}};
type InteractionDrafts=Map<string,InteractionDraft>;
type PendingInteraction={kind:'approval';request:ApprovalRequest}|{kind:'question';request:QuestionRequest};

/** Keep concurrent foreground/background requests instead of replacing the visible request. */
export function usePendingInteractions(){
 const saved=useRef<InteractionDrafts>(new Map());
 const [pending,setPending]=useState<PendingInteraction[]>([]);
 useEffect(()=>{
  const add=(item:PendingInteraction)=>setPending(items=>items.some(current=>current.kind===item.kind&&current.request.id===item.request.id)?items:[...items,item]);
  const remove=(kind:PendingInteraction['kind'],id:string)=>{for(const key of saved.current.keys())if(key===`${kind}:${id}`||id==='*'&&key.startsWith(`${kind}:`))saved.current.delete(key);setPending(items=>items.filter(item=>item.kind!==kind||id!=='*'&&item.request.id!==id))};
  const off=[window.desktop.onApprovalRequest(request=>add({kind:'approval',request})),window.desktop.onApprovalClosed(id=>remove('approval',id)),window.desktop.onQuestionRequest(request=>add({kind:'question',request})),window.desktop.onQuestionClosed(id=>remove('question',id))];
  return()=>off.forEach(unsubscribe=>unsubscribe());
 },[]);
 const dismiss=(kind:PendingInteraction['kind'],id:string)=>{saved.current.delete(`${kind}:${id}`);setPending(items=>items.filter(item=>item.kind!==kind||item.request.id!==id))};
 return {pending,dismiss,saved:saved.current};
}

type PanelProps={language:'zh-CN'|'en';title:string;icon:ReactNode;onClose:()=>void;children:ReactNode;footer:ReactNode;navigation?:ReactNode;queued:number};
function InteractionPanel({language,title,icon,onClose,children,footer,navigation,queued}:PanelProps){
 const zh=language==='zh-CN';const titleId=useId();
 return <section className="interaction-panel" role="region" aria-labelledby={titleId}>
  <div className="interaction-header">
   <h2 id={titleId}>{icon}{title}</h2>
   {queued>0&&<span className="interaction-queued" role="status">{zh?`另有 ${queued} 项待处理`:`${queued} more pending`}</span>}
   <div className="interaction-navigation">{navigation}<Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label={zh?'关闭并取消':'Dismiss and cancel'}><XIcon aria-hidden="true"/></Button></div>
  </div>
  <div className="interaction-body">{children}</div>
  <div className="interaction-footer">{footer}</div>
 </section>;
}

type Choice={value:string;label:string;description?:string};
function InteractionChoices({choices,value,onChange,label}:{choices:Choice[];value:string;onChange:(value:string)=>void;label:string}){
 const name=useId();
 return <fieldset className="interaction-choices" onKeyDown={event=>{if(event.altKey||event.ctrlKey||event.metaKey)return;const index=Number(event.key)-1;if(/^[1-6]$/.test(event.key)&&choices[index]){event.preventDefault();onChange(choices[index].value);event.currentTarget.querySelectorAll<HTMLInputElement>('input')[index]?.focus()}}}><legend className="sr-only">{label}</legend>{choices.map((choice,index)=><label className="interaction-choice" key={choice.value}>
  <input type="radio" name={name} value={choice.value} checked={value===choice.value} onChange={()=>onChange(choice.value)}/>
  <span className="interaction-choice-number" aria-hidden="true">{index+1}</span>
  <span className="interaction-choice-copy"><span>{choice.label}</span>{choice.description&&<small>{choice.description}</small>}</span>
  {value===choice.value&&<CheckIcon className="interaction-choice-check" size={16} aria-hidden="true"/>}
 </label>)}</fieldset>;
}

/** Decode command JSON for reading; preserve all other parameters for review. */
function ApprovalPreview({request,zh}:{request:ApprovalRequest;zh:boolean}){
 let input:Record<string,unknown>|undefined;
 try{const parsed:unknown=JSON.parse(request.detail);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))input=parsed as Record<string,unknown>}catch{/* Plain text from a plugin is still reviewable. */}
 const command=typeof input?.command==='string'?input.command:null;
 const cwd=typeof input?.cwd==='string'?input.cwd:null;
 const [expanded,setExpanded]=useState(false);
 const extra=input?Object.fromEntries(Object.entries(input).filter(([key])=>key!=='command'&&key!=='cwd')):{};
 return <div className="interaction-preview">
  {cwd&&<p className="interaction-cwd" title={cwd}>{zh?'工作目录':'Working directory'}<span>{cwd}</span></p>}
  <pre tabIndex={0} className={expanded?'expanded':undefined}><code>{command??request.detail}</code></pre>
  <button className="interaction-preview-toggle" type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}><ChevronDownIcon size={13} aria-hidden="true"/>{expanded?(zh?'收起详情':'Collapse details'):(zh?'展开详情':'Expand details')}</button>
  {expanded&&command&&Object.keys(extra).length>0&&<pre tabIndex={0}><code>{JSON.stringify(extra,null,2)}</code></pre>}
 </div>;
}

function ApprovalCard({request,language,queued,onRespond,onFullAccess,saved}:{request:ApprovalRequest;language:'zh-CN'|'en';queued:number;onRespond:(id:string,decision:ApprovalDecision)=>void;onFullAccess:(id:string)=>void;saved:InteractionDraft}){
 const zh=language==='zh-CN';const [selected,setSelected]=useState(saved.approval??'');
 useEffect(()=>{saved.approval=selected},[saved,selected]);
 const local=request.name==='skill_bash';const project=request.name.startsWith('project_');
 const title=local?(zh?'本机命令确认':'Local command'):project?(zh?'文件操作确认':'File operation'):request.name;
 const choices:Choice[]=[{value:'allow',label:zh?'允许这一次':'Allow once'},...(request.key?[{value:'always',label:request.name.startsWith('mcp__')?(zh?'始终允许此工具':'Always allow this tool'):(zh?'始终允许此命令':'Always allow this command'),description:zh?'在本项目内生效':'Applies within this project'}]:[]),{value:'full',label:zh?'完全访问':'Full access',description:zh?'切换权限模式，之后的工具执行不再确认':'Change the permission mode; future tools run without confirmation'}];
 return <InteractionPanel language={language} title={title} icon={<ShieldAlertIcon size={17} aria-hidden="true"/>} onClose={()=>onRespond(request.id,'deny')} queued={queued} footer={<>
  <span className="interaction-footer-hint">{zh?'请选择后继续':'Choose an option to continue'}</span>
  <Button variant="outline" size="sm" type="button" onClick={()=>onRespond(request.id,'deny')}>{zh?'拒绝':'Deny'}</Button>
  <Button size="sm" type="button" disabled={!selected} onClick={()=>selected==='full'?onFullAccess(request.id):onRespond(request.id,selected as ApprovalDecision)}>{zh?'确认':'Continue'}</Button>
 </>}>
  {request.context&&<p className="interaction-context">{request.context}</p>}
  <p className="interaction-description">{local?(zh?'命令将在本机运行，可访问当前用户的文件和网络，不受系统沙箱限制。':'Runs locally without OS sandboxing, with access to your files and network.'):project?(zh?'请检查以下文件操作，确认后继续。':'Review the file operation before continuing.'):(zh?'请检查外部 MCP 工具请求的内容。':'Review the external MCP tool request.')}</p>
  <ApprovalPreview request={request} zh={zh}/>
  <InteractionChoices label={zh?'权限选项':'Permission options'} choices={choices} value={selected} onChange={setSelected}/>
 </InteractionPanel>;
}

type AnswerDraft={selected:string;custom:string};
function QuestionCard({request,language,queued,onRespond,saved}:{request:QuestionRequest;language:'zh-CN'|'en';queued:number;onRespond:(id:string,response:QuestionResponse)=>void;saved:InteractionDraft}){
 const zh=language==='zh-CN';const [index,setIndex]=useState(saved.question?.index??0);
 const [drafts,setDrafts]=useState<Record<string,AnswerDraft>>(saved.question?.drafts??{});
 useEffect(()=>{saved.question={index,drafts}},[saved,index,drafts]);
 const question:AgentQuestion=request.questions[index];
 const draft=Object.hasOwn(drafts,question.id)?drafts[question.id]:{selected:'',custom:''};
 const answerFor=(id:string)=>Object.hasOwn(drafts,id)?drafts[id].custom.trim()||drafts[id].selected||null:null;
 const update=(value:AnswerDraft)=>setDrafts(current=>({...current,[question.id]:value}));
 const last=index===request.questions.length-1;
 const answer=draft.custom.trim()||draft.selected||null;
 const advance=(value:string|null)=>{
  if(last){
   const answers=Object.fromEntries(request.questions.map(item=>[item.id,item.id===question.id?value:answerFor(item.id)]));
   onRespond(request.id,{answers});
  }else setIndex(index+1);
 };
 return <InteractionPanel language={language} title={zh?'问题':'Question'} icon={<MessageCircleQuestionIcon size={17} aria-hidden="true"/>} queued={queued} onClose={()=>onRespond(request.id,{answers:{},cancelled:true})} navigation={request.questions.length>1&&<>
  <Button variant="ghost" size="icon-sm" type="button" disabled={index===0} onClick={()=>setIndex(index-1)} aria-label={zh?'上一个问题':'Previous question'}><ChevronLeftIcon aria-hidden="true"/></Button>
  <span className="interaction-page" aria-live="polite">{index+1} / {request.questions.length}</span>
  <Button variant="ghost" size="icon-sm" type="button" disabled={last} onClick={()=>setIndex(index+1)} aria-label={zh?'下一个问题':'Next question'}><ChevronRightIcon aria-hidden="true"/></Button>
 </>} footer={<>
  <div className="interaction-reply"><PencilIcon size={16} aria-hidden="true"/><textarea aria-label={zh?'自行撰写回复':'Write your own answer'} placeholder={zh?'或自行撰写回复':'Or write your own answer'} value={draft.custom} maxLength={10000} rows={1} onChange={event=>update({selected:'',custom:event.target.value})} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(answer)advance(answer)}}}/></div>
  <Button variant="outline" size="sm" type="button" onClick={()=>{update({selected:'',custom:''});advance(null)}}>{zh?'跳过':'Skip'}</Button>
  <Button size="sm" type="button" disabled={!answer} onClick={()=>advance(answer)}>{last?(zh?'提交':'Submit'):(zh?'下一步':'Next')}</Button>
 </>}>
  {question.header&&<p className="interaction-context">{question.header}</p>}
  <h3 className="interaction-prompt">{question.question}</h3>
  {!!question.options?.length&&<InteractionChoices label={question.question} choices={question.options.map(option=>({value:option.label,...option}))} value={draft.selected} onChange={value=>update({selected:value,custom:''})}/>}
 </InteractionPanel>;
}

export function PendingInteractionDock({pending,language,onApproval,onFullAccess,onQuestion,saved}:{pending:PendingInteraction[];language:'zh-CN'|'en';onApproval:(id:string,decision:ApprovalDecision)=>void;onFullAccess:(id:string)=>void;onQuestion:(id:string,response:QuestionResponse)=>void;saved:InteractionDrafts}){
 const current=pending[0];
 if(!current)return null;
 // Keep each card mounted while it waits in the queue so answers survive new requests.
 const state=(key:string)=>{if(!saved.has(key))saved.set(key,{});return saved.get(key)!};
 return <div className="pending-interactions"><p className="sr-only" role="status">{language==='zh-CN'?'等待你的确认或回复':'Waiting for your confirmation or reply'}</p>{pending.map((item,index)=><div hidden={index!==0} key={`${item.kind}:${item.request.id}`}>{item.kind==='approval'?<ApprovalCard saved={state(`approval:${item.request.id}`)} request={item.request} language={language} queued={pending.length-1} onRespond={onApproval} onFullAccess={onFullAccess}/>:<QuestionCard saved={state(`question:${item.request.id}`)} request={item.request} language={language} queued={pending.length-1} onRespond={onQuestion}/>}</div>)}</div>;
}
