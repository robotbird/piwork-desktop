import {useCallback,useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type KeyboardEvent as ReactKeyboardEvent} from 'react';

/* 右侧预览面板拖拽调宽:左缘把手 + localStorage 持久化(参考 deepseek sidebar-right 的可调布局) */
const STORAGE_KEY='piwork.preview-width';
export const MIN_PREVIEW_WIDTH=360;
const DEFAULT_PREVIEW_WIDTH=380;

function maxWidth(){return Math.min(960,Math.round(window.innerWidth*.55))}

function clampWidth(value:number){return Math.min(Math.max(maxWidth(),MIN_PREVIEW_WIDTH),Math.max(MIN_PREVIEW_WIDTH,value))}

function loadWidth(){
  const stored=Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored)&&stored>=MIN_PREVIEW_WIDTH?clampWidth(stored):DEFAULT_PREVIEW_WIDTH;
}

/** 返回当前面板宽度与左缘拖拽把手;两处预览面板(聊天区/文档库)共用同一份持久化宽度。 */
export function usePreviewWidth(){
  const [width,setWidth]=useState(loadWidth);
  const current=useRef(width);
  current.current=width;
  useEffect(()=>{
    const clamp=()=>setWidth(value=>Math.min(value,Math.max(maxWidth(),MIN_PREVIEW_WIDTH)));
    window.addEventListener('resize',clamp);
    return()=>window.removeEventListener('resize',clamp);
  },[]);
  function beginResize(event:ReactPointerEvent<HTMLDivElement>){
    event.preventDefault();
    const node=event.currentTarget;
    node.setPointerCapture(event.pointerId);
    const beginX=event.clientX;
    const beginWidth=current.current;
    let moved=false;
    const move=(moveEvent:PointerEvent)=>{
      moved=true;
      setWidth(clampWidth(beginWidth+beginX-moveEvent.clientX));
    };
    const finish=()=>{
      node.removeEventListener('pointermove',move);
      node.removeEventListener('pointerup',finish);
      node.removeEventListener('pointercancel',finish);
      if(moved)localStorage.setItem(STORAGE_KEY,String(current.current));
    };
    node.addEventListener('pointermove',move);
    node.addEventListener('pointerup',finish);
    node.addEventListener('pointercancel',finish);
  }
  function nudge(event:ReactKeyboardEvent<HTMLDivElement>){
    const step=event.key==='ArrowLeft'?24:event.key==='ArrowRight'?-24:0;
    if(!step)return;
    event.preventDefault();
    setWidth(clampWidth(current.current+step));
    localStorage.setItem(STORAGE_KEY,String(clampWidth(current.current+step)));
  }
  const resizer=<div
    aria-label="调整预览面板宽度 / Resize preview panel"
    className="preview-resizer"
    role="separator"
    aria-orientation="vertical"
    onKeyDown={nudge}
    onPointerDown={beginResize}
    tabIndex={0}
  />;
  return {width,resizer};
}

/* 预览面板折叠/全屏(参考 deepseek sidebar-right):折叠时内容保持挂载,外层宽度归 0、内层平移推出;
   animating 标记仅在折叠/全屏切换期间挂 data-animating 启用过渡,避免拖拽调宽时宽度动画迟滞。 */
const COLLAPSED_KEY='piwork.preview-collapsed';
const FULLSCREEN_KEY='piwork.preview-fullscreen';

function storeFlag(key:string,value:boolean){localStorage.setItem(key,value?'1':'0')}

/** 折叠与全屏两个正交状态 + localStorage 持久化;切换时置 animating,由 onTransitionEnd 清除。 */
export function usePreviewCollapse(){
  const [collapsed,setCollapsedState]=useState(()=>localStorage.getItem(COLLAPSED_KEY)==='1');
  const [fullscreen,setFullscreenState]=useState(()=>localStorage.getItem(FULLSCREEN_KEY)==='1');
  const [animating,setAnimating]=useState(false);
  const collapsedRef=useRef(collapsed);
  const fullscreenRef=useRef(fullscreen);
  collapsedRef.current=collapsed;
  fullscreenRef.current=fullscreen;
  const setCollapsed=useCallback((value:boolean)=>{
    if(collapsedRef.current===value)return;
    collapsedRef.current=value;
    storeFlag(COLLAPSED_KEY,value);
    setAnimating(true);
    setCollapsedState(value);
  },[]);
  const setFullscreen=useCallback((value:boolean)=>{
    if(fullscreenRef.current===value)return;
    fullscreenRef.current=value;
    storeFlag(FULLSCREEN_KEY,value);
    setAnimating(true);
    setFullscreenState(value);
  },[]);
  const endAnimation=useCallback(()=>setAnimating(false),[]);
  return {collapsed,fullscreen,animating,setCollapsed,setFullscreen,endAnimation};
}
