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
