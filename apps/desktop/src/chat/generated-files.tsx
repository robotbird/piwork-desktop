import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {CopyIcon,EyeIcon,FolderOpenIcon,MoreHorizontalIcon,ExternalLinkIcon} from 'lucide-react';
import {toast} from 'sonner';
import {FileTypeIcon} from '@/components/documents/file-type-icon';
import {Button} from '@/components/ui/button';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuGroup,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {copyTextToClipboard} from '@/lib/utils';

export type DocumentAction='open'|'reveal';

export function GeneratedFiles({paths,onPreview,onAction}:{paths:string[];onPreview?:(path:string)=>void;onAction?:(path:string,action:DocumentAction)=>void}){
  return paths.length?<div className="generated-files">{paths.map(path=><GeneratedFile key={path} path={path} onPreview={onPreview} onAction={onAction}/>)}</div>:null;
}

function GeneratedFile({path,onPreview,onAction}:{path:string;onPreview?:(path:string)=>void;onAction?:(path:string,action:DocumentAction)=>void}){
  const t=useTranslations('generatedFiles');
  const [open,setOpen]=useState(false);
  const name=path.split('/').at(-1)??path;
  return <div className="generated-file" onContextMenu={event=>{event.preventDefault();setOpen(true)}} data-menu-open={open||undefined}>
    <button className="generated-file-main" type="button" title={path} aria-label={`${t('preview')}: ${name}`} onClick={()=>onPreview?.(path)} disabled={!onPreview}>
      <FileTypeIcon filename={name} className="generated-file-icon"/>
      <span className="generated-file-label"><strong>{name}</strong><span>{name.split('.').at(-1)?.toUpperCase()}</span></span>
    </button>
    <div className="generated-file-actions">
      <Button variant="ghost" size="icon-sm" aria-label={t('preview')} title={t('preview')} onClick={()=>onPreview?.(path)} disabled={!onPreview}><EyeIcon/></Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('open')} title={t('open')} onClick={()=>onAction?.(path,'open')} disabled={!onAction}><ExternalLinkIcon/></Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('more')} title={t('more')}><MoreHorizontalIcon/></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem onSelect={()=>onPreview?.(path)} disabled={!onPreview}><EyeIcon/>{t('preview')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>onAction?.(path,'open')} disabled={!onAction}><ExternalLinkIcon/>{t('open')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>onAction?.(path,'reveal')} disabled={!onAction}><FolderOpenIcon/>{t('reveal')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>{void copyTextToClipboard(path).then(ok=>ok?toast.success(t('copied')):toast.error(t('copyFailed')))}}><CopyIcon/>{t('copyPath')}</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>;
}
