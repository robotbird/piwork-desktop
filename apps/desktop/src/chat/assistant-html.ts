const fencePattern=/^ {0,3}(`{3,}|~{3,})(.*)$/;
const htmlLanguages=['html','htm','xhtml'];
const documentStart=/^\s*<(?:!doctype\s+html\b|html(?:[\s>]|$)|head(?:[\s>]|$)|body(?:[\s>]|$))/i;
const documentEnd=/<\/html\s*>[ \t]*$/i;

export function isHtmlFile(path:string):boolean {
  return /\.html?$/i.test(path);
}

/** Split HTML deliverables out before either the streaming fallback or Markdown renders. */
export function splitAssistantHtml(value:string,streaming=false):{text:string;html:string[]} {
  const text:string[]=[];
  const html:string[]=[];
  let fence:{marker:string;html:boolean}|undefined;
  let document:string[]|undefined;
  const lines=value.split('\n');

  function store(source:string) {
    const content=source.trim();
    if(content&&!html.includes(content))html.push(content);
  }

  for(const [index,line] of lines.entries()){
    const match=fencePattern.exec(line);
    if(fence){
      const closes=match&&match[1][0]===fence.marker[0]&&match[1].length>=fence.marker.length&&!match[2].trim();
      if(fence.html){
        if(closes){store(document!.join('\n'));document=undefined}
        else document!.push(line);
      }else text.push(line);
      if(closes)fence=undefined;
    }else if(document||documentStart.test(line)){
      document??=[];
      const end=documentEnd.exec(line);
      if(end){
        document.push(line.slice(0,end.index+end[0].length));
        store(document.join('\n'));
        document=undefined;
      }else document.push(line);
    }else if(match){
      const language=match[2].trim().split(/\s+/)[0].toLowerCase();
      const isHtml=htmlLanguages.includes(language);
      if(streaming&&index===lines.length-1&&language&&!isHtml&&htmlLanguages.some(name=>name.startsWith(language)))continue;
      fence={marker:match[1],html:isHtml};
      if(isHtml)document=[];
      else text.push(line);
    }else{
      const candidate=line.trimStart().toLowerCase();
      const pending=streaming&&index===lines.length-1&&candidate.startsWith('<')&&
        ['<!doctype html','<html','<head','<body'].some(tag=>tag.startsWith(candidate));
      if(!pending)text.push(line);
    }
  }
  if(document&&!streaming)store(document.join('\n'));
  const prose=text.join('\n');
  return {text:prose.trim()?prose:'',html};
}
