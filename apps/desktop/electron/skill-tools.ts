import path from 'node:path';
import {defineTool} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import {readBoundedText} from './project-files.ts';

/** Read only text files below the explicitly selected skill directory. */
export function createSkillTools(skillFile:string){
 const root=path.dirname(path.resolve(skillFile));
 return [defineTool({name:'skill_read',label:'Read skill resource',description:'Read a text resource belonging to the selected skill. Pass a path relative to the skill directory or an absolute path within it. Use this for references, templates, and script source. This tool cannot execute scripts.',parameters:Type.Object({path:Type.String({description:'Path within the selected skill directory'})}),execute:async(_id,{path:requested})=>{
  if(typeof requested!=='string'||!requested||requested.includes('\0'))throw new Error('Invalid skill path');
  const relative=path.isAbsolute(requested)?path.relative(root,path.resolve(requested)):requested;
  if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(piece=>!piece||piece==='.'||piece==='..'))throw new Error('Invalid skill path');
  const text=await readBoundedText(root,relative.split(path.sep).join('/'));
  return {content:[{type:'text' as const,text}],details:undefined};
 }})];
}
