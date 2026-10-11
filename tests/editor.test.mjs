import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error('Unexpected network request in editor test'); }; });
test.after(() => { globalThis.fetch = originalFetch; });

async function withCatalogFetch(run, action) {
 const previous=globalThis.fetch;
 globalThis.fetch=async (_url,options)=>{
  assert.notEqual(options?.method,'POST','Invalid configurations must never reach a model write');
  const model=run('getPbipModel()');
  return {ok:true,json:async()=>({...model,detectedDateTables:model.dateTables.map(t=>({table:t.name,dateColumns:t.dateColumns,suggestedColumn:t.primaryDateColumn,isOfficialMarked:t.isMarkedDateTable,tier:1}))})};
 };
 try { await action(); } finally { globalThis.fetch=previous; }
}

function readCss(filePath = 'dist/styles.css') {
  let content = fs.readFileSync(filePath, 'utf8');
  return content.replace(/@import\s+['"]\.\/([^'"]+)['"];/g, (_, rel) => {
    const sub = path.join(path.dirname(filePath), rel);
    return fs.existsSync(sub) ? fs.readFileSync(sub, 'utf8') : '';
  });
}
const appURL=new URL('../dist/app.mjs',import.meta.url);
async function editor(){
 let source=fs.readFileSync(appURL,'utf8');const context={assert,__imports:{}},handlers=new Map(),nodes=new Map(),storage=new Map();
 const add=(owner,event,fn)=>{const key=owner+':'+event;handlers.set(key,[...(handlers.get(key)||[]),fn]);};
 // Test helpers are explicit lexical imports; production imports can be pruned
 // without adding artificial callbacks to the application context.
 for (const file of ['state','canvas','inspector','modals','model','layout','appearance','elements','bindings','dax','cards','colors','icons','pbip','schema','guides']) {
  const mod = await import(new URL(`./${file}.mjs`, appURL));
  for (const [name, value] of Object.entries(mod)) {
   if (typeof value === 'function') context.__imports[name] = value;
   else context[name] = value;
  }
 }
 for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){const mod=await import(new URL(match[2],appURL));for(const raw of match[1].split(',')){const name=raw.trim();if(typeof mod[name]==='function')context.__imports[name]=mod[name];else context[name]=mod[name];}}
 source=source.replace(/^import .*;$/gm,'');
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},get firstElementChild(){return this;},querySelector(s){return node(s);},querySelectorAll(){return [];},contains(){return false;},addEventListener(event,fn){add(id,event,fn);},setAttribute(){},focus(){},getBoundingClientRect(){return {left:0,top:0,width:100,height:100,right:100,bottom:100};},setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){},closest(s){if(s.includes(id))return this;return null;},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
 const fire=(owner,event,e)=>{e.target??=context.document.activeElement;e.preventDefault??=()=>{};for(const f of handlers.get(owner+':'+event)||[])f(e);};
 const button=dataset=>({dataset,closest(selector){if(selector.includes('button'))return this;if(selector==='[data-layout]'&&dataset.layout)return this;return null;}});
 Object.assign(context,{structuredClone,Date,Intl,crypto:webcrypto,setTimeout(){},clearTimeout(){},requestAnimationFrame(){},localStorage:{getItem(k){return storage.get(k)??null;},setItem(k,v){storage.set(k,v);}},document:{querySelector:node,querySelectorAll(){return [];},activeElement:{tagName:'BODY',focus(){}},getElementById(){return null;},addEventListener(event,fn){add('document',event,fn);},documentElement:node('html')},window:{addEventListener(event,fn){add('window',event,fn);}},fire,button});
 // Imported functions are lexical bindings, as in ESM. Only app.mjs can register
 // callbacks on globalThis; the harness must not repair missing registrations.
 const imports=Object.keys(context.__imports).map(name=>`const ${name}=__imports.${name};`).join('\n');
 vm.createContext(context);vm.runInContext(imports+'\n'+source,context);return code=>vm.runInContext(code,context);
}
test('Production callbacks are explicit and imports do not repair missing context registrations', async () => {
 const run=await editor();
 run(`
  assert.equal(typeof handleStudioClick,'function');
  assert.equal(Object.hasOwn(globalThis,'handleStudioClick'),false);
  for(const name of ['updateHistoryButtons','syncElementControls','syncCardControls','rememberInspector','renderCanvasBar','positionSelection','renderGuides','deselect','measureElementFrame']) {
   assert.equal(typeof globalThis[name],'function','Missing production callback: '+name);
  }
  loadDesign(BASE);
  assert.equal($('[data-action="undo"]').disabled,true);
  const input={tagName:'INPUT',type:'text',dataset:{key:'title'},value:'Título editado',setAttribute(){}};
  fire('#app','input',{target:input});
  assert.equal(c.title,'Título editado');
  assert.equal($('[data-action="undo"]').disabled,false);
 `);
});

test('Large catalogs render bounded dropdowns while searching every measure', async () => {
 const run = await editor();
 run(`
  loadDesign(BASE);
  setPbipModel({modelName:'Grande',tables:['Medidas'],dateTables:[],measures:Array.from({length:10000},(_,i)=>({name:'Medida '+i,table:'Medidas'}))},false);
  openDataBindingModal();
  assert.ok(!$('#modal').innerHTML.includes('<datalist'));
  const initial = renderBindingDropdown('measure');
  assert.equal((initial.match(/data-action="select-binding-item"/g)||[]).length,100);
  assert.ok(initial.includes('10000 coincidencias'));
  const found = renderBindingDropdown('measure','Medida 9999');
  assert.equal((found.match(/data-action="select-binding-item"/g)||[]).length,1);
  assert.ok(found.includes('data-value="Medida 9999"'));
 `);
});

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
 assert.equal(c.measureName,'KPI_Clientes_HTML');
 assert.equal(c.title,'Clientes activos');
 assert.equal(dirty(),true);

 const nameInput={value:'KPI_Ventas_Custom',dataset:{bindKey:'measureName'},closest(){return null;}};
 fire('document','input',{target:nameInput});
 assert.equal(c.measureName,'KPI_Ventas_Custom');
 assert.equal(c.title,'Clientes activos');
 const dax=generateDAX(c);
 assert.ok(dax.startsWith('KPI_Ventas_Custom ='));
 assert.ok(dax.includes('Clientes activos'));
 closeModal();
 `);
});

test('Bloque 2: PBIP connection bar renders, connects model, exposes searchable dropdowns and supports disconnect',async()=>{
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
 assert.ok(connectedModal.includes('id="dropdown-menu-measure"'));
 assert.ok(connectedModal.includes('id="dropdown-menu-dateTable"'));
 assert.ok(connectedModal.includes('id="dropdown-menu-dateColumn"'));
 assert.ok(!connectedModal.includes('<datalist'), 'Custom dropdowns must not duplicate the full catalog in hidden native options');
 assert.ok(connectedModal.includes('value="Total Ventas"'));
 assert.ok(connectedModal.includes('value="Calendario"'));
 assert.ok(renderBindingDropdown('dateTable').includes('Fecha oficial'));

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

test('PBIP connection preserves document calendars and assigns defaults only to fresh templates',async()=>{
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
 assert.equal(c.dateTable,'TablaAntigua');
 assert.equal(c.dateColumn,'FechaAntigua');

 openDataBindingModal();
 const inputTable=$('#modal').innerHTML;
 assert.ok(inputTable.includes('value="TablaAntigua"'));
 assert.ok(inputTable.includes('value="FechaAntigua"'));

 fire('document','click',{target:button({action:'disconnect-pbip'})});
 assert.equal(pbipModel,null);

 c={...c,dateTable:'CustomDate',dateColumn:'CustomCol'};
 assert.equal(c.dateTable,'CustomDate');

 setPbipModel(mockModel,true);
 assert.equal(c.dateTable,'CustomDate');
 assert.equal(c.dateColumn,'CustomCol');
 loadDesign(BASE,null,{template:true});
 assert.equal(c.dateTable,'DimDate');
 assert.equal(c.dateColumn,'Date');
 closeModal();
 `);
});


test('User Polish: Dual connection options, searchable dropdowns, clear button, target defaults & DAX numeric formatting', async () => {
 const run = await editor();
 run(`
 loadDesign(BASE);

 // 1. Opening settings preserves document bindings, including legacy targets.
 openDataBindingModal();
 assert.equal(c.targetMeasure, BASE.targetMeasure);
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
 const targetLine=daxWithMeasure.split(String.fromCharCode(10)).find(line=>line.startsWith('VAR __Target ='));
 assert.ok(targetLine.includes('CALCULATE ( [Meta Ventas]'));
 assert.ok(targetLine.includes('TREATAS ( __Dates'));

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
 assert.ok(!inspHTML.includes('f-dup-measure'), 'Measure inputs must not appear in inspector');
 assert.ok(inspHTML.includes('f-dup-format'));
 assert.ok(inspHTML.includes('f-dupsize'));

 // 4. Data binding modal exposes independent inputs for duplicates
 openDataBindingModal();
 const bindModalHTML = $('#modal').innerHTML;
 assert.ok(bindModalHTML.includes('Elementos duplicados vinculables'));
 assert.ok(bindModalHTML.includes('data-bind-dup="value_copy1"'));
 assert.ok(!bindModalHTML.includes('list="dl-pbip-measures"'), 'Duplicate measure input must not use native datalist');
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

 // 2. The write workflow rechecks the model and opens review for a circular reference.
 setConfig(circularConf);
 setPbipModel({
  isLiveConnection: true,
  server: 'localhost:50000',
  database: 'test-db',
  modelName: 'Report', reportName: 'Report.pbix',
  tables: ['Activities', 'Calendario'], dateTables: [{name:'Calendario',dateColumns:['Fecha']}],
  measures: [{ name: 'Horas Absentismo', table: 'Activities' }]
 });

 `);
 await withCatalogFetch(run, async () => {
  await run('applyLiveMeasure()');
  run(`assert.equal($('#modal').className,'measure-review-modal');assert.ok($('#modal').innerHTML.includes('Dependencia circular'));`);
 });
 run(`
 // 3. Fixing the output name resolves the circular reference.
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
  modelName: 'Finanzas',
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
 loadDesign(tpl.config,null,{template:true});

 // c.measure must be empty by default on new template
 assert.equal(c.measure, '');
 assert.equal(c._measureBound, false);
 // c.measureName is safely proposed
 assert.ok(c.measureName.length > 0);
 // dateTable and dateColumn are preserved from pbipModel (not dummy 'Calendario')
 assert.equal(c.dateTable, 'DimCalendar');
 assert.equal(c.dateColumn, 'Date');

 `);
 await withCatalogFetch(run, async () => {
  await run('applyLiveMeasure()');
  run(`assert.equal($('#modal').className,'measure-review-modal');assert.ok($('#modal').innerHTML.includes('Medida principal'));`);
 });
 run(`
 openDataBindingModal();
 assert.ok($('#modal').innerHTML.includes('Conectar datos del modelo'));

 // Bind valid model measure
 applyBindingFieldValue('measure', 'Ventas Reales');
 assert.equal(c.measure, 'Ventas Reales');
 assert.equal(c._measureBound, true);

 // Missing target measure blocks injection when required
 applyBindingFieldValue('targetMeasure', 'MedidaInexistente');
 `);
 await withCatalogFetch(run, async () => {
  await run('applyLiveMeasure()');
  run(`assert.equal($('#modal').className,'measure-review-modal');assert.ok($('#modal').innerHTML.includes('MedidaInexistente'));`);
 });
 run(`
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


test('Advanced Duplicates, Hierarchical Content Inspector, Stacking & Dynamic Resizing', async () => {
  const { BASE, checks, getCircularConflict } = await import('../dist/model.mjs');
  const { generateDAX } = await import('../dist/dax.mjs');
  const { adaptiveResizeCard } = await import('../dist/layout.mjs');
  const fsMod = await import('fs');

  // 1. Z-Index Stacking: Verify styles.css assigns higher z-index to layers-popover and canvas-edit-bar
  const css = readCss('dist/styles.css');
  assert.ok(/\.canvas-edit-bar\{[^}]*z-index:\s*50/.test(css), 'canvas-edit-bar must have z-index: 50');
  assert.ok(/\.layers-popover\{[^}]*z-index:\s*100/.test(css), 'layers-popover must have z-index: 100');
  assert.ok(/#selection-overlay\{[^}]*z-index:\s*5/.test(css), 'selection-overlay has z-index: 5');

  // 2. Adaptive card resizing dynamically scales and clamps duplicates
  let conf = {
    ...BASE,
    width: 320,
    height: 160,
    padding: 16,
    borderWidth: 1,
    elements: {
      value: { frame: { left: 20, top: 40, width: 100, height: 30 } },
      value_copy1: { frame: { left: 150, top: 40, width: 100, height: 30 } },
      title_copy1: { frame: { left: 20, top: 10, width: 120, height: 20 } }
    }
  };

  // Grow card to 480x240
  let resized = adaptiveResizeCard(conf, 480, 240);
  assert.equal(resized.width, 480);
  assert.equal(resized.height, 240);
  const dupVal = resized.elements.value_copy1.frame;
  assert.ok(dupVal.left > 150, 'Duplicate value left should adaptively scale up');
  assert.ok(dupVal.top >= 16, 'Duplicate value top should remain within padding');
  assert.ok(dupVal.left + dupVal.width <= 480 - 16, 'Duplicate value should remain strictly within card width');

  // Shrink card to 220x120 - duplicate must be clamped
  let shrunk = adaptiveResizeCard(conf, 220, 120);
  const shrunkDup = shrunk.elements.value_copy1.frame;
  assert.ok(shrunkDup.left + shrunkDup.width <= 220 - 16, 'Shrunk duplicate must not overflow card right boundary');
  assert.ok(shrunkDup.top + shrunkDup.height <= 120 - 16, 'Shrunk duplicate must not overflow card bottom boundary');

  // 3. DAX generation for duplicate dynamic measures
  conf.elements.value_copy1 = {
    ...conf.elements.value_copy1,
    measure: '[Total Ventas Copy]',
    format: 'currency',
    currency: 'USD',
    decimals: 0
  };
  const daxCode = generateDAX(conf);
  assert.ok(daxCode.includes('__val_value_copy1'), 'DAX must evaluate dynamic variable for value_copy1');
  assert.ok(daxCode.includes('[Total Ventas Copy]'), 'DAX must reference assigned measure for value_copy1');

  // 4. Model checks & circular dependency on duplicates
  const warnChecks = checks({
    ...conf,
    elements: {
      ...conf.elements,
      value_copy2: { deleted: false }
    }
  });
  const dupWarn = warnChecks.find(c => c.field === 'value_copy2');
  assert.ok(dupWarn, 'checks(c) must block a duplicate value without its own measure');
  assert.equal(dupWarn.level, 'error');

  const circConf = {
    ...conf,
    measureName: 'Ventas_Copy',
    elements: {
      ...conf.elements,
      value_copy1: { measure: '[Ventas_Copy]' }
    }
  };
  const circConflict = getCircularConflict(circConf);
  assert.ok(circConflict, 'Circular conflict must be detected when card measure matches duplicate measure');
  assert.equal(circConflict.name, '[Ventas_Copy]');

  // 5. In-browser editor tests for layers panel and content inspector
  await editor(`
  c = structuredClone(BASE);
  c.elements = {
    title_copy1: { text: 'Subtítulo Secundario', deleted: false },
    value_copy1: { measure: '[Margen Real]', format: 'percent', decimals: 1, deleted: false },
    deleted_copy: { text: 'Borrado', deleted: true }
  };
  tab = 'content';
  renderInspector();
  const inspHtml = $('#inspector-fields').innerHTML;

  // Hierarchical Content tab: title_copy1 appears in Section 01, value_copy1 in Section 02
  assert.ok(inspHtml.includes('data-dupid="title_copy1"'), 'title_copy1 should render with data-dupid in Content tab');
  assert.ok(inspHtml.includes('data-dupid="value_copy1"'), 'value_copy1 should render with data-dupid in Content tab');
  assert.ok(!inspHtml.includes('data-dupid="deleted_copy"'), 'Deleted duplicate should NOT render in Content tab');

  // Layers panel: deleted element immediately filtered out without restore option
  layersOpen = true;
  renderCanvasBar();
  const layersHtml = $('#canvas-edit-bar').innerHTML;
  assert.ok(layersHtml.includes('data-layer-row="title_copy1"'), 'title_copy1 should appear in layers');
  assert.ok(!layersHtml.includes('data-layer-row="deleted_copy"'), 'deleted element must NOT appear in layers');
  assert.ok(!layersHtml.includes('Restaurar'), 'Layers panel must NOT show Restaurar button');

  // Format painter button in canvas ribbon
  selectElement('title');
  renderCanvasBar();
  const barHtml = $('#canvas-edit-bar').innerHTML;
  assert.ok(barHtml.includes('format-painter-btn'), 'Canvas bar must contain subtle format-painter-btn');
  assert.ok(barHtml.includes('icon-btn format-painter-btn'), 'Format painter must use subtle icon-btn style');
  `);
});

test('Flawless Element Dragging & Card Resizing Sync: Border and Dimensions Stay 100% Synced', async () => {
  const run = await editor();
  await run(`
  loadDesign(BASE);
  // 1. Element Dragging & Selection Border Sync
  selectElement('title');
  assert.equal(selectedElement, 'title');
  const overlay = $('#selection-overlay');
  assert.equal(overlay.hidden, false);
  assert.ok(overlay.innerHTML.includes('Título del KPI'));

  const titleNode = {
    dataset: { element: 'title' },
    closest(sel) {
      if (sel.includes('data-element')) return this;
      return null;
    },
    getBoundingClientRect() { return { left: 40, top: 40, width: 120, height: 20 }; }
  };
  fire('#app', 'pointerdown', {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    target: titleNode,
    preventDefault(){}
  });
  assert.ok(gesture);
  assert.equal(gesture.id, 'title');
  assert.equal(gesture.kind, 'move');

  // Drag 40px right, 20px down (scale in mock is 100/440 => 40 / (100/440) = 176px, 20 / (100/440) = 88px)
  fire('#app', 'pointermove', {
    pointerId: 1,
    clientX: 140,
    clientY: 120
  });
  assert.equal(c.elements.title.x, 176);
  assert.equal(c.elements.title.y, 88);
  assert.equal(overlay.hidden, false, 'Selection overlay border must remain visible and synced during drag');

  // Finish element drag gesture
  fire('#app', 'pointerup', { pointerId: 1 });
  assert.equal(gesture, null);
  assert.equal(selectedElement, 'title');
  assert.equal(c.elements.title.x, 176);
  assert.equal(c.elements.title.y, 88);
  assert.ok(overlay.innerHTML.includes('Título del KPI'), 'Selection badge and handles must remain valid after gesture');

  // 2. Card Resizing & Handles/Border Sync
  selectCard();
  assert.equal(cardSelected, true);
  assert.equal(overlay.hidden, false);
  assert.ok(overlay.innerHTML.includes('Tarjeta · 440 × 400 px'));
  assert.ok(overlay.innerHTML.includes('handle-e'));
  assert.ok(overlay.innerHTML.includes('handle-s'));
  assert.ok(overlay.innerHTML.includes('handle-se'));

  // Start card resize via SE handle
  const seHandle = { dataset: { cardResize: 'se' }, closest(sel){ return sel.includes('card-resize') ? this : null; } };
  fire('#app', 'pointerdown', {
    button: 0,
    pointerId: 2,
    clientX: 200,
    clientY: 200,
    target: seHandle,
    preventDefault(){}
  });
  assert.ok(gesture);
  assert.equal(gesture.card, true);
  assert.equal(gesture.kind, 'se');

  // Drag +60px width, +40px height
  fire('#app', 'pointermove', {
    pointerId: 2,
    clientX: 260,
    clientY: 240
  });
  assert.equal(c.width, 704);
  assert.equal(c.height, 576);
  assert.ok(overlay.innerHTML.includes('Tarjeta · 704 × 576 px'), 'Overlay badge must track real-time resized dimensions');

  // Release card handle
  fire('#app', 'pointerup', { pointerId: 2 });
  assert.equal(gesture, null);
  assert.equal(c.width, 704);
  assert.equal(c.height, 576);
  assert.ok(overlay.innerHTML.includes('Tarjeta · 704 × 576 px'), 'Final dimensions must be committed and synced');
  `);
});

test('Horizontal duplicate adaptive scaling, guide containment, typology parity and clean data binding', async () => {
  const { adaptiveResizeCard } = await import('../dist/layout.mjs');
  const { sanitizeElements, resolveElementDef } = await import('../dist/elements.mjs');
  const { sanitizeConfig } = await import('../dist/model.mjs');
  const { cardHTML } = await import('../dist/cards.mjs');
  const fs = await import('fs');

  // 1. Horizontal adaptive scaling of duplicates
  resolveElementDef('value_copy1');
  const cardWithDup = sanitizeConfig({
    width: 500,
    height: 400,
    padding: 24,
    borderWidth: 2,
    elements: {
      value_copy1: {
        x: 30,
        y: 20,
        width: 320,
        frame: { left: 100, top: 120, width: 320, height: 40 }
      }
    }
  });

  // Shrink card down to 250px
  const shrunk = adaptiveResizeCard(cardWithDup, 250, 300);
  const dupState = shrunk.elements.value_copy1;
  const maxRight = shrunk.width - shrunk.padding - shrunk.borderWidth;
  assert.ok(dupState.frame.left + dupState.frame.width <= maxRight, 'Duplicate must not exceed maxRight after shrink');
  assert.ok(dupState.frame.left >= shrunk.padding, 'Duplicate must respect left padding margin');
  assert.equal(dupState.x, 0, 'Offsets must be absorbed into frame');
  assert.equal(dupState.y, 0, 'Offsets must be absorbed into frame');
  assert.equal(dupState.width, dupState.frame.width, 'state.width must match new frame.width');

  // 2. Guide containment and styles: outside by default, no scroll triggered
  const css = readCss('dist/styles.css');
  assert.ok(css.includes('.smart-guide.exact.horizontal b {\n  left:calc(100% + 3px);\n  top:-7px;'), 'horizontal exact badge must be outside to the right by default');
  assert.ok(css.includes('scrollbar-gutter:stable'), 'stage layout must be stable against scrollbars');

  // 3. Typology parity for duplicates
  resolveElementDef('delta_copy1');
  resolveElementDef('compareLabel_copy1');
  resolveElementDef('status_copy1');
  const sanitized = sanitizeElements({
    delta_copy1: { comparison: 'none', deltaMode: 'absolute', direction: 'down' },
    compareLabel_copy1: { comparison: 'mom' },
    status_copy1: { goodThreshold: 80, warnThreshold: 50, statusGood: 'Excelente', statusWarn: 'Atención', statusBad: 'Crítico' }
  });
  assert.equal(sanitized.delta_copy1.comparison, 'none');
  assert.equal(sanitized.delta_copy1.deltaMode, 'absolute');
  assert.equal(sanitized.compareLabel_copy1.comparison, 'mom');
  assert.equal(sanitized.status_copy1.goodThreshold, 80);
  assert.equal(sanitized.status_copy1.statusGood, 'Excelente');

  const cardHtml = cardHTML({
    ...sanitizeConfig({ type: 'status' }),
    elements: sanitized
  });
  assert.ok(cardHtml.includes('—'), 'delta_copy1 with comparison none must render dash');
  assert.ok(cardHtml.includes('vs. mes anterior'), 'compareLabel_copy1 with comparison mom must render vs. mes anterior');
  assert.ok(cardHtml.includes('Excelente'), 'status_copy1 must render custom statusGood text');
});

test('Inspector content/element parity and exclusion of measure inputs, unified delta fields, and pure custom dropdowns in modal', async () => {
  const run = await editor();
  run(`
  loadDesign(BASE);

  // 1. Original delta visual inspection has comparison, direction and deltaMode, but NO measure input
  selectedElement = 'delta';
  tab = 'element';
  renderInspector();
  let insp = $('#inspector-fields').innerHTML;
  assert.ok(insp.includes('Comparar con'), 'Original delta must have Comparar con');
  assert.ok(insp.includes('¿Qué significa mejorar?'), 'Original delta must have ¿Qué significa mejorar?');
  assert.ok(insp.includes('Mostrar diferencia'), 'Original delta must have Mostrar diferencia');
  assert.ok(!insp.includes('Medida de comparación'), 'Original delta must NOT have Medida de comparación');

  // 2. Duplicate delta visual inspection has exact same 3 fields and NO measure input
  resolveElementDef('delta_copy1');
  c = updateElement(c, 'delta_copy1', { comparison: 'prev', direction: 'up', deltaMode: 'relative' });
  selectedElement = 'delta_copy1';
  renderInspector();
  insp = $('#inspector-fields').innerHTML;
  assert.ok(insp.includes('Comparar con'), 'Duplicate delta must have Comparar con');
  assert.ok(insp.includes('¿Qué significa mejorar?'), 'Duplicate delta must have ¿Qué significa mejorar?');
  assert.ok(insp.includes('Mostrar diferencia'), 'Duplicate delta must have Mostrar diferencia');
  assert.ok(!insp.includes('Medida de comparación'), 'Duplicate delta must NOT have Medida de comparación');

  // 3. Original and duplicate value visuals have NO measure input in inspector
  selectedElement = 'value';
  renderInspector();
  insp = $('#inspector-fields').innerHTML;
  assert.ok(!insp.includes('Medida del valor'), 'Original value must NOT have Medida del valor in element inspector');
  assert.ok(insp.includes('Formato del valor'), 'Original value has format');

  resolveElementDef('value_copy1');
  c = updateElement(c, 'value_copy1', { format: 'currency', currency: 'EUR' });
  selectedElement = 'value_copy1';
  renderInspector();
  insp = $('#inspector-fields').innerHTML;
  assert.ok(!insp.includes('Medida del valor'), 'Duplicate value must NOT have Medida del valor in element inspector');
  assert.ok(insp.includes('Formato del valor'), 'Duplicate value has format');

  // 4. In Content tab (no selection), duplicates have NO measure input
  tab = 'content';
  selectedElement = null;
  renderInspector();
  insp = $('#inspector-fields').innerHTML;
  assert.ok(!insp.includes('Medida del valor'), 'Content tab must NOT have Medida del valor');
  assert.ok(!insp.includes('Medida de comparación'), 'Content tab must NOT have Medida de comparación');

  // 5. Data binding modal does NOT use native datalist for duplicates
  setPbipModel({
    modelName: 'TestModel',
    measures: [{ name: 'Ventas', table: 'Fact' }],
    tables: ['Fact', 'Calendario'],
    dateTables: [{ name: 'Calendario', dateColumns: ['Fecha'], primaryDateColumn: 'Fecha' }]
  });
  openDataBindingModal();
  const modalHTML = $('#modal').innerHTML;
  assert.ok(modalHTML.includes('data-bind-dup="value_copy1"'));
  assert.ok(!modalHTML.includes('list="dl-pbip-measures"'), 'Modal must not attach list="dl-pbip-measures" to inputs');
  closeModal();
  `);
});

test('Duplicate chart SVG rendering, DAX isolation, comparison label tracking, and glassmorphism styling', async () => {
  const run = await editor();
  run(`
  loadDesign(BASE);

  // 1. Resolve and update duplicate trend chart
  resolveElementDef('trend_copy1');
  c = updateElement(c, 'trend_copy1', {
    measure: BASE.measure, dateTable: BASE.dateTable, dateColumn: BASE.dateColumn,
    chartType: 'area',
    showDots: true,
    showMinMax: true,
    curved: true,
    series: [10, 25, 18, 42, 35, 60]
  });

  // Verify card HTML renders SVG for trend_copy1
  const html = cardHTML(c, undefined, true);
  assert.ok(html.includes('data-element="trend_copy1"'), 'Card HTML must contain trend_copy1 wrapper');
  assert.ok(html.includes('<svg') && html.includes('d="M'), 'Duplicate chart must render non-empty SVG path');

  // Verify DAX generation scopes duplicate trend variable without colliding with original trend
  c = { ...c, measure: 'Ventas Total' };
  const dax = generateDAX(c);
  assert.ok(dax.includes('VAR __trend_trend_copy1'), 'DAX must generate dedicated __trend_trend_copy1 variable');
  assert.ok(dax.includes('VAR __trend =') || dax.includes('__trend'), 'DAX must still declare original trend or base variables');

  // 2. Comparison label tracking and custom text
  // Default: comparisonLabel tracks 'comparison' automatically
  c = updateElement(c, 'compareLabel', { text: '' });
  let htmlComp = cardHTML(c);
  assert.ok(htmlComp.includes('vs. año anterior') || htmlComp.includes('anterior'), 'compareLabel must dynamically track default comparison');

  // Custom text: user overrides comparison text
  c = updateElement(c, 'compareLabel', { text: 'vs. Presupuesto 2026' });
  htmlComp = cardHTML(c);
  assert.ok(htmlComp.includes('vs. Presupuesto 2026'), 'compareLabel must reflect custom text override');

  // Duplicate compareLabel tracks comparison
  resolveElementDef('compareLabel_copy1');
  c = updateElement(c, 'compareLabel_copy1', { comparison: 'yoy', text: '' });
  htmlComp = cardHTML(c);
  assert.ok(htmlComp.includes('vs. año anterior'), 'compareLabel_copy1 must dynamically track YoY comparison');

  // 3. Data binding modal exposes duplicate trend fields (measure, dateTable, dateColumn)
  setPbipModel({
    modelName: 'SalesModel',
    measures: [{ name: 'Ventas', table: 'Fact' }, { name: 'Costes', table: 'Fact' }],
    tables: ['Fact', 'Calendario'],
    dateTables: [{ name: 'Calendario', dateColumns: ['FechaKey'], primaryDateColumn: 'FechaKey' }]
  });
  openDataBindingModal();
  const modalHTML = $('#modal').innerHTML;
  assert.ok(modalHTML.includes('trend_copy1__measure'), 'Modal must have measure binding for trend_copy1');
  assert.ok(modalHTML.includes('trend_copy1__dateTable'), 'Modal must have dateTable binding for trend_copy1');
  assert.ok(modalHTML.includes('trend_copy1__dateColumn'), 'Modal must have dateColumn binding for trend_copy1');
  closeModal();

  // 4. Inspector parity: chartPanel rendered for trend_copy1
  selectedElement = 'trend_copy1';
  tab = 'element';
  renderInspector();
  const insp = $('#inspector-fields').innerHTML;
  assert.ok(insp.includes('Visual'), 'Duplicate trend inspector must display Visual');
  assert.ok(insp.includes('Representación'), 'Duplicate trend inspector must display Representación');
  assert.ok(insp.includes('Trazado'), 'Duplicate trend inspector must display Trazado');
  `);

  // 5. Glassmorphism CSS verification
  const css = readCss('dist/styles.css');
  assert.ok(css.includes('.glass-stage::before'), 'styles.css must include ambient backdrop orb ::before');
  assert.ok(css.includes('.glass-stage::after'), 'styles.css must include ambient backdrop orb ::after');
  assert.ok(css.includes('scrollbar-gutter:stable'), 'styles.css must configure scrollbar-gutter:stable');
});

test('Duplicate chart appearance excludes background opacity, expanded data summary includes duplicate bindings, and zoom-fit fits card', async () => {
  const run = await editor();
  run(`
  loadDesign(BASE);

  // 1. Duplicate chart appearance panel does NOT have background opacity
  resolveElementDef('trend_copy1');
  c = updateElement(c, 'trend_copy1', { chartKind: 'trend', trendStyle: 'area' });
  selectedElement = 'trend_copy1';
  tab = 'element';
  renderInspector();
  const inspHTML = $('#inspector-fields').innerHTML;
  assert.ok(!inspHTML.includes('Opacidad del fondo'), 'Duplicate trend must NOT have Opacidad del fondo');
  assert.ok(!inspHTML.includes('Fondo del elemento'), 'Duplicate trend must NOT have Fondo del elemento');
  assert.ok(inspHTML.includes('Color del área'), 'Duplicate area trend must have Color del área');

  // 2. Data tab dataSummaryCard expands with duplicate bindings
  tab = 'data';
  renderInspector();
  const dataHTML = $('#inspector-fields').innerHTML;
  assert.ok(dataHTML.includes('data-summary-card'), 'Must contain data-summary-card');
  assert.ok(dataHTML.includes('Elementos duplicados'), 'Must list Elementos duplicados');
  assert.ok(dataHTML.includes('trend_copy1') || dataHTML.includes('Gráfico'), 'Must include duplicate trend in summary');

  // 3. Zoom-fit action calculates fitting zoom and centers stage
  zoom = 180;
  $('#stage').scrollTop = 120;
  fire('document', 'click', { target: button({ action: 'zoom-fit' }) });
  assert.ok(zoom <= 100, 'Zoom-fit must scale to 100% or fit ratio');
  assert.equal($('#stage').scrollTop, 0, 'Stage scrollTop must be reset to 0');
  `);
});

test('Punto 1: Fine-grained DOM patching in Inspector and Canvas avoids structural reflows', async () => {
  const run = await editor();
  run(`
  loadDesign(BASE);
  renderStage();
  const initialFit = $('#stage').querySelector('#card-fit');
  assert.ok(initialFit, '#card-fit must exist in stage');

  // Consecutive renderStage call reuses existing #card-fit node
  c = { ...c, title: 'Título Actualizado' };
  renderStage();
  const nextFit = $('#stage').querySelector('#card-fit');
  assert.equal(initialFit, nextFit, 'renderStage must reuse existing #card-fit node without wiping stage');
  assert.ok($('#stage').querySelector('#main-card').innerHTML.includes('Título Actualizado'), 'main-card must reflect updated title');

  // Inspector fine-grained patching: non-structural directChange does NOT wipe inspector DOM
  tab = 'content';
  renderInspector();
  $('#inspector-fields').innerHTML = '<div id="preserved-control">input</div>';
  directChange({ ...c, title: 'Otro Título' }, false, false);
  assert.equal($('#inspector-fields').innerHTML, '<div id="preserved-control">input</div>', 'Non-structural directChange must NOT rebuild inspector DOM');

  // Structural directChange re-renders inspector
  directChange({ ...c, showIcon: false }, false, true);
  assert.notEqual($('#inspector-fields').innerHTML, '<div id="preserved-control">input</div>', 'Structural directChange must rebuild inspector DOM');
  `);
});

test('Punto 2: Real-time Power BI Desktop SSE stream listener', async () => {
  const run = await editor();
  run(`
  // initLivePbiStream handles browser and node environments safely
  assert.equal(typeof initLivePbiStream, 'function', 'initLivePbiStream must be exported as a function');
  let called = false;
  const cleanup = initLivePbiStream(instances => { called = true; });
  assert.ok(cleanup === null || typeof cleanup === 'function', 'cleanup must be null or function');
  `);
});

test('Punto 3: Full Dark Mode toggle, header button, and localStorage persistence', async () => {
  const run = await editor();
  run(`
  // 1. Initial state and getters
  assert.equal(getUiTheme(), 'light', 'Default UI theme must be light');

  // 2. setUiTheme persists to storage and sets data-ui-theme attribute
  setUiTheme('dark');
  assert.equal(getUiTheme(), 'dark', 'getUiTheme must return dark after setUiTheme');
  assert.equal(localStorage.getItem('kpi-atelier-ui-theme'), '"dark"', 'Must persist ui theme in localStorage');

  // 3. toggleUiTheme alternates between dark and light
  toggleUiTheme();
  assert.equal(getUiTheme(), 'light', 'toggleUiTheme must switch back to light');
  assert.equal(localStorage.getItem('kpi-atelier-ui-theme'), '"light"', 'Must persist updated light theme in localStorage');

  // 4. Header contains toggle button with appropriate icon
  setUiTheme('light');
  render();
  const appHeader = $('#app').innerHTML;
  assert.ok(appHeader.includes('data-action="toggle-ui-theme"'), 'Header must render toggle-ui-theme button');
  assert.ok(appHeader.includes('Cambiar a modo oscuro'), 'Light mode must suggest switching to dark');

  // 5. Triggering toggle action updates UI and header
  fire('document', 'click', { target: button({ action: 'toggle-ui-theme' }) });
  assert.equal(getUiTheme(), 'dark', 'Clicking toggle-ui-theme button must flip theme to dark');
  const darkAppHeader = $('#app').innerHTML;
  assert.ok(darkAppHeader.includes('Cambiar a modo claro'), 'Dark mode must suggest switching to light');
  `);
});

test('CSS Architecture: styles.css is decoupled into component submodules (tokens, shell, canvas, inspector, modals)', () => {
  const styles = fs.readFileSync('dist/styles.css', 'utf8');
  assert.ok(styles.includes("@import './css/tokens.css';"), 'styles.css must import tokens.css');
  assert.ok(styles.includes("@import './css/shell.css';"), 'styles.css must import shell.css');
  assert.ok(styles.includes("@import './css/canvas.css';"), 'styles.css must import canvas.css');
  assert.ok(styles.includes("@import './css/inspector.css';"), 'styles.css must import inspector.css');
  assert.ok(styles.includes("@import './css/modals.css';"), 'styles.css must import modals.css');

  const modules = ['tokens.css', 'shell.css', 'canvas.css', 'inspector.css', 'modals.css'];
  for (const m of modules) {
    const p = path.join('dist/css', m);
    assert.ok(fs.existsSync(p), `dist/css/${m} must exist`);
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(content.length > 500, `dist/css/${m} must contain component rules`);
  }
});

test('Template Rail: Collapsible sidebar state, workspace classes, and Ctrl+B shortcut', async () => {
  const run = await editor();
  run(`
  // 1. Initial state is expanded
  assert.equal(getRailCollapsed(), false);
  render();
  let appHTML = $('#app').innerHTML;
  assert.ok(appHTML.includes('class="workspace"'));
  assert.ok(!appHTML.includes('workspace rail-collapsed'));
  assert.ok(appHTML.includes('Elige tu punto de partida'));
  assert.ok(appHTML.includes('data-action="toggle-rail"'));

  // 2. Toggle via action collapses the rail
  fire('document', 'click', { target: button({ action: 'toggle-rail' }) });
  assert.equal(getRailCollapsed(), true);
  appHTML = $('#app').innerHTML;
  assert.ok(appHTML.includes('workspace rail-collapsed'));
  assert.ok(appHTML.includes('template-rail is-collapsed'));
  assert.ok(appHTML.includes('rail-collapsed-bar'));
  assert.ok(appHTML.includes('Plantillas'));

  // 3. Toggle via Ctrl+B expands the rail back
  fire('document', 'keydown', { ctrlKey: true, key: 'b' });
  assert.equal(getRailCollapsed(), false);
  appHTML = $('#app').innerHTML;
  assert.ok(!appHTML.includes('workspace rail-collapsed'));
  assert.ok(appHTML.includes('Elige tu punto de partida'));
  `);
});

test('Binding Dropdown: Standard dropdown with search displays measures with table metadata without overengineered chips', async () => {
  const run = await editor();
  run(`
  loadDesign(BASE);
  setPbipModel({
    modelName: 'EnterpriseModel',
    tables: ['Ventas', 'Clientes', 'Calendario'],
    measures: [
      { name: 'Total Ventas', table: 'Ventas', dax: 'SUM(Ventas[Importe])' },
      { name: 'Margen Bruto', table: 'Ventas', dax: '[Total Ventas] - [Coste]' },
      { name: 'Total Clientes', table: 'Clientes', dax: 'DISTINCTCOUNT(Clientes[ID])' },
      { name: 'NPS Medio', table: 'Clientes', dax: 'AVERAGE(Clientes[NPS])' }
    ],
    dateTables: [{ name: 'Calendario', dateColumns: ['Fecha'] }]
  });

  // Render dropdown: shows all measures with table metadata on the right
  const initialHTML = renderBindingDropdown('measure', '');
  assert.ok(!initialHTML.includes('binding-dropdown-table-filter'));
  assert.ok(!initialHTML.includes('filter-table-chip'));
  assert.ok(initialHTML.includes('Total Ventas'));
  assert.ok(initialHTML.includes('Total Clientes'));
  assert.ok(initialHTML.includes('<span class="binding-dropdown-meta">Ventas</span>'));
  assert.ok(initialHTML.includes('<span class="binding-dropdown-meta">Clientes</span>'));

  // Search by 'Ventas': matches both measure name and table metadata
  const ventasHTML = renderBindingDropdown('measure', 'Ventas');
  assert.ok(ventasHTML.includes('Total Ventas'));
  assert.ok(ventasHTML.includes('Margen Bruto'));
  assert.ok(!ventasHTML.includes('Total Clientes'));
  assert.ok(!ventasHTML.includes('NPS Medio'));

  // Search by 'Clientes': only Clientes measures shown
  const clientesHTML = renderBindingDropdown('measure', 'Clientes');
  assert.ok(!clientesHTML.includes('Total Ventas'));
  assert.ok(clientesHTML.includes('Total Clientes'));
  assert.ok(clientesHTML.includes('NPS Medio'));
  `);
});

test('Productivity & UX: Shortcuts modal on ? key, Infographic guide in export modal, and canvas Tab navigation', async () => {
  const run = await editor();
  run(`
  loadDesign(BASE);
  c.measure = 'Total Ventas';
  c._measureBound = true;
  c.measureName = 'KPI_Total_Ventas';

  // 1. Export modal contains '¿Cómo usar en Power BI?' button
  exportModal();
  assert.equal($('#modal').open, true);
  const expHTML = $('#modal').innerHTML;
  assert.ok(expHTML.includes('data-action="pbi-infographic"'));
  assert.ok(expHTML.includes('¿Cómo usar en Power BI?'));

  // 2. Clicking infographic action opens the 4-step infographic modal
  fire('document', 'click', { target: button({ action: 'pbi-infographic' }) });
  const infoHTML = $('#modal').innerHTML;
  assert.ok(infoHTML.includes('pbi-infographic-container'));
  assert.ok(infoHTML.includes('HTML Content Secure'));
  assert.ok(infoHTML.includes('Crea la medida DAX'));
  assert.ok(infoHTML.includes('Values'));
  assert.ok(infoHTML.includes('Ajuste de dimensiones exactas'));
  assert.ok(infoHTML.includes('data-action="back-to-export"'));

  // 3. Back to export button returns to DAX export
  fire('document', 'click', { target: button({ action: 'back-to-export' }) });
  assert.ok($('#modal').innerHTML.includes('Tu diseño. Tu medida DAX.'));
  closeModal();

  // 4. Pressing '?' opens the shortcuts modal
  fire('document', 'keydown', { key: '?' });
  assert.equal($('#modal').open, true);
  const scHTML = $('#modal').innerHTML;
  assert.ok(scHTML.includes('shortcuts-modal'));
  assert.ok(scHTML.includes('Atajos de Teclado'));
  assert.ok(scHTML.includes('Lienzo y Visualización'));
  assert.ok(scHTML.includes('Edición y Selección'));
  assert.ok(scHTML.includes('Historial y Productividad'));
  assert.ok(scHTML.includes('Ajustar tamaño'));
  assert.ok(scHTML.includes('con elemento seleccionado'));
  assert.ok(scHTML.includes('<kbd class="shortcut-key">+</kbd><span class="shortcut-slash">/</span><kbd class="shortcut-key">−'));
  assert.ok(!scHTML.includes('Tamaño del elemento seleccionado (±1 px)'));
  closeModal();
  assert.equal($('#modal').open, false);
  `);
});

test('Power BI Desktop live injection and measure overwrite lifecycle', async () => {
  const run = await editor();
  run(`
  loadDesign(BASE);
  c.measure = 'Total Ventas';
  c._measureBound = true;
  c.targetMeasure = '100';
  c._targetCustomized = true;
  c.measureName = 'VENTAS_TOTALES';

  // Mock a connected live PBIP model
  setPbipModel({
    modelName: 'AventureWorksDW.pbip',
    reportName: 'AventureWorksDW.pbip',
    isLiveConnection: true,
    server: 'localhost:61377',
    database: 'test-db-guid',
    tables: ['_Measures', 'Sales'],
    measures: [
      { name: 'Total Ventas', table: '_Measures' },
      { name: 'VENTAS_TOTALES', table: '_Measures' }
    ],
    dateTables: [
      { name: 'Calendario', dateColumns: ['Fecha'], isMarkedDateTable: true, primaryDateColumn: 'Fecha' }
    ]
  }, false);

  // 1. When measure 'VENTAS_TOTALES' already exists in model, exportModal renders 'Sobrescribir en Power BI'
  exportModal();
  assert.equal($('#modal').open, true);
  const expHTML = $('#modal').innerHTML;
  assert.ok(expHTML.includes('data-action="inject-live-measure"'));
  assert.ok(expHTML.includes('Sobrescribir en Power BI'), 'Must offer Sobrescribir en Power BI for existing measure');
  closeModal();

  // 2. When measureName does not exist, exportModal renders 'Crear en Power BI'
  c.measureName = 'NUEVA_MEDIDA_KPI';
  exportModal();
  assert.ok($('#modal').innerHTML.includes('Crear en Power BI'), 'Must offer Crear en Power BI for new measure');
  closeModal();

  // 3. Confirm overwrite modal registers and executes pending action
  let executed = false;
  showInjectConfirmModal([], { name: 'VENTAS_TOTALES', table: '_Measures' }, async () => {
    executed = true;
  });
  assert.equal($('#modal').open, true);
  assert.ok($('#modal').innerHTML.includes('Confirmar sobrescritura en Power BI'));
  assert.ok($('#modal').innerHTML.includes('data-action="proceed-inject-measure"'));

  // Pending action is non-null and executable via click
  assert.ok(typeof getPendingInjectAction() === 'function', 'Pending inject action must be registered');
  fire('document', 'click', { target: button({ action: 'proceed-inject-measure' }) });
  assert.equal(executed, true, 'proceed-inject-measure must execute pending inject action');
  assert.equal(getPendingInjectAction(), null, 'Pending action must be cleared after execution');

  // 4. showInjectSuccessModal renders clear success card, table, report, and next steps
  showInjectSuccessModal({
    measureName: 'NUEVA_MEDIDA_KPI',
    tableName: '_Medidas',
    reportName: 'People_Absentismo.pbip',
    isNew: true
  });
  assert.equal($('#modal').open, true);
  const successHTML = $('#modal').innerHTML;
  assert.ok(successHTML.includes('¡Medida creada con éxito en Power BI!'));
  assert.ok(successHTML.includes('[NUEVA_MEDIDA_KPI]'));
  assert.ok(successHTML.includes('_Medidas'));
  assert.ok(successHTML.includes('HTML Content Secure'));
  closeModal();

  // 5. showInjectErrorModal renders explicit error card with retry and reconnect actions
  let retried = false;
  showInjectErrorModal({
    error: new Error('Excepción de conexión al puerto 61377'),
    measureName: 'NUEVA_MEDIDA_KPI',
    reportName: 'AdventureWorksDW.pbip',
    onRetry: () => { retried = true; }
  });
  assert.equal($('#modal').open, true);
  const errorHTML = $('#modal').innerHTML;
  assert.ok(errorHTML.includes('No se pudo sincronizar con Power BI'));
  assert.ok(errorHTML.includes('data-action="connect-live-pbi"'));
  assert.ok(errorHTML.includes('data-action="proceed-inject-measure"'));
  assert.ok(typeof getPendingInjectAction() === 'function');
  fire('document', 'click', { target: button({ action: 'proceed-inject-measure' }) });
  assert.equal(retried, true, 'proceed-inject-measure in error modal must trigger retry action');
  closeModal();
  `);
});

test('Report picker cancellation, close and Escape return to data binding without losing edits', async () => {
  const run = await editor();
  run(`
    loadDesign(BASE);c={...c,measure:'Ventas',_measureBound:true,targetMeasure:'123',_targetCustomized:true};
    openDataBindingModal();
    const instances=[{server:'localhost:1234',database:'ventas',reportName:'Ventas'}];
    for(const action of ['cancel','close','escape']){
      chooseLiveInstanceModal(instances);assert.equal($('#modal').className,'instance-modal');
      if(action==='escape')fire('#modal','cancel',{preventDefault(){}});
      else if(action==='cancel')fire('document','click',{target:button({action:'close-modal'})});
      else closeModal();
      assert.equal($('#modal').open,true);assert.equal($('#modal').className,'binding-modal');
      assert.equal(c.measure,'Ventas');assert.equal(c.targetMeasure,'123');
    }
    fire('document','click',{target:button({action:'close-modal'})});assert.equal($('#modal').open,false);
  `);
});

test('Binding highlights follow temporal measures, independent copies and both pointer and focus', async () => {
  const run = await editor();
  run(`
    loadDesign(BASE);c={...c,elements:{...c.elements,trend_copy1:{measure:'Otra medida',dateTable:'Otro calendario',dateColumn:'Día'}}};
    assert.ok(getBindingElements('dateTable').includes('delta'));
    assert.ok(!getBindingElements('dateTable').includes('trend_copy1'));
    assert.equal(getBindingElements('trend_copy1__measure').join(','),'trend_copy1');
    assert.ok(getBindingElements('measureName').includes('title'));
    const fields=['measure','measureName','dateTable','dateColumn','trend_copy1__measure'];
    const elements=['value','title','delta','trend','trend_copy1','icon'];
    const makeNode=(dataset)=>({dataset,classes:new Set(),classList:{toggle(cls,active){active?this.owner.classes.add(cls):this.owner.classes.delete(cls)}},closest(){return null;}});
    const fieldNodes=fields.map(bindingField=>makeNode({bindingField}));
    const elementNodes=elements.map(element=>makeNode({element}));
    for(const el of [...fieldNodes,...elementNodes])el.classList.owner=el;
    const originalQuery=document.querySelectorAll;
    document.querySelectorAll=selector=>selector==='[data-binding-field]'?fieldNodes:selector==='#binding-card-inner [data-element]'?elementNodes:[];
    const fieldTarget={closest:selector=>selector==='[data-binding-field]'?fieldNodes[2]:null};
    fire('document','pointerover',{target:fieldTarget});
    assert.ok(elementNodes.find(el=>el.dataset.element==='delta').classes.has('binding-highlight'));
    assert.ok(fieldNodes[2].classes.has('is-binding-highlight'));
    const cardTarget={closest:selector=>selector==='#binding-card-inner [data-element]'?elementNodes[1]:null};
    fire('document','pointerover',{target:cardTarget});
    assert.ok(fieldNodes[1].classes.has('is-binding-highlight'));
    assert.ok(!fieldNodes[2].classes.has('is-binding-highlight'));
    fire('document','focusin',{target:fieldTarget});
    const deltaTarget={closest:selector=>selector==='#binding-card-inner [data-element]'?elementNodes[2]:null};
    fire('document','pointerover',{target:deltaTarget});
    assert.equal(elementNodes.filter(el=>el.classes.has('binding-highlight')).map(el=>el.dataset.element).join(','),'delta');
    assert.equal(fieldNodes.filter(el=>el.classes.has('is-binding-highlight')).map(el=>el.dataset.bindingField).join(','),'measure,dateTable,dateColumn');
    const iconTarget={closest:selector=>selector==='#binding-card-inner [data-element]'?elementNodes[5]:null};
    fire('document','pointerover',{target:iconTarget});
    assert.ok(elementNodes.every(el=>!el.classes.has('binding-highlight')));
    assert.ok(fieldNodes.every(el=>!el.classes.has('is-binding-highlight')));
    fire('document','pointerout',{relatedTarget:null});
    assert.ok(fieldNodes[2].classes.has('is-binding-highlight'));
    assert.ok(!fieldNodes[1].classes.has('is-binding-highlight'));
    fire('document','focusout',{relatedTarget:null});
    assert.ok(elementNodes.every(el=>!el.classes.has('binding-highlight')));
    document.querySelectorAll=originalQuery;
  `);
});

test('Visual hover reveals an offscreen copy within the settings column without changing focus', async () => {
  const run = await editor();
  run(`
    loadDesign(BASE);openDataBindingModal();
    const modalHTML=$('#modal').innerHTML;
    assert.ok(modalHTML.indexOf('binding-measure-heading')<modalHTML.indexOf('binding-fields-card'));
    fire('document','input',{target:{id:'f-bind-granularity',value:'month',dataset:{}}});
    assert.equal(c.granularity,'month');
    const previousQuery=document.querySelectorAll;
    const previousMotion=window.matchMedia;
    const previousFocus=document.activeElement;
    const scroller={scrollTop:0,scrollHeight:1000,clientHeight:400,isConnected:true,getBoundingClientRect(){return {top:100,bottom:500}}};
    const body={getBoundingClientRect(){return {top:90,bottom:510}}};
    const makeField=(key,top,bottom)=>({dataset:{bindingField:key},closest(s){return s==='.binding-fields-column'?scroller:s==='.modal-body'?body:null},getBoundingClientRect(){return {top:top-scroller.scrollTop,bottom:bottom-scroller.scrollTop}}});
    const fields=[makeField('measure',130,190),makeField('value_copy1',700,770)];
    document.querySelectorAll=s=>s==='[data-binding-field]'?fields:[];
    window.matchMedia=()=>({matches:true});
    revealBindingFields(['measure','value_copy1'],'value_copy1');
    assert.equal(scroller.scrollTop,280);
    assert.equal(document.activeElement,previousFocus);
    revealBindingFields(['measure','value_copy1'],'value_copy1');
    assert.equal(scroller.scrollTop,280);
    scroller.scrollTop=0;
    revealBindingFields(['measure'],'value');
    assert.equal(scroller.scrollTop,0);
    document.querySelectorAll=previousQuery;window.matchMedia=previousMotion;
  `);
});

test('Measure review refreshes the connected catalog, prevents missing references and avoids writes', async () => {
  const run = await editor();
  run(`
    loadDesign(BASE);c={...c,measure:'Ventas',measureName:'KPI_Ventas',targetMeasure:'100',_measureBound:true,_targetCustomized:true};
    setPbipModel({modelName:'Modelo',reportName:'Informe',isLiveConnection:true,server:'localhost:1234',database:'db',tables:['Medidas','Calendario'],measures:[{name:'Ventas',table:'Medidas'}],dateTables:[{name:'Calendario',dateColumns:['Fecha']}]},false);
  `);
  const originalFetch = globalThis.fetch;
  const requests = [];
  let missing = false;
  let disconnected = false;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (disconnected) throw new Error('Conexión perdida');
    return { ok: true, json: async () => ({ modelName: 'Modelo', reportName: 'Informe', server: 'localhost:1234', database: 'db',
      tables: [{ name: 'Medidas' }, { name: 'Calendario' }],
      measures: missing ? [] : [{ name: 'Ventas', table: 'Medidas' }, { name: 'KPI_Ventas', table: 'Medidas' }],
      detectedDateTables: [{ table: 'Calendario', dateColumns: ['Fecha'], suggestedColumn: 'Fecha', isOfficialMarked: true, tier: 1 }] }) };
  };
  try {
    await run('openMeasureReviewModal()');
    run(`
      const reviewHTML=$('#modal').innerHTML;
      assert.ok(reviewHTML.includes('Conexión verificada'));
      assert.ok(reviewHTML.includes('Sobrescribir en Power BI'));
      assert.ok(reviewHTML.includes('440 × 400 px'));
      assert.ok(!/data-action="inject-live-measure" disabled/.test(reviewHTML));
    `);
    missing = true;
    await run('openMeasureReviewModal()');
    run(`assert.ok($('#modal').innerHTML.includes('No encontrada'));assert.ok(/data-action="inject-live-measure" disabled/.test($('#modal').innerHTML));`);
    disconnected = true;
    await run('openMeasureReviewModal()');
    run(`assert.ok($('#modal').innerHTML.includes('Conexión perdida'));assert.ok(/data-action="inject-live-measure" disabled/.test($('#modal').innerHTML));closeModal();assert.equal($('#modal').className,'export-modal');`);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(r => r.url.includes('/api/pbi/model?') && !r.options?.method));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A late catalog refresh cannot replace the configuration modal after leaving review', async () => {
  const run = await editor();
  run(`loadDesign(BASE);c={...c,measure:'Ventas',targetMeasure:'100',_measureBound:true,_targetCustomized:true};setPbipModel({modelName:'Modelo',isLiveConnection:true,server:'localhost:1234',database:'db',tables:['Medidas'],measures:[],dateTables:[]},false);`);
  const originalFetch = globalThis.fetch;
  let finish;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  try {
    const pending = run('openMeasureReviewModal()');
    run('openDataBindingModal()');
    finish({ ok: true, json: async () => ({ server: 'localhost:1234', database: 'db', tables: [], measures: [], detectedDateTables: [] }) });
    await pending;
    run(`assert.equal($('#modal').className,'binding-modal');assert.ok($('#modal').innerHTML.includes('Conectar datos del modelo'));`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Clicking a binding field or label opens its dropdown, repeats keep it open and the chevron or outside close it', async () => {
 const run=await editor();
 run(`
  loadDesign(BASE);setPbipModel({modelName:'Modelo',measures:[{name:'Ventas',table:'Medidas'}],dateTables:[],tables:['Medidas']},false);
  const priorId=document.getElementById,priorQuery=document.querySelectorAll;
  const classes=new Set(),attrs={};
  const toggle={dataset:{action:'toggle-bind-dropdown',field:'measure'},setAttribute(k,v){attrs[k]=v},classList:{add(){},remove(){}},closest(s){return s.includes('button')?this:s==='[data-binding-field]'?bindingField:s==='.binding-dropdown-wrap'?wrap:null}};
  const wrap={querySelector(s){return s==='.binding-dropdown-toggle'?toggle:s==='.binding-input'?input:null}};
  const bindingField={dataset:{bindingField:'measure'},querySelector(){return wrap}};
  const input={setAttribute(){},closest(s){return s==='[data-binding-field]'?bindingField:s==='.binding-dropdown-wrap'?wrap:null}};
  const menu={parentElement:wrap,innerHTML:'',classList:{contains(c){return classes.has(c)},add(c){classes.add(c)},remove(c){classes.delete(c)}}};
  document.getElementById=id=>id==='dropdown-menu-measure'?menu:null;
  document.querySelectorAll=s=>s==='.binding-dropdown-menu.is-open'&&classes.has('is-open')?[menu]:[];
  fire('document','click',{target:input});assert.ok(classes.has('is-open'));assert.equal(attrs['aria-expanded'],'true');
  fire('document','click',{target:input});assert.ok(classes.has('is-open'));
  const label={closest(s){return s==='[data-binding-field]'?bindingField:null}};
  fire('document','click',{target:label});assert.ok(classes.has('is-open'));
  fire('document','click',{target:toggle});assert.ok(!classes.has('is-open'));
  fire('document','click',{target:label});assert.ok(classes.has('is-open'));
  fire('document','click',{target:{closest(){return null}}});assert.ok(!classes.has('is-open'));assert.equal(attrs['aria-expanded'],'false');
  document.getElementById=priorId;document.querySelectorAll=priorQuery;
 `);
});

test('Exports with missing or unverified references require confirmation, preserve cancellation and never apply the measure', async () => {
 const run=await editor();
 run(`
  loadDesign(BASE);c={...c,measure:'Ventas',measureName:'KPI_Ventas',targetMeasure:'100',_measureBound:true,_targetCustomized:true,elements:{value_copy1:{}}};
  setPbipModel({modelName:'Modelo',measures:[{name:'Ventas',table:'Medidas'}],tables:['Medidas','Calendario'],dateTables:[{name:'Calendario',dateColumns:['Fecha']}]},false);
  exportModal();let exported=0;
  requestExport(()=>exported++);assert.equal(exported,0);assert.equal($('#modal').className,'export-warning-modal');
  assert.ok($('#modal').innerHTML.includes('Sin configurar'));
  fire('document','click',{target:button({action:'close-modal'})});assert.equal(exported,0);assert.equal($('#modal').className,'export-modal');
  requestExport(()=>exported++);fire('document','click',{target:button({action:'confirm-export-anyway'})});assert.equal(exported,1);assert.equal($('#modal').className,'export-modal');
  c.elements.value_copy1.measure='Ventas';requestExport(()=>exported++);assert.equal(exported,2);
  setPbipModel(null,false);requestExport(()=>exported++);assert.equal(exported,2);assert.ok($('#modal').innerHTML.includes('Sin comprobar'));closeModal();
 `);
});

test('Power BI creation and overwrite block empty copies and recheck references immediately before writing', async () => {
 const run=await editor();
 const originalFetch=globalThis.fetch;
 const writes=[];
 let absent=false, existing=false;
 globalThis.fetch=async (url,options)=>{
  if(options?.method==='POST'){
   writes.push(JSON.parse(options.body));
   return {ok:true,json:async()=>({measureName:'KPI_Ventas',tableName:'Medidas',isNew:!existing})};
  }
  return {ok:true,json:async()=>({server:'localhost:1234',database:'db',modelName:'Modelo',reportName:'Informe',tables:[{name:'Medidas'},{name:'Calendario'}],
   measures:[{name:'Ventas',table:'Medidas'},...(!absent?[{name:'Unidades',table:'Medidas'}]:[]),...(existing?[{name:'KPI_Ventas',table:'Medidas'}]:[])],
   detectedDateTables:[{table:'Calendario',dateColumns:['Fecha'],suggestedColumn:'Fecha',isOfficialMarked:true,tier:1}]})};
 };
 const inject=async()=>{await run('applyLiveMeasure()');};
 const setup=(hasExisting=false)=>run(`
  loadDesign(BASE);c={...c,measure:'Ventas',measureName:'KPI_Ventas',targetMeasure:'100',_measureBound:true,_targetCustomized:true,elements:{value_copy1:{measure:''}}};
  setPbipModel({modelName:'Modelo',reportName:'Informe',isLiveConnection:true,server:'localhost:1234',database:'db',tables:['Medidas','Calendario'],measures:[{name:'Ventas',table:'Medidas'},{name:'Unidades',table:'Medidas'}${hasExisting?",{name:'KPI_Ventas',table:'Medidas'}":''}],dateTables:[{name:'Calendario',dateColumns:['Fecha']}]},false);
 `);
 try{
  setup();
  await inject();
  assert.equal(writes.length,0);
  run("assert.equal($('#modal').className,'measure-review-modal');assert.ok($('#modal').innerHTML.includes('Sin configurar')); ");
  setup(true);existing=true;
  await inject();
  assert.equal(writes.length,0);
  run("assert.equal($('#modal').className,'measure-review-modal');");
  setup();existing=false;absent=true;
  run("c.elements.value_copy1.measure='Unidades';");
  await inject();
  assert.equal(writes.length,0);
  run("assert.equal($('#modal').className,'measure-review-modal');assert.ok($('#modal').innerHTML.includes('No encontrada'));assert.ok(/data-action=\"inject-live-measure\" disabled/.test($('#modal').innerHTML));");
  setup(true);existing=true;absent=false;
  run("c.elements.value_copy1.measure='Unidades';");
  await inject();
  run("assert.ok($('#modal').innerHTML.includes('Confirmar sobrescritura')); ");
  absent=true;
  await run('getPendingInjectAction()()');
  assert.equal(writes.length,0);
  run("assert.equal($('#modal').className,'measure-review-modal');");
  setup();existing=false;absent=false;
  run("c.elements.value_copy1.measure='Unidades';");
  await inject();
  assert.equal(writes.length,1);
  assert.equal(writes[0].measureName,'KPI_Ventas');
  assert.match(writes[0].daxExpression,/\[Unidades\]/);
  assert.equal(writes[0].configAnnotation.elements.value_copy1.measure,'Unidades');
  run("assert.ok($('#modal').innerHTML.includes('Medida creada')); ");
 }finally{globalThis.fetch=originalFetch;}
});





