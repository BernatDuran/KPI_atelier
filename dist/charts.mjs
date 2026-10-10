import {elementColor,elementBackground,trendFill} from './appearance.mjs';
import {chartDimensions} from './layout.mjs';
const n=v=>Number(v.toFixed(3));
export function chartGeometry(c){const {width,height}=chartDimensions(c),labels=height>=56&&width>=100,top=labels&&c.showMax?22:7,bottom=height-(labels&&c.showMin?21:7);return {width,height,labels,left:7,right:width-7,top,bottom,spanX:width-14,spanY:Math.max(1,bottom-top)};}
export function chartPoints(c,values){
 const g=chartGeometry(c),v=values.filter(Number.isFinite),low=c.zeroBase?Math.min(0,...v):Math.min(...v),high=c.zeroBase?Math.max(0,...v):Math.max(...v),range=high-low;
 return v.map((value,i)=>({value,x:n(v.length===1?g.width/2:g.left+i*g.spanX/(v.length-1)),y:n(range?g.bottom-(value-low)/range*g.spanY:(g.top+g.bottom)/2)}));
}
export function linePath(points,curve){return points.map((p,i)=>{if(!i)return `M${p.x},${p.y}`;const prev=points[i-1],mid=n((prev.x+p.x)/2);return curve==='smooth'?`C${mid},${prev.y} ${mid},${p.y} ${p.x},${p.y}`:curve==='step'?`H${mid}V${p.y}H${p.x}`:`L${p.x},${p.y}`;}).join(' ');}
function grid(c,g){if(c.trendGrid==='none')return '';return [0,.5,1].map(t=>`<line x1="${g.left}" x2="${g.right}" y1="${n(g.top+t*g.spanY)}" y2="${n(g.top+t*g.spanY)}" stroke="${c.muted}" stroke-opacity=".2" stroke-width="1" ${c.trendGrid==='dots'?'stroke-dasharray="1 5" stroke-linecap="round"':''}/>`).join('');}
export function hash(s){let h=0;for(const ch of s)h=(h*31+ch.charCodeAt(0))>>>0;return h.toString(36);}
export function trendSVG(c,{path='',first='',last='',bars='',annotations='',area=null}){
 const g=chartGeometry(c),color=elementColor(c,'trend'),fill=trendFill(c),id='kpi-area-'+hash(JSON.stringify([fill,c.fillOpacity,g]));
 const defs=c.trendStyle==='area'&&c.areaFill==='gradient'?`<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${fill}" stop-opacity="${c.fillOpacity}"/><stop offset="100%" stop-color="${fill}" stop-opacity="0"/></linearGradient></defs>`:'';
 const defaultArea=c.trendStyle==='area'?`<path d="${path} L${last},${g.bottom} L${first},${g.bottom} Z" fill="${c.areaFill==='gradient'?'url(#'+id+')':fill}" opacity="${c.areaFill==='gradient'?1:c.fillOpacity}"/>`:'';
 const renderedArea=area!==null?area:defaultArea;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.width} ${g.height}" width="100%" height="${g.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolución del KPI">${grid(c,g)}${defs}${c.trendStyle==='bars'?bars:renderedArea+`<path d="${path}" fill="none" stroke="${color}" stroke-width="${c.lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`}${annotations}</svg>`;
}
export function markerSVG(c,kind,{x,y,label='',anchor='middle',labelX=x,labelY=y}){
 const color=elementColor(c,'trend'),g=chartGeometry(c);
 return `${c.showMarkerGuides&&kind!=='last'?`<path d="M${x},${g.top} V${g.bottom} M${g.left},${y} H${g.right}" fill="none" stroke="${color}" stroke-opacity=".35" stroke-dasharray="2 4"/>`:''}${kind!=='last'?`<circle cx="${x}" cy="${y}" r="7" fill="${color}" fill-opacity=".14"/>`:''}<circle cx="${x}" cy="${y}" r="${kind==='last'?3:3.5}" fill="${color}"/>${g.labels&&label?`<text x="${labelX}" y="${labelY}" text-anchor="${anchor}" fill="${color}" font-family="${c.font},sans-serif" font-size="9" font-weight="600">${label}</text>`:''}`;
}
export function extrema(points){if(!points.length)return {};return {min:points.reduce((a,b)=>b.value<a.value?b:a),max:points.reduce((a,b)=>b.value>a.value?b:a)};}
export function emptyTrend(c){return `<div style="height:${c.trendHeight}px;color:${c.muted};display:flex;align-items:center;justify-content:center;font-size:12px">Sin datos de tendencia</div>`;}
export function renderSeries(c,values,format){
 const pts=chartPoints(c,values);if(!pts.length)return emptyTrend(c);
 const g=chartGeometry(c),{min,max}=extrema(pts),path=linePath(pts,c.trendCurve),color=elementColor(c,'trend');
 const low=c.zeroBase?Math.min(0,...pts.map(p=>p.value)):Math.min(...pts.map(p=>p.value)),high=c.zeroBase?Math.max(0,...pts.map(p=>p.value)):Math.max(...pts.map(p=>p.value));
 const baseline=c.zeroBase&&high!==low?Math.max(g.top,Math.min(g.bottom,g.bottom-(0-low)/(high-low)*g.spanY)):g.bottom;
 const barWidth=Math.max(1,Math.min(8,g.spanX/Math.max(1,pts.length)*.65));
 const bars=pts.map(p=>`<rect x="${n(p.x-barWidth/2)}" y="${n(Math.min(p.y,baseline))}" width="${n(barWidth)}" height="${n(Math.max(1,Math.abs(p.y-baseline)))}" rx="1.5" fill="${color}"/>`).join('');
 let annotations='';const marked=new Set();
 for(const [kind,p,show]of [['max',max,c.showMax],['min',min,c.showMin&&(!c.showMax||min.value!==max.value)]])if(show){marked.add(p);const anchor=p.x<g.width*.3?'start':p.x>g.width*.7?'end':'middle';annotations+=markerSVG(c,kind,{...p,anchor,label:(kind==='max'?'Máx. ':'Mín. ')+format(p.value),labelY:kind==='max'?12:g.height-4});}
 if((c.showDot||pts.length===1)&&!marked.has(pts.at(-1)))annotations+=markerSVG(c,'last',pts.at(-1));
 return trendSVG(c,{path,first:pts[0].x,last:pts.at(-1).x,bars,annotations});
}
export function renderDonut(c,d){
 const color=elementColor(c,'trend',d),r=64,track=elementBackground(c,'trend',d),g=chartDimensions(c);
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="100%" height="${g.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Avance hacia el objetivo"><circle cx="80" cy="80" r="${r}" fill="none" stroke="${track}" stroke-width="${c.donutThickness}"/><circle cx="80" cy="80" r="${r}" fill="none" stroke="${color}" stroke-width="${c.donutThickness}" pathLength="100" stroke-dasharray="${d.progressWidth} 100" transform="rotate(-90 80 80)"/>${c.donutLabel?`<text x="80" y="83" text-anchor="middle" fill="${color}" font-family="${c.font},sans-serif" font-size="24" font-weight="600">${d.progress}</text><text x="80" y="103" text-anchor="middle" fill="${c.muted}" font-family="${c.font},sans-serif" font-size="10">del objetivo</text>`:''}</svg>`;
}
