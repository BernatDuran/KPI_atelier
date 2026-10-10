import {resizeCard,applyLayout} from './layout.mjs';
import {COLOR_SPEC,colorModes,appearance,elementColor,elementBackground,trendFill,SURFACE_EFFECTS} from './appearance.mjs';
import {alignmentGuides} from './guides.mjs';
import {BASE,TEMPLATES,THEMES,FAMILIES,sanitizeConfig,checks,getCircularConflict,familyName,needsTrend,needsDate,needsGoal,needsCompare,isValidMeasureName} from './model.mjs';
import {icon,esc,cardHTML,sampleData} from './cards.mjs';
import {generateDAX} from './dax.mjs';
import {ELEMENTS,ELEMENT_IDS,SIZE_LIMITS,elementState,elementSize,elementAvailable,elementEnabled,elementVisible,updateElement,moveElement,resizeElement,restoreElement,clamp,frameFromBounds,detachElement,releaseElement,layerOrder,moveLayer,reorderLayer,resolveElementDef} from './elements.mjs';
import {COLOR_ROLES,hexToHSV,hsvToHex,contrastRatio,paletteFrom,sanitizePalette} from './colors.mjs';
import {ICON_OPTIONS} from './icons.mjs';
import {scanDirectoryHandle,scanFileList,fetchLivePbiModel,fetchLivePbiStatus,injectMeasureToLivePbi,discoverLivePbi} from './pbip.mjs';
const $=s=>document.querySelector(s);
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}};
let c=sanitizeConfig(read('kpi-atelier-draft',BASE)),saved=read('kpi-atelier-saved',[]);
if(!Array.isArray(saved))saved=[];
saved=saved.filter(x=>x&&typeof x.id==='string'&&x.config).map(x=>({...x,config:sanitizeConfig(x.config)}));
let view='designer',mode=read('kpi-atelier-mode','essential'),tab='content',filter='all',query='',context=false,zoom=100,canvasDark=false;
if(!['essential','advanced'].includes(mode))mode=mode==='pro'?'advanced':'essential';
let undo=[],redo=[],lastEdit=0,resizeObserver,toastTimer,lastFocus;
let cardSelected=false,selectedElement=null,selectedElements=new Set(),moveStep=read('kpi-atelier-step',1)===5?5:1,layersOpen=false,gesture=null,ignoreCanvasClick=false,formatPainterSource=null,deleteConfirmLayer=null,deleteConfirmTimer=null;
let draggedLayer=null;
let guidesEnabled=read('kpi-atelier-guides',true)!==false,guidePreviewUntil=0,guideTimer;
const inspectorSections=new Map(),inspectorPositions=new Map();
let customThemes=read('kpi-atelier-themes',[]);if(!Array.isArray(customThemes))customThemes=[];
customThemes=customThemes.filter(t=>t&&typeof t.id==='string'&&/^[\w-]+$/.test(t.id)&&sanitizePalette(t.colors)).map(t=>({...t,name:String(t.name).slice(0,40),colors:sanitizePalette(t.colors)}));
let paletteDraft=null,colorRole='accent',colorHSV=null,colorPointer=null;
let pbipModel=read('kpi-atelier-pbip-cache',null);
let contextResolution=read('kpi-atelier-context-res','1280x720');
let pendingRoundtripConf=null,pendingRoundtripName='';
function getFriendlyReportName(model){
 if(!model)return '';
 const rep=model.reportName||model.modelName||'';
 if(rep&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rep)&&rep!=='Model'){
  return rep;
 }
 return 'Power BI Desktop';
}
function applyPbipCalendarDefaults(catalog){
 if(!catalog||!Array.isArray(catalog.dateTables)||!catalog.dateTables.length)return false;
 const bestTable=catalog.dateTables[0];
 const bestColumn=bestTable.primaryDateColumn||bestTable.dateColumns?.[0]||'';
 const patch={};
 if(bestTable.name)patch.dateTable=bestTable.name;
 if(bestColumn)patch.dateColumn=bestColumn;
 if(Object.keys(patch).length){
  c=sanitizeConfig({...c,...patch});
  persist();
  refreshCard();
  return true;
 }
 return false;
}
function setPbipModel(model,autoAssign=false){
 pbipModel=model;
 try{
  if(model)localStorage.setItem('kpi-atelier-pbip-cache',JSON.stringify(model));
  else localStorage.removeItem('kpi-atelier-pbip-cache');
 }catch{}
 const DUMMY_TARGETS=['Objetivo EBITDA','Objetivo Pedidos','Objetivo Ventas','Objetivo'];
 if(!c._targetCustomized&&DUMMY_TARGETS.includes(c.targetMeasure?.trim())){
  c.targetMeasure='';
  persist();
 }
 if(autoAssign&&model){
  applyPbipCalendarDefaults(model);
 }
 renderInspector();
 renderStatus();
}
const app=$('#app');
const editState=read('kpi-atelier-edit-state',null);
let baseline=editState?.baseline?sanitizeConfig(editState.baseline):structuredClone(c),editingSavedId=editState?.savedId||null,pendingNavigation=null;
const dirty=()=>JSON.stringify(c)!==JSON.stringify(baseline);
function showDirty(){const node=$('#save-state');if(node){node.textContent=dirty()?'Cambios sin guardar':'Sin cambios pendientes';node.classList.toggle('dirty',dirty());}}
const btn=(action,label,ico,cl='',extra='')=>`<button class="${cl}" data-action="${action}" ${extra}>${ico?icon(ico):''}<span>${label}</span></button>`;
const ib=(action,label,ico,extra='')=>`<button class="icon-btn" data-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(ico)}</button>`;
function toast(s){const t=$('#toast');if(!t)return;const modal=$('#modal');if(modal&&modal.open&&modal.appendChild){if(t.parentElement!==modal)modal.appendChild(t);}else{if(document.body?.appendChild&&t.parentElement!==document.body)document.body.appendChild(t);}t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3300);}
function persist(){showDirty();try{localStorage.setItem('kpi-atelier-edit-state',JSON.stringify({baseline,savedId:editingSavedId}));localStorage.setItem('kpi-atelier-draft',JSON.stringify(c));localStorage.setItem('kpi-atelier-mode',JSON.stringify(mode));return true;}catch{toast('No se pudo guardar en este navegador. Exporta tu configuración JSON.');return false;}}
function record(){undo.push(structuredClone(c));if(undo.length>60)undo.shift();redo=[];}
function setConfig(patch,full=false){record();c=sanitizeConfig(full?patch:{...c,...patch});if(full){context=false;cardSelected=false;selectedElement=null;if(['element','card'].includes(tab))tab='content';}persist();render();}
function themeSelect(key){const custom=customThemes.find(t=>t.id===key);if(custom)setConfig({...custom.colors,theme:'custom',customThemeName:custom.name});else if(THEMES[key])setConfig({...THEMES[key],theme:key,customThemeName:''});}
function filtered(){return TEMPLATES.filter(t=>(filter==='all'||t.category===filter)&&`${t.name} ${t.description} ${t.config.title} ${familyName(t.category)}`.toLowerCase().includes(query.toLowerCase()));}
function thumb(conf,cl=''){return `<div class="mini-viewport ${cl}" data-base-width="${conf.width}"><div class="mini-inner" style="width:${conf.width}px">${cardHTML(conf)}</div></div>`;}
function render(){
 rememberInspector();
  app.innerHTML=`<header class="app-header"><a class="brand" href="#" data-action="home" aria-label="KPI Atelier, inicio"><span class="brand-icon">${icon('chart',22)}</span><strong>kpi<span class="brand-divider">/</span>atelier<span class="brand-dot">.</span></strong></a><nav class="top-nav" aria-label="Navegación principal">${btn('view-designer','Diseñador','sliders',view==='designer'?'selected':'')}${btn('view-library',`Biblioteca <span class="count">${TEMPLATES.length}</span>`,'grid',view==='library'?'selected':'')}${btn('view-saved','Mis diseños','folder',view==='saved'?'selected':'')}</nav><div class="header-right">${pbipModel?.isLiveConnection?`<span class="pbip-live-pill" title="Power BI Desktop conectado: ${esc(getFriendlyReportName(pbipModel))}"><i class="pbip-live-dot"></i> ${esc(getFriendlyReportName(pbipModel))}</span>`:''}${ib('guide','Guía de uso','book')}<span class="avatar">BD</span></div></header>
 <div class="page-heading"><div><div class="eyebrow">TU ESTUDIO DE DISEÑO <span> / </span> POWER BI</div><h1>${view==='designer'?'Grandes datos. <em>Mejor diseño.</em>':view==='library'?'Un buen diseño empieza aquí.':'Tus ideas, listas para volver.'}</h1><p>${view==='designer'?'Dale a cada KPI el protagonismo que merece.':view==='library'?`${TEMPLATES.length} puntos de partida. Infinitas posibilidades. Todo editable.`:'Guarda tus tarjetas y construye tu propio lenguaje visual.'}</p></div><div class="heading-actions"><span id="save-state" class="save-state"></span>${btn('import','Importar','upload','button secondary')}${btn('save','Guardar diseño','save','button secondary')}${btn('open-data-modal','Conectar datos','sliders','button secondary')}${btn('export','Generar medida DAX','code','button primary')}</div></div>
 ${view==='designer'?designer():view==='library'?library():savedView()}
 <footer class="app-footer"><span><i class="tiny-dot"></i> Diseño en directo</span><span>KPI Atelier</span></footer>`;
 if(view==='designer'){renderInspector();renderStage();}
 fitThumbs();showDirty();
}
function designer(){return `<div class="workspace"><aside class="template-rail"><div class="rail-heading"><h2>Elige tu punto de partida</h2><span>01—${TEMPLATES.length}</span></div><label class="search-box">${icon('search',15)}<input id="template-search" placeholder="Buscar una tarjeta…" aria-label="Buscar plantillas" value="${esc(query)}"></label><select id="family-filter" aria-label="Familia de tarjetas">${FAMILIES.map(f=>`<option value="${f.id}" ${filter===f.id?'selected':''}>${f.name}</option>`).join('')}</select><div id="rail-cards" class="rail-cards">${railCards()}</div><button class="rail-more" data-action="view-library">Explorar la biblioteca ${icon('arrow',15)}</button></aside>
 <main class="design-main"><div class="canvas-toolbar"><div class="live-label"><i></i>VISTA PREVIA</div><div class="segmented small"><button data-action="single" class="${!context?'active':''}" title="Vista individual de la tarjeta">${icon('card',14)}Tarjeta</button><button data-action="context" class="${context?'active':''}" title="Vista de la tarjeta en contexto del informe">${icon('grid',14)}En contexto</button></div><div class="toolbar-icons">${ib('undo','Deshacer','undo',undo.length?'':'disabled')}${ib('redo','Rehacer','redo',redo.length?'':'disabled')}</div></div><div id="canvas-edit-bar" class="canvas-edit-bar"></div><div id="stage" class="stage ${canvasDark?'dark-stage':''}"></div><div class="canvas-bottom"><span id="dimensions"></span><div class="zoom-controls">${ib('canvas-color','Cambiar fondo del lienzo','palette')}<span class="divider"></span><button data-action="zoom-out" aria-label="Alejar">−</button><span id="zoom-text">${zoom}%</span><button data-action="zoom-in" aria-label="Acercar">+</button>${ib('zoom-fit','Ajustar vista','expand')}</div><span class="sample-tag">DATOS DE MUESTRA</span></div>
  <div class="palette-section"><div class="theme-swatches">${Object.entries(THEMES).map(([key,t])=>`<button data-theme="${key}" class="theme-swatch ${c.theme===key?'active':''}" title="${t.name}" aria-label="Aplicar tema ${t.name}" style="--swatch:${t.background};--dot:${t.accent}"><span></span><small>${t.name}</small></button>`).join('')}<button class="theme-swatch theme-add" data-action="themes" title="Crear o editar una paleta"><span>${icon('plus',15)}</span><small>Crear tema</small></button></div></div></main>
 <aside class="inspector"><div class="inspector-title"><h2>Nivel de detalle</h2>${ib('reset','Restaurar esta plantilla','reset')}</div><div class="mode-switch">${[['essential','Esencial'],['advanced','Avanzado']].map(([id,label])=>`<button data-mode="${id}" class="${mode===id?'active':''}" aria-pressed="${mode===id}">${label}</button>`).join('')}</div><div class="inspector-tabs" role="tablist">${[['content','Contenido'],['style','Estilo'],['data','Datos & DAX']].map(([id,label])=>`<button role="tab" aria-selected="${tab===id}" data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('')}</div><div id="inspector-fields" class="inspector-fields"></div></aside></div>`;}
function railCards(){return filtered().map(t=>`<button class="template-item ${c.id===t.id?'chosen':''}" data-template="${t.id}" aria-label="Usar ${t.name}">${thumb(t.config)}<div><strong>${t.name}</strong>${c.id===t.id?'<span class="chosen-mark">'+icon('check',12)+'</span>':'<span>'+icon('arrow',12)+'</span>'}</div><small>${familyName(t.category)}</small></button>`).join('')||'<p class="empty-hint">No hay plantillas con ese nombre.</p>';}
function library(){return `<main class="library-view"><div class="library-top"><div class="filter-pills">${FAMILIES.map(f=>`<button data-filter="${f.id}" class="${filter===f.id?'active':''}">${f.id==='all'?'Todas':f.name}</button>`).join('')}</div><label class="search-box">${icon('search',16)}<input id="gallery-search" placeholder="Buscar plantilla…" aria-label="Buscar plantilla" value="${esc(query)}"></label></div><div id="gallery-grid" class="gallery-grid">${galleryCards()}</div><div class="library-foot"><span>${icon('sliders',16)} Todas las plantillas incluyen modos de edición esencial y avanzado.</span><span>Hechas para tus datos. Diseñadas para destacar.</span></div></main>`;}
function galleryCards(){return filtered().map((t,i)=>`<button class="gallery-card" data-template="${t.id}"><div class="gallery-preview" style="background:${t.config.theme==='night'?'#dfe5e2':'#eeefeb'}">${thumb(t.config)}<span class="gallery-use">Personalizar ${icon('arrow',15)}</span></div><div class="gallery-description"><div><span class="overline">${familyName(t.category)}</span><h3>${t.name}</h3><p>${t.description}</p></div><span class="gallery-number">${String(TEMPLATES.indexOf(t)+1).padStart(2,'0')}</span></div></button>`).join('')||'<div class="empty-state">No encontramos esa tarjeta. Prueba con otra búsqueda.</div>';}
function savedView(){return `<main class="library-view"><div class="saved-info">${icon('info',16)} Tus diseños se guardan en este navegador. Exporta un JSON para llevarlos a otro equipo.</div>${saved.length?`<div class="gallery-grid">${saved.map(s=>`<article class="gallery-card saved-card"><button data-load="${s.id}" class="saved-preview" aria-label="Abrir ${esc(s.name)}">${thumb(s.config)}</button><div class="gallery-description"><div><span class="overline">${familyName(s.config.type)}</span><h3>${esc(s.name)}</h3><p>${new Date(s.date).toLocaleDateString('es-ES')}</p></div><div class="saved-actions">${ib('saved-json','Exportar configuración','download',`data-id="${s.id}"`)}${ib('delete','Eliminar diseño','trash',`data-id="${s.id}"`)}</div></div></article>`).join('')}</div>`:`<div class="empty-state">${icon('folder',44)}<h2>Aquí empieza tu colección.</h2><p>Guarda una tarjeta y vuelve a ella siempre que quieras.</p>${btn('view-library','Encontrar mi primera plantilla','arrow','button primary')}</div>`}</main>`;}
function field(key,label,type='text',opts={}){
 const val=c[key];let input;
 if(type==='select')input=`<select data-key="${key}" id="f-${key}">${opts.options.map(([v,l])=>`<option value="${v}" ${val===v?'selected':''}>${l}</option>`).join('')}</select>`;
 else if(type==='check')return `<label class="toggle-field" for="f-${key}"><span>${label}</span><input id="f-${key}" type="checkbox" data-key="${key}" ${val?'checked':''}><span class="toggle-track"></span></label>`;
 else if(type==='range')input=`<div class="range-wrap"><input id="f-${key}" data-key="${key}" type="range" min="${opts.min}" max="${opts.max}" step="${opts.step||1}" ${opts.scale?`data-scale="${opts.scale}"`: ''} value="${opts.scale?Math.round(val*opts.scale):val}"><output for="f-${key}">${opts.scale?Math.round(val*opts.scale):val}${opts.unit||''}</output></div>`;
 else if(type==='color')input=`<div class="color-wrap"><input id="f-${key}" data-key="${key}" type="color" value="${val}"><span>${val.toUpperCase()}</span><span class="color-dot" style="background:${val}"></span></div>`;
 else if(type==='textarea')input=`<textarea id="f-${key}" data-key="${key}" rows="3">${esc(val)}</textarea>`;
 else input=`<input id="f-${key}" data-key="${key}" type="${type}" value="${esc(val)}" ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.max!==undefined?`max="${opts.max}"`:''} ${type==='number'?`step="${['width','height'].includes(key)?1:'any'}"`:''} ${opts.placeholder?`placeholder="${opts.placeholder}"`:''} ${type==='text'?'maxlength="160"':''}>`;
 return `<div class="field"><label for="f-${key}">${label}${opts.tag?`<span class="field-tag">${opts.tag}</span>`:''}</label>${input}${opts.help?`<small>${opts.help}</small>`:''}</div>`;
}
const select=(k,l,options,help)=>field(k,l,'select',{options,help});
const range=(k,l,min,max,unit='px',step=1)=>field(k,l,'range',{min,max,unit,step});
const check=(k,l)=>field(k,l,'check');
const percentRange=(k,l)=>field(k,l,'range',{min:0,max:100,unit:'%',scale:100});
const section=(n,label,body,open=true)=>{const key=tab+':'+label;return `<details class="field-section" data-section="${esc(key)}" ${(inspectorSections.get(key)??open)?'open':''}><summary><span><b>${n}</b>${label}</span>${icon('chevron',14)}</summary><div class="section-body">${body}</div></details>`;};
const formats=[['currency','Moneda'],['number','Número'],['percent','Porcentaje']];
const comparisons=[['yoy','Año anterior · YoY'],['mom','Mes anterior · MoM'],['previous','Período anterior'],['target','Objetivo'],['custom','Medida de referencia'],['none','Sin comparación']];
function duplicateContentFields(baseIds){
 if(!c.elements)return '';
 const matchingDups=Object.entries(c.elements).filter(([id,st])=>{
  if(st?.deleted)return false;
  const def=resolveElementDef(id);
  return def?.isDuplicate&&baseIds.includes(def.baseId);
 });
 if(!matchingDups.length)return '';
 return matchingDups.map(([dupId,st])=>{
  const def=resolveElementDef(dupId);
  let fields='';
  if(def.baseId==='value'){
   const curFmt=st.format||c.format;
   const curCurr=st.currency||c.currency;
   const curUnit=st.unit||c.unit;
   const curDec=st.decimals??c.decimals;
   const curMeas=st.measure!==undefined?st.measure:'';
   const curSuf=st.suffix!==undefined?st.suffix:(c.suffix||'');
   fields=`<div class="field"><label for="f-dup-m-${dupId}">Medida del valor</label><input id="f-dup-m-${dupId}" data-dupval="measure" data-dupid="${dupId}" value="${esc(curMeas)}" placeholder="[Nombre de medida]" list="dl-pbip-measures"></div>`+
    `<div class="field"><label for="f-dup-fmt-${dupId}">Formato del valor</label><select id="f-dup-fmt-${dupId}" data-dupval="format" data-dupid="${dupId}">${formats.map(([k,l])=>`<option value="${k}" ${curFmt===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    (curFmt==='currency'?`<div class="field"><label for="f-dup-cur-${dupId}">Moneda</label><select id="f-dup-cur-${dupId}" data-dupval="currency" data-dupid="${dupId}">${[['EUR','Euro · €'],['USD','Dólar · $'],['GBP','Libra · £']].map(([k,l])=>`<option value="${k}" ${curCurr===k?'selected':''}>${l}</option>`).join('')}</select></div>`:'')+
    `<div class="field-row"><div class="field"><label for="f-dup-u-${dupId}">Escala</label><select id="f-dup-u-${dupId}" data-dupval="unit" data-dupid="${dupId}">${[['auto','Automática'],['none','Sin escalar'],['k','Miles'],['m','Millones']].map(([k,l])=>`<option value="${k}" ${curUnit===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-dec-${dupId}">Decimales</label><select id="f-dup-dec-${dupId}" data-dupval="decimals" data-dupid="${dupId}">${[[0,'0'],[1,'1'],[2,'2'],[3,'3']].map(([k,l])=>`<option value="${k}" ${curDec===k?'selected':''}>${l}</option>`).join('')}</select></div></div>`+
    `<div class="field"><label for="f-dup-suf-${dupId}">Sufijo del valor</label><input id="f-dup-suf-${dupId}" data-dupval="suffix" data-dupid="${dupId}" value="${esc(curSuf)}" placeholder="ej. € o %"></div>`;
  }else if(def.baseId==='delta'){
   const curComp=st.comparison||c.comparison;
   const curDir=st.direction||c.direction;
   const curMode=st.deltaMode||c.deltaMode;
   const curCmpMeas=st.compareMeasure!==undefined?st.compareMeasure:(c.compareMeasure||'');
   fields=`<div class="field"><label for="f-dup-cmpmode-${dupId}">Comparar con</label><select id="f-dup-cmpmode-${dupId}" data-dupval="comparison" data-dupid="${dupId}">${comparisons.map(([k,l])=>`<option value="${k}" ${curComp===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-dir-${dupId}">¿Qué significa mejorar?</label><select id="f-dup-dir-${dupId}" data-dupval="direction" data-dupid="${dupId}">${[['up','Cuanto más, mejor ↑'],['down','Cuanto menos, mejor ↓'],['neutral','Sin valoración favorable']].map(([k,l])=>`<option value="${k}" ${curDir===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-dm-${dupId}">Mostrar diferencia</label><select id="f-dup-dm-${dupId}" data-dupval="deltaMode" data-dupid="${dupId}">${[['relative','Porcentaje'],['absolute','Diferencia absoluta'],['pp','Puntos porcentuales']].map(([k,l])=>`<option value="${k}" ${curMode===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-cmp-${dupId}">Medida de comparación</label><input id="f-dup-cmp-${dupId}" data-dupval="compareMeasure" data-dupid="${dupId}" value="${esc(curCmpMeas)}" placeholder="[Medida de referencia]" list="dl-pbip-measures"></div>`;
  }else if(def.baseId==='compareLabel'){
   const curComp=st.comparison||c.comparison;
   const curTxt=st.text!==undefined?st.text:'';
   fields=`<div class="field"><label for="f-dup-clcmp-${dupId}">Comparar con</label><select id="f-dup-clcmp-${dupId}" data-dupval="comparison" data-dupid="${dupId}">${comparisons.map(([k,l])=>`<option value="${k}" ${curComp===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-txt-${dupId}">Texto personalizado</label><input id="f-dup-txt-${dupId}" data-duptext="${dupId}" data-dupid="${dupId}" value="${esc(curTxt)}" placeholder="ej. vs. período anterior"></div>`;
  }else if(def.baseId==='status'){
   const curGood=st.statusGood!==undefined?st.statusGood:(c.statusGood||'Favorable');
   const curWarn=st.statusWarn!==undefined?st.statusWarn:(c.statusWarn||'En alerta');
   const curBad=st.statusBad!==undefined?st.statusBad:(c.statusBad||'Desfavorable');
   const curGTh=st.goodThreshold!==undefined?st.goodThreshold:c.goodThreshold;
   const curWTh=st.warnThreshold!==undefined?st.warnThreshold:c.warnThreshold;
   fields=`<div class="field-row"><div class="field"><label for="f-dup-gth-${dupId}">Umbral favorable</label><input id="f-dup-gth-${dupId}" type="number" data-dupval="goodThreshold" data-dupid="${dupId}" value="${curGTh}"></div>`+
    `<div class="field"><label for="f-dup-wth-${dupId}">Umbral alerta</label><input id="f-dup-wth-${dupId}" type="number" data-dupval="warnThreshold" data-dupid="${dupId}" value="${curWTh}"></div></div>`+
    `<div class="field"><label for="f-dup-sg-${dupId}">Texto favorable</label><input id="f-dup-sg-${dupId}" data-dupval="statusGood" data-dupid="${dupId}" value="${esc(curGood)}"></div>`+
    `<div class="field"><label for="f-dup-sw-${dupId}">Texto alerta</label><input id="f-dup-sw-${dupId}" data-dupval="statusWarn" data-dupid="${dupId}" value="${esc(curWarn)}"></div>`+
    `<div class="field"><label for="f-dup-sb-${dupId}">Texto desfavorable</label><input id="f-dup-sb-${dupId}" data-dupval="statusBad" data-dupid="${dupId}" value="${esc(curBad)}"></div>`;
  }else if(['referenceLabel','referenceValue'].includes(def.baseId)){
   const curComp=st.comparison||c.comparison;
   const curCmpMeas=st.compareMeasure!==undefined?st.compareMeasure:(c.compareMeasure||'');
   fields=`<div class="field"><label for="f-dup-rcmp-${dupId}">Comparar con</label><select id="f-dup-rcmp-${dupId}" data-dupval="comparison" data-dupid="${dupId}">${comparisons.map(([k,l])=>`<option value="${k}" ${curComp===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-rcm-${dupId}">Medida de referencia</label><input id="f-dup-rcm-${dupId}" data-dupval="compareMeasure" data-dupid="${dupId}" value="${esc(curCmpMeas)}" placeholder="[Medida de referencia]" list="dl-pbip-measures"></div>`;
  }else if(def.baseId==='icon'){
   const curIcon=st.icon||c.icon;
   fields=`<div class="field"><label for="f-dup-ico-${dupId}">Icono</label><select id="f-dup-ico-${dupId}" data-dupval="icon" data-dupid="${dupId}">${ICON_OPTIONS.map(([k,l])=>`<option value="${k}" ${curIcon===k?'selected':''}>${l}</option>`).join('')}</select></div>`;
  }else if(['goalLabel','progressLabel','progress'].includes(def.baseId)){
   const curTarget=st.targetMeasure!==undefined?st.targetMeasure:(c.targetMeasure||'');
   fields=`<div class="field"><label for="f-dup-tgt-${dupId}">Medida u objetivo</label><input id="f-dup-tgt-${dupId}" data-dupval="targetMeasure" data-dupid="${dupId}" value="${esc(curTarget)}" placeholder="ej. [Objetivo] o 100" list="dl-pbip-measures"></div>`;
  }else{
   const currentVal=st.text!==undefined?st.text:(def.contentKey?c[def.contentKey]:def.label);
   fields=`<div class="field"><label for="f-dup-txt-${dupId}">Texto</label><input id="f-dup-txt-${dupId}" data-duptext="${dupId}" data-dupid="${dupId}" value="${esc(currentVal)}" placeholder="Texto del elemento…"></div>`;
  }
  return `<div class="dup-content-card"><header><span>${icon('copy',12)} ${esc(def.label)}</span><small>Elemento duplicado</small></header>${fields}</div>`;
 }).join('');
}
function renderInspector(){
 const remembered=rememberInspector();
 const adv=mode==='advanced',pro=adv;let h='';
 if(tab==='card'&&cardSelected){h=cardInspector();}
 else if(tab==='element'&&selectedElement){h=elementInspector();}
 else if(tab==='content'){
 h+=section('01','Identidad',field('title','Título del KPI')+field('subtitle','Subtítulo')+(pro?field('eyebrow','Etiqueta superior'):'')+select('type','Tipo de tarjeta',FAMILIES.filter(f=>f.id!=='all').map(f=>[f.id,f.name]))+duplicateContentFields(['title','subtitle','eyebrow']));
 h+=section('02','Valor principal',select('format','Formato',formats)+(c.format==='currency'?select('currency','Moneda',[['EUR','Euro · €'],['USD','Dólar · $'],['GBP','Libra · £']]):'')+(pro?`<div class="field-row">${select('unit','Escala',[['auto','Automática'],['none','Sin escalar'],['k','Miles'],['m','Millones']])}${select('decimals','Decimales',[[0,'0'],[1,'1'],[2,'2'],[3,'3']])}</div>`:'')+(adv?field('suffix','Sufijo personalizado'):'')+duplicateContentFields(['value']));
 h+=section('03','Contexto y comparación',select('comparison','Comparar con',comparisons)+select('direction','¿Qué significa mejorar?',[['up','Cuanto más, mejor ↑'],['down','Cuanto menos, mejor ↓'],['neutral','Sin valoración favorable']])+(pro?select('deltaMode','Mostrar diferencia',[['relative','Variación relativa · %'],['absolute','Diferencia absoluta'],['pp','Puntos porcentuales · pp']]):'')+duplicateContentFields(['delta','referenceValue','compareLabel','referenceLabel']));
 if(c.type==='status')h+=section('04','Reglas del semáforo',`<p class="field-help">${c.direction==='down'?'Verde ≤ favorable; ámbar ≤ alerta; rojo por encima.':'Verde ≥ favorable; ámbar ≥ alerta; rojo por debajo.'}${c.format==='percent'?' Usa 0,95 para indicar 95 %.':''}</p><div class="field-row">${field('goodThreshold','Umbral favorable','number')}${field('warnThreshold','Umbral de alerta','number')}</div>`+(pro?field('statusGood','Texto favorable')+field('statusWarn','Texto en alerta')+field('statusBad','Texto desfavorable'):'')+duplicateContentFields(['status']));
 if(pro)h+=section('05','Composición',check('showIcon','Mostrar icono')+(c.showIcon?iconPickerField():'')+check('showSubtitle','Mostrar subtítulo')+check('showComparison','Mostrar comparativa')+(['spark','executive','target'].includes(c.type)?check('showTrend','Mostrar gráfico'):'')+(c.type==='executive'?check('showGoal','Mostrar objetivo'):'')+check('showFooter','Mostrar pie')+(adv?field('footer','Texto del pie'):'')+duplicateContentFields(['icon','footer','goalLabel','progressLabel','progress']),false);
 }else if(tab==='style'){
 h+=section('01','Paleta',`<button class="palette-launch" data-action="themes">${icon('palette',17)}<span>Estudio de color<small>Crea, ajusta y guarda tus temas</small></span>${icon('arrow',15)}</button><div class="theme-grid">${Object.entries(THEMES).map(([k,t])=>`<button data-theme="${k}" class="theme-option ${c.theme===k?'active':''}"><span style="background:${t.background};border-color:${t.borderColor}"><i style="background:${t.accent}"></i></span>${t.name}</button>`).join('')}</div>`+field('accent','Color de acento','color')+(pro?`<div class="field-row">${field('background','Fondo','color')}${field('text','Texto','color')}</div>`:'')+(adv?field('muted','Texto secundario','color'):'')+(pro?`<div class="field-row">${field('positive','Favorable','color')}${field('negative','Desfavorable','color')}</div>`:'')+(adv?field('warning','Alerta','color'):''));
 h+=section('02','Forma y tamaño',cardDimensionsPanel()+layoutPanel()+range('radius','Radio de esquinas',0,40)+(pro?range('padding','Espacio interior',12,48)+(['solid','aurora'].includes(c.surfaceEffect)?select('shadow','Sombra',[['none','Sin sombra'],['soft','Suave'],['strong','Profunda']]):''):'')+(adv?range('borderWidth','Grosor del borde',0,4)+field('borderColor','Color del borde','color'):''));
 h+=section('03','Superficie y efectos',surfaceInspector());
 if(pro)h+=section('04','Tipografía',select('font','Familia tipográfica',[['Segoe UI','Segoe UI · Power BI'],['Arial','Arial · Universal'],['Georgia','Georgia · Editorial']])+range('valueSize','Tamaño del valor',6,140)+(adv?range('titleSize','Tamaño del título',6,140)+select('fontWeight','Peso del valor',[[400,'Regular'],[500,'Medio'],[600,'Semibold'],[700,'Negrita'],[800,'Extra bold']]):'')+select('align','Alineación',[['left','Izquierda'],['center','Centrada']]),false);
 if(elementAvailable(c,'trend'))h+=section('05','Gráfico',check('showTrend','Mostrar gráfico')+(c.showTrend?chartPanel():''),false);
 }else{
 h+='<div class="data-notice">'+icon('info',17)+'<p><strong>Vinculación con Power BI.</strong>Mapea las medidas y el calendario de tu modelo con los elementos visuales.</p></div>';
 h+=section('01','Datos del modelo',dataSummaryCard()+btn('open-data-modal','Gestionar vinculación de datos','sliders','button primary full-width'));
 if(pro)h+=section('02','Formato regional',select('locale','Formato de números',[['es-ES','Español · 1.234,5'],['en-US','English · 1,234.5'],['ca-ES','Català · 1.234,5']]),false);
 h+=section('03','Datos de la vista previa','<p class="field-help">Solo cambian la demostración visual. No se exportan al DAX.</p>'+field('sampleValue','Valor de ejemplo','number')+field('samplePrevious','Referencia de ejemplo','number')+field('sampleTarget','Objetivo de ejemplo','number')+(pro?field('sampleSeries','Serie de ejemplo','textarea',{help:'Valores separados por comas. Usa punto para decimales.'}):'')+select('sampleScenario','Escenario',[['normal','Valores normales'],['zero','Valor cero'],['empty','Sin datos · BLANK'],['negative','Valor negativo']]),false);
 }
 h+=`<div class="level-hint">${icon('sliders',15)}${mode==='essential'?'Modo Esencial: configuración ágil y directa. Cambia a Avanzado para el control total al píxel.':'Modo Avanzado: estás al mando de cada detalle visual, tipográfico y de formato.'}</div>`;
 const panel=$('#inspector-fields');panel.innerHTML=h;panel.dataset.panelTab=tab;
 panel.scrollTop=inspectorPositions.get(tab)??0;
 if(remembered?.focus&&remembered.tab===tab){const node=document.getElementById(remembered.focus);if(node){node.focus({preventScroll:true});if(remembered.selection&&node.setSelectionRange)try{node.setSelectionRange(...remembered.selection);}catch{}}}
 updateInspectorTabs();renderStatus();
}
function renderStatus(){const node=$('#inspector-status');if(node)node.innerHTML='';}
function renderStage(){
 const stage=$('#stage');if(!stage)return;
 stage.className='stage'+(c.surfaceEffect==='glass'?' glass-stage':'')+(canvasDark?' dark-stage':'')+(context?' context-stage':'');stage.style.setProperty('--glass-accent',c.accent+'38');
 if(context){
  const [resW, resH] = contextResolution==='1920x1080' ? [1920, 1080] : [1280, 720];
  stage.innerHTML=`
   <div class="context-fit" id="context-fit">
   <div class="context-report-canvas" id="context-viewport" style="width:${resW}px;height:${resH}px">
    <div class="context-report-topbar">
     <div class="context-topbar-left">
      <span class="context-report-title">Executive Overview · Performance Dashboard</span>
      <span class="context-canvas-badge">${icon('grid',12)} Lienzo Power BI: ${resW} × ${resH} px (16:9)</span>
     </div>
     <div class="context-topbar-slicers">
      <span class="context-slicer">Año: <strong>2026</strong></span>
      <span class="context-slicer">Período: <strong>Acumulado</strong></span>
      <span class="context-slicer">Canal: <strong>Todos</strong></span>
     </div>
    </div>
    <div class="context-report-grid">
     <div class="context-cards-row">
      <div class="context-card-slot active-card-slot" style="width:${c.width}px;height:${c.height}px">
       <span class="context-card-badge">Tu tarjeta · ${c.width} × ${c.height} px</span>
       ${cardHTML(c,undefined,true)}
      </div>
      <div class="context-mock-kpi" style="height:${c.height}px">
       <span class="mock-kpi-label">MARGEN OPERATIVO</span>
       <span class="mock-kpi-val">34,8 %</span>
       <span class="mock-kpi-delta positive">↑ +2.4 pp vs. objetivo</span>
       <div class="mock-kpi-bar"><div style="width:78%"></div></div>
      </div>
      <div class="context-mock-kpi" style="height:${c.height}px">
       <span class="mock-kpi-label">CLIENTES ACTIVOS</span>
       <span class="mock-kpi-val">18.420</span>
       <span class="mock-kpi-delta positive">↑ +12 % vs. mes ant.</span>
       <div class="mock-kpi-spark"></div>
      </div>
     </div>
     <div class="context-report-lower">
      <div class="context-mock-visual chart-visual">
       <div class="mock-visual-head">
        <strong>Evolución mensual del negocio</strong>
        <small>Vista agregada anual</small>
       </div>
       <svg viewBox="0 0 740 120" preserveAspectRatio="none" class="mock-chart-svg">
        <path d="M0 100L60 92L120 102L180 75L240 82L300 60L360 68L420 42L480 50L540 28L600 34L680 12L740 8" fill="none" stroke="${c.accent}" stroke-width="2.5"/>
        <path d="M0 100L60 92L120 102L180 75L240 82L300 60L360 68L420 42L480 50L540 28L600 34L680 12L740 8L740 120L0 120Z" fill="${c.accent}" opacity="0.12"/>
       </svg>
       <div class="context-chart-axis"><span>ENE</span><span>FEB</span><span>MAR</span><span>ABR</span><span>MAY</span><span>JUN</span><span>JUL</span><span>AGO</span><span>SEP</span><span>OCT</span><span>NOV</span><span>DIC</span></div>
      </div>
      <div class="context-mock-visual table-visual">
       <div class="mock-visual-head">
        <strong>Top categorías</strong>
        <small>Rendimiento por unidad</small>
       </div>
       <div class="mock-table-grid">
        <div class="mock-tr head"><span>Categoría</span><span>Importe</span><span>% Total</span></div>
        <div class="mock-tr"><span>Bicicletas</span><strong>842.150 €</strong><span>54 %</span></div>
        <div class="mock-tr"><span>Componentes</span><strong>412.300 €</strong><span>26 %</span></div>
        <div class="mock-tr"><span>Accesorios</span><strong>215.420 €</strong><span>14 %</span></div>
        <div class="mock-tr"><span>Ropa & Otros</span><strong>93.680 €</strong><span>6 %</span></div>
       </div>
      </div>
     </div>
    </div>
   </div></div>`;
 }
 else stage.innerHTML=`<span class="canvas-corner top-left"></span><span class="canvas-corner bottom-right"></span><div class="preview-label"><span>${TEMPLATES.find(t=>t.id===c.id)?.name||'Tu diseño'}</span><span>LIVE PREVIEW <i></i></span></div><div class="card-fit" id="card-fit"><div class="main-card" id="main-card" style="width:${c.width}px">${cardHTML(c,undefined,true)}</div><div id="smart-guides" aria-hidden="true"></div><div id="selection-overlay" hidden></div></div><div class="preview-caption">${icon('cursor',12)} Selecciona · arrastra · ajusta con las flechas</div>`;
 if(context){
  const [resW, resH] = contextResolution==='1920x1080' ? [1920, 1080] : [1280, 720];
  $('#dimensions').innerHTML=`${icon('grid',13)} Lienzo Power BI: ${resW} × ${resH} px · Tarjeta: ${c.width} × ${c.height} px`;
 }else{
  $('#dimensions').innerHTML=`${icon('square',13)} ${c.width} × ${c.height} px`;
 }
 $('#zoom-text').textContent=zoom+'%';
 fitThumbs();fitMain();renderStatus();renderCanvasBar();
}
function fitThumbs(){requestAnimationFrame(()=>{document.querySelectorAll('.mini-viewport').forEach(v=>{const inner=v.firstElementChild;const factor=v.clientWidth/Number(v.dataset.baseWidth);inner.style.transform=`scale(${factor})`;v.style.height=(inner.firstElementChild.offsetHeight*factor)+'px';});});}
function fitMain(){
 if(context){
  const stage=$('#stage'),fit=$('#context-fit'),v=$('#context-viewport');
  if(!stage||!v||!fit)return;
  const [resW, resH] = contextResolution==='1920x1080' ? [1920, 1080] : [1280, 720];
  const factor=zoom/100;
  fit.style.width=(resW*factor)+'px';
  fit.style.height=(resH*factor)+'px';
  v.style.transformOrigin='top left';
  v.style.transform=`scale(${factor})`;
  return;
 }
 const v=$('#card-fit'),inner=$('#main-card');if(!v||!inner)return;
 inner.style.transform='';const available=Math.max(210,$('#stage').clientWidth-62),factor=gesture?.scale||Math.min(1,available/c.width)*zoom/100;
 inner.style.transform=`scale(${factor})`;
 // Freeze legacy flow at its current measured positions before editing.
 if(c.geometryVersion!==2){const wasClean=!dirty(),actualHeight=inner.firstElementChild?.offsetHeight||c.height;let migrated=c;
  for(const id of ELEMENT_IDS){if(!elementState(c,id).frame)migrated=detachElement(migrated,id,measureElementFrame(id));}
  c=sanitizeConfig({...migrated,geometryVersion:2,height:actualHeight});if(wasClean)baseline=structuredClone(c);persist();inner.innerHTML=cardHTML(c,undefined,true);renderInspector();
 }
 inner.style.width=c.width+'px';

 v.style.width=(c.width*factor)+'px';v.style.height=((inner.firstElementChild?.offsetHeight||c.height)*factor)+'px';if(gesture?.card){v.style.transform='';const bounds=v.getBoundingClientRect();v.style.transform=`translate(${gesture.anchor.left-bounds.left}px,${gesture.anchor.top-bounds.top}px)`;}else v.style.transform='';positionSelection();renderGuides();reportOverflow();
}
function measureElementFrame(id){
 const node=app.querySelector(`[data-element="${id}"]`),surface=$('#main-card')?.firstElementChild;
 if(!node||!surface)return null;
 const bounds=surface.getBoundingClientRect();return frameFromBounds(c,id,node.getBoundingClientRect(),bounds,bounds.width/c.width);
}

function openModal(title,subtitle,body,footer='',cl=''){
 const modal=$('#modal');lastFocus=document.activeElement;
 modal.className=cl;modal.innerHTML=`<div class="modal-heading"><div><span class="overline">KPI ATELIER</span><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div>${ib('close-modal','Cerrar','close')}</div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:''}`;
 if(!modal.open)modal.showModal();
}
function closeModal(){pendingNavigation=null;const t=$('#toast');if(t&&document.body?.appendChild&&t.parentElement!==document.body)document.body.appendChild(t);$('#modal').close();lastFocus?.focus();}
$('#modal').addEventListener('cancel',()=>{pendingNavigation=null;});
function exportModal(){
 const errors=checks(c).filter(x=>x.level==='error');
 if(errors.length){validationModal();return;}
 const dax=generateDAX(c);
 const isLive=Boolean(pbipModel?.isLiveConnection);
 const injectBtn=isLive?`<button class="button primary btn-inject" data-action="inject-live-measure">${icon('sparkles',14)}<span>Crear en Power BI</span></button>`:'';
 openModal('Tu diseño. Tu medida DAX.','Copia, pega y deja que tus datos hagan el resto.',`<div class="export-banner ${isLive?'is-live':''}">${icon(isLive?'sparkles':'code',15)}<span>${isLive?`Conectado en vivo a '${esc(getFriendlyReportName(pbipModel))}' · Inyección directa disponible`:'Medida DAX lista · Compatible con HTML Content Secure en Power BI'}</span></div><div class="code-bar"><span>${icon('code',15)} ${esc(c.measureName)}.dax</span><span>${dax.split('\n').length} líneas · DAX estándar</span></div><pre class="dax-code" tabindex="0"><code>${esc(dax)}</code></pre><div class="export-notice">${icon('info',16)}<p>${isLive?'La medida se inyectará de forma automática en tu modelo de Power BI Desktop respetando tablas y relaciones existentes. También puedes copiar el código manualmente si lo prefieres.':'Copia el código DAX o descárgalo para usarlo en tu modelo. En Power BI Desktop, añade el visual HTML Content Secure y arrastra esta medida al campo de valores.'}</p></div>`,`<div class="export-other">${btn('download-json','Configuración JSON','download','button quiet')}${btn('download-html','Vista HTML','download','button quiet')}</div><div class="export-main">${injectBtn}${btn('download-dax','Descargar .dax','download','button secondary')}${btn('copy-dax','Copiar DAX','copy',isLive?'button secondary':'button primary')}</div>`,'export-modal');
}
function validationModal(){openModal('Revisión de tu tarjeta','Un último vistazo antes de llevarla a Power BI.',`<div class="check-list">${checks(c).map(x=>`<div class="check-item ${x.level}">${icon(x.level==='error'?'close':x.level==='warning'?'info':'check',17)}<span>${esc(x.text)}</span>${(x.level==='error'||x.level==='warning')&&x.field?`<button type="button" class="check-fix-btn" data-action="fix-check-issue" data-field="${esc(x.field)}" title="Ir a corregir este campo"><span>Corregir</span>${icon('arrow',11)}</button>`:''}</div>`).join('')}</div><div class="export-notice"><p>Esta revisión comprueba la configuración, no ejecuta consultas contra tu modelo.</p></div>`,btn('close-modal','Seguir editando',null,'button primary'));}
function guide(){openModal('Del diseño a Power BI','Tu primera tarjeta, en cuatro pasos.',`<div class="guide-grid"><article><b>01</b><h3>Encuentra tu tarjeta y afina la estructura</h3><p>Explora las ${TEMPLATES.length} plantillas curadas organizadas en familias temáticas. El modo <strong>Esencial</strong> se enfoca en métricas y estilo directo; el modo <strong>Avanzado</strong> desbloquea control tipográfico, pesos y bordes al píxel. Puedes redimensionar la tarjeta o sus elementos con los puntos de arrastre de esquina (con ajuste adaptativo inteligente), o duplicar elementos con <kbd>Ctrl+C</kbd> y <kbd>Ctrl+V</kbd>.</p></article><article><b>02</b><h3>Conecta datos de tu modelo Power BI</h3><p>Vincula tus medidas reales desde <strong>Conectar datos</strong>. La app se conecta en tiempo real a tu sesión abierta de <strong>Power BI Desktop</strong> (localhost) o mediante carpetas PBIP/Fabric. Detecta automáticamente tablas calendario oficiales marcadas con <em>isKey</em> o <em>dataCategory: Time</em>, facilitando comparativas de tiempo YoY y MoM sin escribir fórmulas complejas.</p></article><article><b>03</b><h3>Genera e inyecta la medida DAX</h3><p>Pulsa <strong>Crear en Power BI</strong> para escribir la medida directamente en la memoria de tu informe abierto con un solo clic. Si lo prefieres, copia el código DAX optimizado o descárgalo en archivo <code>.dax</code>. El DAX generado calcula dinámicamente el HTML, los SVG vectoriales incrustados y los formatos numéricos y condicionales de tu tarjeta.</p></article><article><b>04</b><h3>Renderiza con HTML Content Secure</h3><p>En Power BI Desktop, agrega el visual certificado <strong>HTML Content Secure</strong> (disponible en AppSource). Arrastra tu nueva medida al campo <em>Values</em> del visual, ajusta el ancho y alto del contenedor al tamaño diseñado (ej. ${c.width} × ${c.height} px) y desactiva el relleno predeterminado del objeto visual para un acabado impecable.</p></article></div><details class="guide-details" open><summary>Manipulación directa del lienzo y atajos de teclado</summary><p>• <strong>Selección y arrastre:</strong> Haz clic en cualquier elemento para seleccionarlo y arrástralo libremente por la tarjeta o usa las flechas del teclado (paso configurable de 1 o 5 px).</p><p>• <strong>Puntos de arrastre de esquina:</strong> El asa superior izquierda (<em>handle-nw</em>) y la inferior derecha (<em>handle-se</em>) redimensionan el ancho y alto de los elementos manteniendo los límites de forma independiente.</p><p>• <strong>Copiar y pegar (<kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd>):</strong> Duplica al instante elementos de texto, iconos o etiquetas para crear composiciones ricas con límites seguros por tarjeta.</p><p>• <strong>Guías de alineación (regla):</strong> Muestran en tiempo real la distancia respecto a márgenes de seguridad, centros y elementos adyacentes.</p><p>• <strong>Capas:</strong> Reordena la superposición visual de los elementos (traer al frente o enviar al fondo), ocúltalos o elimínalos con total reversibilidad.</p></details><details class="guide-details"><summary>Superficies, efectos visuales y modo "En contexto"</summary><p>• <strong>Efectos de superficie:</strong> Dale personalidad a tu tarjeta con estilos como <em>Cristal translúcido (Glassmorphism)</em>, <em>Aurora</em>, <em>Relieve suave</em> o fondos sólidos neutros.</p><p>• <strong>Vista "En contexto":</strong> Previsualiza tu tarjeta integrada dentro de un panel ejecutivo completo a resolución <strong>1280 × 720 px</strong> o <strong>1920 × 1080 px</strong>, con zoom real 1:1 y desplazamiento panorámico para validar proporciones y jerarquía visual.</p></details><details class="guide-details"><summary>Semáforos, objetivos y comparativas temporales</summary><p>• <strong>Lógica condicional:</strong> Configura si un valor favorable implica incremento (↑) o decremento (↓), definiendo umbrales de advertencia y colores semafóricos dinámicos.</p><p>• <strong>Comparativas YoY y MoM:</strong> Utilizan la función <code>EDATE</code> para contrastar con precisión períodos equivalentes sobre tu dimensión calendario.</p></details>`,btn('close-modal','Empezar a diseñar','arrow','button primary'),'guide-modal');}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Archivo preparado para descargar.');}
const filename=()=>c.measureName.trim().replace(/[^\p{L}\p{N}_-]/gu,'_')||'kpi-atelier';
function downloadJSON(conf=c,name=filename()){download(name+'.json',JSON.stringify({schema:'kpi-atelier',version:1,config:conf},null,2),'application/json');}
async function copyDax(){const dax=generateDAX(c);try{await navigator.clipboard.writeText(dax);toast('DAX copiado. Ya puedes pegarlo en Power BI.');}catch{const t=document.createElement('textarea');t.value=dax;$('#modal').append(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?'DAX copiado.':'No se pudo copiar. Descarga el archivo .dax.');}}
app.addEventListener('input',e=>{
 const t=e.target;
 if(t.type==='number')return;
 if(t.id==='template-search'||t.id==='gallery-search'){query=t.value;$(t.id==='template-search'?'#rail-cards':'#gallery-grid').innerHTML=t.id==='template-search'?railCards():galleryCards();fitThumbs();return;}
 if(t.dataset.duptext){
  const now=Date.now();if(now-lastEdit>700)record();lastEdit=now;
  const id=t.dataset.dupid||t.dataset.duptext;
  const next=updateElement(c,id,{text:t.value});
  c=sanitizeConfig(next);persist();refreshCard();updateHistoryButtons();return;
 }
 if(t.dataset.dupsize){
  const id=t.dataset.dupid||t.dataset.dupsize||selectedElement;
  if(id){
   const now=Date.now();if(now-lastEdit>700)record();lastEdit=now;
   const val=Number(t.value);
   if(t.nextElementSibling&&t.nextElementSibling.tagName==='OUTPUT')t.nextElementSibling.textContent=val+'px';
   const next=updateElement(c,id,{size:val});
   c=sanitizeConfig(next);persist();refreshCard();updateHistoryButtons();return;
  }
 }
 if(t.dataset.dupval){
  const id=t.dataset.dupid||selectedElement;
  if(id){
   const now=Date.now();if(now-lastEdit>700)record();lastEdit=now;
   const prop=t.dataset.dupval;let val=t.value;
   if(['decimals','goodThreshold','warnThreshold'].includes(prop))val=Number(val);
   const next=updateElement(c,id,{[prop]:val});
   c=sanitizeConfig(next);persist();refreshCard();updateHistoryButtons();return;
  }
 }
 if(t.dataset.elprop&&selectedElement){
  const now=Date.now();if(now-lastEdit>700)record();lastEdit=now;
  const id=selectedElement,key=t.dataset.elprop,value=Number(t.value),state=elementState(c,id);
  const next=key==='x'||key==='y'?moveElement(c,id,key==='x'?value-state.x:0,key==='y'?value-state.y:0,1,measureElementFrame(id)):updateElement(c,id,{[key]:value});
  c=sanitizeConfig(next);persist();refreshCard();updateHistoryButtons();return;
 }
 if(t.dataset.appearance&&selectedElement){editAppearance(t);return;}
 if(!t.dataset.key)return;
 const k=t.dataset.key;const now=Date.now();if(now-lastEdit>700)record();lastEdit=now;
 c=sanitizeConfig({...c,[k]:t.type==='checkbox'?t.checked:typeof BASE[k]==='number'?Number(t.value)/Number(t.dataset.scale||1):t.value});
 if(['accent','background','text','muted','positive','negative','warning','borderColor'].includes(k))c.theme='custom';
 if(k==='format'&&c.format!=='percent'&&c.deltaMode==='pp')c.deltaMode='relative';
 if(k==='format'&&c.format==='percent')c.unit='none';
 if(t.type==='range'){const suffix=t.nextElementSibling.textContent.match(/(?:px|%)$/)?.[0]||'';t.nextElementSibling.textContent=(t.dataset.scale?Math.round(c[k]*Number(t.dataset.scale)):c[k])+suffix;}
 if(t.type==='color'){t.nextElementSibling.textContent=c[k].toUpperCase();t.nextElementSibling.nextElementSibling.style.background=c[k];}
 persist();renderStage();updateHistoryButtons();
});
app.addEventListener('change',e=>{
 const t=e.target;
 if(t.type==='number'&&(t.dataset.key||t.dataset.elprop)){commitNumber(t);return;}
 if(t.id==='family-filter'){filter=t.value;$('#rail-cards').innerHTML=railCards();fitThumbs();return;}
 if(t.dataset.dupval){
  const id=t.dataset.dupid||selectedElement;
  if(id){
   const prop=t.dataset.dupval;let val=t.value;
   if(['decimals','goodThreshold','warnThreshold'].includes(prop))val=Number(val);
   const next=updateElement(c,id,{[prop]:val});
   c=sanitizeConfig(next);persist();refreshCard();renderInspector();updateHistoryButtons();return;
  }
 }
 if(t.dataset.appearance&&selectedElement){if(t.tagName==='SELECT')renderInspector();else if(t.dataset.hex!==undefined&&t.getAttribute('aria-invalid')==='true')toast('Escribe un color HEX de 6 caracteres, por ejemplo #477568.');return;}
 if(t.dataset.elprop&&selectedElement){t.value=elementState(c,selectedElement)[t.dataset.elprop];renderInspector();}
 if(t.dataset.key&&(t.tagName==='SELECT'||t.type==='checkbox'||t.type==='color'))renderInspector();
});
let pendingInjectAction=null;
function chooseLiveInstanceModal(instances){
 const rows=instances.map(inst=>{
  const report=inst.reportName||inst.modelName||'Power BI Desktop';
  return `<div class="pbi-instance-card">
   <div class="pbi-instance-info">
    <strong>📊 ${esc(report)}</strong>
   </div>
   <button type="button" class="button primary btn-select-instance" data-action="select-live-instance" data-server="${esc(inst.server)}" data-db="${esc(inst.database||'')}" data-report="${esc(report)}">
    ${icon('sparkles',13)} Conectar informe
   </button>
  </div>`;
 }).join('');

 openModal(
  'Seleccionar informe de Power BI Desktop',
  `Se han detectado ${instances.length} informes abiertos en Power BI Desktop. Elige cuál vincular:`,
  `<div class="pbi-instances-list">${rows}</div>`,
  btn('close-modal','Cancelar',null,'button secondary'),
  'instance-modal'
 );
}

function showInjectConfirmModal(missingRefs,existingMeasure,onConfirm){
 pendingInjectAction=onConfirm;
 let body='';
 if(missingRefs&&missingRefs.length>0){
  body+=`
   <div class="inject-confirm-alert warning">
    <div class="inject-confirm-icon">${icon('info',18)}</div>
    <div>
     <strong>Medidas no encontradas en el modelo</strong>
     <p>Las siguientes medidas referenciadas no se detectaron en tu informe de Power BI Desktop conectado:</p>
     <ul class="inject-missing-list">
      ${missingRefs.map(m=>`<li>${esc(m)}</li>`).join('')}
     </ul>
     <small>Si estas medidas se crean dinámicamente o se crearán luego, puedes continuar.</small>
    </div>
   </div>`;
 }
 if(existingMeasure){
  body+=`
   <div class="inject-confirm-alert info">
    <div class="inject-confirm-icon">${icon('sparkles',18)}</div>
    <div>
     <strong>La medida ya existe en tu modelo</strong>
     <p>La medida <code>${esc(c.measureName)}</code> ya existe en la tabla <strong>${esc(existingMeasure.table)}</strong> de Power BI Desktop.</p>
     <p>¿Confirmas que deseas sobrescribir su fórmula DAX conservando el resto del modelo intacto?</p>
    </div>
   </div>`;
 }

 openModal(
  existingMeasure?'Confirmar sobrescritura en Power BI':'Confirmar creación en Power BI',
  'Comprueba los siguientes avisos antes de aplicar los cambios en tu informe abierto.',
  body,
  btn('cancel-inject-confirm','Cancelar',null,'button secondary')+
  `<button type="button" class="button primary" data-action="proceed-inject-measure">
   ${icon('sparkles',14)} <span>${existingMeasure?'Sobrescribir en Power BI':'Crear en Power BI'}</span>
  </button>`,
  'inject-confirm-modal'
 );
}

function updateHistoryButtons(){const u=app.querySelector('[data-action="undo"]'),r=app.querySelector('[data-action="redo"]');if(u)u.disabled=!undo.length;if(r)r.disabled=!redo.length;}
document.addEventListener('click',e=>{
 const t=e.target.closest('button,a[data-action]');if(!t)return;
 if(t.dataset.action==='home')e.preventDefault();
 if(t.dataset.template){const selected=TEMPLATES.find(x=>x.id===t.dataset.template);requestNavigation(()=>loadDesign(selected.config));return;}
 if(t.dataset.theme){themeSelect(t.dataset.theme);return;}
 if(t.dataset.mode){rememberInspector();mode=t.dataset.mode;persist();render();return;}
 if(t.dataset.tab){rememberInspector();tab=t.dataset.tab;renderInspector();return;}
 if(t.dataset.filter){filter=t.dataset.filter;render();return;}
 if(t.dataset.load){const s=saved.find(x=>x.id===t.dataset.load);if(s){requestNavigation(()=>{loadDesign(s.config,s.id);toast('Diseño abierto.');});}return;}
 const a=t.dataset.action;if(!a)return;
 if(a.startsWith('view-')){const next=a.slice(5);if(next!==view)requestNavigation(()=>{view=next;query='';render();});return;}
 const actions={
 home:()=>{if(view!=='designer')requestNavigation(()=>{view='designer';render();});},
 single:()=>{context=false;zoom=100;renderStage();render();},
 context:()=>{
  context=true;
  const stage=$('#stage');
  const [resW, resH] = contextResolution==='1920x1080' ? [1920, 1080] : [1280, 720];
  const availW=Math.max(300,(stage?.clientWidth||800)-80);
  const availH=Math.max(240,(stage?.clientHeight||500)-80);
  const fitRatio=Math.min(availW/resW,availH/resH);
  zoom=Math.max(25,Math.min(100,Math.round(fitRatio*100)));
  render();
 },
 'canvas-color':()=>{canvasDark=!canvasDark;renderStage();},
 'zoom-in':()=>{zoom=Math.min(200,zoom+10);renderStage();},
 'zoom-out':()=>{zoom=Math.max(25,zoom-10);renderStage();},
 'zoom-fit':()=>{
  if(context){
   const stage=$('#stage');
   const [resW, resH] = contextResolution==='1920x1080' ? [1920, 1080] : [1280, 720];
   const availW=Math.max(300,(stage?.clientWidth||800)-80);
   const availH=Math.max(240,(stage?.clientHeight||500)-80);
   const fitRatio=Math.min(availW/resW,availH/resH);
   zoom=Math.max(25,Math.min(100,Math.round(fitRatio*100)));
  } else {
   zoom=100;
  }
  renderStage();
 },
 'context-res':()=>{
  contextResolution=t.dataset.res||'1280x720';
  try{localStorage.setItem('kpi-atelier-context-res',JSON.stringify(contextResolution));}catch{}
  const stage=$('#stage');
  const [resW, resH] = contextResolution==='1920x1080' ? [1920, 1080] : [1280, 720];
  const availW=Math.max(300,(stage?.clientWidth||800)-80);
  const availH=Math.max(240,(stage?.clientHeight||500)-80);
  const fitRatio=Math.min(availW/resW,availH/resH);
  zoom=Math.max(25,Math.min(100,Math.round(fitRatio*100)));
  renderStage();
  render();
 },
 'fix-check-issue':()=>{
  const field=t.dataset.field;
  if(!field)return;
  closeModal();
  if(['measure','measureName','dateTable','dateColumn','targetMeasure','compareMeasure'].includes(field)){
   openDataBindingModal(field);
  }else if(field.startsWith('dup_')){
   const matchedDupId=Object.keys(c.elements||{}).find(id=>field.startsWith(`dup_${id}_`));
   if(matchedDupId){
    selectElement(matchedDupId,true);
    const subProp=field.replace(`dup_${matchedDupId}_`,'');
    tab='element';
    render();
    const targetNode=$(`[data-dupval="${subProp}"]`)||$(`[data-duptext="${matchedDupId}"]`);
    if(targetNode){
     targetNode.focus();
     targetNode.select?.();
    }
    toast('Corrige el campo del elemento duplicado para continuar.');
    return;
   }
  }else{
   tab=(field==='title'||field==='goodThreshold'?'content':'style');
   render();
   const targetNode=$(`#f-${field}`);
   if(targetNode){
    const det=targetNode.closest('details');
    if(det)det.open=true;
    targetNode.focus();
    targetNode.select?.();
   }
   toast('Corrige el campo indicado para continuar.');
  }
 },
 'fix-circular-name':()=>{
  const cleanId=c.measureName.replace(/^\[|\]$/g,'').trim().replace(/[^\p{L}\p{N}_ ]/gu,'').trim().replace(/\s+/g,'_');
  const safeName=cleanId.startsWith('KPI_')?`${cleanId}_Card`:`KPI_${cleanId}`;
  c=sanitizeConfig({...c,measureName:safeName});
  persist();
  refreshCard();
  closeModal();
  toast(`Nombre actualizado a '${safeName}'. Ya puedes sincronizar sin conflicto.`);
  exportModal();
 },
 'fix-missing-model-fields':()=>{
  closeModal();
  openDataBindingModal();
 },
 undo:()=>{if(undo.length){redo.push(c);c=undo.pop();persist();render();}},redo:()=>{if(redo.length){undo.push(c);c=redo.pop();persist();render();}},
 reset:()=>{const template=TEMPLATES.find(x=>x.id===c.id)||TEMPLATES[0];openModal('¿Restaurar la plantilla?','Volverás a los ajustes originales de '+template.name+'.','<p>Podrás recuperar los cambios con Deshacer.</p>',btn('close-modal','Cancelar',null,'button secondary')+btn('confirm-reset','Restaurar','reset','button primary'));},
 'confirm-reset':()=>{closeModal();loadDesign((TEMPLATES.find(x=>x.id===c.id)||TEMPLATES[0]).config);toast('Plantilla restaurada.');},
 guide,validation:validationModal,export:exportModal,'open-data-modal':()=>openDataBindingModal(),'close-modal':closeModal,'copy-dax':copyDax,
  'inject-live-measure': async () => {
   if(!pbipModel?.isLiveConnection||!pbipModel?.server){
    toast('No hay conexión en vivo con Power BI Desktop.');
    return;
   }
   const b=$('#modal')?.querySelector('[data-action="inject-live-measure"]');

   // Pre-check 0: Control en la capa más alta contra dependencia circular
   const circConflict=getCircularConflict(c);
   if(circConflict){
    openModal(
     'Dependencia circular detectada',
     'Corrige el nombre de la medida en KPI Atelier antes de sincronizar con Power BI.',
     `<div class="inject-confirm-alert error">
       <div class="inject-confirm-icon">${icon('alertTriangle',20)}</div>
       <div>
        <strong>Conflicto con ${esc(circConflict.type)}</strong>
        <p>La medida DAX resultante se llama <code>${esc(c.measureName)}</code>, que coincide exactamente con la ${esc(circConflict.type)} <code>[${esc(circConflict.name)}]</code>.</p>
        <p>En Power BI, una medida no puede utilizar su propia fórmula para calcularse a sí misma (provocaría un error de dependencia circular en el servidor).</p>
        <p>Modifica el nombre de la medida resultante en KPI Atelier para continuar.</p>
       </div>
      </div>`,
     btn('close-modal','Cerrar',null,'button secondary')+
     `<button type="button" class="button primary" data-action="fix-circular-name">
       ${icon('sparkles',14)} <span>Renombrar a KPI_${esc(c.measureName.replace(/^\[|\]$/g,'').trim().replace(/[^\p{L}\p{N}_ ]/gu,'').trim().replace(/\s+/g,'_'))}</span>
      </button>`,
     'circular-conflict-modal'
    );
    return;
   }

   // Pre-check 1: Validar estrictamente todas las medidas, tabla calendario y columna de fecha en el modelo de Power BI
   const modelMeasureNames=(pbipModel.measures||[]).map(m=>m.name.toLowerCase());
   const missingItems=[];

   // 1. Medida principal
   const cleanM=(c.measure||'').replace(/^\[|\]$/g,'').trim().toLowerCase();
   if(!cleanM){
    missingItems.push({type:'Medida principal',detail:'No has seleccionado ninguna medida de negocio.'});
   }else if(!modelMeasureNames.includes(cleanM)){
    missingItems.push({type:'Medida principal',detail:`La medida [${c.measure.trim()}] no existe en tu informe de Power BI.`});
   }

   // 2. Medida objetivo
   if(needsGoal(c)||(needsCompare(c)&&c.comparison==='target')){
    const rawTarget=(c.targetMeasure||'').trim();
    if(!rawTarget){
     missingItems.push({type:'Medida objetivo',detail:'Falta indicar la medida o cifra objetivo.'});
    }else if(!/^-?\d+(\.\d+)?$/.test(rawTarget)){
     const cleanT=rawTarget.replace(/^\[|\]$/g,'').toLowerCase();
     if(!modelMeasureNames.includes(cleanT)){
      missingItems.push({type:'Medida objetivo',detail:`La medida [${rawTarget}] no existe en tu informe de Power BI.`});
     }
    }
   }

   // 3. Medida de referencia
   if(needsCompare(c)&&c.comparison==='custom'){
    const rawComp=(c.compareMeasure||'').trim();
    if(!rawComp){
     missingItems.push({type:'Medida de referencia',detail:'Falta indicar la medida de comparación.'});
    }else{
     const cleanC=rawComp.replace(/^\[|\]$/g,'').toLowerCase();
     if(!modelMeasureNames.includes(cleanC)){
      missingItems.push({type:'Medida de referencia',detail:`La medida [${rawComp}] no existe en tu informe de Power BI.`});
     }
    }
   }

   // 4. Tabla calendario y Columna de fechas
   if(needsDate(c)){
    const rawTable=(c.dateTable||'').trim();
    const rawCol=(c.dateColumn||'').trim();
    if(!rawTable){
     missingItems.push({type:'Tabla calendario',detail:'Falta indicar la tabla calendario del modelo.'});
    }else{
     const foundDt=(pbipModel.dateTables||[]).find(dt=>dt.name.toLowerCase()===rawTable.toLowerCase());
     const tableExistsInModel=foundDt||(pbipModel.tables||[]).some(t=>t.toLowerCase()===rawTable.toLowerCase());
     if(!tableExistsInModel){
      missingItems.push({type:'Tabla calendario',detail:`La tabla '${rawTable}' no existe en tu informe de Power BI.`});
     }else if(!rawCol){
      missingItems.push({type:'Columna de fecha',detail:'Falta indicar la columna de fechas continuas.'});
     }else if(foundDt&&foundDt.dateColumns?.length){
      const colExists=foundDt.dateColumns.some(col=>col.toLowerCase()===rawCol.toLowerCase());
      if(!colExists){
       missingItems.push({type:'Columna de fecha',detail:`La columna '${rawCol}' no existe en la tabla '${foundDt.name}' de tu informe.`});
      }
     }
    }
   }

   // 5. Medidas en elementos duplicados
   for(const [dupId, dupState] of Object.entries(c.elements||{})){
    if(dupState?.deleted) continue;
    const def = resolveElementDef(dupId);
    if(dupState?.measure){
     const cleanDupM=dupState.measure.replace(/^[\[\]]/g,'').trim().toLowerCase();
     if(cleanDupM && !modelMeasureNames.includes(cleanDupM)){
      missingItems.push({type:`Elemento duplicado '${def?.label||dupId}'`,detail:`La medida [${dupState.measure.trim()}] no existe en tu informe de Power BI.`});
     }
    }
    if(dupState?.compareMeasure){
     const cleanDupC=dupState.compareMeasure.replace(/^[\[\]]/g,'').trim().toLowerCase();
     if(cleanDupC && !modelMeasureNames.includes(cleanDupC)){
      missingItems.push({type:`Elemento duplicado '${def?.label||dupId}'`,detail:`La medida de comparación [${dupState.compareMeasure.trim()}] no existe en tu informe de Power BI.`});
     }
    }
    if(dupState?.targetMeasure){
     const rawTarget=(dupState.targetMeasure||'').trim();
     if(rawTarget && !/^-?\d+(\.\d+)?$/.test(rawTarget)){
      const cleanDupT=rawTarget.replace(/^[\[\]]/g,'').toLowerCase();
      if(!modelMeasureNames.includes(cleanDupT)){
       missingItems.push({type:`Elemento duplicado '${def?.label||dupId}'`,detail:`La medida objetivo [${rawTarget}] no existe en tu informe de Power BI.`});
      }
     }
    }
   }

   if(missingItems.length>0){
    openModal(
     'Validación de datos con Power BI',
     'Se han detectado campos no encontrados en tu informe abierto de Power BI Desktop:',
     `<div class="inject-confirm-alert error">
       <div class="inject-confirm-icon">${icon('alertTriangle',20)}</div>
       <div>
        <strong>Campos pendientes o no encontrados en el modelo</strong>
        <ul class="missing-refs-list" style="margin:8px 0 0;padding-left:18px;">
         ${missingItems.map(it=>`<li style="margin:4px 0;"><strong>${esc(it.type)}:</strong> ${esc(it.detail)}</li>`).join('')}
        </ul>
        <p style="margin-top:10px;">Selecciona los campos reales de tu modelo en <em>Conectar datos del modelo</em> antes de crear la medida.</p>
       </div>
      </div>`,
     btn('close-modal','Cancelar',null,'button secondary')+
     `<button type="button" class="button primary" data-action="fix-missing-model-fields">
       ${icon('link',14)} <span>Corregir en Conectar datos</span>
      </button>`,
     'missing-refs-modal'
    );
    return;
   }

   // Pre-check 2: Check if measure already exists in model
   const cleanNewName=c.measureName.trim().toLowerCase();
   const existingMeasure=(pbipModel.measures||[]).find(m=>m.name.toLowerCase()===cleanNewName);

   const executeInjection = async () => {
    const injectBtn=$('#modal')?.querySelector('[data-action="inject-live-measure"]')||b;
    if(injectBtn){
     injectBtn.disabled=true;
     injectBtn.innerHTML=`<span class="loading-spinner"></span> <span>Inyectando medida…</span>`;
    }
    toast('⚡ Actualizando medida en Power BI Desktop…');
    try{
     const dax=generateDAX(c);
     const escapedName=c.measureName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
     const cleanDax=dax.replace(new RegExp(`^\\s*(\\[?${escapedName}\\]?)\\s*=\\s*`,'u'),'');
     const daxExpression='\r\n'+cleanDax.trimStart();
     const targetTbl=existingMeasure?existingMeasure.table:(c.targetTable||(pbipModel.tables?.includes('_Measures')?'_Measures':pbipModel.tables?.[0]||'_Measures'));
     const result=await injectMeasureToLivePbi({
      server: pbipModel.server,
      database: pbipModel.database||'',
      tableName: targetTbl,
      measureName: c.measureName.replace(/^\[|\]$/g,'').trim(),
      daxExpression: daxExpression,
      formatString: '',
      configAnnotation: c
     });
     toast(existingMeasure ? `⚡ ¡Medida '${result.measureName}' sobrescrita con éxito en Power BI Desktop!` : `⚡ ¡Medida '${result.measureName}' creada con éxito en Power BI Desktop!`);
      if(injectBtn){
       injectBtn.innerHTML=`${icon('check',14)} <span>${existingMeasure ? '¡Sobrescrita con éxito!' : '¡Inyectada con éxito!'}</span>`;
       injectBtn.style.background='#2e7d32';
       injectBtn.style.borderColor='#2e7d32';
      }
     fetchLivePbiModel(pbipModel.server,pbipModel.database||'').then(cat=>setPbipModel(cat,false)).catch(()=>{});
    }catch(err){
     let msg=err.message||'';
     if(/dependencia circular|circular dependency/i.test(msg)){
      msg=`Se detectó una dependencia circular en Power BI. La medida '${c.measureName}' no puede referenciarse a sí misma. Modifica el nombre de salida en KPI Atelier para continuar.`;
     }
     toast(`Error al inyectar medida: ${msg}`);
     if(injectBtn){
      injectBtn.disabled=false;
      injectBtn.innerHTML=`${icon('sparkles',14)} <span>Reintentar inyección</span>`;
     }
    }
   };

   if(existingMeasure){
    showInjectConfirmModal([],existingMeasure,executeInjection);
    return;
   }

   await executeInjection();
  },
  'cancel-inject-confirm':()=>{
   pendingInjectAction=null;
   closeModal();
   exportModal();
  },
  'proceed-inject-measure':async ()=>{
   t.disabled=true;
   t.innerHTML=`<span class="loading-spinner"></span> <span>Sobrescribiendo…</span>`;
   toast('⚡ Aplicando cambios en Power BI Desktop…');
   closeModal();
   exportModal();
   if(pendingInjectAction){
    const fn=pendingInjectAction;
    pendingInjectAction=null;
    await fn();
   }
  },
  'connect-live-pbi': async () => {
    const connectBtn = app.querySelector('[data-action="connect-live-pbi"]');
    const origContent = connectBtn ? connectBtn.innerHTML : '';
    if(connectBtn){
     connectBtn.disabled = true;
     connectBtn.innerHTML = `${icon('sparkles',13)} <span>Buscando informes…</span>`;
    }
    toast('Buscando informes abiertos en Power BI Desktop…');
    try{
     const instances=await discoverLivePbi();
     if(!instances||!instances.length){
      toast('No se detectó ninguna instancia abierta de Power BI Desktop. Abre tu archivo en Desktop y vuelve a intentarlo.');
      return;
     }
     if(instances.length>1){
      chooseLiveInstanceModal(instances);
      return;
     }
     const first=instances[0];
     const repName = first.reportName ? `'${first.reportName}'` : `(${first.server})`;
     toast(`Conectando con Power BI Desktop ${repName}…`);
     const catalog=await fetchLivePbiModel(first.server,first.database||'');
     setPbipModel(catalog,true);
     toast(`⚡ Conectado con éxito a '${catalog.reportName || catalog.modelName}' (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
     openDataBindingModal();
    }catch(err){
     toast(`Error al conectar con Power BI: ${err.message}`);
    }finally{
     if(connectBtn){
      connectBtn.disabled = false;
      connectBtn.innerHTML = origContent;
     }
    }
   },
   'select-live-instance': async () => {
    const srv=t.dataset.server;
    const db=t.dataset.db||'';
    const repName=t.dataset.report||'Power BI';
    t.disabled=true;
    t.innerHTML=`${icon('sparkles',13)} Conectando…`;
    toast(`Conectando con '${repName}'…`);
    try{
     const catalog=await fetchLivePbiModel(srv,db);
     closeModal();
     setPbipModel(catalog,true);
     toast(`⚡ Conectado en vivo a '${catalog.reportName || catalog.modelName}' (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
     openDataBindingModal();
    }catch(err){
     toast(`Error al conectar: ${err.message}`);
     t.disabled=false;
     t.innerHTML=`${icon('sparkles',13)} Conectar informe`;
    }
   },
   'load-roundtrip-measure': () => {
    const mName = t.dataset.measure;
    if(!mName || !pbipModel?.measures) return;
    const rm = pbipModel.measures.find(m => m.name === mName);
    if(rm?.configAnnotation){
     try {
      const conf = typeof rm.configAnnotation === 'string' ? JSON.parse(rm.configAnnotation) : rm.configAnnotation;
      pendingRoundtripConf = conf;
      pendingRoundtripName = rm.name;
      openModal(
       '¿Cargar diseño en el lienzo?',
       `Se sustituirá el diseño actual por la configuración de la tarjeta '${esc(rm.name)}'.`,
       '<p class="field-help">Los cambios no guardados se reemplazarán por esta tarjeta. Puedes recuperar el diseño previo con Deshacer.</p>',
       btn('cancel-roundtrip-load','Cancelar',null,'button secondary') +
       `<button type="button" class="button primary" data-action="confirm-roundtrip-load">${icon('sparkles',14)} <span>Cargar en lienzo</span></button>`,
       'roundtrip-confirm-modal'
      );
     } catch (err) {
      toast(`No se pudo leer la configuración de '${esc(rm.name)}'.`);
     }
    }
   },
   'cancel-roundtrip-load': () => {
    pendingRoundtripConf = null;
    pendingRoundtripName = '';
    openDataBindingModal();
   },
   'confirm-roundtrip-load': () => {
    if(pendingRoundtripConf){
     const conf = pendingRoundtripConf;
     const name = pendingRoundtripName;
     pendingRoundtripConf = null;
     pendingRoundtripName = '';
     if(conf.measure && String(conf.measure).trim()){
      conf._measureBound = true;
     }
     if(conf.targetMeasure && String(conf.targetMeasure).trim()){
      conf._targetCustomized = true;
     }
     if(conf.dateTable && String(conf.dateTable).trim()){
      conf._dateCustomized = true;
     }
     setConfig(conf, true);
     openDataBindingModal();
     toast(`⚡ Tarjeta cargada en el lienzo desde '${esc(name)}'.`);
    }
   },
  'refresh-live-pbi': async () => {
   if(!pbipModel?.server)return;
   try{
    toast('Actualizando modelo desde Power BI Desktop…');
    const catalog=await fetchLivePbiModel(pbipModel.server,pbipModel.database||'');
    setPbipModel(catalog,true);
    toast(`Modelo actualizado (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
    openDataBindingModal();
   }catch(err){
    toast(`Error al actualizar: ${err.message}`);
   }
  },
 'connect-pbip':()=>{
  const fallbackInput=document.getElementById('pbip-folder-input');
  if(typeof window.showDirectoryPicker==='function'){
   window.showDirectoryPicker({mode:'read'}).then(async handle=>{
    try{
     const catalog=await scanDirectoryHandle(handle);
     setPbipModel(catalog,true);
     const appliedCal=(catalog.dateTables||[])[0];
     const calMsg=appliedCal?` · Calendario: ${appliedCal.name}[${appliedCal.primaryDateColumn||appliedCal.dateColumns[0]}]`:'';
     toast(`Modelo '${catalog.modelName}' conectado (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha)${calMsg}.`);
     openDataBindingModal();
    }catch(err){
     toast(`Error al leer PBIP: ${err.message}`);
    }
   }).catch(err=>{
    if(err&&err.name!=='AbortError'&&fallbackInput){
     fallbackInput.click();
    }
   });
  }else if(fallbackInput){
   fallbackInput.click();
  }
 },
 'disconnect-pbip':()=>{
  setPbipModel(null);
  const tpl=TEMPLATES.find(x=>x.id===c.id)||TEMPLATES[0];
  c=sanitizeConfig({...c,dateTable:tpl.config.dateTable||'Calendario',dateColumn:tpl.config.dateColumn||'Fecha'});
  persist();
  refreshCard();
  toast('Modelo desconectado.');
  openDataBindingModal();
 },
 'download-dax':()=>download(filename()+'.dax',generateDAX(c),'text/plain;charset=utf-8'),
 'download-json':()=>downloadJSON(),
 'download-html':()=>download(filename()+'.html',`<!doctype html><html lang="es"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)} · Vista de muestra</title><body style="margin:0;min-height:100vh;background:#eceee9;display:grid;place-items:center;padding:24px;box-sizing:border-box"><main style="width:${c.width}px;max-width:100%">${cardHTML(c)}<p style="font:12px Arial;color:#737c77;text-align:center">KPI Atelier · Datos de ejemplo, no conectado a Power BI</p></main></body></html>`,'text/html;charset=utf-8'),
 import:()=>$('#file-import').click(),
 save:()=>openModal('Una idea que merece quedarse.','Guarda esta tarjeta en tu colección personal.',`<label class="save-label" for="design-name">Nombre del diseño</label><input class="save-input" id="design-name" maxlength="80" value="${esc(saved.find(s=>s.id===editingSavedId)?.name||c.title+' · '+(TEMPLATES.find(x=>x.id===c.id)?.name||'Mi diseño'))}" autofocus><p class="field-help">Se guardará en este navegador. Puedes exportar el JSON como copia.</p>`,btn('close-modal','Cancelar',null,'button secondary')+btn('confirm-save','Guardar diseño','save','button primary')),
 'confirm-save':()=>{if(saveCurrent($('#design-name').value)){closeModal();render();toast('Diseño guardado en tu colección.');}},
 'guard-discard':()=>{const go=pendingNavigation;c=structuredClone(baseline);undo=[];redo=[];persist();closeModal();go?.();},
 'guard-save':()=>{const go=pendingNavigation;if(saveCurrent($('#guard-name').value)){closeModal();go?.();}},
 'saved-json':()=>{const s=saved.find(s=>s.id===t.dataset.id);if(s)downloadJSON(s.config,s.name.replace(/[^\p{L}\p{N}_-]/gu,'_'));},
 delete:()=>{const s=saved.find(s=>s.id===t.dataset.id);if(s)openModal('¿Eliminar este diseño?',esc(s.name),'<p>El borrador actual no se eliminará.</p>',btn('close-modal','Cancelar',null,'button secondary')+btn('confirm-delete','Eliminar','trash','button danger',`data-id="${s.id}"`));},
 'confirm-delete':()=>{const next=saved.filter(s=>s.id!==t.dataset.id);try{localStorage.setItem('kpi-atelier-saved',JSON.stringify(next));saved=next;closeModal();render();toast('Diseño eliminado.');}catch{toast('No se pudo eliminar el diseño.');}},
 scenario:()=>{tab='data';render();const details=$('#f-sampleScenario')?.closest('details');if(details){details.open=true;details.scrollIntoView({block:'nearest',behavior:'smooth'});$('#f-sampleScenario').focus();}}
 };
 try{actions[a]?.();}catch(err){toast(err.message||'No se pudo completar la acción.');}
});
$('#file-import').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(f.size>100000){toast('El JSON es demasiado grande (máximo 100 KB).');return;}try{const data=JSON.parse(await f.text());if(data.schema!=='kpi-atelier'||data.version!==1||!data.config||typeof data.config!=='object'||Array.isArray(data.config))throw Error('Selecciona un JSON de configuración de KPI Atelier v1.');const conf=sanitizeConfig(data.config);requestNavigation(()=>{loadDesign(conf);toast('Configuración importada.');});}catch(err){toast(err.message||'No se pudo leer el archivo.');}});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
let clipboardElement=null,clipboardElements=[];
function copySelectedElements(){
 if($('#modal').open)return;
 const targets=selectedElements.size>0?[...selectedElements]:(selectedElement?[selectedElement]:[]);
 if(!targets.length)return;
 clipboardElements=targets.map(id=>{
  const p=elementState(c,id);
  const def=resolveElementDef(id)||ELEMENTS[id];
  const isVal=def?.baseId==='value'||id==='value';
  const isDel=def?.baseId==='delta'||id==='delta';
  return {
   id,
   baseId:def?.baseId||id,
   state:structuredClone(p),
   text:p.text!==undefined?p.text:(def?.contentKey?c[def.contentKey]:''),
   icon:p.icon||c.icon,
   valProps:isVal?{
    format:p.format||c.format,
    currency:p.currency||c.currency,
    unit:p.unit||c.unit,
    decimals:p.decimals??c.decimals,
    suffix:p.suffix!==undefined?p.suffix:(c.suffix||''),
    measure:p.measure!==undefined?p.measure:(c.measure||'')
   }:{},
   deltaProps:isDel?{
    deltaMode:p.deltaMode||c.deltaMode,
    compareMeasure:p.compareMeasure!==undefined?p.compareMeasure:(c.compareMeasure||'')
   }:{},
   label:def?.label||id
  };
 });
 clipboardElement=clipboardElements[0];
 if(clipboardElements.length===1){
  toast(`Copiado: ${clipboardElements[0].label}`);
 }else{
  toast(`Copiados ${clipboardElements.length} elementos en bloque.`);
 }
}
function copySelectedElement(){copySelectedElements();}

function pasteElements(){
 if(!clipboardElements.length||$('#modal').open||context)return;
 const allKeys=Object.keys(c.elements||{});
 const dupCountTotal=allKeys.filter(k=>k.includes('_copy')&&!c.elements[k].deleted).length;
 if(dupCountTotal+clipboardElements.length>8){
  toast('Límite de duplicados alcanzado (máximo 8 copias en la tarjeta).');
  return;
 }
 let nextConf=c;
 const newIds=[];
 for(const item of clipboardElements){
  const baseId=item.baseId;
  const def=resolveElementDef(baseId)||ELEMENTS[baseId];
  if(!def)continue;
  const curKeys=Object.keys(nextConf.elements||{});
  const baseDups=curKeys.filter(k=>k.startsWith(baseId+'_copy')&&!nextConf.elements[k]?.deleted).length;
  if(baseDups>=2){
   toast(`Límite alcanzado: máximo 2 copias para ${def.label}.`);
   continue;
  }
  let nextIdx=1;
  while(nextConf.elements?.[`${baseId}_copy${nextIdx}`]&&!nextConf.elements[`${baseId}_copy${nextIdx}`].deleted){
   nextIdx++;
  }
  const newId=`${baseId}_copy${nextIdx}`;
  resolveElementDef(newId);
  const origFrame=nextConf.elements?.[item.id]?.frame||item.state?.frame||measureElementFrame(item.id)||{left:24,top:24,width:120,height:24};
  const newFrame={
   ...origFrame,
   left:Math.min(nextConf.width-60,origFrame.left+16),
   top:Math.min(nextConf.height-40,origFrame.top+16)
  };
  const newElState={
   ...item.state,
   ...item.valProps,
   ...item.deltaProps,
   x:0,
   y:0,
   hidden:false,
   deleted:false,
   frame:newFrame,
   ...(item.text!==undefined?{text:item.text}:{}),
   ...(item.icon?{icon:item.icon}:{})
  };
  nextConf={
   ...nextConf,
   elements:{...nextConf.elements,[newId]:newElState},
   layerOrder:[newId,...layerOrder(nextConf).filter(k=>k!==newId)]
  };
  newIds.push(newId);
 }
 if(newIds.length===1){
  directChange(nextConf);
  selectElement(newIds[0]);
  toast(`Duplicado: ${ELEMENTS[newIds[0]].label}`);
 }else if(newIds.length>1){
  directChange(nextConf);
  selectedElements=new Set(newIds);
  selectedElement=newIds[0];
  positionSelection();
  renderCanvasBar();
  toast(`Duplicados ${newIds.length} elementos en bloque.`);
 }
}
function pasteElement(){pasteElements();}

function applyFormatPainter(targetId){
 if(!formatPainterSource||formatPainterSource===targetId)return false;
 const srcDef=resolveElementDef(formatPainterSource)||ELEMENTS[formatPainterSource];
 const tgtDef=resolveElementDef(targetId)||ELEMENTS[targetId];
 const srcBase=srcDef?.baseId||formatPainterSource;
 const tgtBase=tgtDef?.baseId||targetId;
 if(srcBase!==tgtBase&&srcDef?.kind!==tgtDef?.kind){
  toast(`El copiado de formato solo es compatible entre elementos del mismo tipo (${srcDef?.label||'origen'}).`);
  return false;
 }
 const srcP=elementState(c,formatPainterSource);
 const tgtP=elementState(c,targetId);
 const srcApp=appearance(c,formatPainterSource);
 const appearancePatch={
  colorMode:srcApp.colorMode,
  color:srcApp.color,
  backgroundColor:srcApp.backgroundColor,
  backgroundMode:srcApp.backgroundMode,
  backgroundOpacity:srcApp.backgroundOpacity,
  opacity:srcApp.opacity
 };
 const srcSize=elementSize(c,formatPainterSource);
 const sizePatch={};
 if(tgtDef.isDuplicate){
  sizePatch.size=srcSize;
 }else if(tgtDef.sizeKey){
  sizePatch[tgtDef.sizeKey]=srcSize;
 }
 if(srcP.width){
  sizePatch.width=srcP.width;
 }
 const formatPatch={};
 if(srcP.format!==undefined)formatPatch.format=srcP.format;
 else if(srcBase==='value')formatPatch.format=c.format;
 if(srcP.decimals!==undefined)formatPatch.decimals=srcP.decimals;
 else if(srcBase==='value')formatPatch.decimals=c.decimals;
 if(srcP.currency!==undefined)formatPatch.currency=srcP.currency;
 else if(srcBase==='value')formatPatch.currency=c.currency;
 if(srcP.unit!==undefined)formatPatch.unit=srcP.unit;
 else if(srcBase==='value')formatPatch.unit=c.unit;
 if(srcP.suffix!==undefined)formatPatch.suffix=srcP.suffix;
 else if(srcBase==='value')formatPatch.suffix=c.suffix;
 if(srcP.deltaMode!==undefined)formatPatch.deltaMode=srcP.deltaMode;
 else if(srcBase==='delta')formatPatch.deltaMode=c.deltaMode;

 let next=c;
 if(!tgtDef.isDuplicate){
  if(srcSize&&tgtDef.sizeKey)next={...next,[tgtDef.sizeKey]:srcSize};
  if(tgtBase==='value'){
   if(formatPatch.format)next.format=formatPatch.format;
   if(formatPatch.decimals!==undefined)next.decimals=formatPatch.decimals;
   if(formatPatch.currency)next.currency=formatPatch.currency;
   if(formatPatch.unit)next.unit=formatPatch.unit;
   if(formatPatch.suffix!==undefined)next.suffix=formatPatch.suffix;
  }
  if(tgtBase==='delta'&&formatPatch.deltaMode){
   next.deltaMode=formatPatch.deltaMode;
  }
 }
 next=updateElement(next,targetId,{
  ...tgtP,
  ...appearancePatch,
  ...sizePatch,
  ...formatPatch
 });
 formatPainterSource=null;
 directChange(next);
 selectElement(targetId);
 toast(`🎨 Formato copiado a '${tgtDef.label}'.`);
 return true;
}

document.addEventListener('keydown',e=>{
 if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();app.querySelector('[data-action="save"]')?.click();}
 if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&!$('#modal').open){e.preventDefault();app.querySelector(`[data-action="${e.shiftKey?'redo':'undo'}"]`)?.click();}
 if((e.ctrlKey||e.metaKey)&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#modal').open){
  if(e.key==='c'||e.key==='C'){e.preventDefault();copySelectedElements();}
  if(e.key==='v'||e.key==='V'){e.preventDefault();pasteElements();}
 }
});
function rememberInspector(){
 const panel=$('#inspector-fields');if(!panel?.dataset.panelTab)return null;
 const panelTab=panel.dataset.panelTab;inspectorPositions.set(panelTab,panel.scrollTop);
 panel.querySelectorAll('[data-section]').forEach(d=>inspectorSections.set(d.dataset.section,d.open));
 const focused=panel.contains(document.activeElement)?document.activeElement:null;
 return {tab:panelTab,focus:focused?.id,selection:focused?.selectionStart!=null?[focused.selectionStart,focused.selectionEnd]:null};
}
app.addEventListener('toggle',e=>{if(e.target.matches?.('[data-section]'))inspectorSections.set(e.target.dataset.section,e.target.open);},true);
function updateInspectorTabs(){
 const tabs=app.querySelector('.inspector-tabs');if(!tabs)return;
 const entries=[...(cardSelected?[['card','Tarjeta']]:[]),...(selectedElement?[['element','Elemento']]:[]),['content','Contenido'],['style','Estilo'],['data','Datos & DAX']];
 tabs.innerHTML=entries.map(([id,label])=>`<button role="tab" aria-selected="${tab===id}" data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('');
}
function iconPickerField(){return `<div class="field"><label>Icono de la tarjeta</label><button class="icon-picker-launch" data-action="icons">${icon(c.icon,24)}<span>${ICON_OPTIONS.find(x=>x[0]===c.icon)?.[1]||'Icono'}<small>${ICON_OPTIONS.length} iconos disponibles</small></span>${icon('chevron',14)}</button></div>`;}
function surfaceInspector(){
 const effect=c.surfaceEffect;
 return `<div class="effect-grid" role="group" aria-label="Efecto de superficie">${SURFACE_EFFECTS.map(([id,label])=>`<button data-surface="${id}" class="effect-option ${effect===id?'active':''}" aria-pressed="${effect===id}"><span class="effect-sample effect-${id}" style="--effect-accent:${c.accent}"></span><span>${label}</span></button>`).join('')}</div>`+
 (effect!=='solid'?range('effectIntensity','Intensidad del efecto',0,100,'%'):'')+
 (effect==='glass'?range('glassOpacity','Opacidad del cristal',10,100,'%')+range('glassBlur','Desenfoque',0,40)+'<p class="field-help"><strong>Glassmorphism.</strong> El cristal deja entrever el fondo del lienzo. El desenfoque depende del contenido detrás y del soporte del visual en Power BI.</p>':'')+
 (['glass','aurora','glow'].includes(effect)?select('effectColorMode','Color del efecto',[['theme','Acento del tema'],['custom','Personalizado']])+(c.effectColorMode==='custom'?field('effectColor','Color del efecto','color'):''):'');
}
function appearanceSelect(key,label,value,options){return `<div class="field"><label for="appearance-${key}">${label}</label><select id="appearance-${key}" data-appearance="${key}">${options.map(([id,text])=>`<option value="${id}" ${id===value?'selected':''}>${text}</option>`).join('')}</select></div>`;}
function appearanceRange(key,label,value){return `<div class="field"><label for="appearance-${key}">${label}</label><div class="range-wrap"><input id="appearance-${key}" data-appearance="${key}" type="range" min="0" max="100" value="${value}"><output for="appearance-${key}">${value}%</output></div></div>`;}
function appearanceColor(key,label,value){return `<div class="field"><label for="appearance-${key}">${label}</label><div class="element-color-row"><input id="appearance-${key}" type="color" data-appearance="${key}" value="${value}"><span>HEX</span><input id="appearance-${key}-hex" data-appearance="${key}" data-hex maxlength="7" spellcheck="false" aria-label="${label}, código hexadecimal" value="${value.toUpperCase()}"></div><div class="element-color-swatches">${['accent','text','muted','background','positive','warning','negative'].map(role=>`<button data-element-color="${key}" data-role-color="${role}" title="${COLOR_ROLES.find(x=>x[0]===role)?.[1]||role}: ${c[role]}" aria-label="Usar ${c[role]}" style="background:${c[role]}"></button>`).join('')}</div></div>`;}
function elementAppearancePanel(id){
 const baseId=id?.replace(/_copy\d+$/,'');
 const p=appearance(c,id),spec=COLOR_SPEC[id]||COLOR_SPEC[baseId]||{role:'text'},data=sampleData(c),resolved=elementColor(c,id,data);
 const names={theme:'Seguir el tema',semantic:'Según el resultado del KPI',custom:'Color personalizado',linked:'Seguir la barra de progreso'};
 let html=appearanceSelect('colorMode',id==='progress'?'Color de la barra':id==='trend'?(c.chartKind==='donut'?'Color del anillo':'Color de línea y puntos'):'Color del elemento',p.colorMode,colorModes(id).map(key=>[key,names[key]]));
 html+=p.colorMode==='custom'?appearanceColor('color','Color personalizado',p.color):`<div class="appearance-source"><i style="background:${resolved}"></i><span>${p.colorMode==='linked'?'Vinculado a la barra':p.colorMode==='semantic'?'Favorable, alerta o desfavorable según el KPI':'Se actualiza al cambiar de tema'}</span></div>`;
 if(spec.background&&(id!=='trend'||c.chartKind==='donut')){html+=appearanceSelect('backgroundMode',['progress','trend'].includes(id)?'Fondo de la pista':'Fondo del elemento',p.backgroundMode,[['auto',id==='progress'?'Texto secundario del tema':'Seguir el color del elemento'],['custom','Color personalizado'],['none','Sin fondo']]);
  if(p.backgroundMode!=='none')html+=(p.backgroundMode==='custom'?appearanceColor('backgroundColor','Color de fondo',p.backgroundColor):'')+appearanceRange('backgroundOpacity','Opacidad del fondo',p.backgroundOpacity);
 }
 if(id==='trend'&&c.chartKind!=='donut'&&c.trendStyle==='area')html+=appearanceSelect('fillMode','Color del área',p.fillMode,[['linked','Seguir la línea'],['custom','Color personalizado']])+(p.fillMode==='custom'?appearanceColor('fillColor','Color del área',p.fillColor):'');
 html+=appearanceRange('opacity','Opacidad del elemento',p.opacity);
 if(id==='status'||p.colorMode==='semantic')html+=`<details class="semantic-colors"><summary>Colores de estado · compartidos</summary><p class="field-help">Estos colores se comparten con los indicadores que siguen el resultado.</p>${field('positive','Favorable','color')}${id!=='delta'?field('warning','Alerta','color'):''}${id==='delta'||id==='status'?field('negative','Desfavorable','color'):''}</details>`;
 return html+btn('reset-appearance','Restablecer apariencia','reset','button quiet appearance-reset');
}
function editAppearance(input){
 const id=selectedElement,key=input.dataset.appearance,p=appearance(c,id),data=sampleData(c);let value=input.value;
 if(input.dataset.hex!==undefined){value=value.startsWith('#')?value:'#'+value;if(!/^#[0-9a-f]{6}$/i.test(value)){input.setAttribute('aria-invalid','true');return;}input.setAttribute('aria-invalid','false');}
 if(input.type==='range')value=Number(value);
 const patch={[key]:value};
 if(key==='colorMode'&&value==='custom'&&p.colorMode!=='custom')patch.color=elementColor(c,id,data);
 if(key==='backgroundMode'&&value==='custom'&&p.backgroundMode!=='custom')patch.backgroundColor=(p.backgroundMode==='none'?(id==='progress'?c.muted:elementColor(c,id,data)):elementBackground(c,id,data).slice(0,7));
 if(key==='fillMode'&&value==='custom'&&p.fillMode!=='custom')patch.fillColor=trendFill(c);
 const now=Date.now();if(now-lastEdit>700||input.tagName==='SELECT')record();lastEdit=now;
 c=sanitizeConfig(updateElement(c,id,patch));persist();refreshCard();updateHistoryButtons();
 if(input.type==='range')input.nextElementSibling.textContent=value+'%';
 for(const other of app.querySelectorAll(`[data-appearance="${key}"]`))if(other!==input){other.value=String(value);other.setAttribute('aria-invalid','false');}
}
function flashGuides(){guidePreviewUntil=Date.now()+850;clearTimeout(guideTimer);guideTimer=setTimeout(()=>{guidePreviewUntil=0;renderGuides();},900);}
function renderGuides(){
 const overlay=$('#smart-guides'),fit=$('#card-fit'),main=$('#main-card');if(!overlay||!fit||!main)return;
 const selected=selectedElement?app.querySelector(`[data-element="${selectedElement}"]`):null;
 if(!guidesEnabled||!selected||!elementVisible(c,selectedElement)){overlay.innerHTML='';return;}
 const parent=fit.getBoundingClientRect(),surface=(main.firstElementChild||main).getBoundingClientRect(),scale=surface.width/c.width;
 if(!scale)return;
 const rect=node=>{
  const r=node.getBoundingClientRect();
  const id=node.dataset.element;
  const def=resolveElementDef(id)||ELEMENTS[id];
  return {
   id,
   label:def?.label||id,
   left:(r.left-surface.left)/scale,
   top:(r.top-surface.top)/scale,
   width:r.width/scale,
   height:r.height/scale
  };
 };
 const box=rect(selected),card={width:surface.width/scale,height:surface.height/scale};
 const peers=[...main.querySelectorAll('[data-element]')].filter(node=>node!==selected&&elementVisible(c,node.dataset.element)).map(rect);
 const result=alignmentGuides(box,card,peers,c.padding+c.borderWidth,3/scale),active=!!gesture||Date.now()<guidePreviewUntil;
 if(!active&&!result.outside){overlay.innerHTML='';return;}
 const left=surface.left-parent.left,top=surface.top-parent.top,w=surface.width,h=surface.height,inset=(c.padding+c.borderWidth)*scale;

 const boundaryClasses=['guide-boundary'];
 if(result.outside)boundaryClasses.push('outside');
 if(result.edgeSnaps?.left)boundaryClasses.push('snap-left');
 if(result.edgeSnaps?.right)boundaryClasses.push('snap-right');
 if(result.edgeSnaps?.top)boundaryClasses.push('snap-top');
 if(result.edgeSnaps?.bottom)boundaryClasses.push('snap-bottom');

 let html=`<div class="${boundaryClasses.join(' ')}" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;border-radius:${c.radius*scale}px"></div>`;
 if(active){
  const safeClasses=['guide-safe-area'];
  if(result.marginSnaps?.left)safeClasses.push('snap-left');
  if(result.marginSnaps?.right)safeClasses.push('snap-right');
  if(result.marginSnaps?.top)safeClasses.push('snap-top');
  if(result.marginSnaps?.bottom)safeClasses.push('snap-bottom');
  if(result.marginBreach?.left)safeClasses.push('breach-left');
  if(result.marginBreach?.right)safeClasses.push('breach-right');
  if(result.marginBreach?.top)safeClasses.push('breach-top');
  if(result.marginBreach?.bottom)safeClasses.push('breach-bottom');

  html+=`<div class="${safeClasses.join(' ')}" style="left:${left+inset}px;top:${top+inset}px;width:${Math.max(0,w-2*inset)}px;height:${Math.max(0,h-2*inset)}px"></div>`;
  // Mínimas líneas necesarias: máximo 1 línea en el eje X y 1 en el eje Y (el mejor ajuste / snap exacto)
  const snapX=result.edgeSnaps?.left||result.edgeSnaps?.right||result.marginSnaps?.left||result.marginSnaps?.right;
  const snapY=result.edgeSnaps?.top||result.edgeSnaps?.bottom||result.marginSnaps?.top||result.marginSnaps?.bottom;
  const candidateX=result.lines.filter(l=>l.axis==='x'&&(!snapX||l.kind==='peer'||l.kind==='center'));
  const candidateY=result.lines.filter(l=>l.axis==='y'&&(!snapY||l.kind==='peer'||l.kind==='center'));
  const bestX=candidateX.sort((a,b)=>(b.exact?1:0)-(a.exact?1:0))[0];
  const bestY=candidateY.sort((a,b)=>(b.exact?1:0)-(a.exact?1:0))[0];
  const minimalLines=[bestX,bestY].filter(Boolean);

  html+=minimalLines.map(line=>`<span class="smart-guide ${line.axis==='x'?'vertical':'horizontal'} ${line.kind} ${line.exact?'exact':''}" style="left:${left+(line.axis==='x'?line.position*scale:-8)}px;top:${top+(line.axis==='y'?line.position*scale:-8)}px;${line.axis==='x'?'height:'+(h+16):'width:'+(w+16)}px">${line.exact?`<b>${line.label}</b>`:''}</span>`).join('');

  const collidingPeers=new Map();
  if(result.overlaps&&result.overlaps.length){
   for(const ov of result.overlaps){
    if(ov.peer&&!collidingPeers.has(ov.peer.id))collidingPeers.set(ov.peer.id,ov.peer);
    html+=`<div class="guide-overlap-zone" style="left:${left+ov.rect.left*scale}px;top:${top+ov.rect.top*scale}px;width:${ov.rect.width*scale}px;height:${ov.rect.height*scale}px"></div>`;
   }
  }
  for(const peer of collidingPeers.values()){
   html+=`<div class="guide-peer-box collision" style="left:${left+peer.left*scale}px;top:${top+peer.top*scale}px;width:${peer.width*scale}px;height:${peer.height*scale}px" title="Colisión con ${peer.label}"></div>`;
  }
  const alignedPeers=new Map();
  for(const line of minimalLines){
   if(line.kind==='peer'&&line.peer&&!collidingPeers.has(line.peer.id)&&!alignedPeers.has(line.peer.id)){
    alignedPeers.set(line.peer.id,line.peer);
   }
  }
  for(const peer of alignedPeers.values()){
   html+=`<div class="guide-peer-box align" style="left:${left+peer.left*scale}px;top:${top+peer.top*scale}px;width:${peer.width*scale}px;height:${peer.height*scale}px" title="Alineado con ${peer.label}"></div>`;
  }
 }

 const sides={left:'izquierda',right:'derecha',top:'arriba',bottom:'abajo'};
 const outside=Object.entries(result.overflow).filter(([,v])=>v).map(([side,n])=>`${n} px ${sides[side]}`).join(' · ');
 const breaches=result.marginBreach?Object.entries(result.marginBreach).filter(([k,v])=>k!=='active'&&v>0).map(([side,n])=>`${n} px ${sides[side]}`).join(' · '):'';
 const snapSides=result.marginSnaps?Object.entries(result.marginSnaps).filter(([k,v])=>k!=='exact'&&v).map(([side])=>sides[side]).join(', '):'';
 const edgeSnapSides=result.edgeSnaps?Object.entries(result.edgeSnaps).filter(([k,v])=>k!=='exact'&&v).map(([side])=>sides[side]).join(', '):'';

 let readoutText='',readoutClass='';
 if(result.outside){
  readoutText='⛔ Fuera del borde: '+outside;readoutClass='outside';
 }else if(active&&result.overlaps&&result.overlaps.length){
  const peerNames=result.overlaps.map(o=>o.peer.label).filter(Boolean);
  readoutText='⚠️ Solapamiento con '+(peerNames.join(', ')||'otro elemento');readoutClass='overlap';
 }else if(edgeSnapSides){
  readoutText=`🎯 Borde exacto: ${edgeSnapSides} (0 px)`;readoutClass='snap';
 }else if(snapSides){
  readoutText=`🎯 Margen exacto: ${snapSides} (0 px)`;readoutClass='snap';
 }else if(breaches){
  readoutText=`⚠️ En margen: ${breaches}`;readoutClass='breach';
 }else{
  readoutText=`${Math.round(box.width)} × ${Math.round(box.height)} px · Guías de alineación`;
 }

 const roLeft=Math.max(8,Math.min(w-180,left+4));
 const roTop=Math.max(8,Math.min(h-26,top+h-28));
 html+=`<span class="guide-readout ${readoutClass}" style="left:${roLeft}px;top:${roTop}px">${readoutText}</span>`;
 overlay.innerHTML=html;
}
function elementInspector(){
 const id=selectedElement,def=resolveElementDef(id)||ELEMENTS[id],p=elementState(c,id),limits=SIZE_LIMITS[def.kind];
 const geom=(key,label,value,min,max)=>`<div class="field"><label for="el-${key}">${label}</label><input id="el-${key}" type="number" data-elprop="${key}" value="${value}" min="${min}" max="${max}" step="${moveStep}"></div>`;
 let specific='';
 if(def.isDuplicate){
  if(def.baseId==='value'){
   const curFmt=p.format||c.format;
   const curCurr=p.currency||c.currency;
   const curUnit=p.unit||c.unit;
   const curDec=p.decimals??c.decimals;
   const curMeas=p.measure!==undefined?p.measure:c.measure;
   const curSuf=p.suffix!==undefined?p.suffix:c.suffix;
   specific=`<div class="field"><label for="f-dup-measure">Medida del valor</label><input id="f-dup-measure" data-dupval="measure" value="${esc(curMeas)}" placeholder="[Nombre de medida]" list="dl-pbip-measures"></div>`+
    `<div class="field"><label for="f-dup-format">Formato del valor</label><select id="f-dup-format" data-dupval="format">${formats.map(([k,l])=>`<option value="${k}" ${curFmt===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    (curFmt==='currency'?`<div class="field"><label for="f-dup-currency">Moneda</label><select id="f-dup-currency" data-dupval="currency">${[['EUR','Euro · €'],['USD','Dólar · $'],['GBP','Libra · £']].map(([k,l])=>`<option value="${k}" ${curCurr===k?'selected':''}>${l}</option>`).join('')}</select></div>`:'')+
    `<div class="field-row"><div class="field"><label for="f-dup-unit">Escala</label><select id="f-dup-unit" data-dupval="unit">${[['auto','Automática'],['none','Sin escalar'],['k','Miles'],['m','Millones']].map(([k,l])=>`<option value="${k}" ${curUnit===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-decimals">Decimales</label><select id="f-dup-decimals" data-dupval="decimals">${[[0,'0'],[1,'1'],[2,'2'],[3,'3']].map(([k,l])=>`<option value="${k}" ${curDec===k?'selected':''}>${l}</option>`).join('')}</select></div></div>`+
    `<div class="field"><label for="f-dup-suffix">Sufijo del valor</label><input id="f-dup-suffix" data-dupval="suffix" value="${esc(curSuf)}" placeholder="ej. € o %"></div>`;
  }else if(def.baseId==='icon'){
   specific=iconPickerField();
  }else if(def.baseId==='delta'){
   const curComp=p.comparison||c.comparison;
   const curDir=p.direction||c.direction;
   const curMode=p.deltaMode||c.deltaMode;
   const curCmpMeas=p.compareMeasure!==undefined?p.compareMeasure:c.compareMeasure;
   specific=`<div class="field"><label for="f-dup-cmpmode">Comparar con</label><select id="f-dup-cmpmode" data-dupval="comparison">${comparisons.map(([k,l])=>`<option value="${k}" ${curComp===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-dir">¿Qué significa mejorar?</label><select id="f-dup-dir" data-dupval="direction">${[['up','Cuanto más, mejor ↑'],['down','Cuanto menos, mejor ↓'],['neutral','Sin valoración favorable']].map(([k,l])=>`<option value="${k}" ${curDir===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-deltamode">Mostrar diferencia</label><select id="f-dup-deltamode" data-dupval="deltaMode">${[['relative','Porcentaje'],['absolute','Diferencia absoluta'],['pp','Puntos porcentuales']].map(([k,l])=>`<option value="${k}" ${curMode===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-compare">Medida de comparación</label><input id="f-dup-compare" data-dupval="compareMeasure" value="${esc(curCmpMeas)}" placeholder="[Medida de referencia]" list="dl-pbip-measures"></div>`;
  }else if(def.baseId==='compareLabel'){
   const curComp=p.comparison||c.comparison;
   const curTxt=p.text!==undefined?p.text:'';
   specific=`<div class="field"><label for="f-dup-clcmp">Comparar con</label><select id="f-dup-clcmp" data-dupval="comparison">${comparisons.map(([k,l])=>`<option value="${k}" ${curComp===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-duptext">Texto personalizado</label><input id="f-duptext" data-duptext="${id}" value="${esc(curTxt)}" placeholder="ej. vs. período anterior"></div>`;
  }else if(def.baseId==='status'){
   const curGood=p.statusGood!==undefined?p.statusGood:(c.statusGood||'Favorable');
   const curWarn=p.statusWarn!==undefined?p.statusWarn:(c.statusWarn||'En alerta');
   const curBad=p.statusBad!==undefined?p.statusBad:(c.statusBad||'Desfavorable');
   const curGTh=p.goodThreshold!==undefined?p.goodThreshold:c.goodThreshold;
   const curWTh=p.warnThreshold!==undefined?p.warnThreshold:c.warnThreshold;
   specific=`<div class="field-row"><div class="field"><label for="f-dup-gth">Umbral favorable</label><input id="f-dup-gth" type="number" data-dupval="goodThreshold" value="${curGTh}"></div>`+
    `<div class="field"><label for="f-dup-wth">Umbral alerta</label><input id="f-dup-wth" type="number" data-dupval="warnThreshold" value="${curWTh}"></div></div>`+
    `<div class="field"><label for="f-dup-sg">Texto favorable</label><input id="f-dup-sg" data-dupval="statusGood" value="${esc(curGood)}"></div>`+
    `<div class="field"><label for="f-dup-sw">Texto alerta</label><input id="f-dup-sw" data-dupval="statusWarn" value="${esc(curWarn)}"></div>`+
    `<div class="field"><label for="f-dup-sb">Texto desfavorable</label><input id="f-dup-sb" data-dupval="statusBad" value="${esc(curBad)}"></div>`;
  }else if(['referenceLabel','referenceValue'].includes(def.baseId)){
   const curComp=p.comparison||c.comparison;
   const curCmpMeas=p.compareMeasure!==undefined?p.compareMeasure:c.compareMeasure;
   specific=`<div class="field"><label for="f-dup-rcmp">Comparar con</label><select id="f-dup-rcmp" data-dupval="comparison">${comparisons.map(([k,l])=>`<option value="${k}" ${curComp===k?'selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div class="field"><label for="f-dup-rcm">Medida de referencia</label><input id="f-dup-rcm" data-dupval="compareMeasure" value="${esc(curCmpMeas)}" placeholder="[Medida de referencia]" list="dl-pbip-measures"></div>`;
  }else if(['goalLabel','progressLabel','progress'].includes(def.baseId)){
   specific=`<div class="field"><label for="f-dup-target">Medida u objetivo</label><input id="f-dup-target" data-dupval="targetMeasure" value="${esc(p.targetMeasure!==undefined?p.targetMeasure:c.targetMeasure)}" placeholder="ej. [Objetivo] o 100" list="dl-pbip-measures"></div>`;
  }else{
   const currentVal=p.text!==undefined?p.text:(def.contentKey?c[def.contentKey]:def.label);
   specific=`<div class="field"><label for="f-duptext">Texto</label><input id="f-duptext" data-duptext="${id}" value="${esc(currentVal)}" placeholder="Texto del elemento…"></div>`;
  }
 }else{
  specific=def.contentKey?field(def.contentKey,def.label):'';
  if(id==='icon')specific=iconPickerField();
  if(id==='value'){
   specific=`<div class="field"><label for="f-val-measure">Medida del valor</label><input id="f-val-measure" data-key="measure" value="${esc(c.measure||'')}" placeholder="[Nombre de medida]" list="dl-pbip-measures"></div>`+
    select('format','Formato del valor',formats)+
    (c.format==='currency'?select('currency','Moneda',[['EUR','Euro · €'],['USD','Dólar · $'],['GBP','Libra · £']]):'')+
    `<div class="field-row">${select('unit','Escala',[['auto','Automática'],['none','Sin escalar'],['k','Miles'],['m','Millones']])}${select('decimals','Decimales',[[0,'0'],[1,'1'],[2,'2'],[3,'3']])}</div>`+
    field('suffix','Sufijo del valor');
  }
  if(['delta','compareLabel','referenceLabel','referenceValue'].includes(id))specific=select('comparison','Comparar con',comparisons)+(id==='delta'?select('deltaMode','Mostrar diferencia',[['relative','Porcentaje'],['absolute','Diferencia absoluta'],['pp','Puntos porcentuales']]):'');
  if(id==='trend')specific=chartPanel();
  if(['goalLabel','progress','progressLabel'].includes(id))specific=field('targetMeasure','Medida objetivo');
  if(id==='status')specific=field('statusGood','Texto favorable')+field('statusWarn','Texto de alerta')+field('statusBad','Texto desfavorable')+`<div class="field-row">${field('goodThreshold','Umbral favorable','number')}${field('warnThreshold','Umbral alerta','number')}</div>`;
  if(id==='period')specific='<p class="field-help">El período se calcula a partir de las fechas seleccionadas en el informe.</p>';
 }
 const hidden=p.hidden||!elementEnabled(c,id);
 const sizeRange=def.isDuplicate
  ?`<div class="field"><label for="f-dupsize">${def.kind==='text'?'Tamaño de texto':def.kind==='icon'?'Tamaño de icono':'Altura'}</label><div class="range-wrap"><input id="f-dupsize" data-dupsize="${id}" type="range" min="${limits[0]}" max="${limits[1]}" value="${elementSize(c,id)}"><output for="f-dupsize">${elementSize(c,id)}px</output></div></div>`
  :range(def.sizeKey,def.kind==='text'?'Tamaño de texto':def.kind==='icon'?'Tamaño de icono':'Altura',...limits);
 return `<div class="selected-object-heading"><span>${icon(def.kind==='icon'?(p.icon||c.icon):def.kind==='chart'?'trend':def.kind==='bar'?'signal':'text',20)}</span><div><strong>${def.label}</strong><small>${p.deleted?'Elemento eliminado':hidden?'Elemento oculto':'Seleccionado en el lienzo'}</small></div>${ib('deselect','Deseleccionar','close')}</div>`+
 section('01','Apariencia',elementAppearancePanel(id))+
 section('02','Contenido del elemento',specific)+
 section('03','Posición y tamaño',`<div class="field-row">${geom('x','Desplazamiento X · px',p.x,-1000,1000)}${geom('y','Desplazamiento Y · px',p.y,-1000,1000)}</div><p class="geometry-note">Posición independiente: el tamaño no mueve otros elementos ni la tarjeta. Flechas: ${moveStep} px · Mayús: ${moveStep===1?5:1} px.</p>`+sizeRange+geom('width','Ancho del elemento · px',p.width,0,800)+`<p class="geometry-note">Ancho 0 = ${p.frame?(def.kind==='icon'?'tamaño del icono':'ancho al desplazarlo'):'automático'}. Asa lateral: ancho; esquina: tamaño.</p>`+(p.frame?btn('release-element','Volver a posición de plantilla','restore','button quiet appearance-reset')+`<p class="geometry-note">Recupera su posición y ancho de plantilla sin cambiar los demás elementos.</p>`:''))+
 section('04','Visibilidad',`<div class="element-action-row">${btn(p.deleted?'restore-element':'hide-element',p.deleted?'Restaurar':hidden?'Mostrar':'Ocultar',p.deleted?'restore':hidden?'eye':'eyeOff','button secondary')}${!p.deleted?btn('delete-element','Eliminar','trash','button quiet'):''}</div><p class="field-help">Ocultar conserva el espacio. Eliminar retira el elemento. Puedes recuperarlo con Deshacer.</p>${btn('reset-element','Restablecer este elemento','reset','button quiet')}`);
}
function selectElement(id,focus=true,toggle=false){
 if(!ELEMENTS[id])return;
 cardSelected=false;
 rememberInspector();
 if(toggle){
  if(selectedElements.has(id)){
   selectedElements.delete(id);
   if(selectedElements.size===0){deselect();return;}
   selectedElement=[...selectedElements][selectedElements.size-1];
  }else{
   selectedElements.add(id);
   selectedElement=id;
  }
 }else{
  selectedElements=new Set([id]);
  selectedElement=id;
 }
 if(selectedElement!==id)inspectorSections.set('element:Apariencia',true);
 tab='element';
 inspectorPositions.set('element',0);
 renderInspector();
 renderCanvasBar();
 positionSelection();
 renderGuides();
 if(focus)app.querySelector(`[data-element="${id}"]`)?.focus({preventScroll:true});
}
function renderCanvasBar(){
 const bar=$('#canvas-edit-bar');if(!bar)return;
 if(context){
  bar.innerHTML=`<div class="canvas-object-label">${icon('grid',13)}<span>Lienzo del informe</span></div><div class="canvas-context-center"><div class="segmented small context-res-selector" aria-label="Resolución del informe"><button data-action="context-res" data-res="1280x720" class="${contextResolution==='1280x720'?'active':''}" title="Lienzo Estándar 1280 × 720 px">1280 × 720</button><button data-action="context-res" data-res="1920x1080" class="${contextResolution==='1920x1080'?'active':''}" title="Lienzo Full HD 1920 × 1080 px">1920 × 1080</button></div></div>`;
  return;
 }
 const layerScroll=bar.querySelector('.layers-popover')?.scrollTop||0;
 const isMulti=selectedElements.size>1;
 const def=selectedElement?(resolveElementDef(selectedElement)||ELEMENTS[selectedElement]):null;
 const labelText=isMulti?`Selección múltiple (${selectedElements.size})`:def?def.label:cardSelected?'Tarjeta seleccionada':'Selecciona un elemento';
 const formatPainterBtn=selectedElement&&!isMulti?`<button class="icon-btn format-painter-btn ${formatPainterSource?'active':''}" data-action="format-painter" title="${formatPainterSource?'Copiar formato activo · Haz clic en otro elemento para aplicar (Esc para cancelar)':`Copiar formato de ${def?.label||selectedElement}`}" aria-pressed="${Boolean(formatPainterSource)}">${icon('brush',13)}</button>`:'';
 const elementActions=selectedElement?`${ib('smaller-element','Reducir tamaño','minus')}${ib('bigger-element','Aumentar tamaño','plus')}${ib('hide-element',elementState(c,selectedElement).hidden?'Mostrar elemento':'Ocultar elemento','eyeOff')}${ib('delete-element','Eliminar elemento','trash')}${formatPainterBtn}`:'';
 bar.innerHTML=`<div class="canvas-object-label">${icon(selectedElement?'cursor':'move',13)}<span>${labelText}</span></div><div class="canvas-object-actions"><button class="card-select-btn ${cardSelected?'active':''}" data-action="select-card" aria-pressed="${cardSelected}" title="Seleccionar tarjeta y ajustar bordes / tamaño">${icon('card',14)}<span>Tarjeta</span></button>${elementActions}<div class="pixel-step" aria-label="Paso de movimiento"><button data-move-step="1" class="${moveStep===1?'active':''}" aria-pressed="${moveStep===1}" title="Mover de 1 en 1 píxel con las flechas">1 px</button><button data-move-step="5" class="${moveStep===5?'active':''}" aria-pressed="${moveStep===5}" title="Mover de 5 en 5 píxeles con las flechas">5 px</button></div>${ib('guides',guidesEnabled?'Ocultar guías de alineación (regla)':'Mostrar guías de alineación (regla)','ruler',`aria-pressed="${guidesEnabled}" title="${guidesEnabled?'Ocultar guías de alineación (regla)':'Mostrar guías de alineación (regla)'}"`)}<button class="layers-button ${layersOpen?'active':''}" data-action="layers" aria-expanded="${layersOpen}" title="Ver y reordenar capas">${icon('layers',14)}<span>Capas</span></button></div>${layersOpen?layersPanel():''}`;
 const popup=bar.querySelector('.layers-popover');if(popup)popup.scrollTop=layerScroll;
}
function layersPanel(){
 const ids=layerOrder(c).filter(id=>elementAvailable(c,id)&&!elementState(c,id).deleted);
 return `<div class="layers-popover" role="region" aria-label="Capas de la tarjeta"><div class="layers-heading"><strong>Elementos de la tarjeta</strong>${ib('layers','Cerrar capas','close')}</div><p class="layers-hint">Arriba = delante <span>Arrastra o usa ↑ ↓</span></p>${ids.map((id,index)=>{
  const state=elementState(c,id),visible=elementVisible(c,id),def=resolveElementDef(id)||ELEMENTS[id],label=def?.label||id;
  const isConfirming=deleteConfirmLayer===id;
  const isSelected=selectedElements.has(id);
  const deleteBtn=`<button class="layer-delete ${isConfirming?'confirming':''}" data-layer-delete="${id}" title="${isConfirming?'Clic para confirmar eliminación':'Eliminar capa'}" aria-label="Eliminar ${label}">${isConfirming?'¿Borrar?':icon('trash',13)}</button>`;
  return `<div class="layer-row ${isSelected?'active':''}" data-layer-row="${id}"><button class="layer-drag" draggable="true" data-layer-drag="${id}" aria-label="Arrastrar capa ${label}" title="Arrastrar · Alt + ↑/↓ para ordenar">${icon('grip',13)}</button><button class="layer-select" data-select-element="${id}" aria-pressed="${isSelected}">${icon(def?.kind==='text'?'text':id==='icon'||def?.kind==='icon'?(state.icon||c.icon):id==='trend'||def?.kind==='chart'?'trend':'signal',14)}<span>${label}<small>${visible?'Visible':'Oculto'}${state.frame?' · Posición libre':''}</small></span></button><div class="layer-controls"><button class="layer-order-button" data-layer-id="${id}" data-layer-move="-1" ${index===0?'disabled':''} title="Subir: traer delante" aria-label="Subir capa ${label}">${icon('arrowUp',13)}</button><button class="layer-order-button" data-layer-id="${id}" data-layer-move="1" ${index===ids.length-1?'disabled':''} title="Bajar: enviar detrás" aria-label="Bajar capa ${label}">${icon('arrowDown',13)}</button><button class="layer-visibility" data-layer-visibility="${id}" title="${visible?'Ocultar':'Mostrar'}" aria-label="${visible?'Ocultar':'Mostrar'} ${label}">${icon(visible?'eye':'eyeOff',15)}</button>${deleteBtn}</div></div>`;
 }).join('')}<p class="layers-footnote">El orden cambia la superposición, conserva las posiciones.</p></div>`;
}
function commitLayerOrder(next,id,direction=null){
 if(next===c)return;
 directChange(next);
 const row=app.querySelector(`[data-layer-row="${id}"]`);
 const button=direction?row?.querySelector(`[data-layer-move="${direction}"]:not(:disabled)`):null;
 (button||row?.querySelector('.layer-drag'))?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest'});
 toast(`${ELEMENTS[id].label}: capa ${layerOrder(c).filter(key=>elementAvailable(c,key)).indexOf(id)+1}, de delante hacia atrás.`);
}
function clearLayerDrop(){app.querySelectorAll('.drop-before,.drop-after,.layer-dragging').forEach(node=>node.classList.remove('drop-before','drop-after','layer-dragging'));}
app.addEventListener('dragstart',e=>{
 const handle=e.target.closest('[data-layer-drag]');if(!handle)return;
 draggedLayer=handle.dataset.layerDrag;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedLayer);
 const row=handle.closest('[data-layer-row]');e.dataTransfer.setDragImage(row,15,15);row.classList.add('layer-dragging');
});
app.addEventListener('dragover',e=>{
 const popup=e.target.closest('.layers-popover');if(!draggedLayer||!popup)return;
 e.preventDefault();e.dataTransfer.dropEffect='move';
 app.querySelectorAll('.drop-before,.drop-after').forEach(node=>node.classList.remove('drop-before','drop-after'));
 const bounds=popup.getBoundingClientRect();if(e.clientY<bounds.top+35)popup.scrollTop-=8;else if(e.clientY>bounds.bottom-35)popup.scrollTop+=8;
 const row=e.target.closest('[data-layer-row]');if(!row||row.dataset.layerRow===draggedLayer)return;
 const r=row.getBoundingClientRect();row.classList.add(e.clientY<r.top+r.height/2?'drop-before':'drop-after');
});
app.addEventListener('drop',e=>{
 if(!draggedLayer||!e.target.closest('.layers-popover'))return;e.preventDefault();
 const id=draggedLayer,row=e.target.closest('[data-layer-row]');draggedLayer=null;clearLayerDrop();
 if(row){const r=row.getBoundingClientRect();commitLayerOrder(reorderLayer(c,id,row.dataset.layerRow,e.clientY<r.top+r.height/2?'before':'after'),id);}
});
app.addEventListener('dragend',()=>{draggedLayer=null;clearLayerDrop();});
app.addEventListener('keydown',e=>{
 const row=e.target.closest('[data-layer-row]');if(!row||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;
 e.preventDefault();e.stopPropagation();const direction=e.key==='ArrowUp'?-1:1;commitLayerOrder(moveLayer(c,row.dataset.layerRow,direction),row.dataset.layerRow,String(direction));
});
function positionSelection(){
 const overlay=$('#selection-overlay'),fit=$('#card-fit');if(!overlay||!fit)return;const focusedHandle=document.activeElement?.dataset?.cardResize;
 app.querySelectorAll('[data-element]').forEach(e=>{
  const isSel=selectedElements.has(e.dataset.element);
  e.classList.toggle('is-selected',isSel);
  e.classList.toggle('is-multi-selected',isSel&&selectedElements.size>1);
  e.setAttribute('aria-pressed',isSel?'true':'false');
 });
 if(selectedElements.size>1){
  const nodes=[...selectedElements].map(id=>app.querySelector(`[data-element="${id}"]`)).filter(Boolean);
  if(!nodes.length){overlay.hidden=true;return;}
  const rects=nodes.map(n=>n.getBoundingClientRect());
  const minL=Math.min(...rects.map(r=>r.left)),minT=Math.min(...rects.map(r=>r.top));
  const maxR=Math.max(...rects.map(r=>r.right)),maxB=Math.max(...rects.map(r=>r.bottom));
  const parent=fit.getBoundingClientRect();
  overlay.hidden=false;
  overlay.style.cssText=`left:${minL-parent.left}px;top:${minT-parent.top}px;width:${maxR-minL}px;height:${maxB-minT}px;`;
  overlay.innerHTML=`<span class="selection-name group-selection-badge">${selectedElements.size} elementos seleccionados</span>`;
  return;
 }
 const el=cardSelected?$('#main-card')?.firstElementChild:selectedElement?app.querySelector(`[data-element="${selectedElement}"]`):null;
 if(!el||(!cardSelected&&!elementVisible(c,selectedElement))){overlay.hidden=true;return;}
 const box=el.getBoundingClientRect(),parent=fit.getBoundingClientRect();
 overlay.hidden=false;overlay.style.cssText=`left:${box.left-parent.left}px;top:${box.top-parent.top}px;width:${box.width}px;height:${box.height}px;`;
 if(cardSelected){overlay.innerHTML=`<span class="selection-name">Tarjeta · ${c.width} × ${c.height} px</span>${['e','s','se'].map(dir=>`<button data-card-resize="${dir}" class="resize-handle handle-${dir}" aria-label="Cambiar ${dir==='e'?'ancho':dir==='s'?'alto':'tamaño'} de tarjeta" title="Arrastra · mínimo 200 px"></button>`).join('')}`;if(focusedHandle)overlay.querySelector(`[data-card-resize="${focusedHandle}"]`)?.focus({preventScroll:true});return;}
 overlay.innerHTML=`<span class="selection-name">${(resolveElementDef(selectedElement)?.label||ELEMENTS[selectedElement]?.label||selectedElement)}</span><button data-resize="nw" aria-label="Cambiar tamaño del elemento (superior izquierda)" class="resize-handle handle-nw" title="Arrastra para cambiar el tamaño"></button><button data-resize="se" aria-label="Cambiar tamaño del elemento (inferior derecha)" class="resize-handle handle-se" title="Arrastra para cambiar el tamaño"></button>`;
}
function refreshCard(){showDirty();const inner=$('#main-card');if(inner){inner.innerHTML=cardHTML(c,undefined,true);fitMain();}else renderStage();renderStatus();}
function syncElementControls(){
 const id=selectedElement;if(!id)return;const p=elementState(c,id),def=resolveElementDef(id)||ELEMENTS[id],key=def?.sizeKey;
 app.querySelectorAll('[data-elprop]').forEach(input=>{if(document.activeElement!==input)input.value=p[input.dataset.elprop];});
 if(key){app.querySelectorAll(`[data-key="${key}"]`).forEach(input=>{if(document.activeElement!==input)input.value=c[key];const output=input.parentElement.querySelector('output');if(output)output.textContent=c[key]+'px';});}
 app.querySelectorAll(`[data-dupsize="${id}"]`).forEach(input=>{if(document.activeElement!==input)input.value=elementSize(c,id);const output=input.parentElement.querySelector('output');if(output)output.textContent=elementSize(c,id)+'px';});
}
function directChange(next,saveHistory=true){if(saveHistory)record();c=sanitizeConfig(next);persist();refreshCard();renderInspector();renderCanvasBar();updateHistoryButtons();}
function elementAction(action){
 const id=selectedElement;if(!id&&!selectedElements.size)return;let next=c;
 if(action==='hide-element'){
  if(selectedElements.size>1){
   next=c;
   for(const selId of selectedElements){
    const p=elementState(next,selId);
    next=p.hidden||p.deleted||!elementEnabled(next,selId)?restoreElement(next,selId):updateElement(next,selId,{hidden:true});
   }
   directChange(next);
   return;
  }
  const p=elementState(c,id);next=p.hidden||p.deleted||!elementEnabled(c,id)?restoreElement(c,id):updateElement(c,id,{hidden:true});
 }
 if(action==='delete-element'){
  if(selectedElements.size>1){
   const count=selectedElements.size;
   next=c;
   for(const selId of selectedElements){
    next=updateElement(next,selId,{deleted:true,hidden:false});
   }
   toast(`${count} elementos eliminados. Recupéralos con Deshacer (Ctrl+Z).`);
   selectedElements.clear();
   selectedElement=null;
   directChange(next);
   return;
  }
  next=updateElement(c,id,{deleted:true,hidden:false});toast('Elemento eliminado. Recupéralo con Deshacer (Ctrl+Z).');
 }
 if(action==='restore-element')next=restoreElement(c,id);
 if(action==='release-element')next=releaseElement(c,id);
 if(action==='smaller-element'||action==='bigger-element')next=resizeElement(c,id,action==='bigger-element'?1:-1);
 if(action==='reset-element'){const template=TEMPLATES.find(t=>t.id===c.id)?.config||BASE;next=restoreElement({...c,elements:{...c.elements,[id]:{...template.elements?.[id],x:0,y:0,width:0}}},id);next[ELEMENTS[id].sizeKey]=elementSize(template,id);}
 directChange(next);app.querySelector(`[data-element="${id}"]`)?.focus({preventScroll:true});
}
function deselect(){rememberInspector();cardSelected=false;selectedElement=null;selectedElements.clear();formatPainterSource=null;deleteConfirmLayer=null;if(deleteConfirmTimer)clearTimeout(deleteConfirmTimer);if(['element','card'].includes(tab))tab='content';renderInspector();renderCanvasBar();positionSelection();renderGuides();}
app.addEventListener('pointerdown',e=>{
 if(context||e.button!==0)return;const cardHandle=e.target.closest('[data-card-resize]');if(cardHandle){startCardGesture(e,cardHandle.dataset.cardResize);return;}const handle=e.target.closest('[data-resize]'),el=e.target.closest('[data-element]');
 if(!handle&&!el)return;
 if(formatPainterSource&&el){
  e.preventDefault();
  applyFormatPainter(el.dataset.element);
  return;
 }
 const isCtrl=e.ctrlKey||e.metaKey;
 if(el){
  if(isCtrl){
   selectElement(el.dataset.element,false,true);
   return;
  }
  if(!selectedElements.has(el.dataset.element)){
   selectElement(el.dataset.element);
  }
 }
 if(!selectedElement||!elementVisible(c,selectedElement))return;
 const scale=$('#main-card').getBoundingClientRect().width/c.width;
 if(!handle&&selectedElements.size>1){
  const members=[...selectedElements];
  const items=members.map(mId=>{
   const node=app.querySelector(`[data-element="${mId}"]`);
   const frame=c.elements?.[mId]?.frame||measureElementFrame(mId);
   const p=elementState(c,mId);
   const bBox=node?node.getBoundingClientRect():null;
   const w=bBox?bBox.width/scale:(p.width||frame?.width||100);
   const h=bBox?bBox.height/scale:(frame?.height||24);
   const left=(frame?.left||0)+p.x;
   const top=(frame?.top||0)+p.y;
   return {id:mId,frame,p,w,h,left,top};
  });
  const minDx=Math.max(...items.map(it=>-it.left));
  const maxDx=Math.min(...items.map(it=>c.width-(it.left+it.w)));
  const minDy=Math.max(...items.map(it=>-it.top));
  const maxDy=Math.min(...items.map(it=>c.height-(it.top+it.h)));
  gesture={kind:'group-move',id:selectedElement,items,minDx,maxDx,minDy,maxDy,startX:e.clientX,startY:e.clientY,start:structuredClone(c),scale,changed:false,pointer:e.pointerId,undoSnapshot:[...undo],redo:[...redo]};
  app.setPointerCapture(e.pointerId);renderGuides();e.preventDefault();
  return;
 }
 const node=app.querySelector(`[data-element="${selectedElement}"]`);
 gesture={id:selectedElement,kind:handle?.dataset.resize||'move',startX:e.clientX,startY:e.clientY,start:structuredClone(c),scale,width:node.getBoundingClientRect().width/scale,frame:measureElementFrame(selectedElement),changed:false,pointer:e.pointerId,undoSnapshot:[...undo],redo:[...redo]};
 app.setPointerCapture(e.pointerId);renderGuides();e.preventDefault();
});
app.addEventListener('pointermove',e=>{
 if(!gesture||e.pointerId!==gesture.pointer)return;const g=gesture;
 if(!g.changed&&Math.hypot(e.clientX-g.startX,e.clientY-g.startY)<3)return;
 if(!g.changed){record();g.changed=true;app.classList.add('is-dragging');}
 const dx=(e.clientX-g.startX)/g.scale,dy=(e.clientY-g.startY)/g.scale,step=e.shiftKey?(moveStep===1?5:1):moveStep;
 let next=g.start;
 if(g.card)next=resizeCard(g.start,g.start.width+(g.kind==='s'?0:Math.round(dx/step)*step),g.start.height+(g.kind==='e'?0:Math.round(dy/step)*step),true);
 else if(g.kind==='group-move'){
  const rawDx=(e.clientX-g.startX)/g.scale,rawDy=(e.clientY-g.startY)/g.scale;
  const snappedDx=Math.round(rawDx/step)*step,snappedDy=Math.round(rawDy/step)*step;
  const clampedDx=Math.max(g.minDx,Math.min(g.maxDx,snappedDx));
  const clampedDy=Math.max(g.minDy,Math.min(g.maxDy,snappedDy));
  next=g.start;
  for(const it of g.items){
   next=moveElement(next,it.id,clampedDx,clampedDy,step,it.frame);
  }
 }
 else if(g.kind==='move')next=moveElement(g.start,g.id,dx,dy,step,g.frame);
 else {
  let detachedConfig=detachElement(g.start,g.id,g.frame);
  const def=resolveElementDef(g.id)||ELEMENTS[g.id];
  const bounds=SIZE_LIMITS[def.kind];
  const p0=elementState(detachedConfig,g.id);
  const S0=elementSize(detachedConfig,g.id);
  const W0=Math.round(p0.width||g.width);
  const X0=p0.x;
  const Y0=p0.y;

  if(g.kind==='nw'){
   const clampDy=Math.min(0,dy);
   const snappedDx=Math.round(dx/step)*step;
   const snappedDy=Math.round(clampDy/step)*step;

   // Width & X: dragging left grows width leftward; right edge stays fixed
   const targetW=Math.max(16,Math.min(800,W0-snappedDx));
   const deltaW=targetW-W0;
   const nextX=X0-deltaW;

   // Size & Y: dragging up grows size upward; bottom edge stays fixed
   const targetS=clamp(S0-snappedDy,...bounds);
   const deltaS=targetS-S0;
   const nextY=Y0-deltaS;

   next=updateElement(detachedConfig,g.id,{x:nextX,y:nextY,width:targetW});
   if(def?.isDuplicate){
    next=updateElement(next,g.id,{size:targetS});
   }else{
    next={...next,[def.sizeKey]:targetS};
   }
  }else{
   const clampDy=Math.max(0,dy);
   const snappedDx=Math.round(dx/step)*step;
   const snappedDy=Math.round(clampDy/step)*step;

   const targetW=Math.max(16,Math.min(800,W0+snappedDx));
   const targetS=clamp(S0+snappedDy,...bounds);

   next=updateElement(detachedConfig,g.id,{width:targetW});
   if(def?.isDuplicate){
    next=updateElement(next,g.id,{size:targetS});
   }else{
    next={...next,[def.sizeKey]:targetS};
   }
  }
 }
 c=sanitizeConfig(next);
 refreshCard();
 if(g.card)syncCardControls();else syncElementControls();updateHistoryButtons();
});
function finishGesture(cancel=false){
 if(!gesture)return;const g=gesture;gesture=null;app.classList.remove('is-dragging');
 if(app.hasPointerCapture(g.pointer))app.releasePointerCapture(g.pointer);
 if(cancel&&g.changed){c=g.start;undo=g.undoSnapshot;redo=g.redo;refreshCard();}
 if(g.changed){persist();renderInspector();updateHistoryButtons();ignoreCanvasClick=true;setTimeout(()=>ignoreCanvasClick=false,0);}
 if(g.card){fitMain();$('#main-card')?.focus({preventScroll:true});}
 else if(g.kind==='group-move'){positionSelection();renderGuides();}
 else if(g.id){app.querySelector(`[data-element="${g.id}"]`)?.focus({preventScroll:true});}
 positionSelection();
 renderGuides();
}
app.addEventListener('pointerup',()=>finishGesture());app.addEventListener('pointercancel',()=>finishGesture(true));
app.addEventListener('click',e=>{if(ignoreCanvasClick||formatPainterSource)return;const isCtrl=e.ctrlKey||e.metaKey;const el=e.target.closest('[data-element]');if(el){if(isCtrl)return;if(selectedElement!==el.dataset.element||selectedElements.size>1)selectElement(el.dataset.element);return;}if(e.target.closest('[data-card-surface]')){selectCard();return;}if(e.target.closest('#stage')&&!e.target.closest('#selection-overlay')&&(selectedElement||cardSelected))deselect();});
document.addEventListener('keydown',e=>{
 const target=e.target;
 const bindKey=target?.dataset?.bindKey;
 if(bindKey){
  const menu=document.getElementById(`dropdown-menu-${bindKey}`);
  const isOpen=menu&&menu.classList.contains('is-open');
  if(e.key==='ArrowDown'){
   e.preventDefault();
   if(!isOpen){
    if(menu&&pbipModel){
     closeAllBindingDropdowns();
     menu.innerHTML=renderBindingDropdown(bindKey,target.value);
     menu.classList.add('is-open');
     const toggle=document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${bindKey}"]`);
     if(toggle){toggle.setAttribute('aria-expanded','true');toggle.classList.add('is-open');}
    }
    return;
   }
   const items=Array.from(menu.querySelectorAll('.binding-dropdown-item'));
   if(!items.length)return;
   const curIdx=items.findIndex(it=>it.classList.contains('is-selected'));
   const nextIdx=curIdx<items.length-1?curIdx+1:0;
   items.forEach((it,idx)=>it.classList.toggle('is-selected',idx===nextIdx));
   items[nextIdx].scrollIntoView({block:'nearest'});
   return;
  }
  if(e.key==='ArrowUp'){
   if(!isOpen)return;
   e.preventDefault();
   const items=Array.from(menu.querySelectorAll('.binding-dropdown-item'));
   if(!items.length)return;
   const curIdx=items.findIndex(it=>it.classList.contains('is-selected'));
   const prevIdx=curIdx>0?curIdx-1:items.length-1;
   items.forEach((it,idx)=>it.classList.toggle('is-selected',idx===prevIdx));
   items[prevIdx].scrollIntoView({block:'nearest'});
   return;
  }
  if(e.key==='Enter'&&isOpen){
   const selectedItem=menu.querySelector('.binding-dropdown-item.is-selected')||menu.querySelector('.binding-dropdown-item');
   if(selectedItem){
    e.preventDefault();
    e.stopPropagation();
    const val=selectedItem.dataset.value;
    applyBindingFieldValue(bindKey,val);
    closeAllBindingDropdowns();
    target.focus();
    return;
   }
  }
  if(e.key==='Escape'&&isOpen){
   e.preventDefault();
   e.stopPropagation();
   closeAllBindingDropdowns();
   return;
  }
 }
 if(e.key==='Escape'){
  const openMenu=document.querySelector('.binding-dropdown-menu.is-open');
  if(openMenu){
   e.preventDefault();
   e.stopPropagation();
   closeAllBindingDropdowns();
   return;
  }
 }
 if(e.key==='Escape'&&gesture){e.preventDefault();finishGesture(true);return;}
 if(!$('#modal').open&&(e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-element]')){e.preventDefault();selectElement(e.target.dataset.element);return;}
 if(e.target.closest?.('.layers-popover'))return;
 if($('#modal').open||!selectedElement||context||view!=='designer'||!e.target.closest?.('#stage,#canvas-edit-bar'))return;
 if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
 if(e.key==='Escape'){if(formatPainterSource){e.preventDefault();formatPainterSource=null;renderCanvasBar();toast('Copiar formato cancelado.');return;}e.preventDefault();deselect();return;}
 if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();elementAction('delete-element');return;}
 if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-element]')){e.preventDefault();selectElement(e.target.dataset.element);return;}
 const step=e.shiftKey?(moveStep===1?5:1):moveStep;
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
  e.preventDefault();flashGuides();
  const reqDx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;
  const reqDy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
  if(selectedElements.size>1){
   const members=[...selectedElements];
   const items=members.map(mId=>{
    const frame=c.elements?.[mId]?.frame||measureElementFrame(mId);
    const p=elementState(c,mId);
    const w=p.width||frame?.width||100;
    const h=frame?.height||24;
    const left=(frame?.left||0)+p.x;
    const top=(frame?.top||0)+p.y;
    return {id:mId,frame,w,h,left,top};
   });
   const minDx=Math.max(...items.map(it=>-it.left));
   const maxDx=Math.min(...items.map(it=>c.width-(it.left+it.w)));
   const minDy=Math.max(...items.map(it=>-it.top));
   const maxDy=Math.min(...items.map(it=>c.height-(it.top+it.h)));
   const clampedDx=Math.max(minDx,Math.min(maxDx,reqDx));
   const clampedDy=Math.max(minDy,Math.min(maxDy,reqDy));
   if(clampedDx!==0||clampedDy!==0){
    let next=c;
    for(const it of items){
     next=moveElement(next,it.id,clampedDx,clampedDy,step,it.frame);
    }
    directChange(next);
   }
  }else{
   directChange(moveElement(c,selectedElement,reqDx,reqDy,step,measureElementFrame(selectedElement)));
   app.querySelector(`[data-element="${selectedElement}"]`)?.focus({preventScroll:true});
  }
 }
 if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();flashGuides();elementAction(e.key==='-'?'smaller-element':'bigger-element');}
});
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.surface){setConfig({surfaceEffect:b.dataset.surface});return;}
 if(b.dataset.elementColor&&selectedElement){directChange(updateElement(c,selectedElement,{[b.dataset.elementColor]:c[b.dataset.roleColor]}));return;}
 if(b.dataset.action==='reset-appearance'&&selectedElement){const p={...elementState(c,selectedElement)};for(const key of ['colorMode','color','opacity','backgroundMode','backgroundColor','backgroundOpacity','fillMode','fillColor'])delete p[key];directChange({...c,elements:{...c.elements,[selectedElement]:p}});return;}
 if(b.dataset.moveStep){moveStep=Number(b.dataset.moveStep);try{localStorage.setItem('kpi-atelier-step',String(moveStep));}catch{}renderCanvasBar();if(tab==='element')renderInspector();return;}
 if(b.dataset.selectElement){selectElement(b.dataset.selectElement);return;}
 if(b.dataset.layerMove){commitLayerOrder(moveLayer(c,b.dataset.layerId,Number(b.dataset.layerMove)),b.dataset.layerId,b.dataset.layerMove);return;}
 if(b.dataset.layerVisibility){const id=b.dataset.layerVisibility;selectedElement=id;directChange(elementVisible(c,id)?updateElement(c,id,{hidden:true}):restoreElement(c,id));return;}
 if(b.dataset.layerDelete){
  const id=b.dataset.layerDelete;
  if(deleteConfirmLayer===id){
   deleteConfirmLayer=null;
   if(deleteConfirmTimer)clearTimeout(deleteConfirmTimer);
   const wasSelected=selectedElement===id||selectedElements.has(id);
   let next=updateElement(c,id,{deleted:true,hidden:false});
   if(wasSelected){
    selectedElements.delete(id);
    if(selectedElement===id)selectedElement=[...selectedElements][0]||null;
   }
   toast(`Elemento '${ELEMENTS[id]?.label||id}' eliminado.`);
   directChange(next);
   renderCanvasBar();
  }else{
   deleteConfirmLayer=id;
   if(deleteConfirmTimer)clearTimeout(deleteConfirmTimer);
   deleteConfirmTimer=setTimeout(()=>{
    deleteConfirmLayer=null;
    renderCanvasBar();
   },3500);
   renderCanvasBar();
  }
  return;
 }
 const a=b.dataset.action;if(a==='layers'){layersOpen=!layersOpen;renderCanvasBar();}
 else if(a==='guides'){guidesEnabled=!guidesEnabled;try{localStorage.setItem('kpi-atelier-guides',JSON.stringify(guidesEnabled));}catch{}renderCanvasBar();renderGuides();}
 else if(a==='select-card')selectCard();
 else if(a==='deselect')deselect();
 else if(a==='format-painter'){
  if(formatPainterSource){
   formatPainterSource=null;
   toast('Copiar formato cancelado.');
  }else if(selectedElement){
   formatPainterSource=selectedElement;
   toast(`Formato de '${ELEMENTS[selectedElement]?.label||selectedElement}' copiado. Haz clic en otro elemento del mismo tipo.`);
  }
  renderCanvasBar();
 }
 else if(['hide-element','delete-element','restore-element','reset-element','release-element','smaller-element','bigger-element'].includes(a))elementAction(a);
 else if(a==='icons')openIconPicker();
 else if(a==='themes')openThemeStudio();
});
function openIconPicker(){openModal('Un símbolo para cada historia.',`${ICON_OPTIONS.length} iconos vectoriales para dar contexto a tu KPI.`,`<label class="search-box icon-search">${icon('search',16)}<input id="icon-search" type="search" placeholder="Busca: ventas, tiempo, personas…" aria-label="Buscar iconos"></label><div id="icon-grid" class="icon-grid">${iconGrid('')}</div>`,btn('close-modal','Cerrar',null,'button secondary'),'icon-modal');}
function iconGrid(query){const activeIcon=(selectedElement&&elementState(c,selectedElement).icon)||c.icon;return ICON_OPTIONS.filter(x=>x.join(' ').toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))).map(([id,label,group])=>`<button data-pick-icon="${id}" class="${activeIcon===id?'active':''}" title="${label} · ${group}">${icon(id,25)}<span>${label}</span></button>`).join('')||'<p class="field-help">No hay iconos con ese nombre.</p>';}
function themeTile(id,name,colors,custom=false){return `<button ${custom?'data-draft-custom':'data-draft-theme'}="${id}" class="studio-theme-tile"><span class="theme-strip">${['background','accent','text','positive'].map(key=>`<i style="background:${colors[key]}"></i>`).join('')}</span><span>${esc(name)}</span>${icon('chevron',12)}</button>`;}
function openThemeStudio(){
 paletteDraft=paletteFrom(c);colorRole='accent';colorHSV=hexToHSV(paletteDraft[colorRole]);
 openModal('El color también cuenta tu historia.','Explora una paleta, afina los matices y hazla tuya.',`<div class="theme-studio"><aside class="theme-library"><h3>Paletas curadas <span>10</span></h3>${Object.entries(THEMES).map(([id,t])=>themeTile(id,t.name,t)).join('')}<div class="custom-theme-heading"><h3>Tus temas</h3></div><div id="custom-theme-list">${customThemes.length?customThemes.map(t=>`<div class="custom-theme-row">${themeTile(t.id,t.name,t.colors,true)}<button data-delete-theme="${t.id}" title="Eliminar tema guardado" aria-label="Eliminar tema ${esc(t.name)}">${icon('trash',13)}</button></div>`).join(''):'<p class="geometry-note">Guarda tu primera paleta para reutilizarla.</p>'}</div></aside><section class="color-workbench"><h3>Ajusta un color</h3><div class="color-roles">${COLOR_ROLES.map(([key,label])=>`<button data-color-role="${key}" class="${key===colorRole?'active':''}"><i style="background:${paletteDraft[key]}"></i><span>${label}</span></button>`).join('')}</div><div class="color-map-label"><strong id="active-color-label">Acento</strong><span>Saturación · luminosidad</span></div><div id="color-map" class="color-map" tabindex="0" role="slider" aria-label="Mapa de color. Flechas izquierda y derecha: saturación. Arriba y abajo: luminosidad." aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(colorHSV.s*100)}"><span id="color-map-cursor"></span></div><label class="hue-label" for="color-hue">Matiz <span id="hue-value"></span></label><input id="color-hue" class="hue-slider" type="range" min="0" max="360" step="1" value="${Math.round(colorHSV.h)}"><div class="color-hex-row"><span id="active-color-preview"></span><label for="color-hex">HEX</label><input id="color-hex" maxlength="7" value="${paletteDraft[colorRole].toUpperCase()}" spellcheck="false" aria-label="Código hexadecimal"><span id="hex-error" role="status"></span></div><div class="quick-colors">${['#ffffff','#17272b','#c3ec83','#477568','#8771bb','#bd8144','#527bdd','#bd758b','#3d9596','#b8664d','#c0b2ee','#000000'].map(color=>`<button data-quick-color="${color}" style="background:${color}" title="${color}" aria-label="Usar ${color}"></button>`).join('')}</div><p class="geometry-note">Arrastra sobre el mapa o usa las flechas. Mayús ajusta de 5 en 5.</p></section><section class="palette-preview-column"><h3>Así se verá tu tarjeta</h3><div id="palette-preview" class="palette-preview"></div><div id="palette-contrast" class="palette-contrast"></div><label class="save-label" for="theme-name">Nombre para tu paleta</label><input id="theme-name" class="save-input" maxlength="40" value="${esc(c.customThemeName||'Mi paleta')}"><p class="geometry-note">Tus paletas se guardan en este navegador. Los colores también viajan con el JSON de cada tarjeta.</p></section></div>`,btn('close-modal','Cancelar',null,'button quiet')+btn('save-theme','Guardar y aplicar','save','button secondary')+btn('apply-theme','Aplicar paleta','check','button primary'),'theme-modal');
 updateColorStudio();
}
function updateColorStudio(){
 if(!$('#color-map')||!paletteDraft)return;
 $('#hex-error').textContent='';$('#color-hex').setAttribute('aria-invalid','false');
 const color=paletteDraft[colorRole];$('#color-map').style.backgroundColor=hsvToHex(colorHSV.h,1,1);
 $('#color-map').setAttribute('aria-valuenow',String(Math.round(colorHSV.s*100)));$('#color-map').setAttribute('aria-valuetext',`${Math.round(colorHSV.s*100)} % saturación, ${Math.round(colorHSV.v*100)} % luminosidad`);
 $('#color-map-cursor').style.cssText=`left:${colorHSV.s*100}%;top:${(1-colorHSV.v)*100}%;background:${color};`;
 $('#color-hue').value=colorHSV.h;$('#hue-value').textContent=Math.round(colorHSV.h)+'°';
 if(document.activeElement!==$('#color-hex'))$('#color-hex').value=color.toUpperCase();
 $('#active-color-preview').style.background=color;$('#active-color-label').textContent=COLOR_ROLES.find(r=>r[0]===colorRole)[1];
 document.querySelectorAll('[data-color-role]').forEach(button=>{button.classList.toggle('active',button.dataset.colorRole===colorRole);button.setAttribute('aria-pressed',String(button.dataset.colorRole===colorRole));button.querySelector('i').style.background=paletteDraft[button.dataset.colorRole];});
 $('#palette-preview').innerHTML=thumb({...c,...paletteDraft});fitThumbs();
 const main=contrastRatio(paletteDraft.text,paletteDraft.background),secondary=contrastRatio(paletteDraft.muted,paletteDraft.background);
 $('#palette-contrast').innerHTML=`<div class="${main<4.5?'low':''}">${icon(main<4.5?'info':'check',13)}<span>Texto principal</span><b>${main.toFixed(1)}:1</b></div><div class="${secondary<4.5?'low':''}">${icon(secondary<4.5?'info':'check',13)}<span>Texto secundario</span><b>${secondary.toFixed(1)}:1</b></div><small>${main<4.5||secondary<4.5?'Puedes mejorar la legibilidad separando más el color del texto y el fondo.':'Buena separación entre texto y fondo.'}</small>`;
}
function colorFromPointer(e){const map=$('#color-map'),r=map.getBoundingClientRect();colorHSV.s=clamp((e.clientX-r.left)/r.width,0,1);colorHSV.v=1-clamp((e.clientY-r.top)/r.height,0,1);paletteDraft[colorRole]=hsvToHex(colorHSV.h,colorHSV.s,colorHSV.v);updateColorStudio();}
document.addEventListener('pointerdown',e=>{if(e.target.closest('#color-map')&&e.button===0){e.preventDefault();$('#color-map').focus({preventScroll:true});colorPointer=e.pointerId;$('#color-map').setPointerCapture(e.pointerId);colorFromPointer(e);}});
document.addEventListener('pointermove',e=>{if(colorPointer===e.pointerId&&$('#color-map'))colorFromPointer(e);});
document.addEventListener('pointerup',e=>{if(colorPointer===e.pointerId)colorPointer=null;});
document.addEventListener('pointercancel',()=>{colorPointer=null;});
document.addEventListener('keydown',e=>{if(e.target.id!=='color-map')return;const step=e.shiftKey?.05:.01;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')colorHSV.s-=step;if(e.key==='ArrowRight')colorHSV.s+=step;if(e.key==='ArrowUp')colorHSV.v+=step;if(e.key==='ArrowDown')colorHSV.v-=step;colorHSV.s=clamp(colorHSV.s,0,1);colorHSV.v=clamp(colorHSV.v,0,1);paletteDraft[colorRole]=hsvToHex(colorHSV.h,colorHSV.s,colorHSV.v);updateColorStudio();}});
document.addEventListener('input',e=>{if(e.target.id==='color-hue'){colorHSV.h=Number(e.target.value);paletteDraft[colorRole]=hsvToHex(colorHSV.h,colorHSV.s,colorHSV.v);updateColorStudio();}if(e.target.id==='color-hex'){const value=e.target.value.trim();const color=value.startsWith('#')?value:'#'+value;if(/^#[0-9a-f]{6}$/i.test(color)){paletteDraft[colorRole]=color.toLowerCase();colorHSV=hexToHSV(color);$('#hex-error').textContent='';e.target.setAttribute('aria-invalid','false');updateColorStudio();}else{$('#hex-error').textContent='6 caracteres';e.target.setAttribute('aria-invalid','true');}}});
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.colorRole){colorRole=b.dataset.colorRole;colorHSV=hexToHSV(paletteDraft[colorRole]);$('#hex-error').textContent='';$('#color-hex').setAttribute('aria-invalid','false');updateColorStudio();}
 if(b.dataset.quickColor){paletteDraft[colorRole]=b.dataset.quickColor;colorHSV=hexToHSV(b.dataset.quickColor);updateColorStudio();}
 if(b.dataset.draftTheme||b.dataset.draftCustom){const preset=b.dataset.draftTheme?THEMES[b.dataset.draftTheme]:customThemes.find(t=>t.id===b.dataset.draftCustom);if(preset){paletteDraft=paletteFrom(preset.colors||preset);colorHSV=hexToHSV(paletteDraft[colorRole]);$('#theme-name').value=preset.name+' · Personalizado';updateColorStudio();}}
 if(b.dataset.deleteTheme){const next=customThemes.filter(t=>t.id!==b.dataset.deleteTheme);try{localStorage.setItem('kpi-atelier-themes',JSON.stringify(next));customThemes=next;b.closest('.custom-theme-row').remove();toast('Tema retirado de tus paletas. Las tarjetas se conservan.');}catch{toast('No se pudo eliminar el tema.');}}
 if(b.dataset.action==='apply-theme'||b.dataset.action==='save-theme'){
  if($('#color-hex').getAttribute('aria-invalid')==='true'){toast('Revisa el código hexadecimal antes de aplicar.');$('#color-hex').focus();return;}
  const name=$('#theme-name').value.trim()||'Mi paleta';
  if(b.dataset.action==='save-theme'){const next=[{id:crypto.randomUUID(),name,colors:paletteFrom(paletteDraft)},...customThemes];try{localStorage.setItem('kpi-atelier-themes',JSON.stringify(next));customThemes=next;}catch{toast('No se pudo guardar el tema. Puedes aplicar sus colores.');return;}}
  const colors={...paletteDraft};closeModal();setConfig({...colors,theme:'custom',customThemeName:name});toast(b.dataset.action==='save-theme'?'Tema guardado y aplicado.':'Paleta aplicada.');
 }
});
document.addEventListener('input',e=>{
 if(e.target.id==='icon-search')$('#icon-grid').innerHTML=iconGrid(e.target.value);
 const dupId=e.target.dataset?.bindDup;
 if(dupId){
  const prop=e.target.dataset?.bindDupprop||'measure';
  const val=e.target.value;
  c=updateElement(c,dupId,{[prop]:val});
  persist();
  const clearBtn=document.querySelector(`[data-action="clear-bind-dup"][data-dup="${dupId}"]`);
  if(clearBtn)clearBtn.classList.toggle('is-visible',Boolean(val));
  const inner=document.getElementById('binding-card-inner');
  if(inner){
   inner.innerHTML=cardHTML(c,undefined,true);
   const el=inner.querySelector(`[data-element="${dupId}"]`);
   if(el)el.classList.add('binding-highlight');
   fitBindingCard();
  }
  refreshCard();
  renderStatus();
  const menu=document.getElementById(`dropdown-menu-${dupId}`);
  if(menu&&pbipModel){
   menu.innerHTML=renderBindingDropdown(dupId,val);
   menu.classList.add('is-open');
   const toggle=document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${dupId}"]`);
   if(toggle)toggle.setAttribute('aria-expanded','true');
  }
  return;
 }
 const bindKey=e.target.dataset?.bindKey;
 if(bindKey){
  if(bindKey==='measure'){
   const val=e.target.value;
   c._measureBound=Boolean(val.trim());
   const cleanId=val.replace(/^\[|\]$/g,'').trim().replace(/[^\p{L}\p{N}_ ]/gu,'').trim().replace(/\s+/g,'_');
   const autoName=cleanId?(cleanId.startsWith('KPI_')?cleanId:`KPI_${cleanId}`):'';
   const autoTitle=val.replace(/^\[|\]$/g,'').trim();
   const patch={measure:val};
   if(autoName){
    patch.measureName=autoName;
    const mnInput=document.getElementById('f-bind-measureName');
    if(mnInput)mnInput.value=autoName;
   }
   if(autoTitle)patch.title=autoTitle;
   c=sanitizeConfig({...c,...patch});
  }else if(bindKey==='measureName'){
   const val=e.target.value;
   const stripped=val.replace(/^kpi[_\s]+/i,'').replace(/_+/g,' ').trim();
   const autoTitle=stripped||val.trim();
   const patch={measureName:val};
   if(autoTitle&&autoTitle.toLowerCase()!=='kpi')patch.title=autoTitle;
   c=sanitizeConfig({...c,...patch});
  }else{
   if(bindKey==='targetMeasure')c._targetCustomized=true;
   if(bindKey==='dateTable')c._dateCustomized=true;
   c=sanitizeConfig({...c,[bindKey]:e.target.value});
  }
  persist();
  const clearBtn=document.querySelector(`[data-action="clear-bind-field"][data-field="${bindKey}"]`);
  if(clearBtn)clearBtn.classList.toggle('is-visible',Boolean(e.target.value));
  const menu=document.getElementById(`dropdown-menu-${bindKey}`);
  if(menu&&pbipModel){
   menu.innerHTML=renderBindingDropdown(bindKey,e.target.value);
   menu.classList.add('is-open');
   const toggle=document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${bindKey}"]`);
   if(toggle)toggle.setAttribute('aria-expanded','true');
  }
  const inner=document.getElementById('binding-card-inner');
  if(inner){
   inner.innerHTML=cardHTML(c,undefined,true);
   highlightBindingElements(bindKey,true);
   fitBindingCard();
  }
  updateBindingFieldStatus(bindKey);
  if(bindKey==='measure')updateBindingFieldStatus('measureName');
  if(bindKey==='dateTable'&&pbipModel){
   const dlDateCols=document.getElementById('dl-pbip-date-columns');
   if(dlDateCols){
    const curDt=(pbipModel.dateTables||[]).find(dt=>dt.name.toLowerCase()===e.target.value.trim().toLowerCase());
    const candidateCols=curDt?curDt.dateColumns:Array.from(new Set((pbipModel.dateTables||[]).flatMap(dt=>dt.dateColumns)));
    dlDateCols.innerHTML=candidateCols.map(col=>{
     const isKey=curDt&&curDt.primaryDateColumn===col;
     const tag=isKey?'⭐ Columna clave (isKey)':curDt?esc(curDt.name):'Columna fecha';
     return `<option value="${esc(col)}">${tag}</option>`;
    }).join('');
   }
  }
  updateBindingModalStatus();
  refreshCard();
  renderStatus();
 }
});
document.addEventListener('click',e=>{
 const clearDupBtn=e.target.closest?.('[data-action="clear-bind-dup"]');
 if(clearDupBtn){
  const dupId=clearDupBtn.dataset.dup;
  const prop=clearDupBtn.dataset.prop||'measure';
  c=updateElement(c,dupId,{[prop]:''});
  persist();
  const input=document.getElementById(`f-bind-${dupId}`);
  if(input){input.value='';input.focus();}
  clearDupBtn.classList.remove('is-visible');
  const inner=document.getElementById('binding-card-inner');
  if(inner){
   inner.innerHTML=cardHTML(c,undefined,true);
   fitBindingCard();
  }
  refreshCard();
  renderStatus();
  return;
 }
 const clearBtn=e.target.closest?.('[data-action="clear-bind-field"]');
 if(clearBtn){
  const fieldKey=clearBtn.dataset.field;
  applyBindingFieldValue(fieldKey,'');
  const input=document.getElementById(`f-bind-${fieldKey}`);
  if(input){input.value='';input.focus();}
  clearBtn.classList.remove('is-visible');
  const menu=document.getElementById(`dropdown-menu-${fieldKey}`);
  if(menu&&menu.classList.contains('is-open')){
   menu.innerHTML=renderBindingDropdown(fieldKey,'');
  }
  return;
 }
 const toggleBtn=e.target.closest?.('[data-action="toggle-bind-dropdown"]');
 if(toggleBtn){
  const fieldKey=toggleBtn.dataset.field;
  const menu=document.getElementById(`dropdown-menu-${fieldKey}`);
  if(menu){
   const isOpen=menu.classList.contains('is-open');
   closeAllBindingDropdowns();
   if(!isOpen){
    menu.innerHTML=renderBindingDropdown(fieldKey,'');
    menu.classList.add('is-open');
    toggleBtn.setAttribute('aria-expanded','true');
    toggleBtn.classList.add('is-open');
    const sel=menu.querySelector('.is-selected');
    if(sel&&sel.scrollIntoView)sel.scrollIntoView({block:'nearest'});
   }
  }
  return;
 }
 const itemBtn=e.target.closest?.('[data-action="select-binding-item"]');
 if(itemBtn){
  const fieldKey=itemBtn.dataset.field;
  const val=itemBtn.dataset.value;
  applyBindingFieldValue(fieldKey,val);
  closeAllBindingDropdowns();
  const input=document.getElementById(`f-bind-${fieldKey}`);
  if(input)input.focus();
  return;
 }
 if(!e.target.closest?.('.binding-dropdown-wrap')){
  closeAllBindingDropdowns();
 }
 const bindingEl=e.target.closest?.('#binding-card-inner .editable-element.is-bindable');
 if(bindingEl){
  e.preventDefault();
  const id=bindingEl.dataset.element;
  const def=resolveElementDef(id);
  const fieldKey=ELEMENT_TO_FIELD[id]||(def?.isDuplicate?id:null);
  if(fieldKey){
   const input=document.getElementById(`f-bind-${fieldKey}`);
   if(input){
    input.focus();
    if(input.select)input.select();
    const wrap=input.closest('.binding-input-wrap');
    if(wrap){
     wrap.style.transition='box-shadow .2s';
     wrap.style.boxShadow='0 0 0 4px #7fa45b55';
     setTimeout(()=>{wrap.style.boxShadow='';},600);
    }
   }
  }
  return;
 }
 const b=e.target.closest('[data-pick-icon]');
 if(!b)return;closeModal();const def=selectedElement?resolveElementDef(selectedElement):null;if(def?.isDuplicate&&def.baseId==='icon'){directChange(updateElement(c,selectedElement,{icon:b.dataset.pickIcon}));}else{directChange({...restoreElement(c,'icon'),icon:b.dataset.pickIcon});}toast('Icono actualizado.');
});
document.addEventListener('focusin',e=>{
 const key=e.target.dataset?.bindKey||e.target.dataset?.bindDup;
 if(key){
  highlightBindingElements(key,true);
  if(pbipModel&&(['measure','targetMeasure','compareMeasure','dateTable','dateColumn'].includes(key)||key.includes('_copy'))){
   const menu=document.getElementById(`dropdown-menu-${key}`);
   if(menu){
    closeAllBindingDropdowns();
    menu.innerHTML=renderBindingDropdown(key,'');
    menu.classList.add('is-open');
    const toggle=document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${key}"]`);
    if(toggle){toggle.setAttribute('aria-expanded','true');toggle.classList.add('is-open');}
    const sel=menu.querySelector('.is-selected');
    if(sel&&sel.scrollIntoView)sel.scrollIntoView({block:'nearest'});
   }
  }
 }
});
document.addEventListener('focusout',e=>{
 const key=e.target.dataset?.bindKey||e.target.dataset?.bindDup;
 if(key)highlightBindingElements(key,false);
});
document.addEventListener('mouseover',e=>{
 const wrap=e.target.closest?.('[data-binding-field]');
 if(wrap)highlightBindingElements(wrap.dataset.bindingField,true);
});
document.addEventListener('mouseout',e=>{
 const wrap=e.target.closest?.('[data-binding-field]');
 if(wrap){
  const key=wrap.dataset.bindingField;
  if(document.activeElement?.dataset?.bindKey!==key&&document.activeElement?.dataset?.bindDup!==key)highlightBindingElements(key,false);
 }
});
document.addEventListener('change',e=>{
 if(e.target.id==='pbip-folder-input'&&e.target.files?.length){
  scanFileList(e.target.files).then(catalog=>{
   setPbipModel(catalog,true);
   const appliedCal=(catalog.dateTables||[])[0];
   const calMsg=appliedCal?` · Calendario: ${appliedCal.name}[${appliedCal.primaryDateColumn||appliedCal.dateColumns[0]}]`:'';
   toast(`Modelo '${catalog.modelName}' conectado (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha)${calMsg}.`);
   openDataBindingModal();
  }).catch(err=>{
   toast(`Error al leer archivos: ${err.message}`);
  });
  return;
 }
 if(e.target.closest?.('#modal')&&e.target.dataset?.key==='granularity'){
  c=sanitizeConfig({...c,granularity:e.target.value});
  persist();
  refreshCard();
 }
});

const FIELD_TO_ELEMENTS={
 measure:['value'],
 measureName:['title'],
 dateTable:['trend','period'],
 dateColumn:['period'],
 targetMeasure:['progress','progressLabel','goalLabel'],
 compareMeasure:['referenceValue','referenceLabel']
};
const ELEMENT_TO_FIELD={
 value:'measure',
 title:'measureName',
 progress:'targetMeasure',
 progressLabel:'targetMeasure',
 goalLabel:'targetMeasure',
 delta:'compareMeasure',
 referenceValue:'compareMeasure',
 referenceLabel:'compareMeasure',
 period:'dateColumn',
 trend:'dateTable'
};

function dataSummaryCard(){
 const rows=[];
 if(pbipModel){
  rows.push(`<div class="data-summary-row"><span>Modelo PBIP</span><strong title="${esc(pbipModel.modelName)}">${esc(pbipModel.modelName)} <span class="data-summary-badge">${pbipModel.measures.length} fx</span></strong></div>`);
 }
 rows.push(
  `<div class="data-summary-row"><span>Medida principal</span><strong>${esc(c.measure||'Sin asignar')}</strong></div>`,
  `<div class="data-summary-row"><span>Nombre salida DAX</span><strong>${esc(c.measureName||'Sin asignar')}</strong></div>`
 );
 if(needsDate(c)){
  rows.push(`<div class="data-summary-row"><span>Calendario</span><strong>${esc(c.dateTable)} [${esc(c.dateColumn)}]</strong></div>`);
 }
 if(needsGoal(c)||c.comparison==='target'){
  rows.push(`<div class="data-summary-row"><span>Medida objetivo</span><strong>${esc(c.targetMeasure||'Sin asignar')}</strong></div>`);
 }
 if(needsCompare(c)&&c.comparison==='custom'){
  rows.push(`<div class="data-summary-row"><span>Referencia</span><strong>${esc(c.compareMeasure||'Sin asignar')}</strong></div>`);
 }
 return `<div class="data-summary-card">${rows.join('')}</div>`;
}

function highlightBindingElements(key,active){
 const targets=FIELD_TO_ELEMENTS[key]||(resolveElementDef(key)?.isDuplicate?[key]:[]);
 const card=document.getElementById('binding-card-inner');
 if(!card)return;
 targets.forEach(id=>{
  const el=card.querySelector(`[data-element="${id}"]`);
  if(el)el.classList.toggle('binding-highlight',active);
 });
}

function updateBindingFieldStatus(key){
 const circ=key==='measureName'?getCircularConflict(c):null;
 const isErr=Boolean(
  (key==='measure'&&!c.measure.trim())||
  (key==='measureName'&&(!isValidMeasureName(c.measureName)||circ))||
  (key==='dateTable'&&needsDate(c)&&!c.dateTable.trim())||
  (key==='dateColumn'&&needsDate(c)&&!c.dateColumn.trim())||
  (key==='targetMeasure'&&(needsGoal(c)||(needsCompare(c)&&c.comparison==='target'))&&!c.targetMeasure.trim())||
  (key==='compareMeasure'&&needsCompare(c)&&c.comparison==='custom'&&!c.compareMeasure.trim())
 );
 const wrap=document.querySelector(`[data-binding-field="${key}"] .binding-input-wrap`);
 const iconEl=document.getElementById(`status-icon-${key}`);
 const helpEl=document.getElementById(`help-${key}`);
 if(wrap)wrap.classList.toggle('is-invalid',isErr);
 if(iconEl){
  iconEl.className='binding-input-status '+(isErr?'invalid':c[key]?'valid':'optional');
  iconEl.innerHTML=icon(isErr?'close':c[key]?'check':'info',isErr||c[key]?14:13);
 }
 if(helpEl){
  helpEl.classList.toggle('error',isErr);
  if(circ){
   helpEl.textContent=`⚠️ No puede coincidir con ${circ.type} (dependencia circular)`;
   helpEl.style.display='';
   helpEl.classList.remove('is-hidden');
  }else if(isErr){
   helpEl.textContent='Este campo es obligatorio para la tarjeta actual';
   helpEl.style.display='';
   helpEl.classList.remove('is-hidden');
  }else{
   const defHelp=helpEl.dataset.defaultHelp||'';
   if(defHelp){
    helpEl.textContent=defHelp;
    helpEl.style.display='';
    helpEl.classList.remove('is-hidden');
   }else{
    helpEl.textContent='';
    helpEl.style.display='none';
    helpEl.classList.add('is-hidden');
   }
  }
 }
}

function updateBindingModalStatus(){
 const statusEl=document.getElementById('binding-modal-status');
 if(!statusEl)return;
 const errors=checks(c).filter(x=>x.level==='error');
 statusEl.className='binding-status-bar '+(errors.length?'has-error':'');
 statusEl.innerHTML=`${icon(errors.length?'info':'check',15)}<span>${errors.length?`${errors.length} campo${errors.length>1?'s':''} pendiente${errors.length>1?'s':''} de configurar`:'Configuración completa · Lista para exportar DAX'}</span>`;
}

function updateBindableElements(){
 const inner=document.getElementById('binding-card-inner');
 if(!inner)return;
 const activeFields=new Set(['measure','measureName']);
 if(needsDate(c)){activeFields.add('dateTable');activeFields.add('dateColumn');}
 if(needsGoal(c)||c.comparison==='target'){activeFields.add('targetMeasure');}
 if(needsCompare(c)&&c.comparison==='custom'){activeFields.add('compareMeasure');}
 inner.querySelectorAll('[data-element]').forEach(el=>{
  const id=el.dataset.element;
  const def=resolveElementDef(id);
  const isDuplicate=Boolean(def?.isDuplicate);
  if(id==='compareLabel'||(id==='delta'&&c.comparison!=='custom')){
   el.classList.remove('is-bindable','binding-highlight');
   el.removeAttribute('role');
   el.removeAttribute('tabindex');
   return;
  }
  const fieldKey=ELEMENT_TO_FIELD[id];
  const isDupBindable=isDuplicate&&(def.baseId==='value'||(def.baseId==='delta'&&(elementState(c,id).comparison||c.comparison)==='custom')||(['goalLabel','progressLabel','progress'].includes(def.baseId)&&(needsGoal(c)||c.comparison==='target')));
  const isBindable=isDupBindable||Boolean(fieldKey&&activeFields.has(fieldKey));
  el.classList.toggle('is-bindable',isBindable);
  if(!isBindable){
   el.classList.remove('binding-highlight');
   el.removeAttribute('role');
   el.removeAttribute('tabindex');
  }
 });
}

function fitBindingCard(){
 updateBindableElements();
 requestAnimationFrame(()=>{
  const wrap=document.querySelector('.binding-card-wrap'),inner=document.getElementById('binding-card-inner');
  if(!wrap||!inner)return;
  const available=Math.max(220,wrap.clientWidth-20);
  const factor=Math.min(1,available/c.width);
  inner.style.transform=`scale(${factor})`;
  if(inner.firstElementChild)wrap.style.height=(inner.firstElementChild.offsetHeight*factor+24)+'px';
  updateBindableElements();
 });
}

function getBindingFieldOptions(key){
 if(!pbipModel)return [];
 if(['measure','targetMeasure','compareMeasure'].includes(key)||key.includes('_copy')){
  return (pbipModel.measures||[]).map(m=>({value:m.name,label:m.name,desc:m.table||'Medida'}));
 }
 if(key==='dateTable'){
  return (pbipModel.dateTables||[]).map(dt=>({
   value:dt.name,
   label:dt.name,
   desc:dt.isMarkedDateTable?'⭐ Fecha oficial (dataCategory: Time)':dt.isLikelyCalendar?'Calendario sugerido':`${dt.dateColumns.length} cols fecha`
  }));
 }
 if(key==='dateColumn'){
  const curDt=(pbipModel.dateTables||[]).find(dt=>dt.name.toLowerCase()===(c.dateTable||'').trim().toLowerCase());
  const candidateDateCols=curDt?curDt.dateColumns:Array.from(new Set((pbipModel.dateTables||[]).flatMap(dt=>dt.dateColumns)));
  return candidateDateCols.map(col=>{
   const isKey=curDt&&curDt.primaryDateColumn===col;
   return {
    value:col,
    label:col,
    desc:isKey?'⭐ Columna clave (isKey)':curDt?curDt.name:'Columna fecha'
   };
  });
 }
 return [];
}

function renderBindingDropdown(key,filterText=''){
 const options=getBindingFieldOptions(key);
 const def=resolveElementDef(key);
 const currentVal=(def?.isDuplicate?elementState(c,key)[def.baseId==='delta'?'compareMeasure':['goalLabel','progressLabel','progress'].includes(def.baseId)?'targetMeasure':'measure']:c[key]||'').trim().toLowerCase();
 const q=(filterText||'').trim().toLowerCase();
 const filtered=q?options.filter(o=>o.label.toLowerCase().includes(q)||o.desc.toLowerCase().includes(q)):options;
 if(!filtered.length){
  return `<div class="binding-dropdown-empty">No se encontraron opciones${filterText?` para "${esc(filterText)}"`:''}</div>`;
 }
 const hasExactSelected=filtered.some(o=>o.value.toLowerCase()===currentVal);
 return filtered.map((opt,idx)=>{
  const isSelected=hasExactSelected?(opt.value.toLowerCase()===currentVal):(idx===0&&Boolean(q));
  return `<button type="button" class="binding-dropdown-item ${isSelected?'is-selected':''}" data-action="select-binding-item" data-field="${key}" data-value="${esc(opt.value)}">
   <span class="binding-dropdown-label">${esc(opt.label)}</span>
   <span class="binding-dropdown-meta">${esc(opt.desc)}</span>
  </button>`;
 }).join('');
}

function closeAllBindingDropdowns(){
 document.querySelectorAll('.binding-dropdown-menu.is-open').forEach(menu=>{
  menu.classList.remove('is-open');
  const toggle=menu.parentElement?.querySelector('.binding-dropdown-toggle');
  if(toggle){
   toggle.setAttribute('aria-expanded','false');
   toggle.classList.remove('is-open');
  }
 });
}

function applyBindingFieldValue(key,val){
 if(key.includes('_copy')){
  const def=resolveElementDef(key);
  const prop=def?.baseId==='delta'?'compareMeasure':['goalLabel','progressLabel','progress'].includes(def?.baseId)?'targetMeasure':'measure';
  c=updateElement(c,key,{[prop]:val});
 }else if(key==='targetMeasure')c._targetCustomized=true;
 if(key==='dateTable')c._dateCustomized=true;
 if(key==='measureName'){
  const stripped=val.replace(/^kpi[_\s]+/i,'').replace(/_+/g,' ').trim();
  const autoTitle=stripped||val.trim();
  const patch={measureName:val};
  if(autoTitle&&autoTitle.toLowerCase()!=='kpi')patch.title=autoTitle;
  c=sanitizeConfig({...c,...patch});
 }else if(key==='measure'){
  c._measureBound=Boolean(val.trim());
  const cleanId=val.replace(/^\[|\]$/g,'').trim().replace(/[^\p{L}\p{N}_ ]/gu,'').trim().replace(/\s+/g,'_');
  const autoName=cleanId?(cleanId.startsWith('KPI_')?cleanId:`KPI_${cleanId}`):'';
  const autoTitle=val.replace(/^\[|\]$/g,'').trim();
  const patch={measure:val};
  if(autoName){
   patch.measureName=autoName;
   const mnInput=document.getElementById('f-bind-measureName');
   if(mnInput)mnInput.value=autoName;
  }
  if(autoTitle)patch.title=autoTitle;
  c=sanitizeConfig({...c,...patch});
 }else if(key==='dateTable'){
  c._dateCustomized=true;
  const patch={dateTable:val};
  if(pbipModel){
   const curDt=(pbipModel.dateTables||[]).find(dt=>dt.name.toLowerCase()===val.trim().toLowerCase());
   if(curDt&&(curDt.primaryDateColumn||curDt.dateColumns[0])){
    patch.dateColumn=curDt.primaryDateColumn||curDt.dateColumns[0];
    const colInput=document.getElementById('f-bind-dateColumn');
    if(colInput)colInput.value=patch.dateColumn;
   }
  }
  c=sanitizeConfig({...c,...patch});
 }else{
  c=sanitizeConfig({...c,[key]:val});
 }
 persist();
 const input=document.getElementById(`f-bind-${key}`);
 if(input)input.value=val;
 const clearBtn=document.querySelector(`[data-action="clear-bind-field"][data-field="${key}"]`);
 if(clearBtn)clearBtn.classList.toggle('is-visible',Boolean(val));
 const inner=document.getElementById('binding-card-inner');
 if(inner){
  inner.innerHTML=cardHTML(c,undefined,true);
  fitBindingCard();
 }
 updateBindingFieldStatus(key);
 if(key==='measure')updateBindingFieldStatus('measureName');
 if(key==='dateTable')updateBindingFieldStatus('dateColumn');
 updateBindingModalStatus();
 refreshCard();
 renderStatus();
}

function openDataBindingModal(focusKey=null){
 const DUMMY_TARGETS=['Objetivo EBITDA','Objetivo Pedidos','Objetivo Ventas','Objetivo'];
 if(!c._targetCustomized&&DUMMY_TARGETS.includes(c.targetMeasure?.trim())){
  c.targetMeasure='';
  persist();
 }
 if(!c._measureBound){
  c.measure='';
  persist();
 }
 if(!c.measureName||!c.measureName.trim()){
  const baseTitle=(c.title||'Medida').replace(/[^\p{L}\p{N}_]/gu,'_').replace(/^_+|_+$/g,'')||'Medida';
  c.measureName=baseTitle.startsWith('KPI_')?baseTitle:`KPI_${baseTitle}`;
  persist();
 }
 if(pbipModel){
  const modelDateTables=pbipModel.dateTables||[];
  const modelTableNames=(pbipModel.tables||[]).map(t=>t.toLowerCase());
  const curTable=(c.dateTable||'').trim().toLowerCase();
  const tableExists=modelDateTables.some(dt=>dt.name.toLowerCase()===curTable)||modelTableNames.includes(curTable);
  if(!tableExists&&modelDateTables.length){
   const bestDt=modelDateTables.find(dt=>dt.isMarkedDateTable)||modelDateTables.find(dt=>dt.isLikelyCalendar)||modelDateTables[0];
   if(bestDt){
    c.dateTable=bestDt.name;
    c.dateColumn=bestDt.primaryDateColumn||bestDt.dateColumns?.[0]||c.dateColumn;
    c._dateCustomized=true;
    persist();
   }
  }
 }
 const markedDateTables=(pbipModel?.dateTables||[]).filter(dt=>dt.isMarkedDateTable);
 const isLive=Boolean(pbipModel?.isLiveConnection);
 const roundtripMeasures=(pbipModel?.measures||[]).filter(m=>m.configAnnotation);
 const roundtripHTML=roundtripMeasures.length?`
  <details class="binding-saved-subbar" open>
   <summary class="binding-saved-title">${icon('sparkles',13)} <span>Tarjetas guardadas en tu modelo (${roundtripMeasures.length})</span>${icon('chevron',12)}</summary>
   <div class="binding-saved-grid">
    ${roundtripMeasures.map(rm=>`
     <div class="binding-saved-item">
      <span><strong>${esc(rm.name)}</strong> <small>(${esc(rm.table)})</small></span>
      <button type="button" class="binding-saved-btn" data-action="load-roundtrip-measure" data-measure="${esc(rm.name)}">Cargar en lienzo</button>
     </div>`).join('')}
   </div>
  </details>`:'';

 const pbipCardHTML=`
 <div class="binding-model-card ${pbipModel?'is-connected'+(isLive?' is-live':''):''}">
  <div class="pbip-bar ${pbipModel?'is-connected'+(isLive?' is-live':''):''}">
   <div class="pbip-bar-info">
    ${pbipModel?(
     isLive?`
      <span class="pbip-badge connected-live">⚡ En Vivo</span>
      <div class="pbip-bar-text">
       <div class="pbip-bar-title">${esc(getFriendlyReportName(pbipModel))}</div>
       <div class="pbip-bar-subtitle">${pbipModel.measures.length} medidas vinculables · ${pbipModel.dateTables.length} tablas con fecha</div>
      </div>
     `:`
      <span class="pbip-badge connected">${icon('check',11)} Conectado</span>
      <div class="pbip-bar-text">
       <div class="pbip-bar-title">${esc(getFriendlyReportName(pbipModel))}</div>
       <div class="pbip-bar-subtitle">${pbipModel.measures.length} medidas detectadas · ${pbipModel.dateTables.length} tablas con fecha</div>
      </div>
     `
    ):`
     <span class="pbip-badge not-connected">${icon('database',11)} Sin vincular</span>
     <div class="pbip-bar-text">
      <div class="pbip-bar-title">Conectar modelo de Power BI</div>
      <div class="pbip-bar-subtitle">Power BI Desktop abierto (localhost) o carpeta de proyecto PBIP.</div>
     </div>
    `}
   </div>
   <div class="pbip-actions">
    <button type="button" class="pbip-btn ${isLive?'secondary':'primary'}" data-action="${isLive?'refresh-live-pbi':'connect-live-pbi'}" title="${isLive?'Recargar modelo desde Power BI Desktop':'Detectar y conectar con Power BI Desktop abierto en localhost'}">
     ${icon('sparkles',13)} ${isLive?'Recargar Desktop':'Power BI (localhost)'}
    </button>
    ${isLive?`<button type="button" class="pbip-btn secondary" data-action="connect-live-pbi" title="Buscar o alternar informes abiertos en Power BI Desktop">${icon('sparkles',13)} Cambiar informe…</button>`:''}
    <button type="button" class="pbip-btn secondary" data-action="connect-pbip" title="Seleccionar carpeta local PBIP / Fabric">
     ${icon('folder',13)} ${pbipModel&&!isLive?'Cambiar PBIP…':'Carpeta PBIP…'}
    </button>
    <input type="file" id="pbip-folder-input" webkitdirectory directory hidden>
    ${pbipModel?`<button type="button" class="pbip-btn danger" data-action="disconnect-pbip" title="Desconectar modelo actual">${icon('close',13)} Desconectar</button>`:''}
   </div>
  </div>
  ${roundtripHTML}
 </div>`;

 let datalistsHTML='';
 if(pbipModel){
  const measureOptions=(pbipModel.measures||[]).map(m=>`<option value="${esc(m.name)}">${esc(m.table)}</option>`).join('');
  const dateTableOptions=(pbipModel.dateTables||[]).map(dt=>{
   const tag=dt.isMarkedDateTable?'⭐ Fecha oficial (dataCategory: Time)':dt.isLikelyCalendar?'Calendario sugerido':`${dt.dateColumns.length} cols fecha`;
   return `<option value="${esc(dt.name)}">${tag}</option>`;
  }).join('');
  const curDt=(pbipModel.dateTables||[]).find(dt=>dt.name.toLowerCase()===(c.dateTable||'').trim().toLowerCase());
  const candidateDateCols=curDt?curDt.dateColumns:Array.from(new Set((pbipModel.dateTables||[]).flatMap(dt=>dt.dateColumns)));
  const dateColOptions=candidateDateCols.map(col=>{
   const isKey=curDt&&curDt.primaryDateColumn===col;
   const tag=isKey?'⭐ Columna clave (isKey)':curDt?esc(curDt.name):'Columna fecha';
   return `<option value="${esc(col)}">${tag}</option>`;
  }).join('');
  datalistsHTML=`<datalist id="dl-pbip-measures">${measureOptions}</datalist><datalist id="dl-pbip-date-tables">${dateTableOptions}</datalist><datalist id="dl-pbip-date-columns">${dateColOptions}</datalist>`;
 }

 const fieldMarkup=(key,label,iconChar,helpText,badgeText)=>{
  const val=c[key]||'';
  const isErr=Boolean(
   (key==='measure'&&!c.measure.trim())||
   (key==='measureName'&&!isValidMeasureName(c.measureName))||
   (key==='dateTable'&&needsDate(c)&&!c.dateTable.trim())||
   (key==='dateColumn'&&needsDate(c)&&!c.dateColumn.trim())||
   (key==='targetMeasure'&&(needsGoal(c)||(needsCompare(c)&&c.comparison==='target'))&&!c.targetMeasure.trim())||
   (key==='compareMeasure'&&needsCompare(c)&&c.comparison==='custom'&&!c.compareMeasure.trim())
  );
  const statusIcon=isErr?icon('close',14):val?icon('check',14):icon('info',13);
  const statusCl=isErr?'invalid':val?'valid':'optional';
  const hasDropdown=Boolean(pbipModel&&['measure','targetMeasure','compareMeasure','dateTable','dateColumn'].includes(key));
  const listAttr=hasDropdown?(
   ['measure','targetMeasure','compareMeasure'].includes(key)?'list="dl-pbip-measures"':
   key==='dateTable'?'list="dl-pbip-date-tables"':
   key==='dateColumn'?'list="dl-pbip-date-columns"':''
  ):'';
  const markedTable=(pbipModel?.dateTables||[]).find(dt=>dt.isMarkedDateTable);
  const defaultTable=markedTable||(pbipModel?.dateTables||[])[0];
  const ph=key==='measure'?(pbipModel?.measures?.[0]?.name||'Total Ventas'):
   key==='dateTable'?(defaultTable?.name||'Calendario'):
   key==='dateColumn'?(defaultTable?.primaryDateColumn||defaultTable?.dateColumns?.[0]||'Fecha'):
   key==='measureName'?'MiMedidaDAX':
   key==='targetMeasure'?'Medida o número (ej. 0)':
   'Valor';
  const curDt=(pbipModel?.dateTables||[]).find(dt=>dt.name.toLowerCase()===(c.dateTable||'').trim().toLowerCase());
  const quickBadge=pbipModel&&(key==='measure'||key==='dateTable'||key==='dateColumn')?
   `<span class="pbip-quick-chip" title="Autocompletado activo">${
     key==='measure'?`${pbipModel.measures.length} medidas`:
     key==='dateTable'?(markedTable?'⭐ Oficial':`${pbipModel.dateTables.length} tablas fecha`):
     (curDt?.primaryDateColumn?'⭐ isKey':'auto')
   }</span>`:'';
  return `<div class="binding-field" data-binding-field="${key}">
   <label class="binding-field-label" for="f-bind-${key}">
    <span>${label}</span>
    <div class="binding-badges-wrap">
     ${quickBadge}
     ${badgeText?`<span class="target-element-badge">${badgeText}</span>`:''}
    </div>
   </label>
   <div class="binding-dropdown-wrap ${hasDropdown?'has-dropdown':''}">
    <div class="binding-input-wrap ${isErr?'is-invalid':''}">
     <span class="binding-input-icon">${iconChar}</span>
     <input id="f-bind-${key}" class="binding-input" data-bind-key="${key}" type="text" value="${esc(val)}" placeholder="Ejemplo: ${esc(ph)}" spellcheck="false" autocomplete="off">
     <button type="button" class="binding-clear-btn ${val?'is-visible':''}" data-action="clear-bind-field" data-field="${key}" title="Borrar selección" aria-label="Borrar selección">${icon('eraser',13)}</button>
     ${hasDropdown?`<button type="button" class="binding-dropdown-toggle" data-action="toggle-bind-dropdown" data-field="${key}" title="Ver todas las opciones" aria-label="Ver todas las opciones" aria-expanded="false">${icon('chevronDown',12)}</button>`:''}
     <span class="binding-input-status ${statusCl}" id="status-icon-${key}">${statusIcon}</span>
    </div>
    ${hasDropdown?`<div class="binding-dropdown-menu" id="dropdown-menu-${key}" role="listbox" aria-label="Opciones para ${esc(label)}"></div>`:''}
   </div>
   <small class="binding-field-help ${isErr?'error':''} ${helpText||isErr?'':'is-hidden'}" id="help-${key}" data-default-help="${esc(helpText||'')}" ${helpText||isErr?'':'style="display:none;"'}>${isErr?'Este campo es obligatorio para la tarjeta actual':(helpText||'')}</small>
  </div>`;
 };

 let fieldsHTML=`<div class="binding-fields-column"><div class="binding-fields-card">`;
 fieldsHTML+=`
  <div class="binding-section-head"><span>fx</span>Medida principal y salida<small>Obligatorio</small></div>
  ${fieldMarkup('measure','Medida de negocio (existente)','fx','','Valor principal')}
  ${fieldMarkup('measureName','Nombre de la medida DAX resultante','T','','Título')}`;

 if(needsDate(c)){
  fieldsHTML+=`
   <div class="binding-section-divider"></div>
   <div class="binding-section-head"><span>📅</span>Calendario y fechas<small>Requerido por tendencia / comparativa</small></div>
   ${fieldMarkup('dateTable','Tabla de fechas / Calendario','田','','Evolución')}
   ${fieldMarkup('dateColumn','Columna de fecha única','▦','','Período')}
   ${needsTrend(c)?select('granularity','Granularidad de tendencia',[['auto','Automática'],['day','Diaria'],['week','Semanal'],['month','Mensual']],'Auto: ≤31 días → diaria; ≤120 → semanal; resto → mensual.'):''}`;
 }

 if(needsGoal(c)||(needsCompare(c)&&c.comparison==='target')){
  fieldsHTML+=`
   <div class="binding-section-divider"></div>
   <div class="binding-section-head"><span>🎯</span>Objetivo comercial<small>Requerido</small></div>
   ${fieldMarkup('targetMeasure','Medida de objetivo','fx','','Progreso')}`;
 }

 if(needsCompare(c)&&c.comparison==='custom'){
  fieldsHTML+=`
   <div class="binding-section-divider"></div>
   <div class="binding-section-head"><span>↔</span>Comparativa personalizada<small>Requerido</small></div>
   ${fieldMarkup('compareMeasure','Medida de comparación','fx','','Variación')}`;
 }
 const activeDupIds=Object.keys(c.elements||{}).filter(id=>{
  const def=resolveElementDef(id);
  const st=elementState(c,id);
  if(!def?.isDuplicate||st.deleted||st.hidden)return false;
  if(def.baseId==='value')return true;
  if(def.baseId==='delta')return (st.comparison||c.comparison)==='custom';
  if(['goalLabel','progressLabel','progress'].includes(def.baseId))return needsGoal(c)||(st.comparison||c.comparison)==='target';
  return false;
 });
 if(activeDupIds.length){
  fieldsHTML+=`
   <div class="binding-section-divider"></div>
   <div class="binding-section-head"><span>📑</span>Elementos duplicados vinculables<small>${activeDupIds.length} activo${activeDupIds.length>1?'s':''}</small></div>`;
  for(const dupId of activeDupIds){
   const def=resolveElementDef(dupId);
   const st=elementState(c,dupId);
   let label=def.label;
   let prop='measure';
   let ph='Medida o valor';
   let val='';
   let iconChar='fx';
   if(def.baseId==='value'){
    prop='measure';
    label=`Medida de ${def.label}`;
    ph=pbipModel?.measures?.[0]?.name||'Medida numérica';
    val=st.measure||'';
    iconChar='fx';
   }else if(def.baseId==='delta'){
    prop='compareMeasure';
    label=`Comparación de ${def.label}`;
    ph=pbipModel?.measures?.[0]?.name||'Medida de comparación';
    val=st.compareMeasure||'';
    iconChar='fx';
   }else if(['goalLabel','progressLabel','progress'].includes(def.baseId)){
    prop='targetMeasure';
    label=`Objetivo de ${def.label}`;
    ph='[Objetivo] o número';
    val=st.targetMeasure||'';
    iconChar='🎯';
   }else if(def.baseId==='icon'){
    prop='icon';
    label=`Icono de ${def.label}`;
    ph=st.icon||c.icon||'icono';
    val=st.icon||'';
    iconChar='★';
   }else{
    prop='text';
    label=`Texto de ${def.label}`;
    ph=def.label;
    val=st.text!==undefined?st.text:'';
    iconChar='T';
   }
   const hasDropdown=Boolean(pbipModel&&['measure','compareMeasure','targetMeasure'].includes(prop));
   const quickBadge=pbipModel&&hasDropdown?`<span class="pbip-quick-chip" title="Autocompletado activo">${pbipModel.measures.length} medidas</span>`:'';
   fieldsHTML+=`
    <div class="binding-field" data-binding-field="${dupId}">
     <label class="binding-field-label" for="f-bind-${dupId}">
      <span>${label}</span>
      <div class="binding-badges-wrap">
       ${quickBadge}
       <span class="target-element-badge">Copia independiente</span>
      </div>
     </label>
     <div class="binding-dropdown-wrap ${hasDropdown?'has-dropdown':''}">
      <div class="binding-input-wrap">
       <span class="binding-input-icon">${iconChar}</span>
       <input id="f-bind-${dupId}" class="binding-input" data-bind-dup="${dupId}" data-bind-dupprop="${prop}" type="text" value="${esc(val)}" placeholder="Ejemplo: ${esc(ph)}" spellcheck="false" autocomplete="off" ${hasDropdown?'list="dl-pbip-measures"':''}>
       <button type="button" class="binding-clear-btn ${val?'is-visible':''}" data-action="clear-bind-dup" data-dup="${dupId}" data-prop="${prop}" title="Borrar selección" aria-label="Borrar selección">${icon('eraser',13)}</button>
       ${hasDropdown?`<button type="button" class="binding-dropdown-toggle" data-action="toggle-bind-dropdown" data-field="${dupId}" title="Ver todas las opciones" aria-label="Ver todas las opciones" aria-expanded="false">${icon('chevronDown',12)}</button>`:''}
       <span class="binding-input-status ${val?'valid':'optional'}">${icon(val?'check':'info',val?14:13)}</span>
      </div>
      ${hasDropdown?`<div class="binding-dropdown-menu" id="dropdown-menu-${dupId}" role="listbox" aria-label="Opciones para ${esc(label)}"></div>`:''}
     </div>
    </div>`;
  }
 }
 fieldsHTML+=`</div></div>`;

 const previewHTML=`<div class="binding-preview-column">
  <div class="binding-preview-header">
   <span>MAPEO VISUAL</span>
   <span class="binding-preview-badge">Tarjeta interactiva</span>
  </div>
  <div class="binding-card-wrap">
   <div class="binding-card-inner" id="binding-card-inner" style="width:${c.width}px">
    ${cardHTML(c,undefined,true)}
   </div>
  </div>
  <div class="binding-preview-hint">
   ${icon('cursor',13)}
   <span>Haz clic en un elemento de la tarjeta para enfocar su campo, o sitúa el cursor sobre un campo para resaltar su elemento visual.</span>
  </div>
 </div>`;

 const body=`<div class="binding-modal-wrapper">${pbipCardHTML}<div class="binding-studio">${previewHTML}${fieldsHTML}</div>${datalistsHTML}</div>`;
 const errors=checks(c).filter(x=>x.level==='error');
 const statusHTML=`<div class="binding-status-bar ${errors.length?'has-error':''}" id="binding-modal-status">
  ${icon(errors.length?'info':'check',15)}
  <span>${errors.length?`${errors.length} campo${errors.length>1?'s':''} pendiente${errors.length>1?'s':''} de configurar`:'Configuración completa · Lista para exportar DAX'}</span>
 </div>`;

 const actionsFooter=`<div class="binding-modal-actions">${btn('export','Generar medida DAX','code','button secondary','title="Exportar DAX"')}${btn('close-modal','Listo','check','button primary')}</div>`;
 openModal('Conectar datos del modelo','',body,`${statusHTML}${actionsFooter}`,'binding-modal');

 fitBindingCard();

 if(focusKey){
  const targetInput=document.getElementById(`f-bind-${focusKey}`);
  if(targetInput)setTimeout(()=>{targetInput.focus();if(targetInput.select)targetInput.select();},50);
 }
}

function cardDimensionsPanel(){return `<div class="field-row">${field('width','Ancho · px','number',{min:200,max:800})}${field('height','Alto · px','number',{min:200,max:650})}</div><p class="geometry-note">Mínimo 200 × 200 px. Los elementos visuales escalables se adaptan proporcionalmente al tamaño de la tarjeta.</p>`;}
function layoutPanel(){return `<div class="field"><label>Distribución</label><div class="layout-options">${[['stacked','Vertical'],['chart-left','Gráfico izq.'],['chart-right','Gráfico der.']].filter(([id])=>id==='stacked'||elementAvailable(c,'trend')).map(([id,label])=>`<button data-layout="${id}" class="${c.layout===id?'active':''}" aria-pressed="${c.layout===id}" title="Aplicar distribución: ${label}"><span class="layout-mini ${id}"><i></i><b></b></span>${label}</button>`).join('')}</div><small>Aplicar una distribución recoloca los elementos. Puedes deshacerlo.</small></div>`;}
function chartPanel(){
 const pro=mode!=='essential',adv=mode==='advanced';
 let h=select('chartKind','Visual',[['trend','Tendencia'],['donut','Donut · avance del objetivo']]);
 if(c.chartKind==='donut')return h+(tab==='style'&&pro?range('trendHeight','Altura del gráfico',24,240):'')+field('targetMeasure','Medida objetivo')+range('donutThickness','Grosor del anillo',4,28)+check('donutLabel','Mostrar porcentaje central')+'<p class="field-help">Valor / objetivo positivo. El anillo se limita a 100 %; la etiqueta muestra el avance real.</p>';
 h+=select('trendStyle','Representación',[['area','Línea con área'],['line','Solo línea'],['bars','Barras']]);
 if(c.trendStyle!=='bars')h+=select('trendCurve','Trazado',[['smooth','Suave'],['linear','Recto'],['step','Escalonado']]);
 if(c.trendStyle==='area')h+=select('areaFill','Relleno del área',[['gradient','Degradado suave'],['solid','Uniforme']])+(pro?percentRange('fillOpacity','Intensidad del área'):'');
 if(pro)h+=(tab==='style'?range('trendHeight','Altura del gráfico',24,240):'')+check('showMax','Máximo y etiqueta')+check('showMin','Mínimo y etiqueta')+check('showDot','Destacar último punto');
 if(adv)h+=range('lineWidth','Grosor del trazo',1,6,'px',.2)+select('trendGrid','Guías de fondo',[['none','Sin guías'],['horizontal','Líneas sutiles'],['dots','Líneas de puntos']])+check('showMarkerGuides','Guías en máximo y mínimo')+check('zeroBase','Incluir cero en la escala');
 return h+(pro?'<p class="geometry-note">Las etiquetas necesitan al menos 100 × 56 px. En gráficos pequeños se conservan los puntos.</p>':'');
}
function cardInspector(){return `<div class="selected-object-heading"><span>${icon('square',20)}</span><div><strong>Tarjeta</strong><small>Lienzo de tamaño fijo</small></div>${ib('deselect','Deseleccionar','close')}</div>`+section('01','Tamaño del lienzo',cardDimensionsPanel())+section('02','Distribución',layoutPanel())+section('03','Superficie y efectos',surfaceInspector(),false);}
function selectCard(){if(context)return;rememberInspector();selectedElement=null;cardSelected=true;tab='card';inspectorPositions.set('card',0);renderInspector();renderCanvasBar();positionSelection();renderGuides();const node=$('#main-card');node?.setAttribute('tabindex','0');node?.setAttribute('aria-label','Tarjeta. Usa las asas para cambiar ancho y alto.');node?.focus({preventScroll:true});}
function startCardGesture(e,kind){const node=$('#main-card'),fit=$('#card-fit');gesture={card:true,kind,startX:e.clientX,startY:e.clientY,start:structuredClone(c),scale:node.getBoundingClientRect().width/c.width,anchor:fit.getBoundingClientRect(),changed:false,pointer:e.pointerId,undoSnapshot:[...undo],redo:[...redo]};app.setPointerCapture(e.pointerId);e.preventDefault();}
function syncCardControls(){for(const key of ['width','height'])app.querySelectorAll(`[data-key="${key}"]`).forEach(input=>{if(document.activeElement!==input)input.value=c[key];});const node=$('#dimensions');if(node)node.innerHTML=`${icon('square',13)} ${c.width} × ${c.height} px`;}
function commitNumber(input){
 const key=input.dataset.key,prop=input.dataset.elprop;const previous=key?c[key]:elementState(c,selectedElement)[prop];
 if(input.value.trim()===''||!Number.isFinite(Number(input.value))){input.value=previous;return;}
 const value=Number(input.value);let next;
 if(key==='width'||key==='height')next=resizeCard(c,key==='width'?value:c.width,key==='height'?value:c.height);
 else if(key)next={...c,[key]:value};
 else {const state=elementState(c,selectedElement);next=['x','y'].includes(prop)?moveElement(c,selectedElement,prop==='x'?value-state.x:0,prop==='y'?value-state.y:0,1,measureElementFrame(selectedElement)):updateElement(c,selectedElement,{[prop]:value});}
 const safe=sanitizeConfig(next),resolved=key?safe[key]:elementState(safe,selectedElement)[prop];
 if(JSON.stringify(safe)!==JSON.stringify(c)){record();c=safe;persist();refreshCard();syncCardControls();updateHistoryButtons();}
 input.value=resolved;if(resolved!==value)toast(`Valor ajustado a ${resolved} px, dentro del rango permitido.`);
}
function reportOverflow(){
 const root=$('#main-card')?.firstElementChild,node=$('#dimensions');if(!root||!node)return;const box=root.getBoundingClientRect();
 const outside=[...root.querySelectorAll('[data-element]')].filter(el=>{if(!elementVisible(c,el.dataset.element))return false;const b=el.getBoundingClientRect();return b.left<box.left-1||b.top<box.top-1||b.right>box.right+1||b.bottom>box.bottom+1;});
 node.innerHTML=`${icon('square',13)} ${c.width} × ${c.height} px${outside.length?` <button class="overflow-hint" data-action="layers" title="${outside.map(el=>ELEMENTS[el.dataset.element].label).join(', ')}">${outside.length} fuera del lienzo · Capas</button>`:''}`;
}
function loadDesign(config,savedId=null){
 const prevDateTable=c?.dateTable;
 const prevDateColumn=c?.dateColumn;
 const prevDateCustomized=c?._dateCustomized;
 c=sanitizeConfig(config);
 if(!savedId){
  c._measureBound=false;
  c.measure='';
  if(!c.measureName||!c.measureName.trim()){
   const cleanTitle=(c.title||'Medida').replace(/[^\p{L}\p{N}_]/gu,'_').replace(/^_+|_+$/g,'')||'Medida';
   c.measureName=cleanTitle.startsWith('KPI_')?cleanTitle:`KPI_${cleanTitle}`;
  }
 }
 if(pbipModel){
  const modelDateTables=pbipModel.dateTables||[];
  const modelTableNames=(pbipModel.tables||[]).map(t=>t.toLowerCase());
  const prevFound=modelDateTables.find(dt=>dt.name.toLowerCase()===(prevDateTable||'').trim().toLowerCase())
   || modelTableNames.includes((prevDateTable||'').trim().toLowerCase());
  if(prevDateTable&&prevFound){
   c.dateTable=prevDateTable;
   c.dateColumn=prevDateColumn||c.dateColumn;
   c._dateCustomized=true;
  }else if(modelDateTables.length){
   const bestDt=modelDateTables.find(dt=>dt.isMarkedDateTable)||modelDateTables.find(dt=>dt.isLikelyCalendar)||modelDateTables[0];
   if(bestDt){
    c.dateTable=bestDt.name;
    c.dateColumn=bestDt.primaryDateColumn||bestDt.dateColumns?.[0]||c.dateColumn;
    c._dateCustomized=true;
   }
  }
 }else if(prevDateCustomized&&prevDateTable){
  c.dateTable=prevDateTable;
  c.dateColumn=prevDateColumn||c.dateColumn;
  c._dateCustomized=true;
 }
 baseline=structuredClone(c);
 editingSavedId=savedId;
 undo=[];redo=[];lastEdit=0;view='designer';context=false;zoom=100;selectedElement=null;cardSelected=false;
 if(['element','card'].includes(tab))tab='content';
 persist();
 render();
}
function saveCurrent(name){
 name=name.trim();if(!name){toast('Añade un nombre para el diseño.');return false;}
 const id=saved.some(s=>s.id===editingSavedId)?editingSavedId:crypto.randomUUID();
 const next=[{id,name,date:new Date().toISOString(),config:structuredClone(c)},...saved.filter(s=>s.id!==id)];
 try{localStorage.setItem('kpi-atelier-saved',JSON.stringify(next));}catch{toast('No se pudo guardar. Los cambios siguen abiertos; puedes exportar el JSON.');return false;}
 saved=next;editingSavedId=id;baseline=structuredClone(c);persist();showDirty();return true;
}
function requestNavigation(go){
 if(!dirty()){go();return;}
 pendingNavigation=go;
 const name=saved.find(s=>s.id===editingSavedId)?.name||c.title+' · Mi diseño';
 openModal('Tienes cambios sin guardar','Decide qué hacer antes de salir de esta tarjeta.',`<p class="field-help">Puedes guardar el diseño, descartar los cambios pendientes o seguir editándolo.</p><label class="save-label" for="guard-name">Nombre del diseño</label><input id="guard-name" class="save-input" maxlength="80" value="${esc(name)}">`,btn('close-modal','Seguir editando',null,'button secondary')+btn('guard-discard','Descartar y continuar',null,'button quiet')+btn('guard-save','Guardar y continuar','save','button primary'),'leave-modal');
 $('#modal').querySelector('[data-action="close-modal"].button')?.focus();
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-layout]');if(b)directChange(applyLayout(c,b.dataset.layout));});
app.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.type==='number'){e.preventDefault();commitNumber(e.target);e.target.blur();}});
document.addEventListener('keydown',e=>{
 if(!cardSelected||$('#modal').open||gesture||context||!e.target.closest?.('#stage,#canvas-edit-bar')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
 if(e.key==='Escape'){e.preventDefault();deselect();return;}
 const handle=e.target.closest('[data-card-resize]'),step=e.shiftKey?(moveStep===1?5:1):moveStep;
 if(handle&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();directChange(resizeCard(c,c.width+(['e','se'].includes(handle.dataset.cardResize)?(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0):0),c.height+(['s','se'].includes(handle.dataset.cardResize)?(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0):0),true));syncCardControls();app.querySelector(`[data-card-resize="${handle.dataset.cardResize}"]`)?.focus();}
});

window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
window.addEventListener('resize',()=>{requestAnimationFrame(()=>{fitThumbs();fitMain();});});
render();

async function initLivePbi(){
 if(typeof window==='undefined'||!window.location||typeof fetch!=='function')return;
 const USP=typeof URLSearchParams!=='undefined'?URLSearchParams:globalThis.URLSearchParams;
 if(!USP)return;
 const params=new USP(window.location.search||'');
 const server=params.get('server');
 const database=params.get('database');
 if(server){
  try{
   const catalog=await fetchLivePbiModel(server,database||'');
   setPbipModel(catalog,true);
   const appliedCal=(catalog.dateTables||[])[0];
   const calMsg=appliedCal?` · Calendario: ${appliedCal.name}[${appliedCal.primaryDateColumn||appliedCal.dateColumns[0]}]`:'';
   toast(`🟢 Power BI Desktop conectado en vivo (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha)${calMsg}.`);
   return;
  }catch(err){
   console.warn('No se pudo conectar a Power BI Desktop via URL:',err);
  }
 }
 try{
  const instances=await discoverLivePbi();
  if(instances&&instances.length===1){
   const first=instances[0];
   const catalog=await fetchLivePbiModel(first.server,first.database||'');
   setPbipModel(catalog,true);
   render();
  }
 }catch{}
}
initLivePbi();
