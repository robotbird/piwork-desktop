import {CronExpressionParser} from 'cron-parser';
import type {ScheduleInput} from '../shared/types';
export function validateSchedule(input:ScheduleInput):ScheduleInput {
 if(!input||typeof input.name!=='string'||typeof input.prompt!=='string'||typeof input.cron!=='string'||typeof input.timezone!=='string'||(input.projectId!==null&&typeof input.projectId!=='string')||(input.skillId!=null&&typeof input.skillId!=='string')||(input.mcpId!=null&&typeof input.mcpId!=='string'))throw new Error('Invalid schedule');
 const name=input.name.trim(),prompt=input.prompt.trim(),cron=input.cron.trim(),timezone=input.timezone.trim();
 if(!name||name.length>100||!prompt||prompt.length>10000||cron.split(/\s+/).length!==5||/[H?]/i.test(cron))throw new Error('Invalid schedule');
 new Intl.DateTimeFormat('en',{timeZone:timezone}).format();
 CronExpressionParser.parse(cron,{tz:timezone,currentDate:new Date()}).next();
 return {name,prompt,cron,timezone,projectId:input.projectId,skillId:input.skillId??null,mcpId:input.mcpId??null};
}
export function nextSchedule(cron:string,timezone:string,after:number):number {
 return CronExpressionParser.parse(cron,{tz:timezone,currentDate:new Date(after)}).next().getTime();
}
export function dueState(nextAt:number,now:number,active:boolean):'future'|'run'|'missed'|'overlap' {
 if(nextAt>now)return 'future';
 if(active)return 'overlap';
 return now-nextAt>60000?'missed':'run';
}
