import test from 'node:test';
import assert from 'node:assert/strict';
import {generateOffice} from '../apps/desktop/electron/office-generate.ts';

const magic=bytes=>Buffer.from(bytes).subarray(0,2).toString('ascii');

test('blocks build a structured Word document with cover, lists, tables and footer',async()=>{
 const bytes=await generateOffice('.docx',{title:'季度报告',doc:{footer:true,accent:'7C3AED'},blocks:[
  {type:'cover',subtitle:'自检与结论',meta:['2026-11-14','内部核查']},
  {type:'heading',level:1,text:'一、核查过程'},
  {type:'paragraph',runs:[{text:'已确认 '},{text:'queryIndex',code:true},{text:' 字段存在，',bold:true},{text:'见下表'}]},
  {type:'list',ordered:true,items:['第一项',{text:'第二项带',runs:[{text:'第二项',bold:true},{text:'带强调'}]}]},
  {type:'list',items:['要点甲','要点乙']},
  {type:'table',header:['字段','说明'],rows:[['id','主键'],['name','名称']]},
  {type:'quote',text:'引用内容'},
  {type:'code',text:'const value = verify();\nconsole.log(value);'},
  {type:'divider'},
  {type:'pageBreak'},
  {type:'heading',level:2,text:'二、结论',align:'center'},
  {type:'paragraph',text:'正文段落',align:'right'},
 ]});
 assert.equal(magic(bytes),'PK');
 assert.ok(bytes.byteLength>2000);
});

test('legacy paragraphs and rows keep generating all three formats',async()=>{
 assert.equal(magic(await generateOffice('.docx',{title:'T',paragraphs:['a','b'],rows:[['h1','h2'],['v1','v2']]})),'PK');
 assert.equal(magic(await generateOffice('.xlsx',{title:'T',rows:[['h1','h2'],['v1','v2']]})),'PK');
 assert.equal(magic(await generateOffice('.pptx',{title:'T',slides:[{title:'s1',body:'b1'}]})),'PK');
});

test('model-friendly shapes are normalized instead of rejected',async()=>{
 // 真实线上会话出现的写法:blocks 传 JSON 字符串、cover.meta 传单字符串、{code:"x"} 当文本、颜色带 #、level 传字符串
 const bytes=await generateOffice('.docx',{title:'ASR 核验结论',doc:{footer:true,accent:'#1F4E79'},blocks:JSON.stringify([
  {type:'cover',subtitle:'接入方式核验',meta:'整理日期：2026-11-14　|　来源：官方文档　|　用途：评估依据'},
  {type:'heading',level:'1',text:'一、核验过程'},
  {type:'paragraph',runs:[{text:'来源：'},{code:'qwen-asr-api-reference'},{text:'。'}]},
  {type:'paragraph'},                       // 空段落 = 空行
  {type:'paragraph',runs:[]},               // 空 runs 回落为空行
  {type:'paragraph',text:'runs 优先',runs:[{text:'富文本段落',bold:true,color:'#F00'}]},
  {type:'list',ordered:true,items:['第一条',{text:'第二条',runs:[{text:'混排',bold:true}]},{runs:[{text:'纯 runs 项'}]}]},
  {type:'table',header:['结论','优先级'],rows:[['成立','P0']]},
 ])});
 assert.equal(magic(bytes),'PK');
 assert.ok(bytes.byteLength>2000);
});

test('still-invalid blocks fail with located, actionable messages',async()=>{
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:[{type:'nope'}]}),/Invalid document content: blocks\[0\] has unknown type "nope"/);
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:[{type:'heading',level:9,text:'x'}]}),/blocks\[0\] \(heading\) level must be 1, 2 or 3/);
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:[{type:'heading',level:1}]}),/blocks\[0\] \(heading\) requires non-empty text/);
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:[{type:'list',items:[]}]}),/blocks\[0\] \(list\) requires a non-empty items array/);
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:[{type:'table'}]}),/blocks\[0\] \(table\) requires rows/);
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:'not json'}),/blocks was sent as a string that is not valid JSON/);
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:{}}),/blocks must be an array of block objects/);
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:[{type:'paragraph',runs:[{text:'b',color:'zzz'}]}]}),/run color "zzz" must be 3 or 6 hex digits/);
 await assert.rejects(generateOffice('.docx',{title:'T',blocks:[{type:'divider'}],doc:{accent:'nope'}}),/doc\.accent "nope" must be 3 or 6 hex digits/);
 await assert.rejects(generateOffice('.docx',{title:'',blocks:[{type:'divider'}]}),/Invalid document content/);
});
