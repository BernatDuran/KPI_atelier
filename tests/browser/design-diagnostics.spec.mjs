import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('**/api/pbi/**',route=>route.fulfill({json:{instances:[]}}));
  await page.goto('/');await expect(page.locator('#f-title')).toBeVisible();
});

test('All built-in templates avoid false warnings from adjacent text or empty layout frames',async({page})=>{
  const results=await page.evaluate(async()=>{
    const {TEMPLATES}=await import('/model.mjs'),{loadDesign,getC}=await import('/state.mjs'),{collectDesignDiagnostics}=await import('/design-diagnostics.mjs');
    const results=[];
    for(const template of TEMPLATES){
      loadDesign(template.config);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      results.push({template:template.id,issues:collectDesignDiagnostics(document.getElementById('main-card'),getC())});
    }
    return results;
  });
  expect(results).toHaveLength(18);
  for(const result of results)expect(result.issues,result.template).toEqual([]);
});

test('Longer content exposes internal text collisions without moving elements and clears when corrected',async({page})=>{
  const wrapped=await page.evaluate(async()=>{
    const {BASE}=await import('/model.mjs'),{loadDesign,getC}=await import('/state.mjs');
    loadDesign({...BASE,title:'Informe consolidado de ingresos comerciales y evolución de ventas por segmento durante el período seleccionado'});
    return (await import('/design-diagnostics.mjs')).collectCurrentDesignDiagnostics(getC());
  });
  expect(wrapped.some(issue=>issue.type==='overlap'&&issue.ids.includes('title')&&issue.ids.includes('value'))).toBe(true);
  await page.evaluate(async()=>{
    const {BASE}=await import('/model.mjs'),{loadDesign}=await import('/state.mjs');
    loadDesign({...BASE,type:'basic',showComparison:false,comparison:'none',title:'A',elements:{title:{frame:{left:28,top:48,width:200,height:20}},title_copy1:{text:'B',frame:{left:120,top:48,width:100,height:20}}},layerOrder:[...BASE.layerOrder,'title_copy1']});
  });
  await expect(page.locator('#design-diagnostics')).toBeHidden();
  const positions=await page.evaluate(async()=>(await import('/state.mjs')).getC().elements);
  await page.locator('#f-title').fill('Título bastante largo para alcanzar la otra etiqueta');
  await page.locator('#f-title').blur();
  await expect(page.locator('#design-diagnostics')).toBeVisible();
  await page.locator('#design-diagnostics summary').click();
  await expect(page.locator('#design-diagnostics')).toContainText('se superpone');
  expect(await page.evaluate(async()=>(await import('/state.mjs')).getC().elements)).toEqual(positions);
  const visible=await page.evaluate(async()=>{const {getC}=await import('/state.mjs');return (await import('/design-diagnostics.mjs')).collectDesignDiagnostics(document.getElementById('main-card'),getC());});
  expect(visible.some(issue=>issue.type==='overlap'&&issue.ids.includes('title_copy1'))).toBe(true);
  await page.locator('#app [data-action="export"]').first().click();
  await expect(page.locator('#modal')).toContainText('Avisos de legibilidad');
  await expect(page.locator('#modal')).toContainText('se superpone');
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.locator('#f-title').fill('A');await page.locator('#f-title').blur();
  await expect(page.locator('#design-diagnostics')).toBeHidden();
});

test('Export in report context still reviews collisions and HTML requires an explicit decision',async({page})=>{
  await page.evaluate(async()=>{
    const {BASE}=await import('/model.mjs'),{loadDesign}=await import('/state.mjs');
    loadDesign({...BASE,type:'basic',showComparison:false,comparison:'none',title:'Título largo que invade la otra etiqueta',elements:{title:{frame:{left:28,top:48,width:200,height:20}},title_copy1:{text:'Etiqueta',frame:{left:120,top:48,width:100,height:20}}}});
  });
  const before=await page.evaluate(async()=>(await import('/state.mjs')).getC());
  await page.locator('[data-action="context"]').click();
  await expect(page.locator('#main-card')).toHaveCount(0);
  await expect(page.locator('#design-diagnostics')).toBeVisible();
  await page.locator('#app [data-action="export"]').first().click();
  await expect(page.locator('#modal')).toContainText('se superpone');
  await page.locator('#modal [data-action="download-html"]').click();
  await expect(page.locator('#modal')).toContainText('Revisa el diseño antes de exportar');
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await expect(page.locator('#modal')).toHaveClass('export-modal');
  await page.locator('#modal [data-action="download-html"]').click();
  const download=page.waitForEvent('download');
  await page.locator('[data-action="confirm-export-anyway"]').click();
  expect((await download).suggestedFilename()).toMatch(/\.html$/);
  expect(await page.evaluate(async()=>(await import('/state.mjs')).getC())).toEqual(before);
  expect(await page.locator('[style*="left: -10000px"]').count()).toBe(0);
});
