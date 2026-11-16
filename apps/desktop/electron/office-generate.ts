import {AlignmentType,BorderStyle,Document,Footer,HeadingLevel,PageNumber,Packer,Paragraph,ShadingType,Table,TableCell,TableRow,TextRun,WidthType,type NumberingDefinition} from 'docx';
import {createWorkbook,addWorksheet} from '@office-kit/xlsx/workbook';
import {setCell} from '@office-kit/xlsx/worksheet';
import {workbookToBytes} from '@office-kit/xlsx/io';
import {createPresentation,addBlankSlide,addSlideTextBox,addSlideTable,inches,savePresentation} from '@office-kit/pptx';

/* Word 文档块状模型:模型用 blocks 描述结构(标题层级/富文本段落/列表/引用/代码/表格/封面/分页),
   生成端统一处理中西文配对字体(run.font.ascii+hAnsi+eastAsia,只设 ascii 不配 eastAsia 时中文
   会被 Word 按默认拉丁字体渲染)、强调色标题、页脚页码。旧参数 paragraphs/rows/slides 保持兼容,
   docx 分支映射为 blocks;xlsx/pptx 分支不消费 blocks/doc。
   blocks 先经 normalizeBlocks 归一化再校验:模型常见写法(blocks 传 JSON 字符串、cover.meta 传
   单字符串、行内代码写 {code:"x"}、颜色带 # 前缀、level 传字符串)都收敛为规范形状;仍不合法的
   输入抛带 blocks[i] 定位的错误,让模型一次修正而不是反复试错。 */

type Slide={title:string;body:string};
export type OfficeRun={text:string;bold?:boolean;italic?:boolean;code?:boolean;color?:string};
export type OfficeBlock=
 {type:'heading';level:1|2|3;text:string;align?:'left'|'center'}|
 {type:'paragraph';text?:string;runs?:OfficeRun[];align?:'left'|'center'|'right'}|
 {type:'list';ordered?:boolean;items:(string|{text?:string;runs?:OfficeRun[]})[]}|
 {type:'quote';text:string}|
 {type:'code';text:string}|
 {type:'table';header?:string[];rows:string[][]}|
 {type:'divider'}|
 {type:'pageBreak'}|
 {type:'cover';subtitle?:string;meta?:string[]};
export type OfficeDocOptions={footer?:boolean;accent?:string};
export type OfficeContent={title:string;paragraphs?:string[];rows?:string[][];slides?:Slide[];blocks?:OfficeBlock[]|string;doc?:OfficeDocOptions};

const ACCENT='1F4E79';
const BODY_FONT={ascii:'Georgia',hAnsi:'Georgia',eastAsia:'宋体'};
const HEAD_FONT={ascii:'Arial',hAnsi:'Arial',eastAsia:'微软雅黑'};
const CODE_FONT={ascii:'Consolas',hAnsi:'Consolas',eastAsia:'微软雅黑'};
const MUTED='595959',LINE='D9D9D9',CODE_BG='F2F2F2',HEAD_BG='EAF1F8';
const BLOCK_TYPES='heading|paragraph|list|quote|code|table|divider|pageBreak|cover';

/** 校验失败统一抛 Invalid document content(前缀保持旧契约),冒号后附定位细节 */
function invalid(detail:string):never{throw new Error(`Invalid document content: ${detail}`)}

/** 颜色归一化:去 # 前缀,3 位色值扩成 6 位;不合法返回 undefined */
function normalizeColor(value:unknown):string|undefined{
 if(typeof value!=='string')return undefined;
 const trimmed=value.trim().replace(/^#/,'');
 if(/^[0-9A-Fa-f]{3}$/.test(trimmed))return trimmed.split('').map(char=>char+char).join('').toUpperCase();
 return /^[0-9A-Fa-f]{6}$/.test(trimmed)?trimmed.toUpperCase():undefined;
}

/** 标题层级归一化:接受 1-3 数字、"1"-"3" 字符串 */
function normalizeLevel(value:unknown):1|2|3|undefined{
 const level=typeof value==='number'?value:typeof value==='string'&&/^\s*[123]\s*$/.test(value)?Number(value.trim()):NaN;
 return level===1||level===2||level===3?level:undefined;
}

/** run 归一化:字符串原样作文本;{code:"x"}(code 当文本字段)→ {text:"x",code:true};颜色去 # */
function normalizeRun(raw:unknown):OfficeRun|undefined{
 if(typeof raw==='string')return {text:raw};
 if(!raw||typeof raw!=='object')return undefined;
 const source=raw as Record<string,unknown>;
 let text:string|undefined=typeof source.text==='string'?source.text:undefined;
 const flags:{bold?:boolean;italic?:boolean;code?:boolean}={};
 for(const key of ['bold','italic','code'] as const){
  const value=source[key];
  if(value===true)flags[key]=true;
  else if(typeof value==='string'&&text===undefined){text=value;flags[key]=true}
 }
 if(text===undefined)return undefined;
 const color=normalizeColor(source.color);
 if(source.color!==undefined&&!color)invalid(`run color "${String(source.color)}" must be 3 or 6 hex digits, e.g. 1F4E79`);
 return {text,...flags,...(color?{color}:{})};
}

function normalizeRuns(raw:unknown):OfficeRun[]{
 if(!Array.isArray(raw))return [];
 return raw.map(normalizeRun).filter((run):run is OfficeRun=>run!==undefined);
}

/** 正文归一化(runs 优先,text 空串/缺省视为空行),返回供渲染的 text/runs */
function normalizeBody(block:Record<string,unknown>):{text?:string;runs?:OfficeRun[]}{
 const runs=normalizeRuns(block.runs);
 if(runs.length)return {runs};
 if(typeof block.text==='string')return {text:block.text};
 return {text:''}; // 空段落 = 空行
}

/** 单块归一化 + 校验;不合法时抛带 blocks[index] 定位的错误 */
function normalizeBlock(item:unknown,index:number):OfficeBlock{
 if(!item||typeof item!=='object')invalid(`blocks[${index}] must be an object with a type (${BLOCK_TYPES})`);
 const block=item as Record<string,unknown>;
 if(typeof block.type!=='string')invalid(`blocks[${index}] is missing "type" (${BLOCK_TYPES})`);
 const alignOf=(allowed:('left'|'center'|'right')[])=>allowed.includes(block.align as 'left'|'center'|'right')?block.align as 'left'|'center'|'right':undefined;
 switch(block.type){
  case 'heading':{
   const level=normalizeLevel(block.level)??invalid(`blocks[${index}] (heading) level must be 1, 2 or 3`);
   if(typeof block.text!=='string'||!block.text.trim())invalid(`blocks[${index}] (heading) requires non-empty text`);
   if(block.text.length>300)invalid(`blocks[${index}] (heading) text exceeds 300 characters`);
   const align=alignOf(['left','center']) as 'left'|'center'|undefined;
   return {type:'heading',level,text:block.text,...(align?{align}:{})};
  }
  case 'paragraph':{
   const body=normalizeBody(block);
   if(body.runs){
    if(body.runs.length>50)invalid(`blocks[${index}] (paragraph) exceeds 50 runs`);
    if(body.runs.reduce((total,run)=>total+run.text.length,0)>16000)invalid(`blocks[${index}] (paragraph) exceeds 16000 characters`);
   }else if((body.text??'').length>16000)invalid(`blocks[${index}] (paragraph) exceeds 16000 characters`);
   const align=alignOf(['left','center','right']);
   return {type:'paragraph',...body,...(align?{align}:{})} as OfficeBlock;
  }
  case 'list':{
   if(!Array.isArray(block.items)||!block.items.length)invalid(`blocks[${index}] (list) requires a non-empty items array`);
   if(block.items.length>100)invalid(`blocks[${index}] (list) exceeds 100 items`);
   const items=block.items.map((rawItem,itemIndex)=>{
    if(typeof rawItem==='string'){if(rawItem.length>4000)invalid(`blocks[${index}] (list) items[${itemIndex}] exceeds 4000 characters`);return rawItem}
    if(rawItem&&typeof rawItem==='object'){
     const body=normalizeBody(rawItem as Record<string,unknown>);
     if(body.runs){
      if(body.runs.length>50)invalid(`blocks[${index}] (list) items[${itemIndex}] exceeds 50 runs`);
      return {runs:body.runs};
     }
     if(typeof body.text==='string'){if(body.text.length>4000)invalid(`blocks[${index}] (list) items[${itemIndex}] exceeds 4000 characters`);return body.text}
    }
    invalid(`blocks[${index}] (list) items[${itemIndex}] must be a string, {text} or {runs}`);
   });
   return {type:'list',ordered:block.ordered===true,items};
  }
  case 'quote': case 'code':{
   if(typeof block.text!=='string'||!block.text.trim())invalid(`blocks[${index}] (${block.type}) requires non-empty text`);
   if(block.text.length>16000)invalid(`blocks[${index}] (${block.type}) exceeds 16000 characters`);
   return {type:block.type,text:block.text};
  }
  case 'table':{
   const cells=(container:unknown,label:string,max:number)=>{
    if(!Array.isArray(container)||!container.length)invalid(`blocks[${index}] (table) ${label} must be a non-empty array of strings`);
    if(container.length>max)invalid(`blocks[${index}] (table) ${label} exceeds ${max} cells`);
    return container.map((cell,cellIndex)=>{
     if(typeof cell==='string'||typeof cell==='number'||typeof cell==='boolean')return String(cell);
     invalid(`blocks[${index}] (table) ${label}[${cellIndex}] must be a string`);
    });
   };
   const rowsRaw=block.rows??invalid(`blocks[${index}] (table) requires rows`);
   if(!Array.isArray(rowsRaw)||rowsRaw.length>200)invalid(`blocks[${index}] (table) requires 1-200 rows`);
   const header=block.header===undefined?undefined:cells(block.header,'header',30);
   const rows=rowsRaw.map(row=>cells(row,'rows',30));
   return {type:'table',...(header?{header}:{}),rows};
  }
  case 'divider': return {type:'divider'};
  case 'pageBreak': return {type:'pageBreak'};
  case 'cover':{
   let subtitle:string|undefined;
   if(block.subtitle!==undefined){
    if(typeof block.subtitle!=='string')invalid(`blocks[${index}] (cover) subtitle must be a string`);
    if(block.subtitle.length>300)invalid(`blocks[${index}] (cover) subtitle exceeds 300 characters`);
    subtitle=block.subtitle;
   }
   let meta:string[]|undefined;
   if(block.meta!==undefined){
    // 单字符串(如 "日期…｜来源…")按一行元信息接受
    const list=typeof block.meta==='string'?[block.meta]:Array.isArray(block.meta)?block.meta:invalid(`blocks[${index}] (cover) meta must be a string or an array of strings`);
    if(list.length>6)invalid(`blocks[${index}] (cover) meta exceeds 6 entries`);
    meta=list.map((entry,entryIndex)=>{
     if(typeof entry!=='string'||!entry)invalid(`blocks[${index}] (cover) meta[${entryIndex}] must be a non-empty string`);
     if(entry.length>100)invalid(`blocks[${index}] (cover) meta[${entryIndex}] exceeds 100 characters`);
     return entry;
    });
   }
   return {type:'cover',...(subtitle!==undefined?{subtitle}:{}),...(meta?{meta}:{})};
  }
  default: invalid(`blocks[${index}] has unknown type "${block.type}" (${BLOCK_TYPES})`);
 }
}

/** blocks 入口归一化:接受数组或 JSON 字符串;逐块归一化并校验 */
function normalizeBlocks(raw:unknown):OfficeBlock[]{
 const source=typeof raw==='string'
  ?(()=>{try{return JSON.parse(raw)as unknown}catch{invalid('blocks was sent as a string that is not valid JSON — send the array itself or a JSON-encoded array')}})()
  :raw;
 if(!Array.isArray(source))invalid(`blocks must be an array of block objects (${BLOCK_TYPES})`);
 if(source.length>500)invalid(`blocks exceeds 500 items`);
 return source.map(normalizeBlock);
}

/** 供 create/append 共用的入口:create 归一化后把结果存进 sidecar,append 读取合并再整体重建 */
export function normalizeOfficeBlocks(raw:unknown):OfficeBlock[]{return normalizeBlocks(raw)}

/** doc 选项归一化:accent 去 # 前缀并大写(create 存 sidecar 时复用) */
export function normalizeOfficeDocOptions(raw:unknown):OfficeDocOptions|undefined{return normalizeDocOptions(raw)}
function normalizeDocOptions(raw:unknown):OfficeDocOptions|undefined{
 if(raw===undefined)return undefined;
 if(!raw||typeof raw!=='object')invalid('doc must be an object like {"footer":true,"accent":"1F4E79"}');
 const source=raw as Record<string,unknown>;
 if(source.footer!==undefined&&typeof source.footer!=='boolean')invalid('doc.footer must be a boolean');
 let accent:string|undefined;
 if(source.accent!==undefined){
  accent=normalizeColor(source.accent);
  if(!accent)invalid(`doc.accent "${String(source.accent)}" must be 3 or 6 hex digits, e.g. 1F4E79`);
 }
 return {...(source.footer===true?{footer:true}:{}),...(accent?{accent}:{})};
}

/** 旧参数映射为 blocks(纯段落+表格),xlsx/pptx 沿用旧字段语义 */
function legacyBlocks(paragraphs:string[],rows:string[][]):OfficeBlock[]{
 const blocks:OfficeBlock[]=paragraphs.map(text=>({type:'paragraph',text} as OfficeBlock));
 if(rows.length)blocks.push({type:'table',rows});
 return blocks;
}

const alignmentOf=(align?:string)=>align==='center'?AlignmentType.CENTER:align==='right'?AlignmentType.RIGHT:AlignmentType.LEFT;

/** 段落/列表项正文 runs;inline code 用等宽字体+浅灰底纹,颜色一律六位大写十六进制 */
function runsOf(block:{text?:string;runs?:OfficeRun[]},size:number):TextRun[]{
 if(block.runs?.length)return block.runs.map(run=>new TextRun({text:run.text,bold:run.bold||undefined,italics:run.italic||undefined,color:run.color||undefined,size:run.code?size-2:size,font:run.code?CODE_FONT:BODY_FONT,shading:run.code?{type:ShadingType.CLEAR,fill:CODE_BG}:undefined}));
 return [new TextRun({text:block.text??'',size,font:BODY_FONT})];
}

export async function generateOffice(extension:string,input:OfficeContent):Promise<Uint8Array>{
 const {title,paragraphs=[],rows=[],slides=[],blocks:provided,doc:docRaw}=input;
 if(typeof title!=='string'||!title.trim()||title.length>200||!Array.isArray(paragraphs)||paragraphs.length>100||paragraphs.some(value=>typeof value!=='string'||value.length>8000)||!Array.isArray(rows)||rows.length>200||rows.some(row=>!Array.isArray(row)||row.length>30||row.some(value=>typeof value!=='string'||value.length>2000))||!Array.isArray(slides)||slides.length>20||slides.some(slide=>!slide||typeof slide.title!=='string'||slide.title.length>200||typeof slide.body!=='string'||slide.body.length>8000)||JSON.stringify(input).length>300000)invalid('title, paragraphs, rows or slides exceed the documented limits');
 const doc=normalizeDocOptions(docRaw);
 const blocks=provided!==undefined?normalizeBlocks(provided):legacyBlocks(paragraphs,rows);
 const accent=doc?.accent??ACCENT;
 if(extension==='.docx'){
  const children:(Paragraph|Table)[]=[];
  const hasCover=blocks.some(block=>block.type==='cover');
  // 无封面块时文档标题作为 Title 段落开场;有封面块时由封面统一渲染标题
  if(!hasCover)children.push(new Paragraph({text:title,heading:HeadingLevel.TITLE}));
  const numbering:NumberingDefinition[]=[];
  let orderedIndex=0;
  for(const block of blocks){
   switch(block.type){
    case 'cover':{
     children.push(new Paragraph({text:'',spacing:{before:2000,after:200}}));
     children.push(new Paragraph({text:title,heading:HeadingLevel.TITLE,alignment:AlignmentType.CENTER,spacing:{before:0,after:240}}));
     if(block.subtitle)children.push(new Paragraph({children:[new TextRun({text:block.subtitle,size:26,color:MUTED,font:HEAD_FONT})],alignment:AlignmentType.CENTER,spacing:{after:120}}));
     if(block.meta?.length)children.push(new Paragraph({children:[new TextRun({text:block.meta.join('  ·  '),size:18,color:MUTED,font:BODY_FONT})],alignment:AlignmentType.CENTER,spacing:{after:120}}));
     children.push(new Paragraph({text:'',border:{bottom:{style:BorderStyle.SINGLE,size:6,color:accent,space:1}},spacing:{after:240}}));
     break;
    }
    case 'heading':
     children.push(new Paragraph({text:block.text,heading:block.level===1?HeadingLevel.HEADING_1:block.level===2?HeadingLevel.HEADING_2:HeadingLevel.HEADING_3,alignment:block.align==='center'?AlignmentType.CENTER:AlignmentType.LEFT}));
     break;
    case 'paragraph':
     children.push(new Paragraph({children:runsOf(block,21),alignment:alignmentOf(block.align),spacing:{after:120}}));
     break;
    case 'list':{
     // 有序列表每个块独立 reference,避免同文档多个列表续号
     const reference=block.ordered?`piwork-ordered-${orderedIndex++}`:'piwork-bullet';
     numbering.push({reference,levels:[{level:0,format:block.ordered?'decimal':'bullet',text:block.ordered?'%1.':'•',alignment:AlignmentType.START}]});
     for(const item of block.items)children.push(new Paragraph({children:runsOf(typeof item==='string'?{text:item}:item,21),numbering:{reference,level:0},spacing:{after:60}}));
     break;
    }
    case 'quote':
     children.push(new Paragraph({children:[new TextRun({text:block.text,size:21,color:MUTED,font:BODY_FONT})],indent:{left:360},border:{left:{style:BorderStyle.SINGLE,size:12,color:LINE,space:8}},spacing:{after:120}}));
     break;
    case 'code':{
     const lines=block.text.split('\n');
     for(const [index,line] of lines.entries())children.push(new Paragraph({children:[new TextRun({text:line.length?line:' ',size:18,font:CODE_FONT,color:'333333'})],shading:{type:ShadingType.CLEAR,fill:CODE_BG},spacing:{after:index===lines.length-1?120:0}}));
     break;
    }
    case 'table':{
     const width=Math.max(block.header?.length??0,...block.rows.map(row=>row.length));
     if(!width)break;
     const cell=(value:string,head:boolean)=>new TableCell({children:[new Paragraph({children:[new TextRun({text:value,size:20,bold:head||undefined,font:head?HEAD_FONT:BODY_FONT})],spacing:{after:0}})],...(head?{shading:{type:ShadingType.CLEAR,fill:HEAD_BG}}:{})});
     const tableRows=[...(block.header?.length?[block.header]:[]),...block.rows];
     children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:{top:{style:BorderStyle.SINGLE,size:4,color:LINE},bottom:{style:BorderStyle.SINGLE,size:4,color:LINE},left:{style:BorderStyle.SINGLE,size:4,color:LINE},right:{style:BorderStyle.SINGLE,size:4,color:LINE},insideHorizontal:{style:BorderStyle.SINGLE,size:4,color:LINE},insideVertical:{style:BorderStyle.SINGLE,size:4,color:LINE}},rows:tableRows.map((row,index)=>new TableRow({children:Array.from({length:width},(_,column)=>cell(row[column]??'',index===0&&!!block.header?.length))}))}));
     children.push(new Paragraph({text:'',spacing:{after:60}}));
     break;
    }
    case 'divider':
     children.push(new Paragraph({text:'',border:{bottom:{style:BorderStyle.SINGLE,size:6,color:LINE,space:1}},spacing:{before:120,after:120}}));
     break;
    case 'pageBreak':
     if(children.length)children.push(new Paragraph({text:'',pageBreakBefore:true,spacing:{after:0}}));
     break;
   }
  }
  const footer=doc?.footer?{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({children:['第 ',PageNumber.CURRENT,' 页'],size:18,color:'888888',font:BODY_FONT})]})]})}:undefined;
  const options:ConstructorParameters<typeof Document>[0]={styles:{default:{
   document:{run:{font:BODY_FONT,size:21,color:'262626'},paragraph:{spacing:{line:320}}}, // 正文 10.5pt,约 1.33 倍行距
   title:{run:{size:44,bold:true,color:'1A1A1A',font:HEAD_FONT},paragraph:{spacing:{before:120,after:240}}},
   heading1:{run:{size:30,bold:true,color:accent,font:HEAD_FONT},paragraph:{spacing:{before:320,after:160},border:{left:{style:BorderStyle.SINGLE,size:24,color:accent,space:10}}}}, // 一级标题左侧色条
   heading2:{run:{size:26,bold:true,color:'1A1A1A',font:HEAD_FONT},paragraph:{spacing:{before:280,after:140}}},
   heading3:{run:{size:23,bold:true,color:'333333',font:HEAD_FONT},paragraph:{spacing:{before:240,after:120}}},
  }},sections:[{...(footer?{footers:footer}:{}),children}],...(numbering.length?{numbering:{config:numbering}}:{})};
  return Packer.toBuffer(new Document(options));
 }
 if(extension==='.xlsx'){
  const book=createWorkbook(),sheet=addWorksheet(book,'Sheet1');const entries=rows.length?rows:[[title],...paragraphs.map(text=>[text])];for(let r=0;r<entries.length;r++)for(let c=0;c<entries[r].length;c++)setCell(sheet,r+1,c+1,entries[r][c]);return workbookToBytes(book);
 }
 if(extension==='.pptx'){
  if(rows.length>10||rows.some(row=>row.length>8))throw new Error('Presentation table exceeds 10 rows or 8 columns');
  const deck=createPresentation();const entries=slides.length?slides:[{title,body:paragraphs.join('\n')}];for(let i=0;i<entries.length;i++){const slide=addBlankSlide(deck);addSlideTextBox(slide,{x:inches(.7),y:inches(.4),w:inches(11.8),h:inches(.8),text:entries[i].title});addSlideTextBox(slide,{x:inches(.8),y:inches(1.5),w:inches(11),h:inches(rows.length&&i===0?2.1:5),text:entries[i].body});if(rows.length&&i===0)addSlideTable(slide,{x:inches(.8),y:inches(4),w:inches(11),h:inches(2.5),rows,firstRow:true})}return savePresentation(deck);
 }
 throw new Error('Unsupported document type');
}
