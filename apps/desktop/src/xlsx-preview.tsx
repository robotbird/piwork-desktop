import {useEffect,useState} from 'react';
type Sheet={name:string;rows:string[][];images:{format:string;bytes:Uint8Array;name:string}[];truncated:boolean};
function imageUrl(image:Sheet['images'][number]){let binary='';for(let i=0;i<image.bytes.length;i+=8192)binary+=String.fromCharCode(...image.bytes.subarray(i,i+8192));return `data:image/${image.format};base64,${btoa(binary)}`}
export function XlsxPreview({data,language}:{data:string;language:'zh-CN'|'en'}){
 const [sheets,setSheets]=useState<Sheet[]|null>(null);const [index,setIndex]=useState(0);const [error,setError]=useState(false);const [truncated,setTruncated]=useState(false);const zh=language==='zh-CN';
 useEffect(()=>{setSheets(null);setIndex(0);setError(false);const worker=new Worker(new URL('./xlsx-worker.ts',import.meta.url),{type:'module'});worker.onmessage=event=>{if(event.data.error)setError(true);else{setSheets(event.data.sheets);setTruncated(event.data.truncated)}};worker.onerror=()=>setError(true);worker.postMessage(data);return()=>worker.terminate()},[data]);
 if(error)return <p role="alert">{zh?'无法打开 XLSX 文件。':'Unable to open XLSX file.'}</p>;
 if(!sheets)return <p>{zh?'正在加载…':'Loading…'}</p>;
 if(!sheets.length)return <p>{zh?'没有可显示的工作表。':'No worksheets to display.'}</p>;
 const sheet=sheets[index];return <div className="xlsx-preview"><div className="sheet-tabs" aria-label={zh?'工作表':'Worksheets'}>{sheets.map((item,i)=><button key={i} className={i===index?'active':''} onClick={()=>setIndex(i)}>{item.name}</button>)}</div>{(sheet.truncated||truncated)&&<p>{zh?'仅显示前 30 个工作表及每表前 200 行、30 列。':'Showing up to 30 sheets, 200 rows and 30 columns per sheet.'}</p>}<div className="sheet-scroll"><table><tbody>{sheet.rows.map((row,r)=><tr key={r}><th scope="row">{r+1}</th>{row.map((value,c)=><td key={c}>{value}</td>)}</tr>)}</tbody></table></div>{sheet.images?.length>0&&<div className="sheet-images"><strong>{zh?'工作表图片':'Worksheet images'}</strong>{sheet.images.map((image,i)=><img key={i} src={imageUrl(image)} alt={image.name||`${zh?'图片':'Image'} ${i+1}`}/>)}</div>}<p>{zh?'只读预览，显示已保存的单元格值，不重新计算公式。':'Read-only preview of saved values; formulas are not recalculated.'}</p></div>
}
