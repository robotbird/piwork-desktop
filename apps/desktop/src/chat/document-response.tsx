import {FileTypeIcon} from '@/components/documents/file-type-icon';
import {useMemo} from 'react';
import {defaultRemarkPlugins} from 'streamdown';
import {MessageResponse} from '@/components/ai-elements/message';
import {documentPath,remarkDocumentLinks} from './file-links';

const remarkPlugins=[...Object.values(defaultRemarkPlugins),remarkDocumentLinks];

export function DocumentResponse({children,onOpenFile}:{children:string;onOpenFile?:(path:string)=>void}){
  const components=useMemo(()=>({
    a:({href,children}:{href?:string;children?:React.ReactNode})=>{
      const path=href&&documentPath(href);
      return path?<a className="conversation-document-link" href={href} title={path} onClick={event=>{event.preventDefault();onOpenFile?.(path)}}><FileTypeIcon filename={path} className="conversation-document-icon"/><strong>{children}</strong></a>
        :<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
  }),[onOpenFile]);
  return <MessageResponse skipHtml disallowedElements={['img']} remarkPlugins={remarkPlugins} components={components}>{children}</MessageResponse>;
}
