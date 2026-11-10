const fileRoute='/__piwork_file__?path=';
const documentExtension=/\.(?:pptx?|docx?|xlsx?|pdf|odt|ods|odp|rtf|txt|md|markdown|csv|tsv|html?|json|xml|ya?ml|svg|png|jpe?g|webp|gif)$/i;

/** Resolve document references only; external URLs keep their normal behavior. */
export function documentPath(value:string):string|undefined {
  let path=value.trim();
  if(path.startsWith(fileRoute)){
    try{return documentPath(decodeURIComponent(path.slice(fileRoute.length)))}catch{return undefined}
  }
  if(path.startsWith('file://')){
    try{const url=new URL(path);if(url.hostname&&url.hostname!=='localhost')return undefined;path=decodeURIComponent(url.pathname)}catch{return undefined}
  }
  if(!path||/[\0\r\n]/.test(path)||/^[a-z][\w+.-]*:/i.test(path)||path.startsWith('//')||!documentExtension.test(path))return undefined;
  return path;
}

type MarkdownNode={type:string;value?:string;url?:string;title?:string;children?:MarkdownNode[]};
const fileNode=(path:string,label=path.split('/').at(-1)??path):MarkdownNode=>({type:'link',url:fileRoute+encodeURIComponent(path),title:path,children:[{type:'text',value:label}]});

/** Turn prose paths into links without changing code fences or existing link labels. */
export function remarkDocumentLinks(){
  return (tree:MarkdownNode)=>{
    function visit(node:MarkdownNode){
      if(node.type==='link'){
        const path=node.url&&documentPath(node.url);
        if(path)node.url=fileRoute+encodeURIComponent(path);
        return;
      }
      if(!node.children||['code','image','html'].includes(node.type))return;
      node.children=node.children.flatMap(child=>{
        if(child.type==='inlineCode'){
          const path=child.value&&documentPath(child.value);
          return path?[fileNode(path)]:[child];
        }
        if(child.type==='text'&&child.value){
          const value=child.value;
          const pattern=/(?:^|(?<=[\s（(：:]))(?:\/?(?:[\p{L}\p{N}_~.-]+\/)+)[^\s`<>，。；;！!？?）)\[\]"']+\.[a-zA-Z0-9]+/gu;
          const result:MarkdownNode[]=[];
          let cursor=0;
          for(const match of value.matchAll(pattern)){
            const path=documentPath(match[0]);
            if(!path)continue;
            if(match.index!>cursor)result.push({type:'text',value:value.slice(cursor,match.index)});
            result.push(fileNode(path));cursor=match.index!+match[0].length;
          }
          if(!cursor)return [child];
          if(cursor<value.length)result.push({type:'text',value:value.slice(cursor)});
          return result;
        }
        visit(child);return [child];
      });
    }
    visit(tree);
  };
}

/** Absolute paths may only map into folders already authorized for this project. */
export function projectDocumentPath(path:string,folders:{path:string;label:string}[]):string|undefined {
  if(!path.startsWith('/'))return path;
  const folder=[...folders].sort((a,b)=>b.path.length-a.path.length).find(folder=>path.startsWith(folder.path.replace(/\/$/,'')+'/'));
  return folder?folder.label+'/'+path.slice(folder.path.replace(/\/$/,'').length+1):undefined;
}

/** Collect reply deliverables while leaving fenced examples and remote links alone. */
export function documentReferences(text:string):string[]{
  const paths=new Set<string>();
  let fence:string|undefined;
  const prose=text.split('\n').filter(line=>{
    const match=/^\s*(`{3,}|~{3,})/.exec(line);
    if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length)fence=undefined;return false}
    return !fence;
  }).join('\n');
  const references=/\[[^\]]*\]\(<?([^>\n]+?)>?\)|`([^`\n]+)`|((?:^|(?<=[\s（(：:]))(?:\/?(?:[\p{L}\p{N}_~.-]+\/)+)[^\s`<>，。；;！!？?）)\[\]"']+\.[a-zA-Z0-9]+)/gu;
  for(const match of prose.matchAll(references)){
    const path=documentPath(match[1]??match[2]??match[3]);if(path)paths.add(path);
  }
  return [...paths];
}

export type DocumentFolder={path:string;label:string;main?:boolean};

/** Keep one card when a reply and a tool use different paths for the same file. */
export function uniqueDocumentPaths(paths:string[],folders:DocumentFolder[]=[]):string[]{
  const seen=new Set<string>();
  return paths.filter(value=>{
    let key=value.replace(/^\.\//,'');
    if(!key.startsWith('/')&&folders.length){
      const folder=folders.find(folder=>key.startsWith(folder.label+'/'));
      const root=folder??folders.find(folder=>folder.main)??folders[0];
      key=root.path.replace(/\/$/,'')+'/'+(folder?key.slice(folder.label.length+1):key);
    }
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
