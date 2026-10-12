import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, sanitizeConfig } from '../dist/model.mjs';
import { applyLayout } from '../dist/layout.mjs';
import { copyElementData, pasteElementData } from '../dist/editor-clipboard.mjs';
import { finishGesture, directChange, selectCard } from '../dist/canvas.mjs';
import {
  setContext, getC, setC, getBaseline, getMode, getUiTheme, getUndo,
  getRedo, getSelectedElements, getSelectedElement, setSelectedElement,
  setGesture, getGesture, loadDesign, requestNavigation, recordEdit,
  saveCurrent, getSaved, dirty, setConfig, setPbipModel, getPbipModel
} from '../dist/state.mjs';

// Import the production ESM modules unchanged. This adapter provides browser
// boundaries only; application functions are never injected into the context.
function editor(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const context = {
    document: { querySelector: () => null, documentElement: { setAttribute() {} } },
    localStorage: storage,
    navigator: { locks: { request: async (_name, _options, operation) => operation() } }
  };
  setContext(context);
  return { context, values, storage };
}

test('ESM state restores mode, theme, draft and baseline from the active storage', () => {
  const original = sanitizeConfig({ ...BASE, title: 'Guardado' });
  editor({
    'kpi-atelier-mode': 'advanced', 'kpi-atelier-ui-theme': 'dark',
    'kpi-atelier-draft': { ...original, title: 'Pendiente' },
    'kpi-atelier-edit-state': { baseline: original, savedId: 'saved-1' }
  });
  assert.equal(getMode(), 'advanced');
  assert.equal(getUiTheme(), 'dark');
  assert.equal(getC().title, 'Pendiente');
  assert.equal(getBaseline().title, 'Guardado');
  assert.equal(dirty(), true);
  editor();
  assert.equal(getMode(), 'essential');
  assert.equal(dirty(), false, 'A new context must not inherit the previous baseline');
});

test('Opening and importing designs preserves their own complete bindings and clears selection', () => {
  const { context } = editor();
  context.pbipModel = {
    tables: ['Calendario A', 'Calendario B'], measures: [],
    dateTables: [{ name: 'Calendario A', dateColumns: ['Fecha A'] }, { name: 'Calendario B', dateColumns: ['Fecha B'] }]
  };
  const incoming = sanitizeConfig({
    ...BASE, measure: '[Importe B]', targetMeasure: '[Objetivo B]',
    compareMeasure: '[Referencia B]', dateTable: 'Calendario B', dateColumn: 'Fecha B',
    _measureBound: true, _dateCustomized: true,
    elements: { value_copy1: { measure: '[Unidades B]' } }
  });
  for (const savedId of [null, 'saved-b']) {
    setC(sanitizeConfig({ ...BASE, dateTable: 'Calendario A', dateColumn: 'Fecha A' }));
    getSelectedElements().add('value');
    setSelectedElement('value');
    setGesture({ changed: true });
    loadDesign(incoming, savedId);
    assert.deepEqual(getC(), incoming);
    assert.equal(getSelectedElements().size, 0);
    assert.equal(getSelectedElement(), null);
    assert.equal(getGesture(), null);
    assert.equal(dirty(), false);
  }
});

test('A fresh template can explicitly start unbound while retaining the working calendar', () => {
  editor();
  setC(sanitizeConfig({ ...BASE, dateTable: 'Calendario elegido', dateColumn: 'Día', _dateCustomized: true }));
  loadDesign(BASE, null, { template: true });
  assert.equal(getC().measure, '');
  assert.equal(getC()._measureBound, false);
  assert.equal(getC().dateTable, 'Calendario elegido');
  assert.equal(getC().dateColumn, 'Día');
});

test('Dirty navigation escapes titles and saved design names before placing them in attributes', () => {
  const { context } = editor();
  let html = '';
  context.openModal = (_title, _subtitle, content) => { html = content; };
  setC({ ...getC(), title: 'A" autofocus onfocus="alert(1)<tag>' });
  requestNavigation(() => assert.fail('Dirty navigation must wait'));
  assert.ok(html.includes('A&quot; autofocus onfocus=&quot;alert(1)&lt;tag&gt;'));
  assert.ok(!html.includes('value="A" autofocus'));
});

test('Layout changes preserve duplicate geometry, bindings and complete layer order', () => {
  const config = sanitizeConfig({ ...BASE,
    elements: { value_copy1: { measure: '[Net Sales]', x: 15, y: 30, frame: { left: 40, top: 55, width: 140, height: 60 } } },
    layerOrder: ['value_copy1', 'title', 'value']
  });
  for (const layout of ['chart-left', 'chart-right', 'stacked']) {
    const next = applyLayout(config, layout);
    assert.deepEqual(next.elements.value_copy1, config.elements.value_copy1);
    assert.deepEqual(next.layerOrder, config.layerOrder);
    assert.equal(next.layout, layout);
    assert.notEqual(next.elements, config.elements);
  }
  assert.equal(applyLayout(config, 'unsupported'), config);
});

test('Input history groups one control but separates different controls and branches after undo', () => {
  editor();
  const first = structuredClone(getC());
  recordEdit('title'); setC({ ...getC(), title: 'A' });
  recordEdit('title'); setC({ ...getC(), title: 'AB' });
  assert.equal(getUndo().length, 1);
  recordEdit('subtitle'); setC({ ...getC(), subtitle: 'C' });
  assert.equal(getUndo().length, 2);
  getRedo().push(structuredClone(getC()));
  setC(getUndo().pop());
  recordEdit('subtitle'); setC({ ...getC(), subtitle: 'D' });
  assert.equal(getUndo().length, 2, 'An edit after undo starts a new history entry');
  assert.equal(getRedo().length, 0);
  assert.deepEqual(getUndo()[0], first);
});

test('Cancelling a canvas gesture restores both history stacks as well as the design', () => {
  editor();
  const start = structuredClone(getC());
  const beforeUndo = [{ ...start, title: 'Anterior' }];
  const beforeRedo = [{ ...start, title: 'Posterior' }];
  getUndo().push(...beforeUndo, start);
  setC({ ...start, width: start.width + 20 });
  setGesture({ start, changed: true, undoSnapshot: beforeUndo, redo: beforeRedo });
  finishGesture(true);
  assert.deepEqual(getC(), start);
  assert.deepEqual(getUndo(), beforeUndo);
  assert.deepEqual(getRedo(), beforeRedo);
  assert.equal(getGesture(), null);
});

test('No-op edits preserve redo, while full replacement is undoable and clears selection', () => {
  editor();
  const start = structuredClone(getC());
  getRedo().push({ ...start, title: 'Rehacer' });
  assert.equal(setConfig({ title: start.title }), false);
  directChange(start);
  assert.equal(getUndo().length, 0);
  assert.equal(getRedo().length, 1);
  getSelectedElements().add('value');
  setSelectedElement('value');
  assert.equal(setConfig({ ...start, title: 'Restablecido' }, true), true);
  assert.deepEqual(getUndo()[0], start);
  assert.equal(getRedo().length, 0);
  assert.equal(getSelectedElements().size, 0);
});

test('Selecting the card releases a previous group selection', () => {
  editor();
  getSelectedElements().add('value').add('title');
  setSelectedElement('value');
  selectCard();
  assert.equal(getSelectedElements().size, 0);
  assert.equal(getSelectedElement(), null);
});

test('Moving back to the original position does not create a history entry or discard redo', () => {
  editor();
  const start = structuredClone(getC());
  const redo = [{ ...start, title: 'Rehacer' }];
  getUndo().push(start);
  setGesture({ start, changed: true, undoSnapshot: [], redo });
  finishGesture();
  assert.equal(getUndo().length, 0);
  assert.deepEqual(getRedo(), redo);
});

test('Restoring a snapshot without a duplicated element releases its stale selection', () => {
  const { context } = editor();
  const start = structuredClone(getC());
  setC(sanitizeConfig({ ...start, elements: { ...start.elements, value_copy1: { measure: 'Ventas' } } }));
  getSelectedElements().add('value_copy1');
  setSelectedElement('value_copy1');
  context.tab = 'element';
  setC(start);
  assert.equal(getSelectedElement(), null);
  assert.equal(getSelectedElements().size, 0);
  assert.equal(context.tab, 'content');
});

test('A failed save keeps the pending design, baseline and saved library intact', async () => {
  const { storage } = editor();
  const baseline = structuredClone(getBaseline());
  setC({ ...getC(), title: 'Edición valiosa' });
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.equal(await saveCurrent('Mi diseño'), false);
  assert.equal(getSaved().length, 0);
  assert.deepEqual(getBaseline(), baseline);
  assert.equal(getC().title, 'Edición valiosa');
  assert.equal(dirty(), true);
});

test('Malformed cached catalogs are ignored, and refreshing metadata never changes imported bindings', () => {
  editor({ 'kpi-atelier-pbip-cache': { tables: 'invalid', measures: null } });
  assert.equal(getPbipModel(), null);
  loadDesign({ ...BASE, dateTable: 'Propio', dateColumn: 'Día', targetMeasure: 'Objetivo Ventas' });
  const before = structuredClone(getC());
  const catalog = { modelName: 'Modelo', tables: ['Fechas'], measures: [], dateTables: [{ name: 'Fechas', dateColumns: ['Fecha'] }] };
  assert.equal(setPbipModel(catalog, true), true);
  assert.deepEqual(getC(), before, 'Import must retain bindings even if customization flags were absent');
  assert.equal(setPbipModel({ invalid: true }), false);
  assert.equal(getPbipModel().modelName, 'Modelo');
});

test('Clipboard preserves explicitly false/zero properties, detached geometry and source immutability', () => {
  const config = sanitizeConfig({ ...BASE, fillOpacity: 0, showMax: false, measure: '[Ventas]',
    elements: { trend: { frame: { left: 25, top: 100, width: 250, height: 60 } } }
  });
  const original = structuredClone(config);
  const data = copyElementData(config, 'trend');
  const result = pasteElementData(config, [data]);
  assert.deepEqual(config, original);
  assert.deepEqual(result.ids, ['trend_copy1']);
  assert.equal(result.config.elements.trend_copy1.fillOpacity, 0);
  assert.equal(result.config.elements.trend_copy1.showMax, false);
  assert.equal(result.config.elements.trend_copy1.measure, '[Ventas]');
  assert.equal(result.config.elements.trend_copy1.frame.left, 41);
  assert.equal(result.config.layerOrder[0], 'trend_copy1');
  const second = pasteElementData(result.config, [data]);
  const third = pasteElementData(second.config, [data]);
  assert.equal(third.ids.length, 0);
  assert.match(third.notices[0], /máximo 2/);
  assert.equal(third.config, second.config);
});

test('Pasting into another design uses the captured position, including the original offsets', () => {
  const source = sanitizeConfig({ ...BASE, elements: { value: { x: 30, y: 20, frame: { left: 40, top: 60, width: 150, height: 55 } } } });
  const destination = sanitizeConfig({ ...BASE, elements: { value: { frame: { left: 5, top: 5, width: 200, height: 60 } } } });
  const data = copyElementData(source, 'value');
  const result = pasteElementData(destination, [data]);
  assert.equal(result.config.elements.value_copy1.frame.left, 86);
  assert.equal(result.config.elements.value_copy1.frame.top, 96);
  assert.equal(result.config.elements.value_copy1.x, 0);
  assert.equal(result.config.elements.value_copy1.y, 0);
  assert.equal(result.config.elements.value_copy1.frame.width, 150);
});
