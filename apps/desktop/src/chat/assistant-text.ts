// Only remove protocol-shaped blocks outside Markdown code examples.
const fencePattern=/^ {0,3}(`{3,}|~{3,})(.*)$/;
const openingTag='<tool_call>';
const closingTag='</tool_call>';
const wireBlock=/(?:^|(?<=<\/tool_call>))[ \t]*<tool_call>[ \t\r\n]*(?=\{)([\s\S]*?)<\/tool_call>(?:[ \t]*<\/tool_call>)*/gm;

function isToolPayload(value:string):boolean {
  try {
    const payload=JSON.parse(value);
    return typeof payload?.name==='string'&&payload.name.length>0&&
      ('arguments' in payload||'parameters' in payload);
  } catch {
    // Some providers emit JSON-like payloads with invalid command escaping.
    return /^\{\s*"name"\s*:/.test(value)&&/"(?:arguments|parameters)"\s*:/.test(value);
  }
}

export function visibleAssistantText(value:string,streaming=false):{text:string;hiddenToolRequest:boolean} {
  let hiddenToolRequest=false;
  let fence:{character:string;length:number}|undefined;
  const output:string[]=[];
  const prose:string[]=[];

  function flushProse(atEnd=false) {
    let text=prose.join('\n').replace(wireBlock,(block:string,payload:string)=>{
      if(!isToolPayload(payload))return block;
      hiddenToolRequest=true;
      return '';
    });
    if(atEnd) {
      if(hiddenToolRequest)text=text.replace(/^[ \t]*(?:<\/tool_call>[ \t]*)+$/gm,'');
      const unfinished=/^[ \t]*<tool_call>[ \t\r\n]*(\{(?:(?!<\/tool_call>)[\s\S])*)?$/m.exec(text);
      if(unfinished&&(streaming||isToolPayload(unfinished[1]??''))) {
        hiddenToolRequest=true;
        text=text.slice(0,unfinished.index);
      }
      if(streaming){
        const lastLine=text.slice(text.lastIndexOf('\n')+1).trimStart();
        if(lastLine&&(openingTag.startsWith(lastLine)||closingTag.startsWith(lastLine))){
          text=text.slice(0,text.lastIndexOf('\n')+1);
        }
      }
    }
    if(prose.length)output.push(hiddenToolRequest?text.replace(/\n{3,}/g,'\n\n'):text);
    prose.length=0;
  }

  for(const line of value.split('\n')){
    const match=fencePattern.exec(line);
    if(fence){
      output.push(line);
      if(match&&match[1][0]===fence.character&&match[1].length>=fence.length&&!match[2].trim())fence=undefined;
    }else if(match){
      flushProse();
      output.push(line);
      fence={character:match[1][0],length:match[1].length};
    }else{
      prose.push(line);
    }
  }
  flushProse(true);
  return {text:hiddenToolRequest?output.join('\n').trim():output.join('\n'),hiddenToolRequest};
}
