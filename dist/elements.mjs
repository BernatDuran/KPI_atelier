import {sanitizeAppearance} from './appearance.mjs';
// Shared by the direct-manipulation editor and the exported HTML renderer.
export const ELEMENTS={
 eyebrow:{label:'Etiqueta superior',kind:'text',sizeKey:'eyebrowSize',defaultSize:9,contentKey:'eyebrow'},
 icon:{label:'Icono',kind:'icon',sizeKey:'iconSize',defaultSize:20,toggle:'showIcon'},
 title:{label:'Título del KPI',kind:'text',sizeKey:'titleSize',defaultSize:14,contentKey:'title'},
 value:{label:'Valor principal',kind:'text',sizeKey:'valueSize',defaultSize:48},
 subtitle:{label:'Subtítulo',kind:'text',sizeKey:'subtitleSize',defaultSize:11,contentKey:'subtitle',toggle:'showSubtitle'},
 delta:{label:'Variación',kind:'text',sizeKey:'deltaSize',defaultSize:12,toggle:'showComparison'},
 compareLabel:{label:'Etiqueta de comparación',kind:'text',sizeKey:'compareLabelSize',defaultSize:11,toggle:'showComparison'},
 trend:{label:'Gráfico',kind:'chart',sizeKey:'trendHeight',defaultSize:75,toggle:'showTrend'},
 goalLabel:{label:'Objetivo y referencia',kind:'text',sizeKey:'goalSize',defaultSize:11,toggle:'showGoal'},
 progressLabel:{label:'Porcentaje de avance',kind:'text',sizeKey:'progressSize',defaultSize:11,toggle:'showGoal'},
 progress:{label:'Barra de progreso',kind:'bar',sizeKey:'progressHeight',defaultSize:4,toggle:'showGoal'},
 status:{label:'Semáforo y estado',kind:'text',sizeKey:'statusSize',defaultSize:12},
 referenceLabel:{label:'Etiqueta de referencia',kind:'text',sizeKey:'referenceSize',defaultSize:11,toggle:'showComparison'},
 referenceValue:{label:'Valor de referencia',kind:'text',sizeKey:'referenceValueSize',defaultSize:11,toggle:'showComparison'},
 footer:{label:'Texto del pie',kind:'text',sizeKey:'footerSize',defaultSize:9,contentKey:'footer',toggle:'showFooter'},
 period:{label:'Período',kind:'text',sizeKey:'periodSize',defaultSize:9,toggle:'showFooter'}
};
export const ELEMENT_IDS=Object.keys(ELEMENTS);
// Top of the layer panel is the front of the card. Defaults match HTML paint order.
export const DEFAULT_LAYER_ORDER=['period','footer','referenceValue','referenceLabel','progress','progressLabel','goalLabel','trend','status','compareLabel','delta','subtitle','value','title','icon','eyebrow'];
export const SIZE_LIMITS={text:[6,140],icon:[10,120],chart:[24,240],bar:[2,40]};
export const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export const snap=(v,step=1)=>Math.round(v/step)*step;
export function resolveElementDef(id){
 if(!id||typeof id!=='string') return null;
 if(ELEMENTS[id]) return ELEMENTS[id];
 const m=id.match(/^([a-zA-Z]+)_copy(\d+)$/);
 if(m&&ELEMENTS[m[1]]){
  const base=ELEMENTS[m[1]];
  ELEMENTS[id]={...base,label:`${base.label} (Copia ${m[2]})`,isDuplicate:true,baseId:m[1]};
  return ELEMENTS[id];
 }
 return null;
}
export function sanitizeElements(raw){
 const result={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;
 const keys=new Set([...ELEMENT_IDS,...Object.keys(raw)]);
 for(const id of keys){
  resolveElementDef(id);
  if(!ELEMENTS[id])continue;
  const p=raw[id];if(!p||typeof p!=='object'||Array.isArray(p))continue;const el={};
  for(const key of ['x','y'])el[key]=Number.isFinite(Number(p[key]))?clamp(Math.round(Number(p[key])),-1000,1000):0;
  el.width=Number.isFinite(Number(p.width))?clamp(Math.round(Number(p.width)),0,800):0;
  el.hidden=p.hidden===true;el.deleted=p.deleted===true;
  if(typeof p.text==='string')el.text=p.text.slice(0,160);
  if(typeof p.icon==='string')el.icon=p.icon.slice(0,40);
  if(Number.isFinite(Number(p.size)))el.size=clamp(Math.round(Number(p.size)),6,240);
  if(typeof p.measure==='string')el.measure=p.measure.slice(0,120);
  if(typeof p.format==='string'&&['currency','percent','number'].includes(p.format))el.format=p.format;
  if(Number.isFinite(Number(p.decimals)))el.decimals=clamp(Math.round(Number(p.decimals)),0,3);
  if(typeof p.suffix==='string')el.suffix=p.suffix.slice(0,40);
  if(typeof p.unit==='string'&&['none','auto','k','m'].includes(p.unit))el.unit=p.unit;
  if(typeof p.currency==='string'&&['EUR','USD','GBP'].includes(p.currency))el.currency=p.currency;
  if(typeof p.targetMeasure==='string')el.targetMeasure=p.targetMeasure.slice(0,120);
  if(typeof p.compareMeasure==='string')el.compareMeasure=p.compareMeasure.slice(0,120);
  if(typeof p.deltaMode==='string'&&['relative','absolute','pp'].includes(p.deltaMode))el.deltaMode=p.deltaMode;
  if(typeof p.comparison==='string'&&['yoy','mom','previous','target','custom','none'].includes(p.comparison))el.comparison=p.comparison;
  if(typeof p.direction==='string'&&['up','down','neutral'].includes(p.direction))el.direction=p.direction;
  if(typeof p.statusGood==='string')el.statusGood=p.statusGood.slice(0,80);
  if(typeof p.statusWarn==='string')el.statusWarn=p.statusWarn.slice(0,80);
  if(typeof p.statusBad==='string')el.statusBad=p.statusBad.slice(0,80);
  if(Number.isFinite(Number(p.goodThreshold)))el.goodThreshold=Number(p.goodThreshold);
  if(Number.isFinite(Number(p.warnThreshold)))el.warnThreshold=Number(p.warnThreshold);
  const frame=sanitizeFrame(p.frame);if(frame)el.frame=frame;
  result[id]={...el,...sanitizeAppearance(p,id)};
 }return result;
}
export function elementState(c,id){return {x:0,y:0,width:0,hidden:false,deleted:false,...c.elements?.[id]};}
export function elementSize(c,id){
 resolveElementDef(id);
 const e=ELEMENTS[id];
 if(!e)return 12;
 if(c.elements?.[id]?.size!==undefined)return c.elements[id].size;
 return c[e.sizeKey]??(id==='progress'&&c.type==='target'?8:e.defaultSize);
}
export function elementAvailable(c,id){
 resolveElementDef(id);
 const def=ELEMENTS[id];
 if(!def)return false;
 if(def.isDuplicate)return elementAvailable(c,def.baseId);
 if(['goalLabel','progressLabel','progress'].includes(id))return ['target','executive'].includes(c.type)&&!(c.chartKind==='donut'&&c.showTrend&&!elementState(c,'trend').deleted&&!elementState(c,'trend').hidden);
 if(['delta','compareLabel'].includes(id))return c.comparison!=='none';
 if(id==='trend')return ['spark','executive','target'].includes(c.type);
 if(id==='status')return c.type==='status';
 if(['referenceLabel','referenceValue'].includes(id))return c.type==='comparison'&&c.comparison!=='none';
 return true;
}
export function elementEnabled(c,id){const key=ELEMENTS[id]?.toggle;return elementAvailable(c,id)&&(!key||c[key]!==false);}
export function elementVisible(c,id){const state=elementState(c,id);return elementEnabled(c,id)&&!state.hidden&&!state.deleted;}
export function updateElement(c,id,patch){return {...c,elements:{...c.elements,[id]:{...elementState(c,id),...patch}}};}
export function sanitizeFrame(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 if(!['left','top','width','height'].every(key=>typeof raw[key]==='number'&&Number.isFinite(raw[key]))||raw.width<0||raw.height<0)return null;
 const round=n=>Math.round(n*1000)/1000;
 return {left:round(clamp(raw.left,-10000,10000)),top:round(clamp(raw.top,-10000,10000)),width:round(clamp(raw.width,1,4000)),height:round(clamp(raw.height,0,10000))};
}
export function frameFromBounds(c,id,box,surface,scale=1){
 if(!Number.isFinite(scale)||scale<=0)return null;
 const p=elementState(c,id);
 // Absolute children use the inside border edge as their containing-block origin.
 return sanitizeFrame({left:(box.left-surface.left)/scale-c.borderWidth-p.x,top:(box.top-surface.top)/scale-c.borderWidth-p.y,width:box.width/scale,height:box.height/scale});
}
export function detachElement(c,id,frame){
 const p=elementState(c,id),safe=sanitizeFrame(frame);if(p.frame||!safe)return c;
 return updateElement(c,id,{frame:safe,...(p.width?{width:Math.round(safe.width)}:{})});
}
export function moveElement(c,id,dx,dy,step=1,frame=null){
 const p=elementState(c,id),x=clamp(p.x+snap(dx,step),-1000,1000),y=clamp(p.y+snap(dy,step),-1000,1000);
 const next=x!==p.x||y!==p.y?detachElement(c,id,frame):c;
 return updateElement(next,id,{x,y});
}
export function resizeElement(c,id,delta,axis='size',measuredWidth=100,step=1){
 if(axis==='width'){const p=elementState(c,id);return updateElement(c,id,{width:clamp(Math.round(p.width||measuredWidth)+snap(delta,step),16,800)});}
 resolveElementDef(id);
 const def=ELEMENTS[id],bounds=SIZE_LIMITS[def.kind];
 const newSize=clamp(elementSize(c,id)+snap(delta,step),...bounds);
 if(def?.isDuplicate){return updateElement(c,id,{size:newSize});}
 return {...c,[def.sizeKey]:newSize};
}
export function restoreElement(c,id){const def=ELEMENTS[id];const n=updateElement(c,id,{hidden:false,deleted:false});if(def.toggle)n[def.toggle]=true;return n;}
export function releaseElement(c,id){const p={...elementState(c,id),x:0,y:0,width:0};delete p.frame;return {...c,elements:{...c.elements,[id]:p}};}
export function sanitizeLayerOrder(raw){
 const known=Array.isArray(raw)?raw.filter(id=>ELEMENT_IDS.includes(id)||resolveElementDef(id)):[];
 return [...new Set([...known,...DEFAULT_LAYER_ORDER])];
}
export const layerOrder=c=>sanitizeLayerOrder(c.layerOrder);
export const layerZIndex=(c,id)=>Math.max(1,layerOrder(c).length-layerOrder(c).indexOf(id));
export function reorderLayer(c,id,target,placement='before'){
 resolveElementDef(id); resolveElementDef(target);
 if(id===target||(!ELEMENT_IDS.includes(id)&&!ELEMENTS[id])||(!ELEMENT_IDS.includes(target)&&!ELEMENTS[target]))return c;
 const current=layerOrder(c),next=current.filter(key=>key!==id);
 next.splice(next.indexOf(target)+(placement==='after'?1:0),0,id);
 return next.every((key,i)=>key===current[i])?c:{...c,layerOrder:next};
}
export function moveLayer(c,id,direction){
 const visible=layerOrder(c).filter(key=>elementAvailable(c,key)),index=visible.indexOf(id),target=visible[index+(direction<0?-1:1)];
 return index<0||!target?c:reorderLayer(c,id,target,direction<0?'before':'after');
}
