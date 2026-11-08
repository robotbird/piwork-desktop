import type {ChatSummary} from '../shared/types';
export const isChatId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export function renameChat(chats:ChatSummary[],id:string,title:string):ChatSummary[]{
 if(!isChatId(id)||typeof title!=='string'||!title.trim()||title.trim().length>80)throw new Error('Invalid chat title');
 if(!chats.some(chat=>chat.id===id))throw new Error('Chat not found');
 return chats.map(chat=>chat.id===id?{...chat,title:title.trim()}:chat);
}
export function validateChatProject(projectId:unknown,projects:{id:string}[],chat?:ChatSummary):string|null {
 if(projectId!==null&&typeof projectId!=='string')throw new Error('Invalid project');
 if(chat){if((chat.projectId??null)!==projectId)throw new Error('Project cannot change during a chat');return projectId as string|null}
 if(projectId!==null&&!projects.some(project=>project.id===projectId))throw new Error('Project not found');
 return projectId as string|null;
}
