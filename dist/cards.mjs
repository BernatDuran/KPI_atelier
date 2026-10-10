import {elementFrame} from './layout.mjs';
import {renderSeries,renderDonut} from './charts.mjs';
import {appearance,elementColor,elementBackground,trendFill,surfaceStyles} from './appearance.mjs';
import {needsGoal,needsTrend,needsCompare} from './model.mjs';
import {ELEMENTS,elementState,elementEnabled,elementSize,layerZIndex,resolveElementDef} from './elements.mjs';
import {EXTRA_PATHS} from './icons.mjs';
export const esc = x=>String(x??'').replace(/[&<>"'@]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','@':'&#64;'}[c]));
const PATHS={ruler:'M3 3h18v18H3zM8 3v4m4-4v6m4-6v4M3 8h4m-4 4h6m-6 4h4',trend:'M3 17l6-6 4 4 8-10M15 5h6v6',chart:'M4 20V11m8 9V4m8 16V8',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-3.87',target:'M22 12a10 10 0 1 1-10-10M22 2l-10 10m10-10v6m0-6h-6',bolt:'M13 2L3 14h8l-1 8L21 10h-8l1-8',box:'M21 8l-9 5-9-5m9 5v9M3 7l9-5 9 5v10l-9 5-9-5z',shield:'M12 22s9-4 9-11V5l-9-3-9 3v6c0 7 9 11 9 11zM8 12l3 3 5-6',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',clock:'M12 8v5l3 2',layers:'M12 2L2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5',grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',square:'M4 4h16v16H4z',card:'M3 4h18v16H3zM3 10h18',compare:'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',signal:'M5 20v-4m7 4V9m7 11V3',sliders:'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6',code:'M8 6l-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',arrow:'M4 12h16m-6-6 6 6-6 6',chevron:'M9 5l7 7-7 7',chevronDown:'M6 9l6 6 6-6',check:'M5 12l4 4L19 6',plus:'M12 5v14M5 12h14',save:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h9',folder:'M3 7V4h6l2 3h10v13H3z',book:'M12 5v16M3 3c5 0 9 2 9 2s4-2 9-2v16c-5 0-9 2-9 2s-4-2-9-2z',search:'M21 21l-5-5',close:'M6 6l12 12M18 6L6 18',undo:'M3 10h10a7 7 0 0 1 7 7M3 10l6-6m-6 6 6 6',redo:'M21 10H11a7 7 0 0 0-7 7m17-7-6-6m6 6-6 6',download:'M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4',upload:'M12 16V3m-5 5 5-5 5 5M5 17v4h14v-4',copy:'M9 9h12v12H9zM15 9V3H3v12h6',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',eraser:'m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21m9 0H7m-2-7 7 7',info:'M12 11v6m0-10h.01',monitor:'M3 3h18v14H3zM12 17v4m-4 0h8',mobile:'M7 2h10v20H7zM11 18h2',sparkles:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z',expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',palette:'M12 22a10 10 0 1 1 10-10c0 3-4 1-5 3s2 4-1 6z',reset:'M3 11a9 9 0 1 1 2 7M3 4v7h7'};
export function icon(name,size=18,color='currentColor'){
 const circle=['clock','info'].includes(name)?'<circle cx="12" cy="12" r="9"/>':name==='search'?'<circle cx="10" cy="10" r="7"/>':name==='users'?'<circle cx="9" cy="7" r="4"/>':name==='target'?'<circle cx="12" cy="12" r="5"/>':'';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${circle}<path d="${EXTRA_PATHS[name]||PATHS[name]||PATHS.chart}"/></svg>`;
}
export function formatNumber(v,c){
 if(v===null||!Number.isFinite(v))return '—';
 const div=c.format==='percent'?1:c.unit==='m'?1e6:c.unit==='k'?1e3:c.unit==='auto'?(Math.abs(v)>=1e6?1e6:Math.abs(v)>=1e3?1e3:1):1;
 const n=new Intl.NumberFormat(c.locale,{minimumFractionDigits:c.decimals,maximumFractionDigits:c.decimals,style:c.format==='percent'?'percent':'decimal'}).format(v/div);
 return n+(div===1e6?' M':div===1e3?' mil':'')+(c.format==='currency'?' '+({EUR:'€',USD:'$',GBP:'£'}[c.currency]):'')+(c.suffix?' '+c.suffix:'');
}
export function comparisonLabel(c){return {yoy:'vs. año anterior',mom:'vs. mes anterior',previous:'vs. período anterior',target:'vs. objetivo',custom:'vs. referencia',none:''}[c.comparison];}
export function seriesValues(c){return c.sampleSeries.split(/[,;\s]+/).filter(Boolean).map(Number).filter(Number.isFinite).slice(-c.maxPoints);}
export function sampleData(c){
 const value=c.sampleScenario==='empty'?null:c.sampleScenario==='zero'?0:c.sampleScenario==='negative'?-Math.abs(c.sampleValue):c.sampleValue;
 const previous=c.comparison==='target'?c.sampleTarget:c.samplePrevious;
 const delta=value===null||previous===null?null:value-previous;
 const relative=previous===0||delta===null?null:delta/Math.abs(previous);
 const favorable=delta===null||delta===0||c.direction==='neutral'?null:c.direction==='down'?delta<0:delta>0;
 const deltaDisplay=c.deltaMode==='pp'?(delta===null?'—':`${delta>0?'+':''}${new Intl.NumberFormat(c.locale,{maximumFractionDigits:1}).format(delta*100)} pp`):c.deltaMode==='absolute'?(delta===null?'—':`${delta>0?'+':''}${formatNumber(delta,c)}`):(relative===null?'—':`${relative>0?'+':''}${new Intl.NumberFormat(c.locale,{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(relative)}`);
 const status=value===null?'empty':c.direction==='down'?(value<=c.goodThreshold?'good':value<=c.warnThreshold?'warn':'bad'):(value>=c.goodThreshold?'good':value>=c.warnThreshold?'warn':'bad');
 const goal=value===null||c.sampleTarget<=0?null:value/c.sampleTarget;
 const goalGood=goal!==null&&(c.direction==='down'?value<=c.sampleTarget:value>=c.sampleTarget);
 return {value:esc(formatNumber(value,c)),delta:esc(deltaDisplay),arrow:delta===null||delta===0?'—':delta>0?'↗':'↘',deltaColor:favorable===null?c.muted:favorable?c.positive:c.negative,
  previous:esc(formatNumber(previous,c)),target:esc(formatNumber(c.sampleTarget,c)),targettext:esc(formatNumber(c.sampleTarget,c)),progress:goal===null?'—':new Intl.NumberFormat(c.locale,{style:'percent',maximumFractionDigits:0}).format(goal),progressWidth:goal===null?'0':String(Math.max(0,Math.min(100,goal*100))),goalColor:goal===null?c.muted:c.direction==='neutral'?c.accent:goalGood?c.positive:c.warning,
  status:esc(status==='empty'?'Sin datos':c[{good:'statusGood',warn:'statusWarn',bad:'statusBad'}[status]]),statusColor:status==='empty'?c.muted:status==='good'?c.positive:status==='warn'?c.warning:c.negative,
  statusGoodOpacity:status==='good'?1:.2,statusWarnOpacity:status==='warn'?1:.2,statusBadOpacity:status==='bad'?1:.2,
  trend:renderTrend(c,c.sampleScenario==='empty'?[]:seriesValues(c)),period:'Período seleccionado',footer:esc(c.footer||'Rendimiento del período'),trendLabel:'Evolución · datos de muestra'};
}
export function renderTrend(c,values,elementId='trend'){return renderSeries(c,values,v=>esc(formatNumber(v,c)),elementId);}
/**
 * @param {any} c
 * @param {any} [d]
 * @param {boolean} [editor]
 */
export function cardHTML(c,d=sampleData(c),editor=false){
 const style=`box-sizing:border-box;width:${c.geometryVersion===2?c.width+'px':'100%'};${c.geometryVersion===2?'height:'+c.height+'px;overflow:hidden;':'min-height:'+c.height+'px;'}padding:${c.padding}px;border-radius:${c.radius}px;color:${c.text};border:${c.borderWidth}px solid ${c.borderColor};font-family:${c.font},sans-serif;text-align:${c.align};${surfaceStyles(c)}display:flex;flex-direction:column;gap:16px;overflow-wrap:anywhere;position:relative;isolation:isolate;`;
 const color=id=>elementColor(c,id,d),bg=id=>elementBackground(c,id,d);
 const detached=[];
 const el=(id,html,extra='')=>{
  const state=elementState(c,id),def=ELEMENTS[id];if(!elementEnabled(c,id)||state.deleted)return '';
  const attributes=editor?` data-element="${id}" class="editable-element" role="button" tabindex="0" aria-label="${def.label}: seleccionar y mover"`:'';
  const fixed=c.geometryVersion===2,frame=fixed?elementFrame(c,id):state.frame,width=state.width||(frame?(def.kind==='icon'?elementSize(c,id):frame.width):0);
  const position=frame?`position:absolute;left:${frame.left}px;top:${frame.top}px;margin:0;`:'position:relative;';
  const visual=`<div${attributes} style="${extra};box-sizing:border-box;${position}transform:translate(${state.x}px,${state.y}px);${width?'width:'+width+'px;':''}font-size:${elementSize(c,id)}px;color:${color(id)};opacity:${appearance(c,id).opacity/100};z-index:${layerZIndex(c,id)};${state.hidden?'visibility:hidden;':''}">${html}</div>`;
  if(!frame)return visual;
  if(fixed){detached.push(visual);return '';}
  // Keep its original layout slot, then paint the independently sized object at card level.
  // A transform alone would still let font/width/height edits reflow its siblings.
  detached.push(visual);
  const slotStyle=extra.replace(/(?:^|;)(?:width|height):[^;]*/g,'');
  return `<div${editor?` data-layout-slot="${id}"`:''} aria-hidden="true" style="${slotStyle};box-sizing:border-box;visibility:hidden;pointer-events:none;flex:none;width:${frame.width}px;height:${frame.height}px;padding:0;border:0;min-width:0;font-size:0;line-height:0;overflow:hidden;"></div>`;
 };
 const row=(body,styles='')=>body?`<div style="${styles}">${body}</div>`:'';
 const flex='display:flex;align-items:center;justify-content:space-between;gap:10px;';
 const heading=row(el('eyebrow',esc(c.eyebrow),`font-weight:600;letter-spacing:1.5px;`)+el('icon',icon(c.icon,elementSize(c,'icon'),color('icon')),`display:flex;flex-shrink:0;margin-left:auto;line-height:0;background:${bg('icon')};border-radius:8px;`),flex);
 const metric=row(el('title',esc(c.title),`line-height:1.4;margin-bottom:5px;`)+el('value',d.value,`line-height:1.12;letter-spacing:-1.8px;font-weight:${c.fontWeight};`)+el('subtitle',esc(c.subtitle),`margin-top:7px;line-height:1.4;`));
 const origCompText=elementState(c,'compareLabel').text;
 const origCompLabel=(origCompText&&origCompText.trim())?esc(origCompText):esc(comparisonLabel(c));
 const comparison=row(el('delta',`${d.arrow} ${d.delta}`,`background:${bg('delta')};padding:5px 8px;border-radius:6px;font-weight:600;line-height:1.4;width:fit-content;`)+el('compareLabel',origCompLabel,`line-height:1.4;`),`display:flex;align-items:center;gap:9px;flex-wrap:wrap;${c.align==='center'?'justify-content:center;':''}`);
 const progressLabels=row(el('goalLabel',`Objetivo <span style="color:${appearance(c,'goalLabel').colorMode==='custom'?color('goalLabel'):c.text}">${d.targettext||d.target}</span>`,`line-height:1.4;`)+el('progressLabel',d.progress,`font-weight:600;line-height:1.4;`),flex+'margin-bottom:9px;');
 const progressBar=el('progress',`<div style="height:100%;width:${d.progressWidth}%;background:${color('progress')};border-radius:8px"></div>`,`height:${elementSize(c,'progress')}px;border-radius:8px;background:${bg('progress')};overflow:hidden;`);
 const goal=row(progressLabels+progressBar,'margin-top:auto;');
 const status=el('status',`<div style="display:flex;gap:5px">${[['Bad',c.negative],['Warn',c.warning],['Good',c.positive]].map(([key,color])=>`<span style="width:.75em;height:.75em;border-radius:50%;background:${color};opacity:${d['status'+key+'Opacity']}"></span>`).join('')}</div><span style="font-weight:600;color:${color('status')}">${d.status}</span>`,`display:flex;align-items:center;gap:10px;padding:14px;border-radius:10px;line-height:1.4;background:${bg('status')};`);
 const trend=el('trend',c.chartKind==='donut'?renderDonut(c,d):d.trend,'margin-top:auto;line-height:0;');
 const prior=row(el('referenceLabel',c.comparison==='target'?'Objetivo':'Referencia',`line-height:1.4;`)+el('referenceValue',d.previous,`font-weight:600;line-height:1.4;`),flex+`border-top:1px solid ${c.borderColor};padding-top:12px;`);
 const footer=row(el('footer',d.footer||esc(c.footer),`line-height:1.4;`)+el('period',d.period,`line-height:1.4;`),flex+'margin-top:auto;align-items:flex-start;');
 const duplicateIds=Object.keys(c.elements||{}).filter(id=>id.includes('_copy'));
 for(const dupId of duplicateIds){
  const def=resolveElementDef(dupId);
  if(!def)continue;
  const dupState=elementState(c,dupId);
  if(!dupState||dupState.deleted)continue;
  let dupContent='',dupExtra='';
  if(def.kind==='icon'){
   dupContent=icon(dupState.icon||c.icon,elementSize(c,dupId),color(dupId));
   dupExtra=`display:flex;flex-shrink:0;line-height:0;background:${bg(dupId)};border-radius:8px;`;
  }
  else if(def.baseId==='value'){
   dupContent=d[`val_${dupId}`]||esc(formatNumber(c.sampleValue,{...c,...dupState}));
   dupExtra=`line-height:1.12;letter-spacing:-1.8px;font-weight:${c.fontWeight};`;
  }
  else if(def.baseId==='delta'){
   const dupComparison=dupState.comparison||c.comparison;
   let dVal=d[`delta_${dupId}`];
   if(!dVal){
    if(dupComparison==='none'){
     dVal='—';
    }else{
     dVal=`${d.arrow} ${d.delta}`;
    }
   }
   dupContent=dVal;
   dupExtra=`background:${bg(dupId)};padding:5px 8px;border-radius:6px;font-weight:600;line-height:1.4;width:fit-content;`;
  }
  else if(def.baseId==='compareLabel'){
   const dupComp=dupState.comparison||c.comparison;
   const autoDupLabel=comparisonLabel({comparison:dupComp});
   dupContent=(dupState.text&&dupState.text.trim())?esc(dupState.text):esc(autoDupLabel);
   dupExtra='line-height:1.4;';
  }
  else if(def.baseId==='trend'){
   const chartKind=dupState.chartKind||c.chartKind;
   const dupHeight=elementSize(c,dupId);
   const dupC={...c,...dupState,trendHeight:dupHeight};
   dupContent=chartKind==='donut'?renderDonut(dupC,d,dupId):(d[`trend_${dupId}`]||renderTrend(dupC,c.sampleScenario==='empty'?[]:seriesValues(dupC),dupId));
   dupExtra='line-height:0;';
  }
  else if(def.baseId==='status'){
   const sGood=dupState.statusGood||c.statusGood||'Favorable';
   const sWarn=dupState.statusWarn||c.statusWarn||'En alerta';
   const sBad=dupState.statusBad||c.statusBad||'Desfavorable';
   const val=c.sampleValue;
   const gTh=dupState.goodThreshold??c.goodThreshold;
   const wTh=dupState.warnThreshold??c.warnThreshold;
   const dir=dupState.direction||c.direction;
   const st=dir==='down'?(val<=gTh?'good':val<=wTh?'warn':'bad'):(val>=gTh?'good':val>=wTh?'warn':'bad');
   const stText=st==='good'?sGood:st==='warn'?sWarn:sBad;
   dupContent=`<div style="display:flex;gap:5px">${[['Bad',c.negative],['Warn',c.warning],['Good',c.positive]].map(([key,color])=>`<span style="width:.75em;height:.75em;border-radius:50%;background:${color};opacity:${st===key.toLowerCase()?1:.2}"></span>`).join('')}</div><span style="font-weight:600;color:${color(dupId)}">${esc(stText)}</span>`;
   dupExtra=`display:flex;align-items:center;gap:10px;padding:14px;border-radius:10px;line-height:1.4;background:${bg(dupId)};`;
  }
  else {
   dupContent=(d[`val_${dupId}`]&&dupState.measure)?d[`val_${dupId}`]:esc(dupState.text!==undefined?dupState.text:(def.contentKey?c[def.contentKey]:def.label));
   dupExtra='line-height:1.4;';
  }
  const dupV=el(dupId,dupContent,dupExtra);if(dupV)detached.push(dupV);
 }
 return `<div${editor?' data-card-surface="true"':''} style="${style}">${heading}${metric}${comparison}${status}${trend}${goal}${prior}${footer}${detached.join('')}</div>`;
}
export function tokenData(c=null){
 const tokens=Object.fromEntries(['value','delta','arrow','deltaColor','previous','target','targettext','progress','progressWidth','goalColor','status','statusColor','statusGoodOpacity','statusWarnOpacity','statusBadOpacity','trend','period','trendLabel','footer'].map(k=>[k,`@@${k}@@`]));
 if(c&&c.elements){
  for(const dupId of Object.keys(c.elements).filter(id=>id.includes('_copy'))){
   tokens[`val_${dupId}`]=`@@val_${dupId}@@`;
   tokens[`delta_${dupId}`]=`@@delta_${dupId}@@`;
   tokens[`trend_${dupId}`]=`@@trend_${dupId}@@`;
  }
 }
 return tokens;
}
