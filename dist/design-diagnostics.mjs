import {elementVisible,resolveElementDef} from './elements.mjs';
import {esc,cardHTML} from './cards.mjs';

/** Measure a snapshot even when the user is in report context or the library. */
export function collectCurrentDesignDiagnostics(c) {
  const rendered=document.querySelector('#main-card');
  if(rendered)return collectDesignDiagnostics(rendered,c);
  if(typeof document.createRange!=='function'||!document.body?.appendChild)return [];
  const temporary=document.createElement('div');
  temporary.setAttribute('aria-hidden','true');
  temporary.inert=true;
  temporary.style.cssText=`position:absolute;left:-10000px;top:0;width:${c.width}px;pointer-events:none`;
  temporary.innerHTML=cardHTML(c,undefined,true);
  document.body.appendChild(temporary);
  try{return collectDesignDiagnostics(temporary,c);}finally{temporary.remove();}
}

/** Compare actual rendered text fragments, never the empty area of layout frames. */
export function textCollisions(items,tolerance=2) {
  const issues=[];
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const a=items[i],b=items[j];
    if(a.id===b.id)continue;
    const overlaps=a.rects.some(x=>b.rects.some(y=>{
      const width=Math.min(x.right,y.right)-Math.max(x.left,y.left);
      const height=Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top);
      const smallest=Math.min((x.right-x.left)*(x.bottom-x.top),(y.right-y.left)*(y.bottom-y.top));
      return width>tolerance&&height>tolerance&&width*height>smallest*.08;
    }));
    if(overlaps)issues.push({type:'overlap',ids:[a.id,b.id],message:'El texto de «'+a.label+'» se superpone al de «'+b.label+'». Revisa posición, tamaño o contenido.'});
  }
  return issues;
}

/** DOM measurements are local preview diagnostics, not a guarantee for every Power BI renderer. */
export function collectDesignDiagnostics(root,c) {
  if(!root?.querySelectorAll||typeof document.createRange!=='function')return [];
  const surface=root.matches?.('[data-card-surface]')?root:root.querySelector('[data-card-surface]')||root.firstElementChild||root;
  const surfaceBounds=surface.getBoundingClientRect();
  if(!surfaceBounds.width)return [];
  const scale=surfaceBounds.width/c.width;
  const items=[],issues=[];
  const metricsContext=document.createElement('canvas').getContext('2d');
  for(const node of root.querySelectorAll('[data-element]')){
    const id=node.dataset.element,def=resolveElementDef(id);
    if(def?.kind!=='text'||!elementVisible(c,id)||!node.textContent.trim())continue;
    const style=getComputedStyle(node);
    if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
    const rects=[];
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const text=walker.currentNode;
      if(!text.textContent.trim()||text.parentElement?.closest('svg'))continue;
      if(text.parentElement?.closest('[data-element]')!==node)continue;
      const range=document.createRange();
      const value=text.textContent;
      range.setStart(text,value.search(/\S/));range.setEnd(text,value.trimEnd().length);
      const textStyle=getComputedStyle(text.parentElement);
      metricsContext.font=textStyle.font||[textStyle.fontStyle,textStyle.fontWeight,textStyle.fontSize,textStyle.fontFamily].join(' ');
      const metrics=metricsContext.measureText(value.trim());
      // Range rectangles include empty font ascender/descender space. Trim that
      // space using actual glyph metrics so adjacent large/small text is not a collision.
      for(const rect of range.getClientRects())if(rect.width&&rect.height){
        const top=(rect.top-surfaceBounds.top)/scale;
        const ascent=metrics.fontBoundingBoxAscent??rect.height/scale*.8;
        rects.push({left:(rect.left-surfaceBounds.left)/scale,right:(rect.right-surfaceBounds.left)/scale,top:top+Math.max(0,ascent-metrics.actualBoundingBoxAscent),bottom:top+ascent+metrics.actualBoundingBoxDescent});
      }
    }
    items.push({id,label:def.label,rects});
    const clipped=['hidden','clip'].includes(style.overflowX)&&node.scrollWidth>node.clientWidth+2||['hidden','clip'].includes(style.overflowY)&&node.scrollHeight>node.clientHeight+2;
    if(clipped)issues.push({type:'clipped',ids:[id],message:'El texto de «'+def.label+'» queda recortado en su espacio. Amplía el elemento o reduce el texto.'});
  }
  return [...issues,...textCollisions(items)];
}

export function renderDesignDiagnostics(root,c) {
  const issues=root?collectDesignDiagnostics(root,c):collectCurrentDesignDiagnostics(c);
  const panel=document.getElementById('design-diagnostics');
  if(panel){
    panel.hidden=!issues.length;
    const html='<summary>'+issues.length+' aviso'+(issues.length===1?'':'s')+' de legibilidad</summary><ul>'+issues.map(issue=>'<li>'+esc(issue.message)+'</li>').join('')+'</ul>';
    if(panel.innerHTML!==html)panel.innerHTML=html;
  }
  return issues;
}
