import {Document,HeadingLevel,Packer,Paragraph,Table,TableCell,TableRow} from 'docx';
import {createWorkbook,addWorksheet} from '@office-kit/xlsx/workbook';
import {setCell} from '@office-kit/xlsx/worksheet';
import {workbookToBytes} from '@office-kit/xlsx/io';
import {createPresentation,addBlankSlide,addSlideTextBox,addSlideTable,inches,savePresentation} from '@office-kit/pptx';

type Slide={title:string;body:string};
export type OfficeContent={title:string;paragraphs?:string[];rows?:string[][];slides?:Slide[]};
export async function generateOffice(extension:string,input:OfficeContent):Promise<Uint8Array>{
 const {title,paragraphs=[],rows=[],slides=[]}=input;
 if(typeof title!=='string'||!title.trim()||title.length>200||!Array.isArray(paragraphs)||paragraphs.length>100||paragraphs.some(value=>typeof value!=='string'||value.length>8000)||!Array.isArray(rows)||rows.length>200||rows.some(row=>!Array.isArray(row)||row.length>30||row.some(value=>typeof value!=='string'||value.length>2000))||!Array.isArray(slides)||slides.length>20||slides.some(slide=>!slide||typeof slide.title!=='string'||slide.title.length>200||typeof slide.body!=='string'||slide.body.length>8000)||JSON.stringify(input).length>200000)throw new Error('Invalid document content');
 if(extension==='.docx'){
  const children:(Paragraph|Table)[]=[new Paragraph({text:title,heading:HeadingLevel.TITLE}),...paragraphs.map(text=>new Paragraph(text))];
  if(rows.length){const width=Math.max(...rows.map(row=>row.length));if(width){children.push(new Table({rows:rows.map(row=>new TableRow({children:Array.from({length:width},(_,i)=>new TableCell({children:[new Paragraph(row[i]??'')]}))}))}))}}
  return Packer.toBuffer(new Document({sections:[{children}]}));
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
