import {test as base, expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {BASE} from '../../dist/model.mjs';

// Exercise the shipped ES modules and DOM. Only the external Power BI boundary is mocked.
const test = base.extend({
  safeBridge: [async ({page}, use) => {
    const writes = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/pbi/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') {
        writes.push(route.request().postDataJSON());
        return route.fulfill({status:409, json:{error:'Browser tests never write to Power BI.'}});
      }
      if (path.endsWith('/events')) return route.fulfill({status:200, contentType:'text/event-stream', body:': browser test\n\n'});
      if (path.endsWith('/discover')) return route.fulfill({json:{instances:[]}});
      if (path.endsWith('/model')) return route.fulfill({json:{modelName:'Prueba',database:'test',server:'localhost:12345',tables:[],measures:[],detectedDateTables:[]}});
      return route.fulfill({json:{connected:false,databases:[]}});
    });
    await use(writes);
    expect(writes, 'No browser flow may accidentally issue model writes').toEqual([]);
    expect(errors, 'No uncaught errors from the real module graph').toEqual([]);
  }, {auto:true}]
});

const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('kpi-atelier-draft')));
const action = (page, name) => page.locator(`#app [data-action="${name}"]`).first();
const modalAction = (page, name) => page.locator(`#modal [data-action="${name}"]`).last();
async function reveal(control) {
  const details = control.locator('xpath=ancestor::details[1]');
  if (await details.count() && !await details.evaluate(node => node.open)) await details.locator('summary').first().click();
}
async function importCard(page, patch = {}) {
  const config = {...BASE, _measureBound:true, ...patch};
  await page.locator('#file-import').setInputFiles({name:'tarjeta.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema:'kpi-atelier',version:1,config}))});
  await expect.poll(async () => (await draft(page))?.measure).toBe(config.measure);
  await expect(page.locator('#main-card [data-element="title"]')).toContainText(config.title);
  if(await page.getByRole('heading',{name:'Configuración importada con ajustes',exact:true}).isVisible()) await modalAction(page,'close-modal').click();
}

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#main-card [data-element="title"]')).toBeVisible();
});

test('Title edits and reset are undoable through actual editor wiring',async ({page}) => {
  const original = await page.locator('#f-title').inputValue();
  await page.locator('#f-title').fill('Título de regresión');
  await page.locator('#f-title').blur();
  await expect(page.locator('#main-card [data-element="title"]')).toHaveText('Título de regresión');
  await expect(action(page,'undo')).toBeEnabled();
  await action(page,'undo').click();
  await expect(page.locator('#f-title')).toHaveValue(original);
  await page.locator('#f-title').fill('Cambio recuperable');
  await page.locator('#f-title').blur();
  await action(page,'reset').click();
  await modalAction(page,'confirm-reset').click();
  await expect(page.locator('#f-title')).toHaveValue(original);
  await action(page,'undo').click();
  await expect(page.locator('#f-title')).toHaveValue('Cambio recuperable');
});

test('Layout controls preserve duplicated content and configured references',async ({page}) => {
  await importCard(page,{title:'Diseño con copia',elements:{value_copy1:{measure:'Ventas Periodo Anterior',size:26,x:10,y:12}},layerOrder:['value_copy1',...BASE.layerOrder]});
  await page.locator('[data-tab="style"]').click();
  const layout = page.locator('[data-layout="chart-left"]');
  await reveal(layout);await layout.click();
  await expect(layout).toHaveAttribute('aria-pressed','true');
  const saved=await draft(page);
  expect(saved.layout).toBe('chart-left');
  expect(saved.elements.value_copy1.measure).toBe('Ventas Periodo Anterior');
  expect(saved.layerOrder).toContain('value_copy1');
  await expect(page.locator('#main-card [data-element="value_copy1"]')).toBeVisible();
  await action(page,'undo').click();
  expect((await draft(page)).layout).toBe('stacked');
});

test('Icon selection and palette theme, HEX, apply and save controls work',async ({page}) => {
  await page.locator('[data-mode="advanced"]').click();
  const icons=page.locator('#app [data-action="icons"]');
  await reveal(icons);await icons.click();
  await page.locator('[data-pick-icon="heart"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect((await draft(page)).icon).toBe('heart');
  await action(page,'themes').click();
  await page.locator('[data-draft-theme="paper"]').click();
  await expect(page.locator('#color-hex')).toHaveValue('#477568');
  await page.locator('#color-hex').fill('#123456');
  await modalAction(page,'apply-theme').click();
  expect((await draft(page)).accent).toBe('#123456');
  await action(page,'themes').click();
  await page.locator('#theme-name').fill('Tema de regresión');
  await page.locator('[data-quick-color="#8771bb"]').click();
  await modalAction(page,'save-theme').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect((await draft(page)).accent).toBe('#8771bb');
  await action(page,'themes').click();
  await expect(page.locator('#custom-theme-list')).toContainText('Tema de regresión');
});

test('JSON import retains measure binding and the chosen calendar through data modal',async ({page}) => {
  await importCard(page,{title:'Calendario importado',measure:'Medida importada',dateTable:'Alternativo',dateColumn:'Dia'});
  await action(page,'open-data-modal').click();
  await expect(page.locator('#f-bind-measure')).toHaveValue('Medida importada');
  await expect(page.locator('#f-bind-dateTable')).toHaveValue('Alternativo');
  await expect(page.locator('#f-bind-dateColumn')).toHaveValue('Dia');
  await modalAction(page,'close-modal').click();
  const config=await draft(page);
  expect(config.measure).toBe('Medida importada');expect(config.dateTable).toBe('Alternativo');expect(config._measureBound).toBe(true);
});

test('PBIP folder input builds a real catalog and enables reference-checked DAX export',async ({page}) => {
  await importCard(page,{title:'Modelo local'});
  await action(page,'open-data-modal').click();
  const directory=fileURLToPath(new URL('./fixtures/Ventas.SemanticModel',import.meta.url));
  await page.locator('#pbip-folder-input').setInputFiles(directory);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kpi-atelier-pbip-cache'))?.measures?.length)).toBe(3);
  await expect(page.locator('#f-bind-dateTable')).toHaveValue('Calendario');
  await modalAction(page,'close-modal').click();
  await action(page,'export').click();
  await expect(page.locator('.dax-code')).toContainText('VAR __Current');
  const downloadEvent=page.waitForEvent('download');
  await modalAction(page,'download-dax').click();
  const download=await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.dax$/);
  const stream=await download.createReadStream();
  const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const dax=Buffer.concat(chunks).toString('utf8');
  expect(dax).toContain('TREATAS');expect(dax).not.toMatch(/@@|undefined|NaN/);
});

test('Advanced mode survives reload and Tab keeps ordinary page navigation',async ({page}) => {
  await page.locator('[data-mode="advanced"]').click();
  await page.reload();
  await expect(page.locator('[data-mode="advanced"]')).toHaveAttribute('aria-pressed','true');
  await action(page,'view-designer').focus();
  await page.keyboard.press('Tab');
  await expect(action(page,'view-library')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(action(page,'view-saved')).toBeFocused();
});


test('Unsaved-design confirmation treats a quoted title as text, never input attributes',async ({page}) => {
  const title='Panel " data-regression="atributo';
  await page.locator('#f-title').fill(title);
  await page.locator('#f-title').blur();
  await page.locator('[data-template="essential-paper"]').first().click();
  await expect(page.locator('#guard-name')).toBeVisible();
  expect(await page.locator('#guard-name').inputValue()).toContain(title);
  expect(await page.locator('#guard-name').getAttribute('data-regression')).toBeNull();
  await modalAction(page,'close-modal').click();
  await expect(page.locator('#f-title')).toHaveValue(title);
});


test('Duplicate numeric thresholds commit on blur, reject blank values and undo as one edit',async ({page}) => {
  await importCard(page,{type:'status',title:'Semáforo',elements:{status_copy1:{goodThreshold:0.95,warnThreshold:0.8}},layerOrder:['status_copy1',...BASE.layerOrder]});
  await page.locator('#main-card [data-element="status_copy1"]').click();
  const good=page.locator('#f-dup-gth'); await reveal(good);
  await good.fill('0.75'); await good.press('Tab');
  expect((await draft(page)).elements.status_copy1.goodThreshold).toBe(0.75);
  await good.fill(''); await good.press('Tab');
  await expect(good).toHaveValue('0.75');
  await action(page,'undo').click();
  expect((await draft(page)).elements.status_copy1.goodThreshold).toBe(0.95);
  await page.keyboard.press('Control+y');
  expect((await draft(page)).elements.status_copy1.goodThreshold).toBe(0.75);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  expect((await draft(page)).elements.status_copy1.goodThreshold).toBe(0.75);
});

test('Inspector tabs expose one tab stop, arrow navigation and preserve focused fields on shell rebuild',async ({page}) => {
  await page.locator('#inspector-tab-content').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#inspector-tab-style')).toBeFocused();
  await expect(page.locator('#inspector-fields')).toHaveAttribute('aria-labelledby','inspector-tab-style');
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('End');
  await expect(page.locator('#inspector-tab-data')).toBeFocused();
  await page.keyboard.press('Home');
  await page.locator('#f-title').focus();
  await page.locator('#f-title').evaluate(el => el.setSelectionRange(1,4));
  await page.evaluate(async () => { const {render}=await import('/shell-ui.mjs'); render(); });
  await expect(page.locator('#f-title')).toBeFocused();
  expect(await page.locator('#f-title').evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([1,4]);
});

test('Dark desktop controls have readable text and zoom shortcuts match their help',async ({page}) => {
  await action(page,'toggle-ui-theme').click();
  const luminance=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4});return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;};
  for(const selector of ['#f-title','.field-section summary','.mode-switch button:not(.active)','.inspector-tabs button:not(.active)','.theme-swatch:not(.active) small','.rail-more']){
    const colors=await page.locator(selector).first().evaluate(el=>{
      let surface=el;
      while(surface.parentElement&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;
      return {fg:getComputedStyle(el).color,bg:getComputedStyle(surface).backgroundColor};
    });
    const [light,dark]=[luminance(colors.fg),luminance(colors.bg)].sort((a,b)=>b-a);
    expect((light+0.05)/(dark+0.05),selector).toBeGreaterThanOrEqual(4.5);
  }
  await page.keyboard.press('Control+0');
  expect(await page.evaluate(async()=> (await import('/state.mjs')).getZoom())).toBe(100);
  await page.keyboard.press('Control+1');
  expect(await page.evaluate(async()=> (await import('/state.mjs')).getZoom())).toBeGreaterThanOrEqual(25);
});

test('Model autocomplete announces active options and commits keyboard selection',async ({page}) => {
  await action(page,'open-data-modal').click();
  await page.locator('#pbip-folder-input').setInputFiles(fileURLToPath(new URL('./fixtures/Ventas.SemanticModel',import.meta.url)));
  const input=page.locator('#f-bind-measure');
  await expect(input).toHaveAttribute('role','combobox');
  await input.fill('');await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-expanded','true');
  const list=page.locator('#dropdown-menu-measure');
  await expect(list.getByRole('option')).toHaveCount(3);
  await input.press('End');
  const last=list.getByRole('option').last();
  const selected=await last.getAttribute('data-value');
  await expect(input).toHaveAttribute('aria-activedescendant',await last.getAttribute('id'));
  await input.press('Enter');
  await expect(input).toHaveValue(selected);
  await expect(input).toHaveAttribute('aria-expanded','false');
  await expect(input).not.toHaveAttribute('aria-activedescendant',/.+/);
  await input.press('ArrowDown');await input.press('Escape');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded','false');
  const destination=page.locator('#f-bind-targetTable');
  await destination.fill('Calendario');await destination.press('Tab');
  expect((await draft(page)).targetTable).toBe('Calendario');
});

test('JSON backups and sample HTML download with incomplete bindings; DAX still requires review',async ({page})=>{
  await importCard(page,{type:'basic',comparison:'none',showComparison:false,showTrend:false,showGoal:false,measure:'',measureName:'KPI_Backup',elements:{value_copy1:{frame:{left:220,top:220,width:180,height:60}}}});
  await action(page,'export').click();
  for(const [name,extension] of [['download-json','.json'],['download-html','.html']]){
    const download=page.waitForEvent('download');
    await modalAction(page,name).click();
    expect((await download).suggestedFilename()).toMatch(new RegExp('\\'+extension+'$'));
    await expect(page.locator('#modal')).toHaveClass('export-modal');
  }
  await modalAction(page,'download-dax').click();
  await expect(page.locator('#modal')).toHaveClass('export-warning-modal');
});

test('Canvas controls remain centered across views and resolutions, with complete labelled report visuals',async ({page})=>{
  const centers=async()=>page.locator('.canvas-bottom').evaluate(el=>{
    const row=el.getBoundingClientRect(),controls=el.querySelector('.zoom-controls').getBoundingClientRect();
    return {row:row.x+row.width/2,controls:controls.x+controls.width/2};
  });
  const checkCenters=async()=>{const c=await centers();expect(Math.abs(c.row-c.controls)).toBeLessThan(1);};
  await checkCenters();
  await expect(page.locator('.canvas-bottom')).not.toContainText(/Datos de muestra/i);
  await action(page,'context').click();await checkCenters();
  await expect(page.locator('#dimensions')).toContainText('1280 × 720');
  await expect(page.getByRole('region',{name:'Ingresos por categoría'})).toBeVisible();
  await expect(page.locator('.context-category-table tbody tr')).toHaveCount(4);
  await expect(page.locator('.context-chart-month')).toHaveCount(9);
  const complete=async()=>page.locator('.context-report-grid').evaluate(el=>el.scrollHeight<=el.clientHeight+1);
  expect(await complete(),'Default report fits without clipping its visual labels').toBe(true);
  await page.getByRole('button',{name:'1920 × 1080',exact:true}).click();await checkCenters();
  expect(await complete()).toBe(true);
  await expect(page.locator('.canvas-bottom')).not.toContainText(/Datos de muestra/i);
  await page.setViewportSize({width:850,height:1000});await checkCenters();
  await action(page,'single').click();await checkCenters();
});

test('Copied charts share one editable calendar, reciprocal hover and the generated DAX references',async ({page})=>{
  await importCard(page,{dateTable:'Calendario común',dateColumn:'Fecha común',elements:{value_copy1:{measure:'Costes propios'},trend_copy1:{measure:'Obsoleta',dateTable:'Obsoleto',dateColumn:'Obsoleta',frame:{left:24,top:150,width:380,height:85}}}});
  await action(page,'open-data-modal').click();
  await expect(page.locator('#f-bind-dateTable')).toHaveValue('Calendario común');
  await expect(page.locator('[data-binding-field$="__dateTable"],[data-binding-field$="__dateColumn"]')).toHaveCount(0);
  const copied=page.locator('#binding-card-inner [data-element="trend_copy1"]');
  await copied.hover();
  await expect(page.locator('[data-binding-field="dateTable"]')).toHaveClass(/is-binding-highlight/);
  await expect(page.locator('[data-binding-field="dateColumn"]')).toHaveClass(/is-binding-highlight/);
  await expect(page.locator('[data-binding-field="value_copy1"]')).toHaveClass(/is-binding-highlight/);
  await expect(page.locator('#binding-card-inner [data-element="trend"]')).not.toHaveClass(/binding-highlight/);
  await page.locator('#f-bind-dateTable').hover();
  await expect(copied).toHaveClass(/binding-highlight/);
  await expect(page.locator('#binding-card-inner [data-element="trend"]')).toHaveClass(/binding-highlight/);
  await page.locator('#f-bind-dateTable').fill('Calendario cambiado');
  await page.locator('#f-bind-dateColumn').fill('Día cambiado');
  await modalAction(page,'export').click();
  await expect(page.locator('.dax-code')).toContainText("REMOVEFILTERS ( 'Calendario cambiado' ), TREATAS ( __GroupDates, 'Calendario cambiado'[Día cambiado] )");
  await expect(page.locator('.dax-code')).toContainText('[Costes propios]');
  await expect(page.locator('.dax-code')).not.toContainText(/Obsoleto|Obsoleta/);
});

test('Context never scrolls or loses its visual margins at extreme card sizes, zoom and both resolutions',async ({page})=>{
 for(const dimensions of [{width:800,height:650},{width:200,height:200}]){
  await importCard(page,dimensions);await action(page,'context').click();
  for(const resolution of ['1280 × 720','1920 × 1080']){
   await page.getByRole('button',{name:resolution,exact:true}).click();
   await action(page,'zoom-in').click();await page.keyboard.press('Control+1');
   const geometry=await page.locator('#context-viewport').evaluate(report=>{
    const bounds=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const grid=report.querySelector('.context-report-grid'),stage=report.closest('#stage');
    const inner=report.querySelector('.context-card-fit').getBoundingClientRect(),slot=report.querySelector('.context-card-slot').getBoundingClientRect();
    return {report:bounds(report),stage:bounds(stage),outerScroll:stage.scrollHeight>stage.clientHeight+1||stage.scrollWidth>stage.clientWidth+1,innerScroll:grid.scrollHeight>grid.clientHeight+1||grid.scrollWidth>grid.clientWidth+1,
     visuals:Array.from(report.querySelectorAll('.context-card-slot,.context-mock-visual,.context-mock-kpi')).map(bounds),cardFits:inner.width<=slot.width+1&&inner.height<=slot.height+1,
     chartFits:Array.from(report.querySelectorAll('svg')).filter(el=>!el.closest('.context-card-fit')).every(svg=>{const r=svg.getBoundingClientRect(),p=svg.closest('.context-mock-visual,.context-mock-kpi,.context-card-caption')?.getBoundingClientRect();return !p||r.left>=p.left&&r.right<=p.right+1&&r.top>=p.top&&r.bottom<=p.bottom+1})};
   });
   expect(geometry.outerScroll).toBe(false);expect(geometry.innerScroll).toBe(false);expect(geometry.cardFits).toBe(true);expect(geometry.chartFits).toBe(true);
   expect(geometry.report.left,JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.stage.left+20);
   expect(geometry.report.right).toBeLessThanOrEqual(geometry.stage.right-20);
   for(const v of geometry.visuals){expect(v.left).toBeGreaterThan(geometry.report.left);expect(v.right).toBeLessThan(geometry.report.right);expect(v.bottom).toBeLessThan(geometry.report.bottom);}
  }
  await action(page,'single').click();
 }
 await page.setViewportSize({width:540,height:900});await action(page,'context').click();
 expect(await page.locator('#stage').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)).toBe(true);
 const narrowZoom=Number((await page.locator('#zoom-text').textContent()).replace('%',''));
 await page.setViewportSize({width:1440,height:1000});
 await expect.poll(async()=>Number((await page.locator('#zoom-text').textContent()).replace('%',''))).toBeGreaterThan(narrowZoom);
 expect(await page.locator('#stage').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)).toBe(true);
});

test('Related variations and objectives show only their owner fields and update DAX when that owner changes',async ({page})=>{
 await importCard(page,{measure:'Ventas',targetMeasure:'Objetivo común',_targetCustomized:true,elements:{value_copy1:{measure:'Costes',frame:{left:220,top:80,width:150,height:50}},delta_copy1:{measure:'Obsoleta',comparison:'target',frame:{left:220,top:150,width:100,height:25}},progress_copy1:{targetMeasure:'Objetivo copia',frame:{left:220,top:200,width:150,height:4}},goalLabel_copy1:{},progressLabel_copy1:{}}});
 await action(page,'open-data-modal').click();
 await expect(page.locator('#f-bind-delta_copy1__measure,#f-bind-progress_copy1,#f-bind-goalLabel_copy1,#f-bind-progressLabel_copy1,#f-bind-delta_copy1')).toHaveCount(0);
 const variation=page.locator('#binding-card-inner [data-element="delta_copy1"]');
 await variation.hover();
 await expect(page.locator('[data-binding-field="value_copy1"]')).toHaveClass(/is-binding-highlight/);
 await expect(page.locator('[data-binding-field="goalLabel_copy1__targetMeasure"]')).toHaveClass(/is-binding-highlight/);
 await page.locator('#f-bind-value_copy1').hover();await expect(variation).toHaveClass(/binding-highlight/);
 await expect(page.locator('#binding-card-inner [data-element="progress_copy1"]')).toHaveClass(/binding-highlight/);
 await page.locator('#f-bind-value_copy1').fill('Margen');
 await modalAction(page,'export').click();
 await expect(page.locator('.dax-code')).toContainText('VAR __Cur_delta_copy1 = IF ( __HasDates, CALCULATE ( [Margen]');
 await expect(page.locator('.dax-code')).toContainText('VAR __Target_progress_copy1 = __Objective_goalLabel_copy1');
 await expect(page.locator('.dax-code')).not.toContainText(/Obsoleta|Objetivo obsoleto/);
 await modalAction(page,'open-data-modal').click();await page.locator('#f-bind-value_copy1').fill('');
 await expect(page.locator('#f-bind-value_copy1')).toHaveAttribute('aria-invalid','true');
 await modalAction(page,'export').click();await modalAction(page,'review-live-measure').click();
 await expect(page.locator('.measure-review-references')).toContainText('Sin configurar');
});

test('Destination clicks and copied value/chart/objective fields share coherent dropdowns, hover and strict review',async({page})=>{
 await importCard(page,{measure:'Sales',measureName:'Card',targetMeasure:'100',elements:{value_copy1:{measure:'Cost',frame:{left:220,top:80,width:150,height:50}},trend_copy1:{frame:{left:24,top:270,width:380,height:80}},goalLabel_copy1:{targetMeasure:'200'},progress_copy1:{},progressLabel_copy1:{},delta_copy1:{comparison:'target'}}});
 await page.evaluate(async()=>{const state=await import('/state.mjs');state.setPbipModel({modelName:'Prueba',tables:['Measures','Calendario'],measures:['Sales','Cost','Goal copy'].map(name=>({name,table:'Measures'})),dateTables:[{name:'Calendario',dateColumns:['Fecha']}]});});
 await action(page,'open-data-modal').click();
 const destination=page.locator('#f-bind-targetTable'),menu=page.locator('#dropdown-menu-targetTable');
 await destination.click();await expect(menu).toHaveClass(/is-open/);
 await destination.click();await expect(menu).toHaveClass(/is-open/);
 await page.locator('[data-action="toggle-bind-dropdown"][data-field="targetTable"]').click();await expect(menu).not.toHaveClass(/is-open/);
 await page.locator('label[for="f-bind-targetTable"]').click();await expect(menu).toHaveClass(/is-open/);
 await page.getByRole('heading',{name:'Conectar datos del modelo',exact:true}).click();await expect(menu).not.toHaveClass(/is-open/);
 await page.locator('[data-action="toggle-bind-dropdown"][data-field="targetTable"]').click();
 await page.locator('[data-action="select-binding-item"][data-field="targetTable"][data-value="Measures"]').click();await expect(destination).toHaveValue('Measures');
 await expect(page.locator('#f-bind-trend_copy1__measure')).toHaveCount(0);
 await page.locator('#f-bind-value_copy1').hover();await expect(page.locator('#binding-card-inner [data-element="trend_copy1"]')).toHaveClass(/binding-highlight/);
 await page.locator('#binding-card-inner [data-element="trend_copy1"]').hover();await expect(page.locator('[data-binding-field="value_copy1"]')).toHaveClass(/is-binding-highlight/);
 const objective=page.locator('#f-bind-goalLabel_copy1__targetMeasure');
 await objective.fill('Goal copy');await objective.hover();
 for(const id of ['goalLabel_copy1','progress_copy1','progressLabel_copy1','delta_copy1'])await expect(page.locator(`#binding-card-inner [data-element="${id}"]`)).toHaveClass(/binding-highlight/);
 await expect(page.locator('#binding-card-inner [data-element="progress"]')).not.toHaveClass(/binding-highlight/);
 await modalAction(page,'export').click();
 await expect(page.locator('.dax-code')).toContainText('VAR __Objective_goalLabel_copy1 = IF ( __HasDates, CALCULATE ( [Goal copy]');
 await expect(page.locator('.dax-code')).toContainText('VAR __Dates_trend_copy1 = __Dates');
 await modalAction(page,'open-data-modal').click();await objective.fill('');await expect(objective).toHaveAttribute('aria-invalid','true');
 await modalAction(page,'export').click();await modalAction(page,'review-live-measure').click();
 await expect(page.locator('.measure-review-reference.error')).toContainText('Objetivo · Copia 1');
 await expect(page.locator('.measure-review-reference.error')).toContainText('Sin configurar');
 await page.evaluate(async()=>{const state=await import('/state.mjs');const model=state.getPbipModel();state.setPbipModel({...model,measures:[...model.measures,{name:'Card',table:'Measures'}]});});
 await modalAction(page,'open-data-modal').click();
 await expect(destination).toBeEnabled();await expect(destination).toHaveAttribute('readonly','');await expect(destination).toHaveValue('Measures');
 await destination.click();await expect(menu).toHaveClass(/is-open/);
 await destination.click();await expect(menu).toHaveClass(/is-open/);
 await expect(menu.locator('[role="option"]')).toHaveCount(1);await expect(menu).toContainText('Se conserva al sobrescribir');
 await page.locator('[data-action="toggle-bind-dropdown"][data-field="targetTable"]').click();await expect(menu).not.toHaveClass(/is-open/);
 await page.locator('[data-action="toggle-bind-dropdown"][data-field="targetTable"]').click();await expect(menu).toHaveClass(/is-open/);
});

test('Renaming the measure updates the KPI title in the modal, editor, exported HTML and undo',async({page})=>{
 const original=await page.evaluate(async()=>structuredClone((await import('/state.mjs')).getC()));
 await action(page,'open-data-modal').click();
 await page.locator('#f-bind-measureName').fill('Ingresos revisados');
 await expect(page.locator('#binding-card-inner [data-element="title"]')).toHaveText('Ingresos revisados');
 await expect.poll(async()=>(await draft(page)).title).toBe('Ingresos revisados');
 await modalAction(page,'export').click();await expect(page.locator('.dax-code')).toContainText('Ingresos revisados');
 await modalAction(page,'close-modal').click();
 await expect(page.locator('#main-card [data-element="title"]')).toHaveText('Ingresos revisados');
 await page.keyboard.press('Control+z');
 await expect(page.locator('#main-card [data-element="title"]')).toHaveText(original.title);
 expect((await draft(page)).measureName).toBe(original.measureName);
});

test('An orphan chart and variation expose independent measures with reciprocal hover and exact DAX references',async({page})=>{
 await importCard(page,{measure:'Sales',measureName:'Card',elements:{trend_copy1:{measure:'Cost',frame:{left:24,top:250,width:380,height:85}},delta_copy1:{measure:'Margin',comparison:'custom',compareMeasure:'Sales',frame:{left:220,top:170,width:130,height:30}}}});
 await action(page,'open-data-modal').click();
 await expect(page.locator('#f-bind-trend_copy1__measure')).toHaveValue('Cost');
 await expect(page.locator('#f-bind-delta_copy1__measure')).toHaveValue('Margin');
 await page.locator('#binding-card-inner [data-element="trend_copy1"]').hover();
 await expect(page.locator('[data-binding-field="trend_copy1__measure"]')).toHaveClass(/is-binding-highlight/);
 await expect(page.locator('[data-binding-field="measure"]')).not.toHaveClass(/is-binding-highlight/);
 await page.locator('#f-bind-trend_copy1__measure').hover();
 await expect(page.locator('#binding-card-inner [data-element="trend_copy1"]')).toHaveClass(/binding-highlight/);
 await expect(page.locator('#binding-card-inner [data-element="trend"]')).not.toHaveClass(/binding-highlight/);
 await page.locator('#f-bind-trend_copy1__measure').fill('Pedidos');
 await page.screenshot({path:'test-results/medida-grafico-independiente.png'});
 await modalAction(page,'export').click();
 await expect(page.locator('.dax-code')).toContainText('CALCULATE ( [Pedidos], REMOVEFILTERS');
 await expect(page.locator('.dax-code')).toContainText('VAR __Cur_delta_copy1 = IF ( __HasDates, CALCULATE ( [Margin]');
 await modalAction(page,'open-data-modal').click();await page.locator('#f-bind-trend_copy1__measure').fill('');
 await expect(page.locator('#f-bind-trend_copy1__measure')).toHaveAttribute('aria-invalid','true');
});

test('Context zoom grows beyond fit, pans without editing the design or scrollbars, and resets to fit',async({page})=>{
 await expect(page.getByRole('heading',{name:'Elige tu tarjeta',exact:true})).toBeVisible();
 const before=await draft(page);
 await action(page,'context').click();
 const initialZoom=Number((await page.locator('#zoom-text').textContent()).replace('%',''));
 const initialWidth=await page.locator('#context-viewport').evaluate(el=>el.getBoundingClientRect().width);
 await action(page,'zoom-in').click();
 await expect.poll(async()=>Number((await page.locator('#zoom-text').textContent()).replace('%',''))).toBeGreaterThan(initialZoom);
 expect(await page.locator('#context-viewport').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(initialWidth);
 for(let i=0;i<12;i++)await action(page,'zoom-in').click();
 const stage=page.locator('#stage');await expect(stage).toHaveClass(/can-pan/);
 const box=await stage.boundingBox(),beforePan=await page.locator('#context-fit').getAttribute('style');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2+40,{steps:4});await page.mouse.up();
 expect(await page.locator('#context-fit').getAttribute('style')).not.toBe(beforePan);
 expect(await stage.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)).toBe(true);
 expect(await page.locator('.context-report-grid').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)).toBe(true);
 expect(await draft(page)).toEqual(before);
 await action(page,'zoom-out').click();
 await page.keyboard.press('Control+0');await expect(page.locator('#zoom-text')).toHaveText('100%');
 await action(page,'zoom-fit').click();await expect(page.locator('#zoom-text')).toHaveText(initialZoom+'%');
 await expect(stage).not.toHaveClass(/can-pan/);
 await page.setViewportSize({width:1024,height:640});
 const count=page.locator('.rail-heading-actions>span');
 expect(await count.evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('nowrap');
 expect(await count.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length;})).toBe(1);
 await page.screenshot({path:'test-results/zoom-contexto-actualizado.png'});
});
