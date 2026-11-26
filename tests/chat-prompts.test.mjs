import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildDesktopSystemPrompt} from '../apps/desktop/electron/chat-prompts.ts';

const base={supportsImages:false,canRenderOffice:false,canAskUser:false};
const root=path.resolve('/project/main');
const folder={root,label:'main'};

test('desktop prompt only advertises native document operations when a file workspace exists',()=>{
 for(const scope of [{}, {projectRoots:[folder]}, {chatWorkspace:folder}]){
  const prompt=buildDesktopSystemPrompt({...base,...scope});
  const hasDocuments=!!(scope.projectRoots||scope.chatWorkspace);
  for(const tool of ['project_read','project_write','project_create_office','project_append_office'])assert.equal(prompt.includes(tool),hasDocuments,`${tool} in ${JSON.stringify(scope)}`);
  assert.doesNotMatch(prompt,/\b(?:deliver_file|image_gen|workbuddy-docx|workbuddy-sheetagent)\b/);
 }
});

test('visual verification guidance requires both image input and a rendering bridge',()=>{
 for(const supportsImages of [false,true])for(const canRenderOffice of [false,true]){
  const prompt=buildDesktopSystemPrompt({...base,chatWorkspace:folder,supportsImages,canRenderOffice});
  assert.equal(prompt.includes('use office_render'),supportsImages&&canRenderOffice);
  assert.equal(prompt.includes('layout was not visually checked'),!(supportsImages&&canRenderOffice));
 }
 assert(!buildDesktopSystemPrompt({...base,supportsImages:true,canRenderOffice:true}).includes('office_render'));
});

test('skill resources and command working directory match the explicitly selected workflow',()=>{
 const skillPath=path.resolve('/skills/office-routing/SKILL.md');
 const skillRoot=path.dirname(skillPath);
 const selected=buildDesktopSystemPrompt({...base,skillPath});
 const project=buildDesktopSystemPrompt({...base,skillPath,projectRoots:[folder]});
 assert(selected.includes(`skill directory: ${skillRoot}`));
 assert(selected.includes(`execution directory is ${skillRoot}`));
 assert(project.includes(`skill directory: ${skillRoot}`));
 assert(project.includes(`execution directory is ${root}`));
 const unselected=buildDesktopSystemPrompt(base);
 assert(!unselected.includes(skillRoot));
 assert(!unselected.includes('skill_read'));
 assert(!unselected.includes('skill_bash'));
});

test('only foreground sessions with a question bridge are instructed to call ask_user',()=>{
 assert(!buildDesktopSystemPrompt(base).includes('ask_user'));
 assert(buildDesktopSystemPrompt({...base,canAskUser:true}).includes('use ask_user'));
});
