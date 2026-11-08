import {parseWorkbook} from './xlsx-parser';
self.onmessage=async(event:MessageEvent<string>)=>{
 try {const bytes=Uint8Array.from(atob(event.data),character=>character.charCodeAt(0));self.postMessage(await parseWorkbook(bytes))}
 catch {self.postMessage({error:true})}
};
