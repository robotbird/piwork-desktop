import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseWorkbook} from '../apps/desktop/src/xlsx-parser.ts';

test('parses an ExcelJS-generated workbook with Chinese, formatted numbers and cached formulas',async()=>{
 const bytes=await readFile(new URL('./fixtures/sample.xlsx',import.meta.url));
 const result=await parseWorkbook(bytes);assert.equal(result.sheets.length,2);assert.equal(result.sheets[0].name,'项目');assert.deepEqual(result.sheets[0].rows[0],['周报','42','50.0%','84','示例']);assert.equal(result.sheets[1].rows[0][0],'完成');
});
test('rejects invalid workbook data',async()=>{await assert.rejects(parseWorkbook(Uint8Array.from([1,2,3])))});
test('bounds displayed worksheets, rows and columns without silently treating overflow as complete',async()=>{
 const {createWorkbook,addWorksheet}=await import('../apps/desktop/node_modules/@office-kit/xlsx/dist/workbook.mjs');const {setCell}=await import('../apps/desktop/node_modules/@office-kit/xlsx/dist/worksheet.mjs');const {workbookToBytes}=await import('../apps/desktop/node_modules/@office-kit/xlsx/dist/io.mjs');
 const book=createWorkbook();for(let i=0;i<31;i++){const sheet=addWorksheet(book,`S${i}`);if(i===0){setCell(sheet,201,31,'outside');setCell(sheet,1,1,'inside')}}
 const result=await parseWorkbook(await workbookToBytes(book));assert.equal(result.sheets.length,30);assert.equal(result.truncated,true);assert.equal(result.sheets[0].truncated,true);assert.equal(result.sheets[0].rows.length,200);assert.equal(result.sheets[0].rows[0].length,30);assert.equal(result.sheets[0].rows[0][0],'inside');
});
test('reads embedded worksheet images for basic preview',async()=>{
 const {createWorkbook,addWorksheet}=await import('../apps/desktop/node_modules/@office-kit/xlsx/dist/workbook.mjs');const {setCell}=await import('../apps/desktop/node_modules/@office-kit/xlsx/dist/worksheet.mjs');const {addImageAt}=await import('../apps/desktop/node_modules/@office-kit/xlsx/dist/drawing.mjs');const {workbookToBytes}=await import('../apps/desktop/node_modules/@office-kit/xlsx/dist/io.mjs');
 const book=createWorkbook(),sheet=addWorksheet(book,'中文表');setCell(sheet,1,1,'项目');setCell(sheet,1,2,'数量');const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');addImageAt(sheet,'A3',image,{widthPx:20,heightPx:20});const parsed=await parseWorkbook(await workbookToBytes(book));assert.equal(parsed.sheets[0].rows[0][0],'项目');assert.equal(parsed.sheets[0].images.length,1);assert.equal(parsed.sheets[0].images[0].format,'png');assert.deepEqual(Buffer.from(parsed.sheets[0].images[0].bytes),image);
});
