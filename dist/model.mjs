import {sanitizeElements,ELEMENTS,SIZE_LIMITS,elementEnabled,elementState,DEFAULT_LAYER_ORDER,sanitizeLayerOrder} from './elements.mjs';
import {ICON_OPTIONS} from './icons.mjs';
export const FAMILIES = [
 {id:'all',name:'Todas las tarjetas',icon:'grid'}, {id:'basic',name:'KPI esenciales',icon:'square'},
 {id:'comparison',name:'Comparativas',icon:'compare'}, {id:'target',name:'Objetivos',icon:'target'},
 {id:'status',name:'Semáforos',icon:'signal'}, {id:'spark',name:'Tendencias',icon:'trend'}, {id:'executive',name:'Ejecutivas',icon:'layers'}
];
export const BASE = {
 id:'executive-night',type:'executive',title:'Ingresos totales',subtitle:'Visión de negocio',eyebrow:'REVENUE OVERVIEW',
 measure:'Total Ventas',measureName:'KPI_Ventas_HTML',dateTable:'Calendario',dateColumn:'Fecha',targetMeasure:'Objetivo Ventas',compareMeasure:'Ventas Periodo Anterior',
 format:'currency',currency:'EUR',unit:'auto',decimals:1,locale:'es-ES',suffix:'',direction:'up',comparison:'yoy',deltaMode:'relative',
 theme:'night',accent:'#c3ec83',positive:'#96daa7',negative:'#ff9a98',warning:'#e8c373',background:'#17272b',text:'#ffffff',muted:'#a4b5b5',
 geometryVersion:2,layout:'stacked',width:440,height:400,radius:22,padding:28,borderWidth:1,borderColor:'#304247',shadow:'soft',font:'Segoe UI',valueSize:48,titleSize:14,fontWeight:600,align:'left',
 showIcon:true,icon:'trend',showSubtitle:true,showComparison:true,showTrend:true,showGoal:true,showFooter:true,footer:'Rendimiento del período',
 chartKind:'trend',trendCurve:'smooth',areaFill:'gradient',showMin:false,showMax:false,trendGrid:'none',showMarkerGuides:false,donutThickness:12,donutLabel:true,trendStyle:'area',trendHeight:75,lineWidth:2.4,fillOpacity:.12,showDot:true,granularity:'auto',maxPoints:24,zeroBase:false,
 goodThreshold:.95,warnThreshold:.8,statusGood:'En objetivo',statusWarn:'En seguimiento',statusBad:'Requiere atención',
 sampleValue:1245800,samplePrevious:1087500,sampleTarget:1400000,sampleSeries:'66,72,65,83,80,93,87,108,102,120,115,138',sampleScenario:'normal',
 surfaceEffect:'solid',effectIntensity:35,glassOpacity:70,glassBlur:16,effectColorMode:'theme',effectColor:'#8771bb',
 elements:{},layerOrder:DEFAULT_LAYER_ORDER,eyebrowSize:9,iconSize:20,subtitleSize:11,deltaSize:12,compareLabelSize:11,goalSize:11,progressSize:11,progressHeight:4,statusSize:12,referenceSize:11,referenceValueSize:11,footerSize:9,periodSize:9,customThemeName:''
};
export const THEMES = {
 night:{name:'Midnight',background:'#17272b',text:'#ffffff',muted:'#a4b5b5',accent:'#c3ec83',borderColor:'#304247',positive:'#96daa7',negative:'#ff9a98',warning:'#e8c373'},
 paper:{name:'Porcelain',background:'#ffffff',text:'#253336',muted:'#7d898c',accent:'#477568',borderColor:'#e2e8e5',positive:'#278360',negative:'#cc5a54',warning:'#b6892f'},
 mint:{name:'Sage',background:'#eaf1e7',text:'#244333',muted:'#6c8273',accent:'#4b805d',borderColor:'#d9e4d4',positive:'#287247',negative:'#b95548',warning:'#9b7425'},
 lavender:{name:'Lavender',background:'#edeaf7',text:'#3c3454',muted:'#8a809a',accent:'#8771bb',borderColor:'#ddd7ef',positive:'#397b67',negative:'#bd596e',warning:'#a67a35'},
 sand:{name:'Sandstone',background:'#f6eee2',text:'#51412c',muted:'#9c8973',accent:'#bd8144',borderColor:'#e9dcc9',positive:'#57814d',negative:'#bd594a',warning:'#b98427'},
 cobalt:{name:'Cobalt',background:'#e8eefb',text:'#263858',muted:'#7388a6',accent:'#527bdd',borderColor:'#d4e0f5',positive:'#337b62',negative:'#bf565e',warning:'#9e7c30'},
 rose:{name:'Rosewater',background:'#f7ecee',text:'#543741',muted:'#916c79',accent:'#bd758b',borderColor:'#ead8dd',positive:'#407b62',negative:'#bc525e',warning:'#a87c39'},
 arctic:{name:'Arctic',background:'#e8f2f2',text:'#254548',muted:'#668589',accent:'#3d9596',borderColor:'#cfe4e4',positive:'#2f7f67',negative:'#bb6166',warning:'#a57d36'},
 terracotta:{name:'Terracotta',background:'#f7eae1',text:'#593c32',muted:'#937461',accent:'#b8664d',borderColor:'#ebd6c8',positive:'#557d4d',negative:'#bb4e47',warning:'#a07a27'},
 graphite:{name:'Graphite',background:'#292932',text:'#f4f1f7',muted:'#ada5bc',accent:'#c0b2ee',borderColor:'#45414e',positive:'#9bd9b8',negative:'#f5a4ac',warning:'#e5c48d'}
};
const p=(id,name,description,category,overrides)=>({id,name,description,category,config:{...BASE,id,progressHeight:category==='target'?8:4,...overrides}});
export const TEMPLATES = [
 p('executive-night','Executive Noir','Todo el contexto. Una sola tarjeta.','executive',{}),
 p('essential-paper','The Essential','La cifra que realmente importa.','basic',{type:'basic',theme:'paper',...THEMES.paper,title:'Clientes activos',eyebrow:'CUSTOMER BASE',subtitle:'Relaciones que crecen',format:'number',measure:'Clientes Activos',measureName:'KPI_Clientes_HTML',sampleValue:2847,samplePrevious:2563,showTrend:false,showGoal:false,height:260,valueSize:54,icon:'users'}),
 p('compare-mint','Growth Story','Un antes y un después muy claros.','comparison',{type:'comparison',theme:'mint',...THEMES.mint,title:'Ventas netas',subtitle:'Comparativa interanual',eyebrow:'GROWTH',showTrend:false,showGoal:false,height:290,comparison:'yoy'}),
 p('target-lavender','North Star','Cada objetivo, un poco más cerca.','target',{type:'target',theme:'lavender',...THEMES.lavender,title:'Objetivo comercial',subtitle:'Avance de ventas',eyebrow:'GOAL TRACKER',showTrend:false,showGoal:true,comparison:'target',height:320,icon:'target'}),
 p('status-paper','Pulse Check','El estado del negocio, sin ruido.','status',{type:'status',theme:'paper',...THEMES.paper,title:'SLA de resolución',subtitle:'Customer Service',eyebrow:'SERVICE HEALTH',format:'percent',unit:'none',measure:'Cumplimiento SLA',sampleValue:.967,samplePrevious:.943,sampleTarget:.98,goodThreshold:.95,warnThreshold:.85,showTrend:false,showGoal:false,comparison:'mom',height:320,icon:'shield'}),
 p('spark-paper','Quiet Trend','La evolución toma el protagonismo.','spark',{type:'spark',theme:'paper',...THEMES.paper,title:'Margen operativo',subtitle:'Evolución del período',eyebrow:'PROFITABILITY',format:'percent',unit:'none',measure:'Margen Operativo',sampleValue:.248,samplePrevious:.219,showGoal:false,height:360,trendStyle:'line'}),
 p('basic-lavender','Soft Number','Minimalismo con personalidad.','basic',{type:'basic',theme:'lavender',...THEMES.lavender,title:'Empleados afectados',subtitle:'Personas · absentismo',eyebrow:'PEOPLE',format:'number',unit:'none',decimals:0,measure:'Empleados Afectados',sampleValue:42,samplePrevious:49,direction:'down',showTrend:false,showGoal:false,height:260,icon:'users'}),
 p('comparison-sand','Less is More','Porque a veces, bajar es mejorar.','comparison',{type:'comparison',theme:'sand',...THEMES.sand,title:'Coste por intervención',eyebrow:'EFFICIENCY',subtitle:'Field Service',measure:'Coste Medio Intervencion',sampleValue:186,samplePrevious:212,direction:'down',comparison:'mom',unit:'none',showTrend:false,showGoal:false,height:290,icon:'bolt'}),
 p('target-mint','On Track','Una barra de progreso que inspira.','target',{type:'target',theme:'mint',...THEMES.mint,title:'Pedidos entregados',eyebrow:'DELIVERY',subtitle:'Plan de operaciones',format:'number',unit:'none',decimals:0,measure:'Pedidos Entregados',targetMeasure:'Objetivo Pedidos',sampleValue:846,sampleTarget:1000,samplePrevious:790,showTrend:false,comparison:'target',height:320,icon:'box'}),
 p('status-sand','Watchtower','Detecta lo que necesita atención.','status',{type:'status',theme:'sand',...THEMES.sand,title:'Tasa de absentismo',eyebrow:'PEOPLE HEALTH',subtitle:'Recursos humanos',measure:'Tasa Absentismo',format:'percent',unit:'none',sampleValue:.047,samplePrevious:.053,goodThreshold:.03,warnThreshold:.05,direction:'down',showTrend:false,showGoal:false,height:320,icon:'users'}),
 p('spark-cobalt','Blue Motion','Cada dato cuenta una historia.','spark',{type:'spark',theme:'cobalt',...THEMES.cobalt,title:'Oportunidades abiertas',eyebrow:'SALES PIPELINE',subtitle:'Actividad comercial',measure:'Oportunidades Abiertas',format:'number',decimals:0,unit:'none',sampleValue:184,samplePrevious:156,showGoal:false,height:360,trendStyle:'bars',icon:'layers'}),
 p('executive-paper','Boardroom','Visión ejecutiva, claridad absoluta.','executive',{theme:'paper',...THEMES.paper,title:'Facturación neta',eyebrow:'BUSINESS OVERVIEW',subtitle:'Resumen ejecutivo',icon:'chart'}),
 p('essential-night','Bold Statement','Un número. Toda la atención.','basic',{type:'basic',title:'NPS de clientes',eyebrow:'CUSTOMER EXPERIENCE',subtitle:'Lealtad y satisfacción',format:'number',unit:'none',decimals:0,measure:'NPS',sampleValue:68,samplePrevious:61,showTrend:false,showGoal:false,height:260,valueSize:64,icon:'heart'}),
 p('executive-sand','Golden Hour','Una visión cálida de tus resultados.','executive',{theme:'sand',...THEMES.sand,title:'EBITDA',eyebrow:'FINANCIAL PERFORMANCE',subtitle:'Finanzas',measure:'EBITDA',targetMeasure:'Objetivo EBITDA',sampleValue:428500,samplePrevious:396000,sampleTarget:500000,icon:'chart'}),
 p('spark-mint','Service Flow','El ritmo de un equipo que resuelve.','spark',{type:'spark',theme:'mint',...THEMES.mint,title:'Tiempo de resolución',eyebrow:'SERVICE OPERATIONS',subtitle:'Media de horas por caso',format:'number',unit:'none',suffix:'h',measure:'Horas Resolucion',sampleValue:6.2,samplePrevious:7.4,direction:'down',sampleSeries:'11,10,10.8,9,9.4,8.6,8.8,7.2,7.9,6.8,7.1,6.2',showGoal:false,height:360,icon:'clock'})
];
TEMPLATES.push(
 p('spark-horizontal','Horizon','Un trazo suave, con espacio para respirar.','spark',{type:'spark',theme:'paper',...THEMES.paper,layout:'chart-left',width:560,height:280,trendHeight:130,showGoal:false,showMax:true,showMarkerGuides:true,trendGrid:'dots',fillOpacity:.22,title:'Ingresos netos',eyebrow:'REVENUE',subtitle:'Evolución del período',trendStyle:'area'}),
 p('spark-right','Side Story','La cifra y su historia, lado a lado.','spark',{type:'spark',theme:'arctic',...THEMES.arctic,layout:'chart-right',width:560,height:280,trendHeight:130,showGoal:false,showMin:true,trendStyle:'line',title:'Ventas netas',eyebrow:'SALES',subtitle:'Evolución del período'}),
 p('target-donut','Full Circle','Un objetivo que se entiende de un vistazo.','target',{type:'target',theme:'lavender',...THEMES.lavender,layout:'chart-left',chartKind:'donut',width:520,height:280,trendHeight:160,showTrend:true,showGoal:true,comparison:'none',title:'Objetivo comercial',eyebrow:'GOAL TRACKER',subtitle:'Avance de ventas',icon:'target'})
);

export const LIMITS={geometryVersion:[1,2],donutThickness:[4,28],effectIntensity:[0,100],glassOpacity:[10,100],glassBlur:[0,40],width:[200,800],height:[200,650],radius:[0,40],padding:[12,48],borderWidth:[0,4],decimals:[0,3],valueSize:[24,80],titleSize:[10,24],fontWeight:[400,800],trendHeight:[40,150],lineWidth:[1,6],fillOpacity:[0,1],maxPoints:[6,90]};
export const ENUMS={layout:['stacked','chart-left','chart-right'],chartKind:['trend','donut'],trendCurve:['smooth','linear','step'],areaFill:['gradient','solid'],trendGrid:['none','horizontal','dots'],surfaceEffect:['solid','glass','aurora','glow','raised'],effectColorMode:['theme','custom'],type:['basic','comparison','target','status','spark','executive'],theme:[...Object.keys(THEMES),'custom'],format:['currency','number','percent'],currency:['EUR','USD','GBP'],unit:['auto','none','k','m'],locale:['es-ES','en-US','ca-ES'],direction:['up','down','neutral'],comparison:['yoy','mom','previous','target','custom','none'],deltaMode:['relative','absolute','pp'],shadow:['none','soft','strong'],font:['Segoe UI','Arial','Georgia'],align:['left','center'],trendStyle:['area','line','bars'],granularity:['auto','day','week','month'],sampleScenario:['normal','zero','empty','negative'],icon:['trend','chart','users','target','bolt','box','shield','heart','clock','layers']};
ENUMS.icon=ICON_OPTIONS.map(x=>x[0]);
for(const def of Object.values(ELEMENTS))LIMITS[def.sizeKey]=SIZE_LIMITS[def.kind];
export function healCorruptedText(str){
 if(typeof str!=='string'||!str)return str;
 return str
  .replace(/Visi[\uFFFD?]n(\s+de\s+negocio)?/gi,(m,rest)=>'Visión'+(rest||''))
  .replace(/per[\uFFFD?]odo/gi,'período')
  .replace(/atenci[\uFFFD?]n/gi,'atención')
  .replace(/evoluci[\uFFFD?]n/gi,'evolución')
  .replace(/a[\uFFFD?]o(\s+anterior)?/gi,(m,rest)=>'año'+(rest||''))
  .replace(/operaci[\uFFFD?]n/gi,'operación')
  .replace(/resoluci[\uFFFD?]n/gi,'resolución')
  .replace(/intervenci[\uFFFD?]n/gi,'intervención')
  .replace(/relaci[\uFFFD?]n/gi,'relación')
  .replace(/situaci[\uFFFD?]n/gi,'situación')
  .replace(/acci[\uFFFD?]n/gi,'acción')
  .replace(/direcci[\uFFFD?]n/gi,'dirección')
  .replace(/configuraci[\uFFFD?]n/gi,'configuración')
  .replace(/funci[\uFFFD?]n/gi,'función')
  .replace(/informaci[\uFFFD?]n/gi,'información')
  .replace(/producci[\uFFFD?]n/gi,'producción')
  .replace(/gesti[\uFFFD?]n/gi,'gestión')
  .replace(/selecci[\uFFFD?]n/gi,'selección')
  .replace(/\uFFFD/g,'');
}

export function sanitizeConfig(raw={}){
 if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{raw={};}}
 if(!raw||typeof raw!=='object')raw={};
 const c={...BASE,geometryVersion:raw.geometryVersion===undefined?1:2,elements:{},layerOrder:[...DEFAULT_LAYER_ORDER]};
 for(const k of Object.keys(BASE)){
  if(!(k in raw))continue;
  if(k==='elements'){c.elements=sanitizeElements(raw.elements);continue;}
  if(k==='layerOrder'){c.layerOrder=sanitizeLayerOrder(raw.layerOrder);continue;}
  if(ENUMS[k]){if(ENUMS[k].includes(raw[k]))c[k]=raw[k];continue;}
  if(typeof BASE[k]==='boolean'){c[k]=raw[k]===true;continue;}
  if(typeof BASE[k]==='number'){const v=Number(raw[k]);if(Number.isFinite(v))c[k]=LIMITS[k]?Math.min(LIMITS[k][1],Math.max(LIMITS[k][0],v)):Math.min(1e15,Math.max(-1e15,v));continue;}
  if(/^(accent|positive|negative|warning|background|text|muted|borderColor|effectColor)$/.test(k)){if(/^#[0-9a-f]{6}$/i.test(raw[k]))c[k]=raw[k];continue;}
  c[k]=healCorruptedText(String(raw[k]).slice(0,k==='sampleSeries'?2000:160));
 }
 for(const k of ['decimals','width','height','maxPoints'])c[k]=Math.round(c[k]);
 if(!('progressHeight' in raw)&&c.type==='target')c.progressHeight=8;
 if('_measureBound' in raw)c._measureBound=raw._measureBound===true;
 if('_targetCustomized' in raw)c._targetCustomized=raw._targetCustomized===true;
 if('_dateCustomized' in raw)c._dateCustomized=raw._dateCustomized===true;
 return c;
}
export function familyName(type){return FAMILIES.find(f=>f.id===type)?.name??type;}
const rendered=(c,id)=>elementEnabled(c,id)&&!elementState(c,id).deleted;
export function needsTrend(c){return c.chartKind!=='donut'&&rendered(c,'trend');}
export function needsGoal(c){return c.chartKind==='donut'&&rendered(c,'trend')||['goalLabel','progressLabel','progress'].some(id=>rendered(c,id));}
export function needsCompare(c){return ['delta','compareLabel'].some(id=>rendered(c,id))||c.type==='comparison'&&['referenceLabel','referenceValue'].some(id=>rendered(c,id))&&c.showComparison;}
export function needsDate(c){return needsTrend(c)||(needsCompare(c)&&['yoy','mom','previous'].includes(c.comparison));}
export function isValidMeasureName(name){
 if(!name||typeof name!=='string')return false;
 const t=name.trim();
 if(!t||t.length>120)return false;
 if(/[\[\]"'\r\n\t=]/.test(t))return false;
 return true;
}
export function getCircularConflict(c){
 if(!c||!c.measureName)return null;
 const norm=s=>(s||'').replace(/^\[|\]$/g,'').trim().toLowerCase();
 const target=norm(c.measureName);
 if(!target)return null;
 if(norm(c.measure)&&target===norm(c.measure)){
  return {type:'medida principal',name:c.measure.trim(),field:'measure'};
 }
 if((needsGoal(c)||(needsCompare(c)&&c.comparison==='target'))&&c.targetMeasure){
  const tTrim=c.targetMeasure.trim();
  if(!/^-?\d+(\.\d+)?$/.test(tTrim)&&target===norm(tTrim)){
   return {type:'medida objetivo',name:tTrim,field:'targetMeasure'};
  }
 }
 if(needsCompare(c)&&c.comparison==='custom'&&c.compareMeasure&&target===norm(c.compareMeasure)){
  return {type:'medida de referencia',name:c.compareMeasure.trim(),field:'compareMeasure'};
 }
 if(needsDate(c)&&c.dateColumn&&target===norm(c.dateColumn)){
  return {type:'columna de fechas',name:c.dateColumn.trim(),field:'dateColumn'};
 }
 return null;
}
export function checks(c){
 const issues=[];
 if(rendered(c,'title')&&!c.title.trim())issues.push({level:'error',text:'Añade un título para la tarjeta.',field:'title'});
 if(!c.measure.trim())issues.push({level:'error',text:'Indica el nombre de la medida principal.',field:'measure'});
 if(!isValidMeasureName(c.measureName))issues.push({level:'error',text:'Indica un nombre de medida DAX válido (sin corchetes [], comillas ni saltos de línea).',field:'measureName'});
 const circ=getCircularConflict(c);
 if(circ)issues.push({level:'error',text:`Dependencia circular: el nombre de la medida resultante ('${c.measureName.trim()}') no puede coincidir con la ${circ.type} ('${circ.name}'). Modifícalo en KPI Atelier para continuar.`,field:'measureName'});
 if(needsDate(c)&&(!c.dateTable.trim()||!c.dateColumn.trim()))issues.push({level:'error',text:'Completa la tabla calendario y su columna de fecha.',field:!c.dateTable.trim()?'dateTable':'dateColumn'});
 if((needsGoal(c)||(needsCompare(c)&&c.comparison==='target'))&&!c.targetMeasure.trim())issues.push({level:'error',text:'Indica una medida u objetivo numérico (ej. 0 o 100).',field:'targetMeasure'});
 if(needsCompare(c)&&c.comparison==='custom'&&!c.compareMeasure.trim())issues.push({level:'error',text:'Indica la medida de comparación.',field:'compareMeasure'});
 if(rendered(c,'status')&&((c.direction==='down'&&c.goodThreshold>c.warnThreshold)||(c.direction!=='down'&&c.goodThreshold<c.warnThreshold)))issues.push({level:'error',text:'Revisa los umbrales: favorable y alerta deben seguir la dirección elegida.',field:'goodThreshold'});
 if(rendered(c,'status')&&c.direction==='neutral')issues.push({level:'error',text:'Un semáforo necesita dirección favorable: subir o bajar.',field:'direction'});
 if(c.deltaMode==='pp'&&c.format!=='percent')issues.push({level:'error',text:'Los puntos porcentuales requieren formato porcentaje.',field:'format'});
 if(c.height<240&&['executive','target','status','spark'].includes(c.type))issues.push({level:'warning',text:'Esta composición puede necesitar más altura. Revisa el resultado a tamaño real.'});
 if(c.valueSize>52&&c.width<360)issues.push({level:'warning',text:'El valor podría ocupar varias líneas. Reduce la tipografía o amplía el ancho.'});
 if(needsDate(c))issues.push({level:'info',text:'Usa una tabla calendario relacionada y filtra el período desde esa tabla.'});
 if(needsGoal(c))issues.push({level:'info',text:'El avance muestra valor / objetivo positivo; la dirección determina si cumplir significa subir o bajar.'});
 issues.push({level:'info',text:'Los nombres se revisan aquí; su existencia y el resultado DAX se comprueban en tu modelo de Power BI.'});
 return issues;
}
