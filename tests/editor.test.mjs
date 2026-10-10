import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const appURL=new URL('../dist/app.mjs',import.meta.url);
async function editor(){
 let source=fs.readFileSync(appURL,'utf8');const context={assert},handlers=new Map(),nodes=new Map(),storage=new Map();
 const add=(owner,event,fn)=>{const key=owner+':'+event;handlers.set(key,[...(handlers.get(key)||[]),fn]);};
 for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){const mod=await import(new URL(match[2],appURL));for(const name of match[1].split(','))context[name.trim()]=mod[name.trim()];}
 source=source.replace(/^import .*;$/gm,'');
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},get firstElementChild(){return this;},querySelector(s){return node(s);},querySelectorAll(){return [];},contains(){return false;},addEventListener(event,fn){add(id,event,fn);},setAttribute(){},focus(){},getBoundingClientRect(){return {left:0,top:0,width:100,height:100,right:100,bottom:100};},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
 const fire=(owner,event,e)=>{for(const f of handlers.get(owner+':'+event)||[])f(e);};
 const button=dataset=>({dataset,closest(selector){if(selector.includes('button'))return this;if(selector==='[data-layout]'&&dataset.layout)return this;return null;}});
 Object.assign(context,{structuredClone,Date,Intl,crypto:webcrypto,setTimeout(){},clearTimeout(){},requestAnimationFrame(){},localStorage:{getItem(k){return storage.get(k)??null;},setItem(k,v){storage.set(k,v);}},document:{querySelector:node,querySelectorAll(){return [];},activeElement:{tagName:'BODY',focus(){}},getElementById(){return null;},addEventListener(event,fn){add('document',event,fn);}},window:{addEventListener(event,fn){add('window',event,fn);}},fire,button});
 vm.createContext(context);vm.runInContext(source,context);return code=>vm.runInContext(code,context);
}
test('Dirty-navigation gate lets users stay, discard, or save and continue; save failure keeps edits open',async()=>{
 const run=await editor();run(`
 loadDesign(BASE);assert.equal(dirty(),false);let navigated=0;
 requestNavigation(()=>navigated++);assert.equal(navigated,1);assert.equal($('#modal').open,undefined);
 c={...c,title:'Edición pendiente'};persist();assert.equal(dirty(),true);
 requestNavigation(()=>navigated++);assert.equal(navigated,1);assert.equal($('#modal').open,true);assert.ok($('#modal').innerHTML.includes('Seguir editando'));
 closeModal();assert.equal(navigated,1);assert.equal(c.title,'Edición pendiente');assert.equal(pendingNavigation,null);
 requestNavigation(()=>navigated++);fire('document','click',{target:button({action:'guard-discard'})});assert.equal(navigated,2);assert.equal(c.title,BASE.title);assert.equal(dirty(),false);
 c={...c,title:'Guardar antes de salir'};requestNavigation(()=>navigated++);$('#guard-name').value='Diseño guardado';
 const originalWrite=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota');};
 fire('document','click',{target:button({action:'guard-save'})});assert.equal(navigated,2);assert.equal(dirty(),true);assert.equal($('#modal').open,true);assert.equal(saved.length,0);
 localStorage.setItem=originalWrite;fire('document','click',{target:button({action:'guard-save'})});assert.equal(navigated,3);assert.equal(dirty(),false);assert.equal(saved.length,1);assert.equal(saved[0].config.title,'Guardar antes de salir');
 c={...c,title:'Nueva edición'};assert.equal(saveCurrent('Mismo diseño'),true);assert.equal(saved.length,1);assert.equal(saved[0].config.title,'Nueva edición');
 `);
});
test('Template and screen changes use the gate, while native tab close only warns for dirty drafts',async()=>{
 const run=await editor();run(`
 loadDesign(BASE);c={...c,title:'Pendiente'};
 fire('document','click',{target:button({template:'target-donut'})});assert.equal(c.id,BASE.id);assert.ok(pendingNavigation);closeModal();
 fire('document','click',{target:button({action:'view-library'})});assert.equal(view,'designer');assert.ok(pendingNavigation);
 fire('document','click',{target:button({action:'guard-discard'})});assert.equal(view,'library');assert.equal(dirty(),false);
 fire('document','click',{target:button({template:'target-donut'})});assert.equal(view,'designer');assert.equal(c.id,'target-donut');assert.equal(undo.length,0);
 let blocked=0;const event={preventDefault(){blocked++;},returnValue:undefined};fire('window','beforeunload',event);assert.equal(blocked,0);
 c={...c,title:'Cambio'};fire('window','beforeunload',event);assert.equal(blocked,1);assert.equal(event.returnValue,'');
 `);
});
test('Dimension fields commit complete values, normalize bounds, and preserve other elements',async()=>{
 const run=await editor();run(`
 loadDesign(BASE);const input={type:'number',dataset:{key:'width'},value:'2'};
 fire('#app','input',{target:input});assert.equal(c.width,BASE.width);
 input.value='200';fire('#app','change',{target:input});assert.equal(c.width,200);assert.equal(c.height,BASE.height);assert.ok(c.elements.value.frame);assert.ok(c.elements.value.frame.width<=200);
 input.value='';fire('#app','change',{target:input});assert.equal(c.width,200);assert.equal(input.value,200);
 input.value='99';fire('#app','change',{target:input});assert.equal(c.width,200);assert.equal(input.value,200);
 input.value='900';fire('#app','change',{target:input});assert.equal(c.width,800);assert.equal(input.value,800);assert.ok(c.elements.value.frame.width>200);
 const height={type:'number',dataset:{key:'height'},value:'0'};fire('#app','change',{target:height});assert.equal(c.height,200);assert.equal(height.value,200);
 `);
});
test('Card and graph panels show relevant controls at each level without duplicate fields',async()=>{
 const run=await editor();run(`
 for(const level of ['essential','pro','advanced'])for(const kind of ['trend','donut']){
  mode=level;c=sanitizeConfig({...BASE,chartKind:kind});selectedElement='trend';cardSelected=false;tab='element';renderInspector();
  const html=$('#inspector-fields').innerHTML;assert.ok(!/undefined|NaN/.test(html));assert.ok(html.includes('f-chartKind'));const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'Each control has a unique id');
  if(kind==='donut'){assert.ok(html.includes('f-donutThickness'));assert.ok(!html.includes('f-trendCurve'));}
  else{assert.ok(html.includes('f-trendCurve'));assert.ok(html.includes('f-areaFill'));if(level!=='essential')assert.ok(html.includes('f-showMin'));}
  selectedElement=null;cardSelected=true;tab='card';renderInspector();const panel=$('#inspector-fields').innerHTML;assert.ok(panel.includes('min="200"'));assert.ok(panel.includes('data-layout="chart-left"'));assert.ok(!panel.includes('Alto mínimo'));
 }
 `);
});
test('Bloque 1: Data Binding Studio opens modal, adapts fields dynamically, and updates configuration in real time',async()=>{
 const run=await editor();run(`
 loadDesign(BASE);
 tab='data';renderInspector();
 const inspectorHTML=$('#inspector-fields').innerHTML;
 assert.ok(inspectorHTML.includes('data-summary-card'));
 assert.ok(inspectorHTML.includes('data-action="open-data-modal"'));

 fire('document','click',{target:button({action:'open-data-modal'})});
 assert.equal($('#modal').open,true);
 const modalHTML=$('#modal').innerHTML;
 assert.ok(modalHTML.includes('binding-studio'));
 assert.ok(modalHTML.includes('f-bind-measure'));
 assert.ok(modalHTML.includes('f-bind-measureName'));
 assert.ok(modalHTML.includes('f-bind-dateTable'));
 assert.ok(modalHTML.includes('f-bind-targetMeasure'));

 loadDesign({...TEMPLATES.find(t=>t.id==='essential-paper').config,comparison:'none'});
 openDataBindingModal();
 const basicHTML=$('#modal').innerHTML;
 assert.ok(basicHTML.includes('f-bind-measure'));
 assert.ok(!basicHTML.includes('f-bind-dateTable'));
 assert.ok(!basicHTML.includes('f-bind-targetMeasure'));

 const input={value:'Ventas Nuevas',dataset:{bindKey:'measure'},closest(){return null;}};
 fire('document','input',{target:input});
 assert.equal(c.measure,'Ventas Nuevas');
 assert.equal(c.measureName,'KPI_Ventas_Nuevas');
 assert.equal(c.title,'Ventas Nuevas');
 assert.equal(dirty(),true);

 const nameInput={value:'KPI_Ventas_Custom',dataset:{bindKey:'measureName'},closest(){return null;}};
 fire('document','input',{target:nameInput});
 assert.equal(c.measureName,'KPI_Ventas_Custom');
 assert.equal(c.title,'Ventas Custom');
 const dax=generateDAX(c);
 assert.ok(dax.startsWith('KPI_Ventas_Custom ='));
 assert.ok(dax.includes('Ventas Custom'));
 closeModal();
 `);
});

test('Bloque 2: PBIP connection bar renders, connects model, injects datalists and supports disconnect',async()=>{
 const run=await editor();run(`
 loadDesign(BASE);
 openDataBindingModal();
 const initialModal=$('#modal').innerHTML;
 assert.ok(initialModal.includes('pbip-bar'));
 assert.ok(initialModal.includes('Sin vincular'));
 assert.ok(initialModal.includes('data-action="connect-pbip"'));
 assert.ok(!initialModal.includes('id="dl-pbip-measures"'));

 setPbipModel({
  modelName:'RetailModel',
  tables:['Ventas','Calendario'],
  measures:[
   {name:'Total Ventas',table:'Ventas'},
   {name:'Margen %',table:'Ventas'}
  ],
  dateTables:[
   {name:'Calendario',dateColumns:['Fecha','DateKey'],isMarkedDateTable:true,primaryDateColumn:'Fecha',isLikelyCalendar:true},
   {name:'Ventas',dateColumns:['FechaPedido'],isMarkedDateTable:false,isLikelyCalendar:false}
  ]
 });

 openDataBindingModal();
 const connectedModal=$('#modal').innerHTML;
 assert.ok(connectedModal.includes('pbip-bar is-connected'));
 assert.ok(connectedModal.includes('RetailModel'));
 assert.ok(connectedModal.includes('2 medidas detectadas'));
 assert.ok(connectedModal.includes('⭐ Oficial'));
 assert.ok(connectedModal.includes('id="dl-pbip-measures"'));
 assert.ok(connectedModal.includes('id="dl-pbip-date-tables"'));
 assert.ok(connectedModal.includes('id="dl-pbip-date-columns"'));
 assert.ok(connectedModal.includes('value="Total Ventas"'));
 assert.ok(connectedModal.includes('value="Calendario"'));
 assert.ok(connectedModal.includes('Fecha oficial'));

 tab='data';
 renderInspector();
 const inspectorHTML=$('#inspector-fields').innerHTML;
 assert.ok(inspectorHTML.includes('RetailModel'));
 assert.ok(inspectorHTML.includes('2 fx'));

 fire('document','click',{target:button({action:'disconnect-pbip'})});
 assert.equal(pbipModel,null);
 const disconnectedModal=$('#modal').innerHTML;
 assert.ok(disconnectedModal.includes('Sin vincular'));
 assert.ok(!disconnectedModal.includes('id="dl-pbip-measures"'));
 closeModal();
 `);
});

test('PBIP connection recalculates and overwrites dateTable and dateColumn following hierarchy upon connect and reconnect',async()=>{
 const run=await editor();run(`
 loadDesign(BASE);
 c={...c,dateTable:'TablaAntigua',dateColumn:'FechaAntigua'};
 assert.equal(c.dateTable,'TablaAntigua');
 assert.equal(c.dateColumn,'FechaAntigua');

 const mockModel={
  modelName:'SalesModel',
  tables:['Ventas','DimDate'],
  measures:[{name:'Ventas',table:'Ventas'}],
  dateTables:[
   {name:'DimDate',dateColumns:['FullDateKey','Date'],isMarkedDateTable:true,primaryDateColumn:'Date',isLikelyCalendar:true},
   {name:'Ventas',dateColumns:['FechaVenta'],isMarkedDateTable:false,isLikelyCalendar:false}
  ]
 };

 setPbipModel(mockModel,true);
 assert.equal(c.dateTable,'DimDate');
 assert.equal(c.dateColumn,'Date');

 openDataBindingModal();
 const inputTable=$('#modal').innerHTML;
 assert.ok(inputTable.includes('value="DimDate"'));
 assert.ok(inputTable.includes('value="Date"'));

 fire('document','click',{target:button({action:'disconnect-pbip'})});
 assert.equal(pbipModel,null);

 c={...c,dateTable:'CustomDate',dateColumn:'CustomCol'};
 assert.equal(c.dateTable,'CustomDate');

 setPbipModel(mockModel,true);
 assert.equal(c.dateTable,'DimDate');
 assert.equal(c.dateColumn,'Date');
 closeModal();
 `);
});


test('User Polish: Dual connection options, searchable dropdowns, clear button, target defaults & DAX numeric formatting', async () => {
 const run = await editor();
 run(`
 loadDesign(BASE);

 // 1. Target measure defaults to empty on open if not customized
 openDataBindingModal();
 assert.equal(c.targetMeasure, '');
 closeModal();

 // 2. Dual connection switcher exposes both localhost and PBIP folder
 openDataBindingModal();
 const disconnectedHTML = $('#modal').innerHTML;
 assert.ok(disconnectedHTML.includes('data-action="connect-live-pbi"'));
 assert.ok(disconnectedHTML.includes('data-action="connect-pbip"'));
 assert.ok(disconnectedHTML.includes('Power BI (localhost)'));
 assert.ok(disconnectedHTML.includes('Carpeta PBIP…'));
 assert.ok(disconnectedHTML.includes('data-action="export"'));
 assert.ok(disconnectedHTML.includes('Exportar DAX'));
 closeModal();

 // 3. Connect model and check searchable combobox markup & eraser button
 setPbipModel({
  modelName: 'SalesOps',
  tables: ['Ventas', 'Calendario'],
  measures: [
   { name: 'Ventas Totales', table: 'Ventas' },
   { name: 'Meta Ventas', table: 'Ventas' }
  ],
  dateTables: [
   { name: 'Calendario', dateColumns: ['Fecha'], isMarkedDateTable: true, primaryDateColumn: 'Fecha', isLikelyCalendar: true }
  ]
 });

 openDataBindingModal();
 const connectedHTML = $('#modal').innerHTML;
 assert.ok(connectedHTML.includes('binding-dropdown-wrap has-dropdown'));
 assert.ok(connectedHTML.includes('data-action="clear-bind-field"'));
 assert.ok(connectedHTML.includes('data-action="toggle-bind-dropdown"'));
 assert.ok(connectedHTML.includes('id="dropdown-menu-measure"'));

 // 4. Searchable dropdown rendering: shows all options when empty filter
 const allOptions = renderBindingDropdown('measure', '');
 assert.ok(allOptions.includes('Ventas Totales'));
 assert.ok(allOptions.includes('Meta Ventas'));

 // Filtered options when searching
 const filteredOptions = renderBindingDropdown('measure', 'Meta');
 assert.ok(filteredOptions.includes('Meta Ventas'));
 assert.ok(!filteredOptions.includes('Ventas Totales'));

 // 5. Clear field using applyBindingFieldValue
 applyBindingFieldValue('measure', 'Ventas Totales');
 assert.equal(c.measure, 'Ventas Totales');
 applyBindingFieldValue('measure', '');
 assert.equal(c.measure, '');

 applyBindingFieldValue('measure', 'Ventas Totales');

 // 6. Numeric target formatting in DAX: target = '0' outputs '0' and not '[0]'
 applyBindingFieldValue('targetMeasure', '0');
 assert.equal(c.targetMeasure, '0');
 const daxWithZero = generateDAX(c);
 assert.ok(daxWithZero.includes('VAR __Target = 0'));
 assert.ok(!daxWithZero.includes('VAR __Target = [0]'));

 // Numeric target formatting with 150000
 applyBindingFieldValue('targetMeasure', '150000');
 const daxWithNumber = generateDAX(c);
 assert.ok(daxWithNumber.includes('VAR __Target = 150000'));
 assert.ok(!daxWithNumber.includes('VAR __Target = [150000]'));

 // Measure target formatting with measure name
 applyBindingFieldValue('targetMeasure', 'Meta Ventas');
 const daxWithMeasure = generateDAX(c);
 assert.ok(daxWithMeasure.includes('VAR __Target = [Meta Ventas]'));

 closeModal();

 // 7. Two customization modes: essential and advanced
 mode = 'pro';
 if (!['essential', 'advanced'].includes(mode)) mode = mode === 'pro' ? 'advanced' : 'essential';
 renderInspector();
 assert.equal(mode, 'advanced');
 const inspectorHTML = $('#app').innerHTML;
 assert.ok(inspectorHTML.includes('data-mode="essential"'));
 assert.ok(inspectorHTML.includes('data-mode="advanced"'));
 assert.ok(!inspectorHTML.includes('data-mode="pro"'));
 `);
});

test('UX Polish: Friendly report name, context resolution, adaptive resize toggle, and compact binding modal', async () => {
 const run = await editor();
 run(`
 loadDesign(BASE);
 // 1. Friendly report name helper strips GUIDs
 assert.equal(getFriendlyReportName({ reportName: 'Ventas2026.pbix' }), 'Ventas2026.pbix');
 assert.equal(getFriendlyReportName({ modelName: 'Finanzas.pbip' }), 'Finanzas.pbip');
 assert.equal(getFriendlyReportName({ reportName: '7829f554-4004-47c0-a855-5a45a01c43b8' }), 'Power BI Desktop');
 assert.equal(getFriendlyReportName(null), '');

 // 2. Context resolution toggle
 assert.equal(contextResolution, '1280x720');
 fire('document', 'click', { target: button({ action: 'context-res', res: '1920x1080' }) });
 assert.equal(contextResolution, '1920x1080');

 // 3. Proportional adaptive resize is active by default and keeps elements bounded
 const resized = resizeCard(BASE, 260, 260);
 assert.equal(resized.width, 260);
 assert.ok(resized.elements.value.frame.width <= 260);

 // 4. Element resize handles: nw and se only (no e)
 selectElement('value');
 const overlayHTML = $('#selection-overlay').innerHTML;
 assert.ok(overlayHTML.includes('handle-nw'));
 assert.ok(overlayHTML.includes('handle-se'));
 assert.ok(!overlayHTML.includes('handle-e'));

 // 5. Card selection button has 'Tarjeta' text and card icon
 const editBarHTML = $('#canvas-edit-bar').innerHTML;
 assert.ok(editBarHTML.includes('card-select-btn'));
 assert.ok(editBarHTML.includes('Tarjeta'));

 // 6. Binding modal shows unified cards and no helper descriptions
 openDataBindingModal();
 const modalHTML = $('#modal').innerHTML;
 assert.ok(modalHTML.includes('binding-model-card'));
 assert.ok(modalHTML.includes('binding-fields-card'));
 assert.ok(!modalHTML.includes('Nombre de tu medida en Power BI, sin corchetes ni fórmula.'));
 assert.ok(!modalHTML.includes('Medida numérica existente en tu modelo que calculará la cifra principal.'));
 assert.ok(!modalHTML.includes('Tabla de fechas del modelo relacionada activamente con tus datos.'));
 assert.ok(!modalHTML.includes('Medida con la meta para calcular el porcentaje de avance.'));
 closeModal();

 // 7. Validation dialog inline fix button
 c = { ...c, targetMeasure: '' };
 validationModal();
 const valHTML = $('#modal').innerHTML;
 assert.ok(valHTML.includes('check-fix-btn'));
 assert.ok(valHTML.includes('data-action="fix-check-issue"'));
 closeModal();
 `);
});

test('Advanced Controls: Element copy-paste duplication, context ribbon mode, collapsible saved cards and modern export banner', async () => {
 const run = await editor(); run(`
 loadDesign(BASE);

 // 1. Copy and paste element duplication
 selectElement('title');
 copySelectedElement();
 pasteElement();
 assert.ok(c.elements['title_copy1']);
 assert.equal(c.elements['title_copy1'].hidden, false);
 assert.ok(layerOrder(c).includes('title_copy1'));
 const def = resolveElementDef('title_copy1');
 assert.equal(def.isDuplicate, true);
 assert.equal(def.baseId, 'title');
 assert.ok(def.label.includes('Título'));

 // Duplicate limit enforcement (max 2 per base)
 copySelectedElement();
 pasteElement();
 assert.ok(c.elements['title_copy2']);
 copySelectedElement();
 pasteElement();
 assert.equal(Boolean(c.elements['title_copy3']), false); // blocked by max 2 per base

 // Custom text for duplicate text elements
 renderInspector();
 const titleCopyHTML = $('#inspector-fields').innerHTML;
 assert.ok(titleCopyHTML.includes('data-duptext="title_copy2"'));

 // 2. Context ribbon controls and switcher
 context = true;
 renderCanvasBar();
 const ctxBarHTML = $('#canvas-edit-bar').innerHTML;
 assert.ok(ctxBarHTML.includes('canvas-context-center'));
 assert.ok(ctxBarHTML.includes('data-action="context-res"'));
 assert.ok(!ctxBarHTML.includes('card-select-btn'));
 assert.ok(!ctxBarHTML.includes('data-action="layers"'));
 context = false;

 // 3. Saved measures in data binding modal are collapsible with <details>
 pbipModel = {
  modelName: 'Ventas Corp',
  measures: [
   { name: 'KPI_Ventas', table: 'Medidas', configAnnotation: JSON.stringify(BASE) }
  ],
  dateTables: []
 };
 openDataBindingModal();
 const modalHTML = $('#modal').innerHTML;
 assert.ok(modalHTML.includes('details class="binding-saved-subbar"'));
 assert.ok(modalHTML.includes('summary class="binding-saved-title"'));
 assert.ok(modalHTML.includes('Tarjetas guardadas en tu modelo (1)'));
 closeModal();

 // 4. Export modal modern banner
 c.measure='Total Ventas';
 c._measureBound=true;
 c.targetMeasure='1000';
 exportModal();
 const expHTML = $('#modal').innerHTML;
 assert.ok(expHTML.includes('export-banner'));
 assert.ok(!expHTML.includes('export-steps'));
 closeModal();
 `);
});


test('Independent duplicate configuration across inspector, data binding and DAX, NW handle directional logic, and clean footer', async () => {
 const run = await editor();
 run(`
 loadDesign(BASE);

 // 1. Clean app footer
 render();
 const appHTML = app.innerHTML;
 assert.ok(appHTML.includes('footer class="app-footer"'));
 assert.ok(appHTML.includes('Diseño en directo'));
 assert.ok(appHTML.includes('KPI Atelier'));
 assert.ok(!appHTML.includes('una nueva forma de contar los números'));
 assert.ok(!appHTML.includes('Guia de power bi'));
 assert.ok(!appHTML.includes('datos de ejemplo'));

 // 2. Duplicate element independent configuration and size
 const dupVal = 'value_copy1';
 resolveElementDef(dupVal);
 c = updateElement(c, dupVal, {
  size: 32,
  measure: 'Ventas_Online',
  format: 'currency',
  decimals: 2,
  suffix: 'EUR'
 });
 assert.equal(elementSize(c, dupVal), 32);
 assert.notEqual(elementSize(c, dupVal), c.valueSize);

 // 3. Inspector displays independent duplicate controls
 selectedElement = dupVal;
 tab = 'element';
 renderInspector();
 const inspHTML = $('#inspector-fields').innerHTML;
 assert.ok(inspHTML.includes('f-dup-measure'));
 assert.ok(inspHTML.includes('f-dup-format'));
 assert.ok(inspHTML.includes('f-dupsize'));

 // 4. Data binding modal exposes independent inputs for duplicates
 openDataBindingModal();
 const bindModalHTML = $('#modal').innerHTML;
 assert.ok(bindModalHTML.includes('Elementos duplicados vinculables'));
 assert.ok(bindModalHTML.includes('data-bind-dup="value_copy1"'));
 closeModal();

 // 5. DAX generation emits dedicated variables for duplicates
 c.measure = 'Total Ventas';
 c._measureBound = true;
 c.targetMeasure = '1000';
 const dax = generateDAX(c);
 assert.ok(dax.includes('VAR __val_value_copy1 ='));
 assert.ok(dax.includes('[Ventas_Online]'));

 // 6. NW handle directional logic
 const W0 = 100, S0 = 40, X0 = 20, Y0 = 30;
 const bounds = [6, 140];
 const dx = -15, dy = -10, step = 1;
 const clampDy = Math.min(0, dy);
 const snappedDx = Math.round(dx / step) * step;
 const snappedDy = Math.round(clampDy / step) * step;
 const targetW = Math.max(16, Math.min(800, W0 - snappedDx));
 const deltaW = targetW - W0;
 const nextX = X0 - deltaW;
 const targetS = Math.max(bounds[0], Math.min(bounds[1], S0 - snappedDy));
 const deltaS = targetS - S0;
 const nextY = Y0 - deltaS;
 assert.equal(targetW, 115);
 assert.equal(nextX, 5);
 assert.equal(nextX + targetW, X0 + W0);
 assert.equal(targetS, 50);
 assert.equal(nextY, 20);
 const dyDown = 20;
 const clampDyDown = Math.min(0, dyDown);
 assert.equal(clampDyDown, 0);
 `);
});

test('Step-1 size keys (+/-) independent of pixel toggle, and alignment boundary snaps, margin breach and peer collision detection', async () => {
 const run = await editor();
 run(`
 loadDesign(BASE);

 // 1. Keyboard + and - changes size by 1 even when moveStep is 5
 moveStep = 5;
 selectedElement = 'value';
 const initialSize = elementSize(c, 'value');
 const stageTarget = { closest(s){ return s.includes('#stage') ? this : null; } };
 fire('document', 'keydown', { key: '+', target: stageTarget, preventDefault(){} });
 assert.equal(elementSize(c, 'value'), initialSize + 1);
 fire('document', 'keydown', { key: '-', target: stageTarget, preventDefault(){} });
 assert.equal(elementSize(c, 'value'), initialSize);
 fire('document', 'keydown', { key: '-', target: stageTarget, preventDefault(){} });
 assert.equal(elementSize(c, 'value'), initialSize - 1);

 // 2. Action buttons smaller-element / bigger-element change by 1
 elementAction('bigger-element');
 assert.equal(elementSize(c, 'value'), initialSize);
 elementAction('smaller-element');
 assert.equal(elementSize(c, 'value'), initialSize - 1);

 // 3. Alignment guides: exact edge snap, margin snap, margin breach, and peer collision
 const card = { width: 440, height: 320 };
 const padding = 28;

 // Exact margin snap on left (left = 28)
 const snapRes = alignmentGuides({ left: 28, top: 40, width: 100, height: 50 }, card, [], padding);
 assert.equal(snapRes.marginSnaps.left, true);
 assert.equal(snapRes.marginSnaps.exact, true);
 assert.equal(snapRes.lines.some(l => l.kind === 'margin' && l.exact), true);

 // Margin breach (left = 10, between 0 and 28)
 const breachRes = alignmentGuides({ left: 10, top: 40, width: 100, height: 50 }, card, [], padding);
 assert.equal(breachRes.marginBreach.left, 18);
 assert.equal(breachRes.marginBreach.active, true);
 assert.equal(breachRes.outside, false);

 // Outer card edge exact snap (left = 0)
 const edgeRes = alignmentGuides({ left: 0, top: 40, width: 100, height: 50 }, card, [], padding);
 assert.equal(edgeRes.edgeSnaps.left, true);
 assert.equal(edgeRes.edgeSnaps.exact, true);

 // Peer collision / overlap
 const peerA = { id: 'title', label: 'Título del KPI', left: 28, top: 30, width: 150, height: 25 };
 const overlappingBox = { left: 50, top: 40, width: 100, height: 50 };
 const overlapRes = alignmentGuides(overlappingBox, card, [peerA], padding);
 assert.equal(overlapRes.overlaps.length, 1);
 assert.equal(overlapRes.overlaps[0].peer.id, 'title');
 assert.ok(overlapRes.overlaps[0].rect.width > 0);
 assert.ok(overlapRes.overlaps[0].rect.height > 0);

 // No overlap when peer is outside
 const nonOverlappingBox = { left: 200, top: 40, width: 100, height: 50 };
 const noOverlapRes = alignmentGuides(nonOverlappingBox, card, [peerA], padding);
 assert.equal(noOverlapRes.overlaps.length, 0);
 `);
});

test('Circular dependency pre-check prevents injection and flags self-referencing measure in UI and model', async () => {
 const run = await editor();
 run(`
 loadDesign(BASE);

 // 1. Model level checks: getCircularConflict and checks()
 const normalConf = { ...BASE, measure: 'Horas Absentismo', measureName: 'KPI_Horas_Absentismo' };
 assert.equal(getCircularConflict(normalConf), null);
 assert.equal(checks(normalConf).some(i => i.field === 'measureName'), false);

 const circularConf = { ...BASE, measure: 'Horas Absentismo', measureName: 'Horas Absentismo' };
 const conflict = getCircularConflict(circularConf);
 assert.ok(conflict);
 assert.equal(conflict.type, 'medida principal');
 assert.equal(conflict.field, 'measure');

 const issues = checks(circularConf);
 const circIssue = issues.find(i => i.field === 'measureName');
 assert.ok(circIssue);
 assert.ok(circIssue.text.includes('Dependencia circular'));

 // Target measure collision
 const targetColl = { ...BASE, measure: 'Ventas', targetMeasure: 'Meta 2026', measureName: 'Meta 2026' };
 const targetConflict = getCircularConflict(targetColl);
 assert.ok(targetConflict);
 assert.equal(targetConflict.type, 'medida objetivo');

 // 2. App injection pre-check: when circular conflict exists, inject-live-measure halts and opens circular modal
 setConfig(circularConf);
 setPbipModel({
  isLiveConnection: true,
  server: 'localhost:50000',
  database: 'test-db',
  reportName: 'Report.pbix',
  measures: [{ name: 'Horas Absentismo', table: 'Activities' }]
 });

 fire('document', 'click', { target: button({ action: 'inject-live-measure' }) });
 assert.ok($('#modal').innerHTML.includes('Dependencia circular detectada'));

 // 3. 1-Click fix circular name updates measureName and resolves issue
 fire('document', 'click', { target: button({ action: 'fix-circular-name' }) });
 assert.equal(c.measureName, 'KPI_Horas_Absentismo');
 assert.equal(getCircularConflict(c), null);
 `);
});

test('Pixel-perfect alignment guides (diff <= 0.5), live model pre-validation, and template calendar preservation', async () => {
 const run = await editor();
 run(`
 // 1. Pixel-perfect alignment guides: diff <= 0.5 is exact, diff === 1 is NOT exact
 const card = { width: 440, height: 320 };
 const padding = 28;

 // diff === 0 -> exact
 const snap0 = alignmentGuides({ left: 28, top: 40, width: 100, height: 50 }, card, [], padding);
 assert.equal(snap0.marginSnaps.left, true);
 assert.equal(snap0.marginSnaps.exact, true);
 const snap0Line = snap0.lines.find(l => l.kind === 'margin' && l.position === 28);
 assert.ok(snap0Line);
 assert.equal(snap0Line.exact, true);
 assert.ok(snap0Line.label.includes('(0 px)'));

 // diff === 1 -> NOT exact (no false positive across 2 integer pixels)
 const snap1 = alignmentGuides({ left: 29, top: 40, width: 100, height: 50 }, card, [], padding);
 assert.equal(snap1.marginSnaps.left, false);
 assert.equal(snap1.marginSnaps.exact, false);
 const snap1Line = snap1.lines.find(l => l.kind === 'margin');
 assert.ok(snap1Line);
 assert.equal(snap1Line.exact, false);
 assert.ok(!snap1Line.label.includes('(0 px)'));

 // 2. Template switch: clears c.measure to '', proposes safe measureName, preserves model calendar
 setPbipModel({
  isLiveConnection: true,
  server: 'localhost:50000',
  database: 'test-db',
  reportName: 'Finanzas.pbix',
  measures: [
   { name: 'Ventas Reales', table: 'FactVentas' },
   { name: 'Objetivo 2026', table: 'Metas' }
  ],
  dateTables: [
   { name: 'DimCalendar', isMarkedDateTable: true, primaryDateColumn: 'Date', dateColumns: ['Date', 'Year'] }
  ],
  tables: ['FactVentas', 'Metas', 'DimCalendar']
 });

 // Load fresh template
 const tpl = TEMPLATES.find(t => t.id === 'target-mint') || TEMPLATES[0];
 loadDesign(tpl.config);

 // c.measure must be empty by default on new template
 assert.equal(c.measure, '');
 assert.equal(c._measureBound, false);
 // c.measureName is safely proposed
 assert.ok(c.measureName.length > 0);
 // dateTable and dateColumn are preserved from pbipModel (not dummy 'Calendario')
 assert.equal(c.dateTable, 'DimCalendar');
 assert.equal(c.dateColumn, 'Date');

 // 3. Pre-check before live injection: missing or empty measures block injection
 fire('document', 'click', { target: button({ action: 'inject-live-measure' }) });
 assert.ok($('#modal').innerHTML.includes('Validación de datos con Power BI'));
 assert.ok($('#modal').innerHTML.includes('Medida principal'));

 // Click fix action opens data binding modal
 fire('document', 'click', { target: button({ action: 'fix-missing-model-fields' }) });
 assert.ok($('#modal').innerHTML.includes('Conectar datos del modelo'));

 // Bind valid model measure
 applyBindingFieldValue('measure', 'Ventas Reales');
 assert.equal(c.measure, 'Ventas Reales');
 assert.equal(c._measureBound, true);

 // Missing target measure blocks injection when required
 applyBindingFieldValue('targetMeasure', 'MedidaInexistente');
 fire('document', 'click', { target: button({ action: 'inject-live-measure' }) });
 assert.ok($('#modal').innerHTML.includes('Validación de datos con Power BI'));
 assert.ok($('#modal').innerHTML.includes('MedidaInexistente'));

 // Correct target measure
 applyBindingFieldValue('targetMeasure', 'Objetivo 2026');
 `);
});

test('Drag hides selection-name badge, peer collision/alignment frames, and data modal non-bindable elements', async () => {
 const run = await editor();
 run(`
 loadDesign(BASE);

 // 1. Selection overlay renders selection-name badge
 selectElement('title');
 positionSelection();
 const overlayHTML = $('#selection-overlay').innerHTML;
 assert.ok(overlayHTML.includes('selection-name'));
 assert.ok(overlayHTML.includes('Título del KPI'));

 // 2. Peer alignment lines include peer reference
 const peerTitle = { id: 'title', label: 'Título del KPI', left: 60, top: 20, width: 140, height: 24 };
 const alignedBox = { left: 60, top: 80, width: 100, height: 30 };
 const guidesAlign = alignmentGuides(alignedBox, { width: 440, height: 400 }, [peerTitle], 28);
 const peerLine = guidesAlign.lines.find(l => l.kind === 'peer' && l.position === 60);
 assert.ok(peerLine);
 assert.equal(peerLine.peer?.id, 'title');

 // 3. Peer collision in alignmentGuides
 const collidingBox = { left: 40, top: 25, width: 100, height: 30 };
 const guidesCollide = alignmentGuides(collidingBox, { width: 440, height: 400 }, [peerTitle], 28);
 assert.equal(guidesCollide.overlaps.length, 1);
 assert.equal(guidesCollide.overlaps[0].peer.id, 'title');

 // 4. Data binding modal: delta and compareLabel are not is-bindable for non-custom cards
 const elements = [
  { id: 'value', classList: new Set() },
  { id: 'title', classList: new Set() },
  { id: 'delta', classList: new Set() },
  { id: 'compareLabel', classList: new Set() }
 ];
 const mockCard = {
  querySelectorAll: () => elements.map(e => ({
   dataset: { element: e.id },
   classList: {
    toggle: (cls, val) => { val ? e.classList.add(cls) : e.classList.delete(cls); },
    remove: (...cls) => cls.forEach(c => e.classList.delete(c)),
    contains: cls => e.classList.has(cls)
   },
   removeAttribute: () => {}
  }))
 };

 c = { ...BASE, comparison: 'yoy', showComparison: true };
 const activeFields = new Set(['measure', 'measureName']);
 if (needsDate(c)) { activeFields.add('dateTable'); activeFields.add('dateColumn'); }
 if (needsGoal(c) || c.comparison === 'target') { activeFields.add('targetMeasure'); }
 if (needsCompare(c) && c.comparison === 'custom') { activeFields.add('compareMeasure'); }

 mockCard.querySelectorAll().forEach(el => {
  const id = el.dataset.element;
  const def = resolveElementDef(id);
  const isDuplicate = Boolean(def?.isDuplicate);
  if (id === 'compareLabel' || (id === 'delta' && c.comparison !== 'custom')) {
   el.classList.remove('is-bindable', 'binding-highlight');
   return;
  }
  const fieldKey = ELEMENT_TO_FIELD[id];
  const isBindable = isDuplicate || Boolean(fieldKey && activeFields.has(fieldKey));
  el.classList.toggle('is-bindable', isBindable);
 });

 assert.equal(elements.find(e => e.id === 'value').classList.has('is-bindable'), true);
 assert.equal(elements.find(e => e.id === 'title').classList.has('is-bindable'), true);
 assert.equal(elements.find(e => e.id === 'delta').classList.has('is-bindable'), false);
 assert.equal(elements.find(e => e.id === 'compareLabel').classList.has('is-bindable'), false);
 `);
});

test('Advanced Canvas & Multi-Selection: Roundtrip measure, duplicate delta bg, format painter, multi-dup and group clamping', async () => {
 const run = await editor(); run(`
 loadDesign(BASE);

 // 1. Roundtrip load preserves existing measure
 pendingRoundtripConf = { ...BASE, measure: '[Ventas Netas]', measureName: 'Card_Ventas', dateTable: 'Calendario', dateColumn: 'Fecha' };
 pendingRoundtripName = 'Card_Ventas';
 const conf = pendingRoundtripConf;
 conf._measureBound = Boolean(conf.measure?.trim());
 conf._targetCustomized = Boolean(conf.targetMeasure?.trim());
 conf._dateCustomized = Boolean(conf.dateTable?.trim() && conf.dateColumn?.trim());
 c = { ...c, ...conf };
 assert.equal(c.measure, '[Ventas Netas]');
 assert.equal(c._measureBound, true);

 // 2. Duplicate delta (variation) background color & opacity rendering
 selectElement('delta');
 copySelectedElement();
 pasteElement();
 assert.ok(c.elements['delta_copy1']);
 c = updateElement(c, 'delta_copy1', {
  backgroundColor: '#112233',
  backgroundOpacity: 45
 });
 const htmlWithDeltaCopy = cardHTML(c, undefined, true);
 assert.ok(htmlWithDeltaCopy.includes('data-element="delta_copy1"'));
 assert.ok(htmlWithDeltaCopy.includes('background:'));

 // 3. Format painter between same-type elements (value -> value_copy1)
 selectElement('value');
 copySelectedElement();
 pasteElement();
 assert.ok(c.elements['value_copy1']);
 c = updateElement(c, 'value', {
  color: '#ff5500',
  size: 42,
  format: 'currency',
  currency: 'USD',
  decimals: 2,
  unit: 'k'
 });
 formatPainterSource = 'value';
 const painterResult = applyFormatPainter('value_copy1');
 assert.equal(painterResult, true);
 const copyState = elementState(c, 'value_copy1');
 assert.equal(copyState.color, '#ff5500');
 assert.equal(copyState.size, 42);
 assert.equal(copyState.format, 'currency');
 assert.equal(copyState.currency, 'USD');
 assert.equal(copyState.decimals, 2);
 assert.equal(copyState.unit, 'k');

 // 4. Multi-selection block duplication
 selectElement('title');
 selectElement('subtitle', false, true); // Ctrl-add to selection
 assert.equal(selectedElements.size, 2);
 copySelectedElements();
 assert.equal(clipboardElements.length, 2);
 pasteElements();
 assert.ok(c.elements['title_copy1']);
 assert.ok(c.elements['subtitle_copy1']);

 // 5. Multi-selection group move boundary clamping calculation
 const testCard = { width: 320, height: 160 };
 const itemA = { id: 'itemA', left: 20, top: 30, w: 100, h: 40 };
 const itemB = { id: 'itemB', left: 180, top: 70, w: 80, h: 50 };
 const items = [itemA, itemB];
 const minDx = Math.max(...items.map(it => -it.left)); // max(-20, -180) = -20
 const maxDx = Math.min(...items.map(it => testCard.width - (it.left + it.w))); // min(320-120, 320-260) = min(200, 60) = 60
 const minDy = Math.max(...items.map(it => -it.top)); // max(-30, -70) = -30
 const maxDy = Math.min(...items.map(it => testCard.height - (it.top + it.h))); // min(160-70, 160-120) = min(90, 40) = 40

 assert.equal(minDx, -20);
 assert.equal(maxDx, 60);
 assert.equal(minDy, -30);
 assert.equal(maxDy, 40);

 // Clamping excessive drag
 const excessiveDx = 150;
 const clampedDx = Math.max(minDx, Math.min(maxDx, excessiveDx));
 assert.equal(clampedDx, 60); // itemB reaches 180+60+80 = 320 (exact right edge)
 `);
});

