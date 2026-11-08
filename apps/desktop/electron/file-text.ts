import path from 'node:path';
import {readProjectDocx,readProjectPdf,readProjectPptx,readProjectText,readProjectXlsx} from './project-files.ts';
import {parseWorkbook} from '../src/xlsx-parser.ts';
import {extractDocxText} from './docx-text.ts';
import {extractPdfText} from './pdf-text.ts';
import {getAllTables,getSlides,getTableCellText,getTableCells,getSlideText,loadPresentation} from '@office-kit/pptx';

const limitText=(text:string)=>text.length>64000?`${text.slice(0,64000)}\n[Text truncated]`:text;
/** PDF/Office 文档统一提取为带 64K 截断的纯文本;其他扩展名回落到项目文本读取(白名单校验)。 */
export async function readDocumentText(root:string,relative:string):Promise<string>{
 const ext=path.extname(relative).toLowerCase();
 if(ext==='.pdf')return extractPdfText(Buffer.from(await readProjectPdf(root,relative),'base64'));
 if(ext==='.docx')return extractDocxText(Buffer.from(await readProjectDocx(root,relative),'base64'));
 if(ext==='.xlsx'){const data=await parseWorkbook(Buffer.from(await readProjectXlsx(root,relative),'base64'));return limitText(data.sheets.map(sheet=>`## ${sheet.name}\n${sheet.rows.map(row=>row.join('\t')).join('\n')}${sheet.truncated?'\n[Worksheet truncated]':''}`).join('\n\n')+(data.truncated?'\n[Additional worksheets omitted]':''))}
 if(ext==='.pptx'){const data=Buffer.from(await readProjectPptx(root,relative),'base64');const presentation=await loadPresentation(data,{limits:{maxEntries:10000,maxTotalUncompressedBytes:128*1024*1024,maxXmlPartBytes:16*1024*1024,maxTotalXmlBytes:64*1024*1024}});const tables=getAllTables(presentation),slides=getSlides(presentation);return limitText(slides.slice(0,200).map((slide,i)=>`## Slide ${i+1}\n${getSlideText(slide)}\n${tables.filter(item=>item.slideIndex===i).map(item=>getTableCells(item.table).map(row=>row.map(getTableCellText).join('\t')).join('\n')).join('\n')}`).join('\n\n')+(slides.length>200?'\n[Additional slides omitted]':''))}
 return readProjectText(root,relative);
}
