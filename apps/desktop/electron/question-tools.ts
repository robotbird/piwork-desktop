import {defineTool} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import type {AgentQuestion,QuestionResponse} from '../shared/types.ts';

export type RequestQuestions=(id:string,questions:AgentQuestion[],signal?:AbortSignal)=>Promise<QuestionResponse>;

/** Only foreground sessions expose this tool; scheduled tasks never wait for a user. */
export function createQuestionTools(request:RequestQuestions){
 return [defineTool({
  name:'ask_user',label:'询问用户',
  description:'Ask the user for missing information or a decision needed to continue. Present one to five concise questions with optional choices. The user may select a choice, write a custom answer, skip, or dismiss. A skipped or cancelled answer is not consent. Do not use this tool for command or file permissions; those have a separate approval flow.',
  parameters:Type.Object({questions:Type.Array(Type.Object({
   id:Type.String({minLength:1,maxLength:64}),
   question:Type.String({minLength:1,maxLength:2000}),
   header:Type.Optional(Type.String({maxLength:80})),
   options:Type.Optional(Type.Array(Type.Object({label:Type.String({minLength:1,maxLength:200}),description:Type.Optional(Type.String({maxLength:500}))}),{maxItems:6})),
  }),{minItems:1,maxItems:5})}),
  execute:async(id,input,signal)=>{
   if(new Set(input.questions.map(question=>question.id)).size!==input.questions.length)throw new Error('Question ids must be unique');
   if(input.questions.some(question=>question.options&&new Set(question.options.map(option=>option.label)).size!==question.options.length))throw new Error('Option labels must be unique within each question');
   if(signal?.aborted)throw new Error('Question cancelled');
   const response=await request(id,input.questions,signal);
   return {content:[{type:'text' as const,text:JSON.stringify(response)}],details:undefined};
  },
 })];
}

/** Validate renderer replies against the pending request; discard unknown answer keys. */
export function validateQuestionResponse(questions:AgentQuestion[],value:unknown):QuestionResponse{
 if(!value||typeof value!=='object')throw new Error('Invalid question response');
 const input=value as QuestionResponse;
 if(!input.answers||typeof input.answers!=='object'||Array.isArray(input.answers)||input.cancelled!==undefined&&typeof input.cancelled!=='boolean')throw new Error('Invalid question response');
 const answers:Record<string,string|null>=Object.create(null);
 for(const question of questions){
  const answer=Object.hasOwn(input.answers,question.id)?input.answers[question.id]:null;
  if(answer!==null&&(typeof answer!=='string'||answer.length>10000))throw new Error('Invalid question answer');
  answers[question.id]=typeof answer==='string'?answer.trim()||null:null;
 }
 return {answers:{...answers},...(input.cancelled?{cancelled:true}:{})};
}
