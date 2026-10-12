import test from 'node:test';
import assert from 'node:assert/strict';
import { setContext, setPbipModel, getPbipModel, getC } from '../dist/state.mjs';
import { beginModelRequest, cancelModelRequest, matchesModelTarget } from '../dist/model-session.mjs';
import { importModelFiles } from '../dist/model-import.mjs';
import { initLiveConnection } from '../dist/live-connection.mjs';
import { apiRequest } from '../dist/pbi-client.mjs';

const catalog = name => ({ modelName: name, tables: ['Measures'], measures: [], dateTables: [] });
function context() {
  const values = new Map();
  const ctx = { document: { querySelector: () => null, documentElement: { setAttribute() {} } },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } };
  setContext(ctx); cancelModelRequest();
  return ctx;
}

test('Selecting a newer model cancels older reads and rejects their commits', () => {
  context();
  const old = beginModelRequest();
  const latest = beginModelRequest();
  assert.equal(old.signal.aborted, true);
  assert.equal(latest.commit(catalog('B')), true);
  assert.equal(old.commit(catalog('A')), false);
  assert.equal(getPbipModel().modelName, 'B');
  old.finish();
  assert.equal(latest.isCurrent(), true, 'An obsolete completion cannot finish the newer request');
  latest.finish();
});

test('External catalog replacement invalidates pending reads even without cancellation', () => {
  context();
  const request = beginModelRequest();
  setPbipModel(catalog('Selected outside the request'), false);
  assert.equal(request.isCurrent(), false);
  assert.equal(request.commit(catalog('Stale')), false);
  request.finish();
});

test('An invalid catalog cannot be reported as a successful model commit', () => {
  context();
  const request = beginModelRequest();
  assert.equal(request.commit({ tables: [], measures: [], dateTables: [] }), false);
  assert.equal(getPbipModel(), null);
  request.finish();
});

test('A late PBIP file read cannot replace a subsequently selected live model', async () => {
  context();
  const before = structuredClone(getC());
  let complete;
  let started;
  const readingStarted = new Promise(resolve => { started = resolve; });
  const files = [{ name: 'Old.tmdl', text: () => new Promise(resolve => { complete = resolve; started(); }) }];
  const reading = importModelFiles(files);
  await readingStarted;
  assert.equal(typeof complete, 'function');
  const selection = beginModelRequest();
  selection.commit(catalog('New live selection'));
  complete('table Old\n\tmeasure Total = 1');
  await reading;
  assert.equal(getPbipModel().modelName, 'New live selection');
  assert.deepEqual(getC(), before);
  selection.finish();
});

test('Startup ignores an uncancellable response after a newer model selection', async () => {
  context();
  const originalWindow = globalThis.window, originalFetch = globalThis.fetch;
  let complete, renders = 0;
  globalThis.window = { location: { search: '?server=localhost%3A45101', protocol: 'http:' }, addEventListener() {} };
  globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
  try {
    const loading = initLiveConnection(() => { renders++; });
    const selected = beginModelRequest();
    selected.commit(catalog('B'));
    complete({ ok: true, json: async () => ({ modelName: 'A', server: 'localhost:45101', database: 'a', tables: ['Measures'], measures: [], detectedDateTables: [] }) });
    await loading;
    assert.equal(getPbipModel().modelName, 'B');
    assert.equal(renders, 0);
    selected.finish();
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});

test('API requests honour caller cancellation and classify cancelled reads correctly', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { once: true });
  });
  try {
    const read = apiRequest('/api/pbi/discover', { signal: controller.signal });
    controller.abort();
    await assert.rejects(read, error => error.name === 'AbortError' && error.outcomeUnknown === false);
  } finally { globalThis.fetch = originalFetch; }
});

test('Write-result actions match the original live server and stable database identity', () => {
  const target = { server: 'localhost:45101', database: 'guid-a', tableName: 'Measures', measureName: 'Card', reportName: 'A' };
  const original = { ...catalog('A'), isLiveConnection: true, server: target.server, database: 'Display name', databaseId: target.database };
  assert.equal(matchesModelTarget(original, target), true);
  assert.equal(matchesModelTarget({ ...original, server: 'localhost:45102' }, target), false);
  assert.equal(matchesModelTarget({ ...original, databaseId: 'guid-b' }, target), false);
  assert.equal(matchesModelTarget({ ...original, isLiveConnection: false }, target), false);
  assert.equal(matchesModelTarget(null, target), false);
});
