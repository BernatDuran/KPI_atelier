import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from '../dist/model.mjs';
import { paletteFrom } from '../dist/colors.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)
  };
}
function lockManager() {
  let queue = Promise.resolve();
  return { request(_name, _options, operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  } };
}
let sequence = 0;
async function openWindow(localStorage, locks, sessionStorage = memoryStorage()) {
  const state = await import(`../dist/state.mjs?window=${++sequence}`);
  const events = new Map();
  const context = {
    localStorage, sessionStorage, navigator: { locks },
    document: { querySelector: () => null, documentElement: { setAttribute() {} } },
    addEventListener: (name, handler) => events.set(name, handler), removeEventListener: name => events.delete(name)
  };
  state.setContext(context);
  return { state, context, events, sessionStorage };
}
const collection = storage => JSON.parse(storage.getItem('kpi-atelier-saved') || '[]');

test('A pending save cannot adopt its identity or baseline into a later document', async () => {
  const storage = memoryStorage();
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const locks = { request: async (_name, _options, operation) => { await wait; return operation(); } };
  const win = await openWindow(storage, locks);
  win.state.setC({ ...BASE, title: 'Documento A' });
  const pending = win.state.saveCurrent('A');
  assert.equal(await win.state.saveCurrent('Duplicado pendiente'), false);
  win.state.loadDesign({ ...BASE, title: 'Documento B' });
  win.state.setC({ ...win.state.getC(), subtitle: 'Cambio local B' });
  const baseline = structuredClone(win.state.getBaseline());
  release();
  assert.equal(await pending, true);
  assert.equal(win.context.editingSavedId, null);
  assert.deepEqual(win.state.getBaseline(), baseline);
  assert.equal(win.state.dirty(), true);
  assert.equal(await win.state.saveCurrent('B'), true);
  assert.deepEqual(collection(storage).map(x => x.name).sort(), ['A', 'B']);
  assert.equal(collection(storage).find(x => x.name === 'A').config.title, 'Documento A');
});

test('Edits within the same document remain dirty after its captured version saves', async () => {
  const storage = memoryStorage();
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const win = await openWindow(storage, { request: async (_n, _o, op) => { await wait; return op(); } });
  win.state.setC({ ...BASE, title: 'Capturado' });
  const pending = win.state.saveCurrent('Documento');
  win.state.setC({ ...win.state.getC(), title: 'Edición posterior' });
  release(); await pending;
  assert.equal(win.state.getBaseline().title, 'Capturado');
  assert.equal(win.state.getC().title, 'Edición posterior');
  assert.equal(win.state.dirty(), true);
  assert.ok(win.context.editingSavedId);
});

test('A cloned session never removes the original window recovery, including an identical first edit', async () => {
  const storage = memoryStorage(), locks = lockManager();
  const original = await openWindow(storage, locks);
  original.state.setC({ ...BASE, title: 'Original recuperable' }); original.state.persist();
  const originalKey = [...Array(storage.length)].map((_x, i) => storage.key(i)).find(key => key.startsWith('kpi-atelier-recovery:'));
  const originalRaw = storage.getItem(originalKey);
  const clonedSession = memoryStorage();
  clonedSession.setItem('kpi-atelier-window-draft', original.sessionStorage.getItem('kpi-atelier-window-draft'));
  const cloned = await openWindow(storage, locks, clonedSession);
  cloned.state.persist();
  assert.equal(storage.getItem(originalKey), originalRaw);
  cloned.state.setC({ ...cloned.state.getC(), title: 'Copia independiente' }); cloned.state.persist();
  const fresh = await openWindow(storage, locks);
  assert.ok(fresh.state.getSaved().some(x => x.config.title === 'Original recuperable'));
  assert.ok(fresh.state.getSaved().some(x => x.config.title === 'Copia independiente'));
});

test('Concurrent independent windows preserve every save and refresh stale collections', async () => {
  const storage = memoryStorage(), locks = lockManager();
  const a = await openWindow(storage, locks), b = await openWindow(storage, locks);
  a.state.setC({ ...BASE, title: 'Ventana A' });
  b.state.setC({ ...BASE, title: 'Ventana B' });
  assert.deepEqual(await Promise.all([a.state.saveCurrent('A'), b.state.saveCurrent('B')]), [true, true]);
  assert.deepEqual(collection(storage).map(x => x.name).sort(), ['A', 'B']);
  assert.equal(a.state.getSaved().length, 2);
  assert.equal(b.state.getSaved().length, 2);
});

test('Concurrent editing of the same design preserves the second version as a conflict copy', async () => {
  const storage = memoryStorage(), locks = lockManager();
  storage.setItem('kpi-atelier-saved', JSON.stringify([{ id: 'shared', name: 'Original', date: '2026-01-01', config: BASE }]));
  const a = await openWindow(storage, locks), b = await openWindow(storage, locks);
  for (const win of [a, b]) win.state.loadDesign(BASE, 'shared');
  a.state.setC({ ...a.state.getC(), title: 'Edición A' });
  b.state.setC({ ...b.state.getC(), title: 'Edición B' });
  await Promise.all([a.state.saveCurrent('Original'), b.state.saveCurrent('Original')]);
  assert.equal(collection(storage).length, 2);
  assert.deepEqual(collection(storage).map(x => x.config.title).sort(), ['Edición A', 'Edición B']);
  assert.equal(b.context.lastSaveConflict, true);
  assert.match(collection(storage)[0].name, /Copia en conflicto/);
});

test('Deleting in one window cannot erase an unrelated concurrent save or a stale edit', async () => {
  const storage = memoryStorage(), locks = lockManager();
  storage.setItem('kpi-atelier-saved', JSON.stringify([{ id: 'shared', name: 'Original', date: '2026-01-01', config: BASE }]));
  const a = await openWindow(storage, locks), b = await openWindow(storage, locks);
  b.state.loadDesign(BASE, 'shared');
  b.state.setC({ ...b.state.getC(), title: 'Recuperado' });
  const reviewed = structuredClone(a.state.getSaved().find(entry => entry.id === 'shared'));
  await Promise.all([a.state.deleteSaved('shared', reviewed), b.state.saveCurrent('Original')]);
  assert.equal(collection(storage).length, 1);
  assert.equal(collection(storage)[0].config.title, 'Recuperado');
  assert.notEqual(collection(storage)[0].id, 'shared');
  assert.equal(b.context.lastSaveConflict, true);
});

test('A rejected save retains dirty state and never overwrites a damaged collection', async () => {
  const storage = memoryStorage(), locks = lockManager();
  const win = await openWindow(storage, locks);
  win.state.setC({ ...BASE, title: 'Pendiente' });
  storage.setItem('kpi-atelier-saved', '{broken');
  assert.equal(await win.state.saveCurrent('A'), false);
  assert.equal(storage.getItem('kpi-atelier-saved'), '{broken');
  assert.equal(win.state.dirty(), true);
  storage.setItem('kpi-atelier-saved', '[]');
  win.context.navigator.locks = null;
  assert.equal(await win.state.saveCurrent('A'), false);
  assert.deepEqual(collection(storage), []);
});

test('Each window reloads its own draft and closed windows remain recoverable', async () => {
  const storage = memoryStorage(), locks = lockManager();
  const a = await openWindow(storage, locks), b = await openWindow(storage, locks);
  a.state.setC({ ...a.state.getC(), title: 'Borrador A' }); a.state.persist();
  b.state.setC({ ...b.state.getC(), title: 'Borrador B' }); b.state.persist();
  const reloaded = await openWindow(storage, locks, a.sessionStorage);
  assert.equal(reloaded.state.getC().title, 'Borrador A');
  reloaded.state.persist();
  assert.ok(reloaded.state.getSaved().some(x => x.id.startsWith('draft:') && x.config.title === 'Borrador B'));
  const fresh = await openWindow(storage, locks);
  const recovered = fresh.state.getSaved().find(x => x.config.title === 'Borrador A');
  assert.ok(recovered);
  fresh.state.loadDesign(recovered.config, recovered.id);
  assert.equal(await fresh.state.saveCurrent('Recuperado A'), true);
  assert.equal(collection(storage)[0].config.title, 'Borrador A');
  assert.ok(fresh.state.getSaved().some(x => x.config.title === 'Borrador B'));
});

test('Storage notifications update the library without replacing the editor or its draft', async () => {
  const storage = memoryStorage(), win = await openWindow(storage, lockManager());
  let renders = 0; win.context.render = () => renders++;
  win.state.setC({ ...BASE, title: 'Edición local' });
  storage.setItem('kpi-atelier-saved', JSON.stringify([{ id: 'new', name: 'Nuevo', config: BASE }]));
  win.events.get('storage')({ key: 'kpi-atelier-saved', storageArea: storage });
  assert.equal(win.context.saved.length, 1);
  assert.equal(win.state.getC().title, 'Edición local');
  assert.equal(renders, 0);
  win.state.setView('saved');
  win.events.get('storage')({ key: 'kpi-atelier-saved', storageArea: storage });
  assert.equal(renders, 1);
});

test('Delete requires the revision displayed before confirmation, including external renames', async () => {
  const storage = memoryStorage(), locks = lockManager();
  storage.setItem('kpi-atelier-saved', JSON.stringify([{ id: 'shared', name: 'Original', date: '2026-01-01', config: BASE }]));
  const a = await openWindow(storage, locks), b = await openWindow(storage, locks);
  const reviewed = structuredClone(a.state.getSaved().find(entry => entry.id === 'shared'));
  b.state.loadDesign(BASE, 'shared');
  await b.state.saveCurrent('Nombre nuevo');
  assert.equal(await a.state.deleteSaved('shared', reviewed), false);
  assert.equal(a.context.lastDeleteConflict, true);
  assert.equal(collection(storage)[0].name, 'Nombre nuevo');
  assert.equal(await a.state.deleteSaved('shared'), false);
  assert.equal(collection(storage).length, 1);
  const currentReview = structuredClone(a.state.getSaved()[0]);
  assert.equal(await a.state.deleteSaved('shared', currentReview), true);
  assert.deepEqual(collection(storage), []);
});

test('Delete checks the reviewed revision again after waiting for another transaction', async () => {
  const storage = memoryStorage(), locks = lockManager();
  storage.setItem('kpi-atelier-saved', JSON.stringify([{ id: 'shared', name: 'Original', date: '2026-01-01', config: BASE }]));
  const win = await openWindow(storage, locks);
  const reviewed = structuredClone(win.state.getSaved()[0]);
  let release;
  const holder = locks.request('kpi-atelier-saved-collection', {}, () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const pendingDelete = win.state.deleteSaved('shared', reviewed);
  reviewed.name = 'Mutated caller object';
  const external = collection(storage)[0];
  external.config.title = 'Edición externa';
  storage.setItem('kpi-atelier-saved', JSON.stringify([external]));
  release();
  await holder;
  assert.equal(await pendingDelete, false);
  assert.equal(collection(storage)[0].config.title, 'Edición externa');
});

test('Recovery deletion protects the complete reviewed date and a damaged recovery entry', async () => {
  const storage = memoryStorage(), win = await openWindow(storage, lockManager());
  const key = 'kpi-atelier-recovery:closed-window';
  storage.setItem(key, JSON.stringify({ date: '2026-01-01', config: BASE }));
  const reviewed = structuredClone(win.state.getSaved().find(entry => entry.id === 'draft:closed-window'));
  storage.setItem(key, JSON.stringify({ date: '2026-01-02', config: BASE }));
  assert.equal(await win.state.deleteSaved(reviewed.id, reviewed), false);
  storage.setItem(key, '{broken');
  assert.equal(await win.state.deleteSaved(reviewed.id, reviewed), false);
  assert.equal(storage.getItem(key), '{broken');
});

const palettes = storage => JSON.parse(storage.getItem('kpi-atelier-themes') || '[]');
const colours = accent => ({ ...paletteFrom(BASE), accent });

test('Simultaneous palette saves preserve both names from initially empty windows', async () => {
  const storage = memoryStorage(), locks = lockManager();
  const a = await openWindow(storage, locks), b = await openWindow(storage, locks);
  const results = await Promise.all([a.state.saveCustomTheme('A', colours('#123456')), b.state.saveCustomTheme('B', colours('#654321'))]);
  assert.ok(results.every(Boolean));
  assert.deepEqual(palettes(storage).map(theme => theme.name).sort(), ['A', 'B']);
  assert.deepEqual(a.state.getCustomThemes().map(theme => theme.name).sort(), ['A', 'B']);
});

test('Same-name palette creation and stale updates preserve both colour versions', async () => {
  const storage = memoryStorage(), locks = lockManager();
  const a = await openWindow(storage, locks), b = await openWindow(storage, locks);
  await Promise.all([a.state.saveCustomTheme('Compartida', colours('#123456')), b.state.saveCustomTheme('Compartida', colours('#654321'))]);
  assert.equal(palettes(storage).length, 2);
  assert.equal(b.context.lastThemeSaveConflict, true);
  assert.equal(new Set(palettes(storage).map(theme => theme.id)).size, 2);
  assert.deepEqual(palettes(storage).map(theme => theme.colors.accent).sort(), ['#123456', '#654321']);
  const original = structuredClone(a.state.getCustomThemes().find(theme => theme.name === 'Compartida'));
  await a.state.saveCustomTheme('Compartida', colours('#112233'), original);
  await b.state.saveCustomTheme('Compartida', colours('#445566'), original);
  assert.equal(palettes(storage).length, 3);
  assert.equal(palettes(storage).find(theme => theme.id === original.id).colors.accent, '#112233');
  assert.ok(palettes(storage).some(theme => theme.colors.accent === '#445566' && theme.name.includes('Copia en conflicto')));
  assert.equal(new Set(palettes(storage).map(theme => theme.name)).size, 3);
});

test('A stale palette delete preserves external edits and every unrelated palette', async () => {
  const storage = memoryStorage(), locks = lockManager();
  const a = await openWindow(storage, locks), b = await openWindow(storage, locks);
  const original = await a.state.saveCustomTheme('A', colours('#123456'));
  await b.state.saveCustomTheme('B', colours('#654321'));
  await b.state.saveCustomTheme('A', colours('#112233'), original);
  assert.equal(await a.state.deleteCustomTheme(original.id, original), false);
  assert.deepEqual(palettes(storage).map(theme => theme.name).sort(), ['A', 'B']);
  const reviewed = structuredClone(a.state.getCustomThemes().find(theme => theme.id === original.id));
  await Promise.all([a.state.deleteCustomTheme(original.id, reviewed), b.state.saveCustomTheme('C', colours('#334455'))]);
  assert.deepEqual(palettes(storage).map(theme => theme.name).sort(), ['B', 'C']);
});

test('Renaming a reviewed palette into another existing name keeps both originals', async () => {
  const storage = memoryStorage(), win = await openWindow(storage, lockManager());
  const original = await win.state.saveCustomTheme('A', colours('#123456'));
  const other = await win.state.saveCustomTheme('B', colours('#654321'));
  const renamed = await win.state.saveCustomTheme('B', colours('#112233'), original);
  assert.equal(win.context.lastThemeSaveConflict, true);
  assert.match(renamed.name, /Copia en conflicto/);
  assert.equal(palettes(storage).length, 3);
  assert.deepEqual(palettes(storage).find(theme => theme.id === original.id), original);
  assert.deepEqual(palettes(storage).find(theme => theme.id === other.id), other);
});

test('Palette storage events refresh only the library and retain the current colour draft', async () => {
  const storage = memoryStorage(), win = await openWindow(storage, lockManager());
  let updates = 0, renders = 0;
  const unsubscribe = win.state.subscribeCustomThemes(() => updates++);
  win.context.render = () => renders++;
  win.state.setC({ ...BASE, title: 'Edición local' });
  const draft = colours('#123456');
  win.state.setPaletteDraft(draft);
  storage.setItem('kpi-atelier-themes', JSON.stringify([{ id: 'external', name: 'Externa', colors: colours('#654321') }]));
  win.events.get('storage')({ key: 'kpi-atelier-themes', storageArea: storage });
  assert.equal(updates, 1);
  assert.equal(win.state.customThemes[0].name, 'Externa');
  assert.equal(win.state.getPaletteDraft(), draft);
  assert.equal(win.state.getC().title, 'Edición local');
  assert.equal(renders, 0);
  unsubscribe();
  storage.removeItem('kpi-atelier-themes');
  win.events.get('storage')({ key: null, storageArea: storage });
  assert.equal(win.state.getCustomThemes().length, 0);
  assert.equal(updates, 1);
});

test('Palette mutations retain damaged collections and reject unsafe lock-free writes', async () => {
  const storage = memoryStorage(), win = await openWindow(storage, lockManager());
  const original = await win.state.saveCustomTheme('A', colours('#123456'));
  storage.setItem('kpi-atelier-themes', '{broken');
  assert.equal(await win.state.saveCustomTheme('B', colours('#654321')), null);
  assert.equal(await win.state.deleteCustomTheme(original.id, original), false);
  assert.equal(storage.getItem('kpi-atelier-themes'), '{broken');
  storage.setItem('kpi-atelier-themes', JSON.stringify([original]));
  win.context.navigator.locks = null;
  assert.equal(await win.state.saveCustomTheme('B', colours('#654321')), null);
  assert.equal(await win.state.deleteCustomTheme(original.id, original), false);
  assert.deepEqual(palettes(storage), [original]);
});

function legacyConfig() {
  return { ...BASE, geometryVersion: 1, dateTable: 'SharedDates', dateColumn: 'Date', title: 'Título largo '.repeat(20), elements: { trend_copy1: { dateTable: 'LegacyDates', dateColumn: 'Day', measure: '[Sales]' } } };
}

test('Legacy library notices survive unrelated writes and are never persisted as metadata', async () => {
  const storage = memoryStorage(), raw = { id: 'legacy', name: 'Antiguo', config: legacyConfig() };
  storage.setItem('kpi-atelier-saved', JSON.stringify([raw]));
  const win = await openWindow(storage, lockManager());
  const legacy = win.state.getSaved().find(entry => entry.id === 'legacy');
  assert.ok(legacy.normalizationWarnings.some(warning => warning.includes('calendario compartido')));
  assert.ok(legacy.normalizationWarnings.some(warning => /recortar|recortará/.test(warning)));
  assert.equal(legacy.config.elements.trend_copy1.dateTable, undefined);
  assert.equal(legacy.storageRevision, JSON.stringify(raw));
  assert.deepEqual(collection(storage), [raw], 'Reading must preserve the original stored configuration');
  win.state.setC({ ...win.state.getC(), title: 'Otra tarjeta' });
  assert.equal(await win.state.saveCurrent('Otra'), true);
  assert.deepEqual(collection(storage).find(entry => entry.id === 'legacy'), raw);
  const other = win.state.getSaved().find(entry => entry.id !== 'legacy');
  assert.equal(await win.state.deleteSaved(other.id, structuredClone(other)), true);
  assert.deepEqual(collection(storage), [raw], 'Deleting another card must preserve unreviewed legacy settings');
  assert.ok(win.state.getSaved()[0].normalizationWarnings.some(warning => warning.includes('calendario compartido')));
  win.state.loadDesign(legacy.config, legacy.id);
  assert.equal(await win.state.saveCurrent('Antiguo'), true);
  assert.equal(win.context.lastSaveConflict, false);
  const [updated] = collection(storage);
  assert.equal(updated.id, raw.id);
  assert.equal(updated.config.elements.trend_copy1.dateTable, undefined);
  assert.equal(Object.hasOwn(updated, 'normalizationWarnings'), false);
  assert.equal(Object.hasOwn(updated, 'storageRevision'), false);
  assert.ok((win.state.getSaved()[0].normalizationWarnings || []).every(warning => !warning.includes('calendario compartido') && !/recortar|recortará/.test(warning)));
  assert.equal(await win.state.saveCurrent('Antiguo'), true);
  assert.equal(win.context.lastSaveConflict, false);
  assert.equal(collection(storage).length, 1);
});

test('Raw legacy changes remain detectable even when normalized configurations and notices match', async () => {
  const storage = memoryStorage(), raw = { id: 'legacy', name: 'Antiguo', date: '2026-01-01', config: legacyConfig() };
  storage.setItem('kpi-atelier-saved', JSON.stringify([raw]));
  const win = await openWindow(storage, lockManager());
  const reviewed = structuredClone(win.state.getSaved()[0]);
  win.state.loadDesign(reviewed.config, reviewed.id);
  const changed = structuredClone(raw);
  changed.config.elements.trend_copy1.dateTable = 'AnotherLegacyCalendar';
  storage.setItem('kpi-atelier-saved', JSON.stringify([changed]));
  const latest = win.state.getSaved()[0];
  assert.deepEqual(latest.config, reviewed.config);
  assert.deepEqual(latest.normalizationWarnings, reviewed.normalizationWarnings);
  assert.equal(await win.state.deleteSaved(reviewed.id, reviewed), false);
  assert.deepEqual(collection(storage), [changed]);
  assert.equal(await win.state.saveCurrent('Antiguo'), true);
  assert.equal(win.context.lastSaveConflict, true);
  assert.equal(collection(storage).length, 2);
  assert.deepEqual(collection(storage).find(entry => entry.id === raw.id), changed);
});

test('Recoverable legacy drafts expose notices and protect their original raw revision', async () => {
  const storage = memoryStorage(), win = await openWindow(storage, lockManager());
  const key = 'kpi-atelier-recovery:legacy-window';
  const raw = { date: '2026-01-01', config: legacyConfig(), baseline: BASE };
  storage.setItem(key, JSON.stringify(raw));
  const reviewed = structuredClone(win.state.getSaved().find(entry => entry.id === 'draft:legacy-window'));
  assert.ok(reviewed.normalizationWarnings.some(warning => warning.includes('calendario compartido')));
  assert.equal(reviewed.config.elements.trend_copy1.dateTable, undefined);
  assert.equal(reviewed.storageRevision, JSON.stringify(raw));
  assert.deepEqual(JSON.parse(storage.getItem(key)), raw);
  const changed = structuredClone(raw);
  changed.config.elements.trend_copy1.dateColumn = 'AnotherDay';
  storage.setItem(key, JSON.stringify(changed));
  assert.equal(await win.state.deleteSaved(reviewed.id, reviewed), false);
  assert.deepEqual(JSON.parse(storage.getItem(key)), changed);
  const latestReview = structuredClone(win.state.getSaved().find(entry => entry.id === reviewed.id));
  assert.equal(await win.state.deleteSaved(latestReview.id, latestReview), true);
  assert.equal(storage.getItem(key), null);
});

test('Saving a reviewed recovery keeps an externally changed source that normalizes identically', async () => {
  const storage = memoryStorage(), win = await openWindow(storage, lockManager());
  const key = 'kpi-atelier-recovery:legacy-window';
  const raw = { date: '2026-01-01', config: legacyConfig(), baseline: BASE };
  storage.setItem(key, JSON.stringify(raw));
  const reviewed = win.state.getSaved().find(entry => entry.id === 'draft:legacy-window');
  win.state.loadDesign(reviewed.config, reviewed.id);
  const changed = structuredClone(raw);
  changed.config.elements.trend_copy1.dateColumn = 'AnotherDay';
  storage.setItem(key, JSON.stringify(changed));
  assert.equal(await win.state.saveCurrent('Recuperado'), true);
  assert.deepEqual(JSON.parse(storage.getItem(key)), changed);
  assert.equal(collection(storage).length, 1);
  assert.equal(collection(storage)[0].name, 'Recuperado');
  assert.equal(collection(storage)[0].config.elements.trend_copy1.dateColumn, undefined);
});
