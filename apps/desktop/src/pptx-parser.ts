import {getSlides,loadPresentation} from '@office-kit/pptx';
import {renderSlideToSvg} from '@office-kit/pptx-preview';
export async function loadSlides(bytes:Uint8Array){
 const presentation=await loadPresentation(bytes,{limits:{maxEntries:10000,maxTotalUncompressedBytes:128*1024*1024,maxXmlPartBytes:16*1024*1024,maxTotalXmlBytes:64*1024*1024}});
 const slides=getSlides(presentation);
 return {count:slides.length,render(index:number){if(!Number.isInteger(index)||index<0||index>=slides.length)throw new Error('Invalid slide');return renderSlideToSvg(presentation,slides[index],{textLayout:'svg',eastAsianFamily:'PingFang SC'})}};
}
