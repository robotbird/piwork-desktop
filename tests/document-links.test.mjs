import test from 'node:test';
import assert from 'node:assert/strict';
import {documentPath,projectDocumentPath,remarkDocumentLinks} from '../apps/desktop/src/chat/file-links.ts';

test('document references support spaces, Chinese, Office and file URLs, but reject remote and executable URLs',()=>{
  for(const ext of ['pptx','docx','xlsx','pdf','md','html','txt','csv','odt'])assert.equal(documentPath(`/Users/me/技术 报告.${ext}`),`/Users/me/技术 报告.${ext}`);
  assert.equal(documentPath('file:///Users/me/%E6%8A%A5%E5%91%8A.pdf'),'/Users/me/报告.pdf');
  for(const value of ['https://example.com/report.pdf','javascript:report.pdf','file://remote/report.pdf','//remote/report.pdf','renders/','run.sh'])assert.equal(documentPath(value),undefined);
});

test('Markdown paths become links while existing labels, code fences and external links survive',()=>{
  const code={type:'code',value:'/tmp/report.pdf'};
  const remote={type:'link',url:'https://example.com/report.pdf',children:[{type:'text',value:'remote'}]};
  const tree={type:'root',children:[{type:'paragraph',children:[
    {type:'inlineCode',value:'/Users/me/技术 报告.pptx'},
    {type:'text',value:' Generated: reports/result.xlsx，/tmp/报告.pdf。'},
    {type:'link',url:'reports/word.docx',children:[{type:'text',value:'Word report'}]},remote,
  ]},code]};
  remarkDocumentLinks()(tree);
  const links=tree.children[0].children.filter(node=>node.type==='link');
  assert.deepEqual(links.slice(0,-1).map(node=>documentPath(node.url)),['/Users/me/技术 报告.pptx','reports/result.xlsx','reports/word.docx']);
  assert.equal(links[2].children[0].value,'Word report');
  assert.deepEqual(tree.children[1],code);assert.deepEqual(links.at(-1),remote);
});

test('absolute paths resolve only within authorized project folders',()=>{
  const folders=[{path:'/Users/me/work',label:'Work'},{path:'/Users/me/work/sub',label:'Sub'}];
  assert.equal(projectDocumentPath('/Users/me/work/报告.pdf',folders),'Work/报告.pdf');
  assert.equal(projectDocumentPath('/Users/me/work/sub/report.pdf',folders),'Sub/report.pdf');
  assert.equal(projectDocumentPath('/Users/me/work-other/report.pdf',folders),undefined);
  assert.equal(projectDocumentPath('reports/report.pdf',folders),'reports/report.pdf');
});
