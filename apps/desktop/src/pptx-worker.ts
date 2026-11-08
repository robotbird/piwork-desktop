import {loadSlides} from './pptx-parser';
let deck:Awaited<ReturnType<typeof loadSlides>>|null=null;
self.onmessage=async(event:MessageEvent<{type:'load';data:string}|{type:'page';index:number}>)=>{
 try {if(event.data.type==='load'){deck=await loadSlides(Uint8Array.from(atob(event.data.data),c=>c.charCodeAt(0)));self.postMessage({type:'loaded',count:deck.count});if(deck.count)self.postMessage({type:'page',index:0,svg:deck.render(0)})}else if(deck)self.postMessage({type:'page',index:event.data.index,svg:deck.render(event.data.index)})}
 catch{self.postMessage({type:'error'})}
};
