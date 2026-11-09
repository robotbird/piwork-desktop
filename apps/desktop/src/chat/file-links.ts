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
