import { test as base, expect } from '@playwright/test';
import { BASE } from '../../dist/model.mjs';

const SERVER = 'localhost:45678';
const DATABASE_NAME = 'Ventas de prueba';
const DATABASE_ID = 'browser-test-database-guid';
const MEASURE_NAME = 'KPI_Browser_Ventas';
const ORIGINAL_EXPRESSION = '\r\n  SUM ( Ventas[Importe] )  \r\n';

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

async function openConfiguredCard(page) {
  await page.goto(`/?server=${encodeURIComponent(SERVER)}&database=${encodeURIComponent(DATABASE_NAME)}`);
  await expect(page.locator('#app .pbip-live-pill')).toContainText('Informe de prueba');
  const config = {
    ...BASE, title: 'Ventas verificadas', measure: 'Ventas', measureName: MEASURE_NAME,
    type: 'basic', comparison: 'none', showComparison: false, showTrend: false,
    showGoal: false, _measureBound: true, elements: {}
  };
  await page.locator('#file-import').setInputFiles({ name: 'escritura.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'kpi-atelier', version: 1, config })) });
  await expect(page.locator('#main-card [data-element="title"]')).toHaveText(config.title);
  await page.locator('#app [data-action="export"]').first().click();
  await expect(modalAction(page, 'inject-live-measure')).toBeEnabled();
}

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
    await expect(modalAction(page, 'inject-live-measure')).toBeEnabled();
    await expect(modalAction(page, 'inject-live-measure')).toContainText('Sobrescribir');
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
  await expect(modalAction(page, 'inject-live-measure')).toBeEnabled();
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
