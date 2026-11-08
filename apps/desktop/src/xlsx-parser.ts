import {fromArrayBuffer,loadWorkbook} from '@office-kit/xlsx/io';
import {iterWorksheets} from '@office-kit/xlsx/workbook';
import {getCell,getCellExtent} from '@office-kit/xlsx/worksheet';
import {getCellDisplayText} from '@office-kit/xlsx/styles';
import {listImagesOnSheet} from '@office-kit/xlsx/drawing';

const MAX_ROWS=200,MAX_COLS=30,MAX_SHEETS=30;
export async function parseWorkbook(data:Uint8Array){
 const workbook=await loadWorkbook(fromArrayBuffer(Uint8Array.from(data).buffer),{
  decompressionLimits:{maxTotalUncompressedBytes:256*1024*1024},
  contentLimits:{maxCells:1_000_000,maxRows:100_000},
 });
 const worksheets=Array.from(iterWorksheets(workbook));
 const sheets=worksheets.slice(0,MAX_SHEETS).map(sheet=>{
  const extent=getCellExtent(sheet);const maxRow=extent?.maxRow??0;const maxCol=extent?.maxCol??0;
  const rows=Array.from({length:Math.min(maxRow,MAX_ROWS)},(_,row)=>Array.from({length:Math.min(maxCol,MAX_COLS)},(_,col)=>{
   const cell=getCell(sheet,row+1,col+1);return cell?getCellDisplayText(workbook,cell):'';
  }));
  let imageBytes=0;const images=listImagesOnSheet(sheet).flatMap(item=>{if(item.content.kind!=='picture'||item.content.picture.hidden)return [];const image=item.content.picture.image;if(!image||!['png','jpeg','gif','webp'].includes(image.format)||image.bytes.length>2*1024*1024||imageBytes+image.bytes.length>10*1024*1024)return [];imageBytes+=image.bytes.length;return [{format:image.format,bytes:image.bytes,name:item.content.picture.descr||item.content.picture.name||''}]}).slice(0,20);
  return {name:sheet.title,rows,images,truncated:maxRow>MAX_ROWS||maxCol>MAX_COLS};
 });
 return {sheets,truncated:worksheets.length>MAX_SHEETS};
}
