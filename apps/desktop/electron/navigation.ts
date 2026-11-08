import {pathToFileURL} from 'node:url';

export function developmentServerUrl(isPackaged:boolean,value:string|undefined):string|undefined{return isPackaged?undefined:value||undefined}

export function allowedNavigation(target:string,developmentUrl:string|undefined,entryPath:string):boolean {
 try {
  const url=new URL(target);
  if(developmentUrl){const base=new URL(developmentUrl);return ['http:','https:'].includes(base.protocol)&&!url.username&&!url.password&&url.origin===base.origin}
  const expected=new URL(pathToFileURL(entryPath).href);
  return url.protocol==='file:'&&url.host===expected.host&&url.pathname===expected.pathname&&!url.search;
 } catch {return false}
}
