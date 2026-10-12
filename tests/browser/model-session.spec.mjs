import {test as base,expect} from '@playwright/test';
import {BASE} from '../../dist/model.mjs';

const A='localhost:45101', B='localhost:45102';
const instances=[{server:A,database:'db-a',reportName:'Informe A'},{server:B,database:'db-b',reportName:'Informe B'}];
const catalog=server=>({server,database:server===A?'db-a':'db-b',databaseId:server===A?'guid-a':'guid-b',modelName:server===A?'Modelo A':'Modelo B',reportName:server===A?'Informe A':'Informe B',tables:[{name:'Medidas'},{name:'Calendario'}],measures:[{name:server===A?'Medida A':'Medida B',table:'Medidas',expression:'1'}],detectedDateTables:[{table:'Calendario',dateColumns:['Fecha'],suggestedColumn:'Fecha',isOfficialMarked:true,tier:1}]});

const test=base.extend({
  bridge:[async({page},use)=>{
    const state={held:new Set(),pending:[],errors:[],writes:[]};
    page.on('pageerror',e=>state.errors.push(e.message));
    // Simulate a transport that has already received a response and cannot cancel.
    // The production revision guard must reject stale data independently of AbortController.
    await page.addInitScript(()=>{
      const original=window.fetch.bind(window);
      window.fetch=(input,options)=>String(input).includes('/api/pbi/model')?original(input,{...options,signal:undefined}):original(input,options);
    });
    await page.route('**/api/pbi/**',async route=>{
      const url=new URL(route.request().url());
      if(route.request().method()==='POST'){state.writes.push(route.request().postData());return route.fulfill({status:409,json:{error:'Read-only test'}});}
      if(url.pathname.endsWith('/model')){
        const server=url.searchParams.get('server');
        if(state.held.has(server)){state.pending.push({route,server});return;}
        return route.fulfill({json:catalog(server)});
      }
      if(url.pathname.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:'retry: 10000\ndata: '+JSON.stringify({type:'instances',instances})+'\n\n'});
      if(url.pathname.endsWith('/discover'))return route.fulfill({json:{instances}});
      return route.fulfill({json:{connected:true,databases:[]}});
    });
    await use(state);
    expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);
  },{auto:true}]
});
const action=(page,name)=>page.locator('#modal [data-action="'+name+'"]').last();
const model=page=>page.evaluate(async()=>{const state=await import('/state.mjs');return state.getPbipModel();});
const snapshot=page=>page.evaluate(async()=>{const state=await import('/state.mjs');return {config:state.getC(),undo:state.getUndo(),redo:state.getRedo()};});
async function select(page,server){await page.locator('[data-action="select-live-instance"][data-server="'+server+'"]').click();}
async function choose(page){await page.locator('#app [data-action="open-data-modal"]').click();await action(page,'connect-live-pbi').click();}
async function release(page,bridge,server){
  const entry=bridge.pending.find(p=>p.server===server);expect(entry).toBeTruthy();
  const response=page.waitForResponse(r=>r.url().includes('/api/pbi/model')&&new URL(r.url()).searchParams.get('server')===server);
  await entry.route.fulfill({json:catalog(server)});await response;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

test('Late startup model A cannot replace manually selected model B',async({page,bridge})=>{
  bridge.held.add(A);
  await page.goto('/?server='+encodeURIComponent(A)+'&database=db-a');
  await expect.poll(()=>bridge.pending.length).toBe(1);
  await choose(page);await select(page,B);
  await expect.poll(async()=>(await model(page))?.server).toBe(B);
  await expect(page.locator('#modal .pbip-bar-title')).toContainText('Informe B');
  const before=await snapshot(page);
  await release(page,bridge,A);
  expect((await model(page)).server).toBe(B);expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#modal .pbip-bar-title')).toContainText('Informe B');
});

test('The most recent of two manual model selections wins when responses arrive out of order',async({page,bridge})=>{
  bridge.held.add(A);
  await page.goto('/');await choose(page);await select(page,A);
  await expect.poll(()=>bridge.pending.length).toBe(1);
  await select(page,B);
  await expect.poll(async()=>(await model(page))?.server).toBe(B);
  const before=await snapshot(page);
  await release(page,bridge,A);
  expect((await model(page)).server).toBe(B);expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#modal .pbip-bar-title')).toContainText('Informe B');
});

test('Disconnect cancels a late refresh and preserves the complete design, references and undo history',async({page,bridge})=>{
  await page.goto('/?server='+encodeURIComponent(B)+'&database=db-b');
  await expect.poll(async()=>(await model(page))?.server).toBe(B);
  const config={...BASE,title:'Diseño conservado',measure:'Medida propia',_measureBound:true,_dateCustomized:true,_targetCustomized:true,dateTable:'Calendario manual',dateColumn:'Dia',targetMeasure:'Meta propia',elements:{value_copy1:{measure:'Otra medida',size:25},title_copy1:{text:'Texto independiente',x:10}},layerOrder:[...BASE.layerOrder,'value_copy1','title_copy1']};
  await page.locator('#file-import').setInputFiles({name:'conservar.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema:'kpi-atelier',version:1,config}))});
  await expect(page.locator('#f-title')).toHaveValue('Diseño conservado');
  if(await page.locator('#modal[open]').count())await action(page,'close-modal').click();
  await page.locator('#f-title').fill('Título editado');await page.locator('#f-title').blur();
  await page.locator('#f-subtitle').fill('Segundo cambio');await page.locator('#f-subtitle').blur();
  await page.locator('#app [data-action="undo"]').click();
  const before=await snapshot(page);expect(before.undo.length).toBeGreaterThan(0);expect(before.redo.length).toBeGreaterThan(0);
  expect(before.config.dateTable).toBe('Calendario manual');expect(before.config.elements.value_copy1.measure).toBe('Otra medida');
  await page.locator('#app [data-action="open-data-modal"]').click();
  bridge.held.add(B);await action(page,'refresh-live-pbi').click();
  await expect.poll(()=>bridge.pending.length).toBe(1);
  await action(page,'disconnect-pbip').click();
  await expect.poll(()=>model(page)).toBeNull();expect(await snapshot(page)).toEqual(before);
  await release(page,bridge,B);
  expect(await model(page)).toBeNull();expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#modal .pbip-badge')).toContainText('Sin vincular');
  await expect(page.locator('#f-bind-dateTable')).toHaveValue('Calendario manual');
});

test('Importing long text and a legacy layout reports normalization in a persistent dialog',async({page})=>{
  await page.goto('/');
  const config={...BASE,title:'x'.repeat(220),geometryVersion:1};
  await page.locator('#file-import').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema:'kpi-atelier',version:1,config}))});
  await expect(page.locator('#modal')).toContainText('Configuración importada con ajustes');
  await expect(page.locator('#modal')).toContainText('title');
  await expect(page.locator('#modal')).toContainText(/Distribución antigua|layout/);
  await expect(action(page,'close-modal')).toBeVisible();
  const state=await snapshot(page);expect(state.config.title.length).toBeLessThan(220);expect(state.config.geometryVersion).toBe(2);
});
