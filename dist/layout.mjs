import {ELEMENT_IDS,elementState,clamp} from './elements.mjs';
export const CARD_LIMITS={width:[200,800],height:[200,650]};
// Preset geometry intentionally never reads an element's edited size.
export function presetFrames(c){
 const p=c.padding,w=c.width-2*p-2*c.borderWidth,h=c.height-2*c.borderWidth;
 const f={},put=(id,left,top,width,height)=>f[id]={left,top,width:Math.max(1,width),height};
 const horizontal=c.layout!=='stacked',gap=24,cw=Math.max(60,(w-gap)*.44),mw=Math.max(60,w-cw-gap);
 const mx=horizontal&&c.layout==='chart-left'?p+cw+gap:p,tw=horizontal?mw:w;
 put('eyebrow',p,p,w-32,14);put('icon',p+w-20,p-3,20,20);
 put('title',mx,p+(horizontal?42:28),tw,20);
 put('value',mx,p+(horizontal?66:51),tw,64);
 put('subtitle',mx,p+(horizontal?130:127),tw,16);
 put('delta',mx,p+(horizontal?155:152),Math.min(tw,102),27);
 put('compareLabel',horizontal?mx:mx+112,p+(horizontal?189:158),horizontal?tw:tw-112,16);
 put('trend',horizontal?(c.layout==='chart-left'?p:p+mw+gap):p,p+(horizontal?44:188),horizontal?cw:w,75);
 put('status',p,p+184,w,45);
 put('goalLabel',p,h-p-63,w-62,16);put('progressLabel',p+w-60,h-p-63,60,16);
 put('progress',p,h-p-37,w,4);
 put('referenceLabel',p,h-p-49,w*.5,16);put('referenceValue',p+w*.5,h-p-49,w*.5,16);
 put('footer',p,h-p-12,w*.54,13);put('period',p+w*.56,h-p-12,w*.44,13);
 return f;
}
export function elementFrame(c,id){return elementState(c,id).frame||presetFrames(c)[id];}
export function freezeLayout(c){
 const frames=presetFrames(c);
 const baseEntries=ELEMENT_IDS.map(id=>[id,{...elementState(c,id),frame:elementState(c,id).frame||frames[id]}]);
 const dupEntries=Object.keys(c.elements||{}).filter(id=>id.includes('_copy')).map(id=>[id,{...elementState(c,id)}]);
 return {...c,elements:Object.fromEntries([...baseEntries,...dupEntries])};
}
export function adaptiveResizeCard(c,width=c.width,height=c.height){
 const targetW=clamp(Math.round(width),...CARD_LIMITS.width);
 const targetH=clamp(Math.round(height),...CARD_LIMITS.height);
 const oldW=c.width,oldH=c.height;
 const deltaW=targetW-oldW,deltaH=targetH-oldH;
 if(deltaW===0&&deltaH===0)return c;
 const p=c.padding,availW=targetW-2*p-2*c.borderWidth;
 const oldAvailW=Math.max(1,oldW-2*p-2*c.borderWidth);
 const availH=targetH-2*c.borderWidth;
 const oldAvailH=Math.max(1,oldH-2*c.borderWidth);
 const rW=availW/oldAvailW,rH=availH/oldAvailH;
 const newPresets=presetFrames({...c,width:targetW,height:targetH});
 const currentFrames=presetFrames(c);
 const updated={...c.elements};
 const horizontal=c.layout!=='stacked',gap=24;
 const cw=Math.max(60,(availW-gap)*.44),mw=Math.max(60,availW-cw-gap);
 const mx=horizontal&&c.layout==='chart-left'?p+cw+gap:p,tw=horizontal?mw:availW;
 for(const id of ELEMENT_IDS){
  const state=elementState(c,id);
  const curF=state.frame||currentFrames[id];
  if(!curF)continue;
  let newF={...curF};
  if(!state.frame){
   newF={...newPresets[id]};
  }else{
   if(['icon','progressLabel','period','referenceValue'].includes(id)){
    const oldRightOffset=oldW-p-c.borderWidth-(curF.left+curF.width);
    newF.left=Math.max(p,targetW-p-c.borderWidth-curF.width-Math.max(0,oldRightOffset));
   }else if(horizontal&&['title','value','subtitle','delta','compareLabel'].includes(id)){
    newF.left=mx;
    newF.width=Math.max(30,Math.min(tw,Math.round(curF.width*rW)));
   }else if(horizontal&&id==='trend'){
    newF.left=c.layout==='chart-left'?p:p+mw+gap;
    newF.width=cw;
   }else{
    if(Math.abs(curF.width-oldAvailW)<40){
     newF.width=Math.max(30,availW);
     newF.left=p;
    }else{
     const relLeft=Math.max(0,curF.left-p);
     newF.left=Math.max(p,p+Math.round(relLeft*rW));
     newF.width=Math.max(20,Math.round(curF.width*rW));
    }
   }
   if(['goalLabel','progressLabel','progress','referenceLabel','referenceValue','footer','period'].includes(id)){
    const oldBottomOffset=oldH-(curF.top+curF.height);
    newF.top=Math.max(p,targetH-curF.height-Math.max(0,oldBottomOffset));
   }else if(deltaH!==0&&!['eyebrow','icon'].includes(id)){
    const relTop=Math.max(0,curF.top-p);
    newF.top=Math.max(p,p+Math.round(relTop*rH));
   }
   const maxRight=targetW-p-c.borderWidth;
   if(newF.left+newF.width>maxRight){
    if(['icon','progressLabel','period'].includes(id)){newF.left=Math.max(p,maxRight-newF.width);}
    else{newF.width=Math.max(20,maxRight-newF.left);}
   }
   if(newF.left<p)newF.left=p;
   if(newF.top<p)newF.top=p;
   const maxBottom=targetH-c.borderWidth;
   if(newF.top+newF.height>maxBottom){newF.top=Math.max(p,maxBottom-newF.height);}
  }
  updated[id]={...state,frame:newF};
 }
 const dupIds=Object.keys(c.elements||{}).filter(id=>id.includes('_copy'));
 for(const id of dupIds){
  const state=elementState(c,id);
  const curF=state.frame;
  if(!curF)continue;
  const effLeft=curF.left+(state.x||0);
  const effTop=curF.top+(state.y||0);
  const effWidth=state.width||curF.width;
  const relLeft=Math.max(0,effLeft-p);
  let newLeft=Math.max(p,p+Math.round(relLeft*rW));
  const relTop=Math.max(0,effTop-p);
  let newTop=Math.max(p,p+Math.round(relTop*rH));
  let newWidth=Math.abs(effWidth-oldAvailW)<40
   ? Math.max(20,availW)
   : Math.max(20,Math.round(effWidth*rW));
  const maxRight=targetW-p-c.borderWidth;
  if(newWidth>maxRight-p){
   newWidth=Math.max(20,maxRight-p);
   newLeft=p;
  }else if(newLeft+newWidth>maxRight){
   newLeft=Math.max(p,maxRight-newWidth);
  }
  const maxBottom=targetH-c.borderWidth;
  if(newTop+curF.height>maxBottom){
   newTop=Math.max(p,maxBottom-curF.height);
  }
  let newF={...curF,left:newLeft,top:newTop,width:newWidth,height:curF.height};
  updated[id]={...state,x:0,y:0,width:newWidth,frame:newF};
 }
 let nextTrendHeight=c.trendHeight;
 if(deltaH!==0&&c.layout==='stacked'&&oldAvailH>0){
  const r=availH/oldAvailH;
  nextTrendHeight=clamp(Math.round(c.trendHeight*Math.sqrt(r)),40,150);
 }
 return {...c,width:targetW,height:targetH,trendHeight:nextTrendHeight,elements:updated};
}
export function resizeCard(c,width=c.width,height=c.height,adaptive=true){
 if(adaptive)return adaptiveResizeCard(c,width,height);
 return {...freezeLayout(c),width:clamp(Math.round(width),...CARD_LIMITS.width),height:clamp(Math.round(height),...CARD_LIMITS.height)};
}
export function applyLayout(c,layout){return {...c,geometryVersion:2,layout,elements:Object.fromEntries(ELEMENT_IDS.map(id=>{const p={...elementState(c,id),x:0,y:0,width:0};delete p.frame;return [id,p]}))};}
export function chartDimensions(c){const p=elementState(c,'trend');return {width:Math.max(24,p.width||elementFrame(c,'trend').width),height:c.trendHeight};}
