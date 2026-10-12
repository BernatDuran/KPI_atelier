import { test as base, expect } from '@playwright/test';
import { BASE } from '../../dist/model.mjs';

const SERVER = 'localhost:45678';
const DATABASE_NAME = 'Ventas de prueba';
const DATABASE_ID = 'browser-test-database-guid';
const MEASURE_NAME = 'KPI_Browser_Ventas';
const ORIGINAL_EXPRESSION = '\r\n  SUM ( Ventas[Importe] )  \r\n';
const OTHER_SERVER = 'localhost:45679';
const OTHER_DATABASE_ID = 'browser-other-database-guid';

// All Power BI requests are intercepted before navigation, including failures,
// stream reconnections and unexpected endpoints. Nothing reaches a live model.
const test = base.extend({
  bridge: [async ({ page }, use) => {
    const state = {
      expression: null,
      existingTable: 'KPIs existentes',
      outcome: 'success',
      connected: true,
      writes: [],
      reads: [],
      events: 0,
      errors: []
    };
    state.holdWrites = false;
    state.pendingWrites = [];
    state.offerOther = false;
    state.holdModelReads = false;
    state.pendingModelReads = [];
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/api/pbi/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST') {
        state.writes.push(request.postDataJSON());
        if (url.pathname !== '/api/pbi/measure') {
          return route.fulfill({ status: 400, json: { error: 'Unexpected test mutation endpoint' } });
        }
        const payload = state.writes.at(-1);
        if (state.holdWrites) await new Promise(resolve => { state.pendingWrites.push(resolve); });
        if (state.outcome === 'failure') return route.fulfill({ status: 400, json: { error: 'La escritura fue rechazada por el modelo original.', code: 'WRITE_REJECTED', outcomeUnknown: false } });
        if (state.outcome === 'conflict') {
          state.expression = 'SUM ( Ventas[Importe] ) + 42';
          return route.fulfill({ status: 409, json: { error: 'La versión revisada ha cambiado.', code: 'CONFLICT' } });
        }
        const isNew = state.expression === null;
        // Model a saved mutation whose response can be lost in transit.
        state.expression = payload.daxExpression;
        state.existingTable = payload.tableName;
        if (state.outcome === 'abort') return route.abort('connectionreset');
        if (state.outcome === 'unknown') {
          return route.fulfill({ status: 504, json: { error: 'No se recibió confirmación.', outcomeUnknown: true } });
        }
        return route.fulfill({ json: { success: true, measureName: MEASURE_NAME, tableName: payload.tableName, isNew } });
      }
      if (url.pathname === '/api/pbi/model') {
        state.reads.push(url.searchParams.get('database'));
        if (state.holdModelReads) await new Promise(resolve => { state.pendingModelReads.push(resolve); });
        if (url.searchParams.get('server') === OTHER_SERVER) return route.fulfill({ json: {
          server: OTHER_SERVER, database: 'Otro modelo', databaseId: OTHER_DATABASE_ID,
          modelName: 'Modelo B', reportName: 'Informe B', tables: [{ name: '_Measures' }],
          measures: [{ name: 'Ventas', table: '_Measures', expression: '42' }], detectedDateTables: []
        } });
        return route.fulfill({ json: {
          server: SERVER, database: DATABASE_NAME, databaseId: DATABASE_ID,
          modelName: DATABASE_NAME, reportName: 'Informe de prueba',
          tables: [{ name: '_Measures' }, { name: 'KPIs existentes' }, { name: 'Ventas' }],
          measures: [{ name: 'Ventas', table: '_Measures', expression: 'SUM ( Ventas[Importe] )' },
            ...(state.expression === null ? [] : [{ name: MEASURE_NAME, table: state.existingTable, expression: state.expression }])],
          detectedDateTables: []
        } });
      }
      const instances = state.connected ? [{ server: SERVER, database: DATABASE_NAME, pid: 99999, reportName: 'Informe de prueba' }] : [];
      if (state.offerOther) instances.push({ server: OTHER_SERVER, database: 'Otro modelo', pid: 99998, reportName: 'Informe B' });
      if (url.pathname === '/api/pbi/events') {
        state.events++;
        return route.fulfill({ status: 200, contentType: 'text/event-stream',
          body: `retry: 250\ndata: ${JSON.stringify({ type: 'instances', instances })}\n\n` });
      }
      if (url.pathname === '/api/pbi/discover') return route.fulfill({ json: { instances } });
      if (url.pathname === '/api/pbi/status') return route.fulfill({ json: { connected: state.connected, server: SERVER, databases: [{ id: DATABASE_ID, name: DATABASE_NAME }] } });
      return route.fulfill({ status: 404, json: { error: 'Unconfigured test endpoint' } });
    });
    await use(state);
    expect(state.errors, 'The production module graph must not throw browser errors').toEqual([]);
  }, { auto: true }]
});

const modalAction = (page, name) => page.locator(`#modal [data-action="${name}"]`).last();

async function openConfiguredCard(page, patch = {}) {
  await page.goto(`/?server=${encodeURIComponent(SERVER)}&database=${encodeURIComponent(DATABASE_NAME)}`);
  await expect(page.locator('#app .pbip-live-pill')).toContainText('Informe de prueba');
  const config = {
    ...BASE, title: 'Ventas verificadas', measure: 'Ventas', measureName: MEASURE_NAME,
    type: 'basic', comparison: 'none', showComparison: false, showTrend: false,
    showGoal: false, _measureBound: true, elements: {}, ...patch
  };
  await page.locator('#file-import').setInputFiles({ name: 'escritura.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'kpi-atelier', version: 1, config })) });
  await expect(page.locator('#main-card [data-element="title"]')).toHaveText(config.title);
  await page.locator('#app [data-action="export"]').first().click();
  if (!patch.targetTable || patch.targetTable !== 'Tabla eliminada') await expect(modalAction(page, 'inject-live-measure')).toBeEnabled();
}

test('Explicit destinations survive JSON import and are the actual write target',async({page,bridge})=>{
  await openConfiguredCard(page,{targetTable:'KPIs existentes'});
  await modalAction(page,'inject-live-measure').click();
  await expect(page.locator('#modal')).toContainText('Medida creada');
  expect(bridge.writes).toHaveLength(1);
  expect(bridge.writes[0].tableName).toBe('KPIs existentes');
  expect(bridge.writes[0].configAnnotation.targetTable).toBe('KPIs existentes');
});

test('A missing configured destination blocks writes instead of silently choosing another table',async({page,bridge})=>{
  await openConfiguredCard(page,{targetTable:'Tabla eliminada'});
  await expect(modalAction(page,'inject-live-measure')).toBeDisabled();
  await modalAction(page,'review-live-measure').click();
  await expect(page.locator('#modal')).toContainText('La tabla de destino no existe');
  await expect(modalAction(page,'inject-live-measure')).toBeDisabled();
  expect(bridge.writes).toHaveLength(0);
});

test('URL connection creates exactly one measure using the stable database ID', async ({ page, bridge }) => {
  await openConfiguredCard(page);
  await expect.poll(() => bridge.events).toBeGreaterThan(0);
  expect(bridge.reads[0]).toBe(DATABASE_NAME);
  await modalAction(page, 'inject-live-measure').click();
  await expect(page.locator('#modal')).toContainText('Medida creada');
  expect(bridge.writes).toHaveLength(1);
  expect(bridge.writes[0]).toMatchObject({
    server: SERVER, database: DATABASE_ID, measureName: MEASURE_NAME,
    tableName: '_Measures', expectedExpression: null,
    configAnnotation: { title: 'Ventas verificadas', measure: 'Ventas' }
  });
  expect(bridge.writes[0].daxExpression).toContain('[Ventas]');
  expect(bridge.writes[0].daxExpression).not.toContain(`${MEASURE_NAME} =`);
  // A metadata refresh following success is read-only.
  await expect.poll(() => bridge.reads.length).toBeGreaterThanOrEqual(3);
  expect(bridge.writes).toHaveLength(1);
});

test('Overwrite requires confirmation and retains the existing table and exact expression', async ({ page, bridge }) => {
  bridge.expression = ORIGINAL_EXPRESSION;
  await openConfiguredCard(page);
  await modalAction(page, 'inject-live-measure').click();
  await expect(page.locator('#modal')).toContainText('Confirmar sobrescritura');
  await expect(page.locator('#modal')).toContainText(bridge.existingTable);
  expect(bridge.writes).toHaveLength(0);
  await modalAction(page, 'proceed-inject-measure').click();
  await expect(page.locator('#modal')).toContainText('Medida actualizada');
  expect(bridge.writes).toHaveLength(1);
  expect(bridge.writes[0]).toMatchObject({ database: DATABASE_ID, tableName: bridge.existingTable, expectedExpression: ORIGINAL_EXPRESSION });
});

test('A changed version invalidates approval and requires a second explicit confirmation', async ({ page, bridge }) => {
  bridge.expression = ORIGINAL_EXPRESSION;
  await openConfiguredCard(page);
  await modalAction(page, 'inject-live-measure').click();
  await expect(page.locator('#modal')).toContainText('Confirmar sobrescritura');
  const readsBeforeApproval = bridge.reads.length;
  bridge.expression = '\r\n SUM ( Ventas[Importe] ) + 1\r\n';
  const updated = bridge.expression;
  await modalAction(page, 'proceed-inject-measure').click();
  await expect.poll(() => bridge.reads.length).toBeGreaterThan(readsBeforeApproval);
  await expect(modalAction(page, 'proceed-inject-measure')).toBeEnabled();
  await expect(page.locator('#modal')).toContainText('Confirmar sobrescritura');
  expect(bridge.writes).toHaveLength(0);
  await modalAction(page, 'proceed-inject-measure').click();
  await expect(page.locator('#modal')).toContainText('Medida actualizada');
  expect(bridge.writes).toHaveLength(1);
  expect(bridge.writes[0].expectedExpression).toBe(updated);
});

for (const outcome of ['abort', 'unknown']) {
  test(`An uncertain write (${outcome}) is never replayed when the user refreshes the review`, async ({ page, bridge }) => {
    bridge.outcome = outcome;
    await openConfiguredCard(page);
    await modalAction(page, 'inject-live-measure').click();
    await expect(page.locator('#modal')).toContainText('La medida podría haberse guardado');
    await expect(modalAction(page, 'review-live-measure')).toHaveText('Actualizar y revisar');
    await expect(modalAction(page, 'proceed-inject-measure')).toHaveCount(0);
    expect(bridge.writes).toHaveLength(1);
    const readsBeforeReview = bridge.reads.length;
    await modalAction(page, 'review-live-measure').click();
    await expect(page.locator('#modal')).toHaveClass('measure-review-modal');
    await expect(modalAction(page, 'proceed-inject-measure')).toBeEnabled();
    await expect(modalAction(page, 'proceed-inject-measure')).toContainText('Sobrescribir');
    expect(bridge.reads.length).toBeGreaterThan(readsBeforeReview);
    expect(bridge.writes).toHaveLength(1);
  });
}

test('HTTP 409 surfaces a version conflict and refreshes without repeating the write', async ({ page, bridge }) => {
  bridge.expression = ORIGINAL_EXPRESSION;
  bridge.outcome = 'conflict';
  await openConfiguredCard(page);
  await modalAction(page, 'inject-live-measure').click();
  await modalAction(page, 'proceed-inject-measure').click();
  await expect(page.locator('#modal')).toContainText('La medida cambió desde la última revisión');
  await expect(modalAction(page, 'review-live-measure')).toHaveText('Actualizar y revisar');
  expect(bridge.writes).toHaveLength(1);
  await modalAction(page, 'review-live-measure').click();
  await expect(page.locator('#modal')).toHaveClass('measure-review-modal');
  await expect(modalAction(page, 'proceed-inject-measure')).toBeEnabled();
  expect(bridge.writes).toHaveLength(1);
});

test('External Tool URL connections retain SSE monitoring and update the header after disconnection', async ({ page, bridge }) => {
  await openConfiguredCard(page);
  await modalAction(page, 'close-modal').click();
  await expect.poll(() => bridge.events).toBeGreaterThan(0);
  const initialEvents = bridge.events;
  bridge.connected = false;
  // The real EventSource reconnects to the intercepted stream using its retry field.
  await expect.poll(() => bridge.events, { timeout: 7000 }).toBeGreaterThan(initialEvents);
  await expect(page.locator('#app .pbip-live-pill')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Power BI se ha desconectado');
  expect(bridge.writes).toHaveLength(0);
});

const designSnapshot = page => page.evaluate(async () => {
  const state = await import('/state.mjs');
  return { config: state.getC(), undo: state.getUndo(), redo: state.getRedo() };
});
const currentModel = page => page.evaluate(async () => (await import('/state.mjs')).getPbipModel());

async function changeSelectionDuringWrite(page, bridge, selection) {
  await modalAction(page, 'close-modal').click();
  await page.locator('#app [data-action="open-data-modal"]').first().click();
  if (selection === 'disconnect') {
    await modalAction(page, 'disconnect-pbip').click();
    await expect.poll(() => currentModel(page)).toBeNull();
  } else {
    bridge.offerOther = true;
    await modalAction(page, 'connect-live-pbi').click();
    await page.locator(`[data-action="select-live-instance"][data-server="${OTHER_SERVER}"]`).click();
    await expect.poll(async () => (await currentModel(page))?.server).toBe(OTHER_SERVER);
  }
}

for (const selection of ['disconnect', 'replace']) {
  for (const outcome of ['success', 'unknown', 'failure']) {
    test(`A submitted write reports ${outcome} for its original target after ${selection}`, async ({ page, bridge }) => {
      bridge.holdWrites = true;
      bridge.outcome = outcome;
      await openConfiguredCard(page);
      const before = await designSnapshot(page);
      await modalAction(page, 'inject-live-measure').click();
      await expect.poll(() => bridge.pendingWrites.length).toBe(1);
      await changeSelectionDuringWrite(page, bridge, selection);
      const selectedModel = await currentModel(page);
      expect(await designSnapshot(page)).toEqual(before);
      bridge.pendingWrites.shift()();
      await expect(page.locator('#modal')).toHaveClass(outcome === 'success' ? 'inject-success-modal' : 'inject-error-modal');
      await expect(page.locator('#modal')).toContainText('Informe de prueba');
      await expect(page.locator('#modal')).toContainText(SERVER);
      await expect(page.locator('#modal')).toContainText(DATABASE_ID);
      if (outcome === 'unknown') {
        await expect(page.locator('#modal')).toContainText('La medida podría haberse guardado');
        await expect(modalAction(page, 'review-live-measure')).toBeDisabled();
      } else if (outcome === 'failure') {
        await expect(page.locator('#modal')).toContainText('rechazada por el modelo original');
        await expect(modalAction(page, 'proceed-inject-measure')).toBeDisabled();
      }
      expect(bridge.writes).toHaveLength(1);
      expect(bridge.writes[0]).toMatchObject({ server: SERVER, database: DATABASE_ID, tableName: '_Measures' });
      expect(await currentModel(page)).toEqual(selectedModel);
      expect(await designSnapshot(page)).toEqual(before);
    });
  }
}

test('Retry stays bound to the original target if selection changes after its result is shown', async ({ page, bridge }) => {
  bridge.outcome = 'failure';
  await openConfiguredCard(page);
  await modalAction(page, 'inject-live-measure').click();
  await expect(page.locator('#modal')).toHaveClass('inject-error-modal');
  await expect(modalAction(page, 'proceed-inject-measure')).toBeEnabled();
  const before = await designSnapshot(page);
  // Simulate a model selection finishing in the background while the result
  // dialog is still visible. The action guard must work beyond disabled UI.
  await page.evaluate(async ({ server, database }) => {
    const state = await import('/state.mjs');
    const { beginModelRequest } = await import('/model-session.mjs');
    const request = beginModelRequest();
    request.commit({ modelName: 'Modelo B', reportName: 'Informe B', isLiveConnection: true,
      server, database, databaseId: database, tables: ['_Measures'], measures: [], dateTables: [] }, false);
    request.finish();
  }, { server: OTHER_SERVER, database: OTHER_DATABASE_ID });
  await modalAction(page, 'proceed-inject-measure').click();
  await expect(page.locator('#modal')).toContainText('Selecciona este informe original');
  await expect(modalAction(page, 'proceed-inject-measure')).toBeDisabled();
  expect(bridge.writes).toHaveLength(1);
  expect((await currentModel(page)).server).toBe(OTHER_SERVER);
  expect(await designSnapshot(page)).toEqual(before);
});

test('Review after an uncertain write uses the submitted card even if the editor changes', async ({ page, bridge }) => {
  bridge.outcome = 'unknown';
  await openConfiguredCard(page);
  await modalAction(page, 'inject-live-measure').click();
  await expect(page.locator('#modal')).toHaveClass('inject-error-modal');
  await page.evaluate(async () => {
    const state = await import('/state.mjs');
    state.setC({ ...state.getC(), title: 'Otra tarjeta en edición', measureName: 'Otro_KPI' });
  });
  const before = await designSnapshot(page);
  await modalAction(page, 'review-live-measure').click();
  await expect(page.locator('#modal')).toHaveClass('measure-review-modal');
  await expect(page.locator('#modal')).toContainText('Ventas verificadas');
  await expect(page.locator('#modal')).toContainText(MEASURE_NAME);
  expect(await designSnapshot(page)).toEqual(before);
  expect(bridge.writes).toHaveLength(1);
  bridge.outcome = 'success';
  await modalAction(page, 'proceed-inject-measure').click();
  await expect(page.locator('#modal')).toContainText('Confirmar sobrescritura');
  await expect(page.locator('#modal')).toContainText(MEASURE_NAME);
  await expect(page.locator('#modal')).not.toContainText('Otro_KPI');
  expect(bridge.writes).toHaveLength(1);
  await modalAction(page, 'proceed-inject-measure').click();
  await expect(page.locator('#modal')).toHaveClass('inject-success-modal');
  expect(bridge.writes).toHaveLength(2);
  expect(bridge.writes[1]).toMatchObject({ server: SERVER, database: DATABASE_ID, measureName: MEASURE_NAME });
  expect(bridge.writes[1].configAnnotation.title).toBe('Ventas verificadas');
  expect(await designSnapshot(page)).toEqual(before);
});

test('Cancelling a stale preflight never submits a write or replaces the disconnect dialog', async ({ page, bridge }) => {
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = (input, options) => String(input).includes('/api/pbi/model') ? fetchOriginal(input, { ...options, signal: undefined }) : fetchOriginal(input, options);
  });
  await openConfiguredCard(page);
  const before = await designSnapshot(page);
  bridge.holdModelReads = true;
  await modalAction(page, 'inject-live-measure').click();
  await expect.poll(() => bridge.pendingModelReads.length).toBe(1);
  await changeSelectionDuringWrite(page, bridge, 'disconnect');
  bridge.holdModelReads = false;
  bridge.pendingModelReads.shift()();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await currentModel(page)).toBeNull();
  expect(await designSnapshot(page)).toEqual(before);
  expect(bridge.writes).toHaveLength(0);
  await expect(page.locator('#modal')).not.toHaveClass('inject-error-modal');
  await expect(page.locator('#modal')).not.toHaveClass('inject-success-modal');
});
