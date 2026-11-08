import {defineTool} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';

export type ScheduleCreateInput = {taskType:string;prompt:string;cron:string;timezone:string};

// Mirrors piwork/lib/ai/scheduled-task-tools.ts: the agent creates recurring
// tasks through this tool; the host (main process) owns validation and
// persistence, identity is never a model argument. No approval dialog — like
// the web tool it is a local, low-risk write the user explicitly requested.
export function createScheduleTools(requestCreate:(input:ScheduleCreateInput)=>Promise<void>){
 return [defineTool({name:'create_scheduled_task',label:'创建定时任务',description:'Create a recurring AI task when explicitly requested. Only report success after this tool succeeds. Does not send external notifications.',parameters:Type.Object({taskType:Type.String({description:'Short user-facing task title',minLength:1,maxLength:64}),prompt:Type.String({description:'Self-contained instructions to execute each time',minLength:1,maxLength:10000}),schedule:Type.Object({cron:Type.String({description:'Five-field cron, e.g. 0 9 * * 1-5'}),timezone:Type.String({description:'IANA timezone, default Asia/Shanghai'})})}),execute:async(_id,input)=>{await requestCreate({taskType:input.taskType,prompt:input.prompt,cron:input.schedule.cron,timezone:input.schedule.timezone});return {content:[{type:'text' as const,text:'Scheduled task created'}],details:undefined}}})];
}

// Desktop adaptation of the web schedulingPrompt (piwork/lib/ai/scheduled-task-tools.ts):
// same rules (recurring only, self-contained prompt, default timezone, report
// name/time/timezone on success) plus the desktop execution model note; the
// results live in the sidebar Scheduled tasks page instead of a /scheduled-tasks link.
export const schedulingPrompt='用户明确要求定时或周期执行工作时，使用 create_scheduled_task 创建任务，而不是仅口头承诺。默认时区 Asia/Shanghai；缺少执行时间时先询问。仅支持周期计划（每日、工作日、每周或 Cron），不支持一次性提醒、事件监测或邮件/推送通知；不要把一次性请求转为周期任务。执行提示词必须自包含，不假定能读取此前对话或文件。任务仅在本机应用运行时执行。工具成功后告知名称、时间、时区，并提示可在侧栏「定时任务」页面查看。当前时间：';
