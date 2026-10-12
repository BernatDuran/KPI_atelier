import { test, expect } from '@playwright/test';
import { BASE } from '../../dist/model.mjs';
import { paletteFrom } from '../../dist/colors.mjs';

async function prepare(page, readiness = true) {
  // These disposable drafts deliberately reload to verify per-window recovery.
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await page.route('**/api/pbi/**', route => {
    if (route.request().method() === 'POST') throw new Error('Persistence tests must not write to Power BI');
    if (route.request().url().endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': test\n\n' });
    return route.fulfill({ json: { instances: [], connected: false, databases: [] } });
  });
  await page.goto('/');
  await expect(page.locator('#main-card')).toBeVisible();
  expect(await page.evaluate(async () => (await import('/state.mjs')).getActiveContext().collectionsReady)).toBe(readiness);
}
async function save(page, name) {
  return page.evaluate(async title => {
    const state = await import('/state.mjs');
    state.setC({ ...state.getC(), title });
    return state.saveCurrent(title);
  }, name);
}
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('kpi-atelier-saved') || '[]'));

test('A pending named save preserves a later document and its newly opened dialog', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const state = await import('/state.mjs');
    state.setC({ ...state.getC(), title: 'Documento A' }); state.persist();
    navigator.locks.request('kpi-atelier-saved-collection', () => new Promise(resolve => { window.__releaseSave = resolve; }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseSave)).toBe('function');
  await page.locator('[data-action="save"]').first().click();
  await page.locator('#design-name').fill('Diseño A');
  await page.locator('[data-action="confirm-save"]').click();
  await expect(page.locator('[data-action="confirm-save"]')).toBeDisabled();
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.evaluate(async () => {
    const state = await import('/state.mjs');
    state.loadDesign({ ...state.getC(), title: 'Documento B' });
    state.setC({ ...state.getC(), subtitle: 'Cambio de B' }); state.persist();
    (await import('/modals.mjs')).openModal('Diálogo del documento B', '', '<p>Debe permanecer abierto</p>');
    window.__releaseSave();
  });
  await expect.poll(() => saved(page)).toHaveLength(1);
  await expect(page.locator('#modal')).toContainText('Diálogo del documento B');
  expect(await page.evaluate(async () => {
    const s = await import('/state.mjs');
    return { title: s.getC().title, baseline: s.getBaseline().title, id: s.getActiveContext().editingSavedId, dirty: s.dirty() };
  })).toEqual({ title: 'Documento B', baseline: 'Documento B', id: null, dirty: true });
  await page.locator('#modal [data-action="close-modal"]').first().click();
  expect(await save(page, 'Diseño B')).toBe(true);
  expect((await saved(page)).map(x => x.name).sort()).toEqual(['Diseño A', 'Diseño B']);
});

test('Cancelling a save-and-continue never performs its obsolete navigation', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const s = await import('/state.mjs');
    s.setC({ ...s.getC(), title: 'Pendiente' }); s.persist();
    navigator.locks.request('kpi-atelier-saved-collection', () => new Promise(resolve => { window.__releaseGuard = resolve; }));
    s.requestNavigation(() => { window.__obsoleteNavigation = true; });
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseGuard)).toBe('function');
  await page.locator('#guard-name').fill('Guardado pendiente');
  await page.locator('[data-action="guard-save"]').click();
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.evaluate(async () => {
    (await import('/modals.mjs')).openModal('Trabajo nuevo', '', '<p>Continuar aquí</p>');
    window.__releaseGuard();
  });
  await expect.poll(() => saved(page)).toHaveLength(1);
  expect(await page.evaluate(() => window.__obsoleteNavigation)).toBeUndefined();
  await expect(page.locator('#modal')).toContainText('Trabajo nuevo');
});

test('A real popup with cloned sessionStorage retains both window recoveries', async ({ context, page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const s = await import('/state.mjs'); s.setC({ ...s.getC(), title: 'Original en ventana A' }); s.persist();
  });
  const popupReady = page.waitForEvent('popup');
  await page.evaluate(() => window.open('/', '_blank'));
  const popup = await popupReady;
  await prepare(popup);
  expect(await popup.evaluate(async () => (await import('/state.mjs')).getC().title)).toBe('Original en ventana A');
  await popup.evaluate(async () => { const s = await import('/state.mjs'); s.persist(); s.setC({ ...s.getC(), title: 'Copia en ventana B' }); s.persist(); });
  await popup.close(); await page.close();
  const fresh = await context.newPage(); await prepare(fresh);
  const titles = await fresh.evaluate(async () => (await import('/state.mjs')).getSaved().filter(x => x.id.startsWith('draft:')).map(x => x.config.title));
  expect(titles).toContain('Original en ventana A'); expect(titles).toContain('Copia en ventana B');
});

test('Notifications survive dialog rebuilds and export warning restoration', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const s = await import('/state.mjs'), m = await import('/modals.mjs');
    m.openModal('Primero', '', '<p>Uno</p>'); s.toast('Notificación persistente');
    window.__notification = document.querySelector('#toast');
    m.openModal('Segundo', '', '<p>Dos</p>');
  });
  await expect(page.locator('#toast')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('Notificación persistente');
  expect(await page.evaluate(() => window.__notification === document.querySelector('#toast'))).toBe(true);
  await page.evaluate(async () => { const m = await import('/modals.mjs'); m.requestExport(() => {}); });
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await expect(page.locator('#modal')).toContainText('Segundo');
  await expect(page.locator('#toast')).toHaveCount(1);
  await page.evaluate(async () => (await import('/state.mjs')).toast('Aviso posterior'));
  await expect(page.locator('#toast')).toContainText('Aviso posterior');
});

test('Real Web Locks serialize simultaneous saves from two desktop windows', async ({ context, page }) => {
  const other = await context.newPage();
  await Promise.all([prepare(page), prepare(other)]);
  await page.evaluate(() => {
    window.__auditLock = navigator.locks.request('kpi-atelier-saved-collection', () => new Promise(resolve => { window.__releaseAuditLock = resolve; }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseAuditLock)).toBe('function');
  const a = save(page, 'Diseño A'), b = save(other, 'Diseño B');
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(2);
  await page.evaluate(() => window.__releaseAuditLock());
  expect(await Promise.all([a, b])).toEqual([true, true]);
  // Storage notifications cross renderer processes asynchronously, after the
  // Web Lock transaction has committed. Verify convergence in both windows.
  await expect.poll(async () => (await saved(page)).map(x => x.name).sort()).toEqual(['Diseño A', 'Diseño B']);
  await expect.poll(async () => (await saved(other)).map(x => x.name).sort()).toEqual(['Diseño A', 'Diseño B']);
  await page.locator('[data-action="view-saved"]').first().click();
  await expect(page.locator('.saved-card')).toHaveCount(2);
});

test('Window drafts survive reload independently and concurrent edits retain both versions', async ({ context, page }) => {
  const other = await context.newPage();
  await Promise.all([prepare(page), prepare(other)]);
  expect(await save(page, 'Compartido')).toBe(true);
  const [original] = await saved(page);
  await Promise.all([page, other].map(win => win.evaluate(async entry => {
    const state = await import('/state.mjs');
    state.loadDesign(entry.config, entry.id);
  }, original)));
  await Promise.all([[page, 'Borrador A'], [other, 'Borrador B']].map(([win, title]) => win.evaluate(async text => {
    const state = await import('/state.mjs');
    state.setC({ ...state.getC(), title: text });
    state.persist();
  }, title)));
  await Promise.all([page.reload(), other.reload()]);
  expect(await page.evaluate(async () => (await import('/state.mjs')).getC().title)).toBe('Borrador A');
  expect(await other.evaluate(async () => (await import('/state.mjs')).getC().title)).toBe('Borrador B');
  await Promise.all([save(page, 'Edición A'), save(other, 'Edición B')]);
  const entries = await saved(page);
  expect(entries).toHaveLength(2);
  expect(entries.map(x => x.config.title).sort()).toEqual(['Edición A', 'Edición B']);
  expect(entries.filter(x => x.name.includes('Copia en conflicto'))).toHaveLength(1);
});

test('Delete confirmation cannot erase a newer version saved while its dialog is open', async ({ context, page }) => {
  const other = await context.newPage();
  await Promise.all([prepare(page), prepare(other)]);
  expect(await save(page, 'Original')).toBe(true);
  const [original] = await saved(page);
  await page.locator('[data-action="view-saved"]').first().click();
  await page.locator('.saved-card [data-action="delete"]').click();
  await expect(page.locator('#modal')).toContainText('Original');
  await other.evaluate(async entry => {
    const state = await import('/state.mjs');
    state.loadDesign(entry.config, entry.id);
    state.setC({ ...state.getC(), title: 'Contenido externo nuevo' });
    await state.saveCurrent('Versión externa nueva');
  }, original);
  await expect(page.locator('#modal')).toContainText('Original');
  await page.locator('#modal [data-action="confirm-delete"]').click();
  await expect.poll(async () => (await saved(page)).map(entry => entry.name)).toEqual(['Versión externa nueva']);
  await expect(page.locator('#toast')).toContainText(/cambió|actualizado|revisa/i);
  if (await page.locator('#modal').isVisible()) await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.locator('.saved-card [data-action="delete"]').click();
  await expect(page.locator('#modal')).toContainText('Versión externa nueva');
  await page.locator('#modal [data-action="confirm-delete"]').click();
  await expect.poll(() => saved(page)).toEqual([]);
});

async function openPalette(page, name, accent) {
  await page.evaluate(async () => (await import('/studio-ui.mjs')).openThemeStudio());
  await expect(page.locator('#modal')).toBeVisible();
  await page.locator('#theme-name').fill(name);
  await page.locator('#color-hex').fill(accent);
}
const themes = page => page.evaluate(() => JSON.parse(localStorage.getItem('kpi-atelier-themes') || '[]'));

test('Real palette transactions preserve simultaneous saves and live library updates retain edits', async ({ context, page }) => {
  const other = await context.newPage();
  await Promise.all([prepare(page), prepare(other)]);
  await Promise.all([openPalette(page, 'Paleta A', '#123456'), openPalette(other, 'Paleta B', '#654321')]);
  await page.evaluate(() => {
    window.__paletteLock = navigator.locks.request('kpi-atelier-themes-collection', () => new Promise(resolve => { window.__releasePaletteLock = resolve; }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releasePaletteLock)).toBe('function');
  await Promise.all([page.locator('[data-action="save-theme"]').click(), other.locator('[data-action="save-theme"]').click()]);
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(2);
  await page.evaluate(() => window.__releasePaletteLock());
  await expect.poll(async () => (await themes(page)).map(theme => theme.name).sort()).toEqual(['Paleta A', 'Paleta B']);
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(other.locator('#modal')).not.toBeVisible();
  expect((await themes(page)).map(theme => theme.colors.accent).sort()).toEqual(['#123456', '#654321']);
  await openPalette(other, 'Borrador intacto', '#445566');
  await page.evaluate(async () => {
    const state = await import('/state.mjs');
    await state.saveCustomTheme('Externa', { ...state.getCustomThemes()[0].colors, accent: '#778899' });
  });
  await expect(other.locator('#custom-theme-list')).toContainText('Externa');
  await expect(other.locator('#theme-name')).toHaveValue('Borrador intacto');
  await expect(other.locator('#color-hex')).toHaveValue('#445566');
  expect(await other.evaluate(async () => (await import('/state.mjs')).getPaletteDraft().accent)).toBe('#445566');
});

test('A palette changed externally while the editor is open is saved as a conflict copy', async ({ context, page }) => {
  const other = await context.newPage();
  await Promise.all([prepare(page), prepare(other)]);
  await page.evaluate(async () => {
    const state = await import('/state.mjs');
    const { paletteFrom } = await import('/colors.mjs');
    await state.saveCustomTheme('Compartida', paletteFrom(state.getC()));
  });
  await Promise.all([openPalette(page, 'Compartida', '#123456'), openPalette(other, 'Compartida', '#654321')]);
  await page.locator('[data-action="save-theme"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(other.locator('#custom-theme-list [data-draft-custom]')).toHaveCount(1);
  await expect(other.locator('#color-hex')).toHaveValue('#654321');
  await other.locator('[data-action="save-theme"]').click();
  await expect(other.locator('#modal')).not.toBeVisible();
  const entries = await themes(page);
  expect(entries).toHaveLength(2);
  expect(entries.map(theme => theme.colors.accent).sort()).toEqual(['#123456', '#654321']);
  expect(entries.filter(theme => theme.name.includes('Copia en conflicto'))).toHaveLength(1);
  expect(await other.evaluate(async () => (await import('/state.mjs')).getC().customThemeName)).toContain('Copia en conflicto');
});

test('Closing a pending palette save does not apply it to a later design', async ({ page }) => {
  await prepare(page);
  await openPalette(page, 'Pendiente', '#123456');
  await page.evaluate(() => {
    window.__paletteLock = navigator.locks.request('kpi-atelier-themes-collection', () => new Promise(resolve => { window.__releasePaletteLock = resolve; }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releasePaletteLock)).toBe('function');
  await page.locator('[data-action="save-theme"]').click();
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(1);
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.evaluate(async () => {
    const state = await import('/state.mjs');
    state.setC({ ...state.getC(), title: 'Otro diseño', accent: '#abcdef', customThemeName: '' });
    window.__releasePaletteLock();
  });
  await expect.poll(async () => (await themes(page)).map(theme => theme.name)).toEqual(['Pendiente']);
  expect(await page.evaluate(async () => {
    const state = await import('/state.mjs');
    return { title: state.getC().title, accent: state.getC().accent, theme: state.getC().customThemeName };
  })).toEqual({ title: 'Otro diseño', accent: '#abcdef', theme: '' });
});

async function durableCollection(page, key) {
  return page.evaluate(collectionKey => new Promise((resolve, reject) => {
    const opening = indexedDB.open('kpi-atelier-storage', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction('collections', 'readonly');
      const read = transaction.objectStore('collections').get(collectionKey);
      read.onsuccess = () => { resolve(read.result); };
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => db.close();
    };
  }), key);
}

test('Authoritative transactions retain both collections when renderer caches are deliberately stale', async ({ context, page }) => {
  const other = await context.newPage();
  await Promise.all([prepare(page), prepare(other)]);
  await Promise.all([page, other].map(win => win.evaluate(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    const stale = new Map(['kpi-atelier-saved', 'kpi-atelier-themes'].map(key => [key, get.call(localStorage, key)]));
    Storage.prototype.getItem = function (key) { return this === localStorage && stale.has(key) ? stale.get(key) : get.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (this === localStorage) stale.delete(key); return set.call(this, key, value); };
  })));
  expect(await Promise.all([save(page, 'Diseño A'), save(other, 'Diseño B')])).toEqual([true, true]);
  const results = await Promise.all([[page, 'Paleta A', '#123456'], [other, 'Paleta B', '#654321']].map(([win, name, accent]) => win.evaluate(async args => {
    const state = await import('/state.mjs'), { paletteFrom } = await import('/colors.mjs');
    return state.saveCustomTheme(args.name, { ...paletteFrom(state.getC()), accent: args.accent });
  }, { name, accent })));
  expect(results.every(Boolean)).toBe(true);
  expect(JSON.parse(await durableCollection(page, 'kpi-atelier-saved')).map(entry => entry.name).sort()).toEqual(['Diseño A', 'Diseño B']);
  expect(JSON.parse(await durableCollection(page, 'kpi-atelier-themes')).map(entry => entry.name).sort()).toEqual(['Paleta A', 'Paleta B']);
  await expect.poll(async () => (await saved(page)).map(entry => entry.name).sort()).toEqual(['Diseño A', 'Diseño B']);
  await expect.poll(async () => (await themes(other)).map(entry => entry.name).sort()).toEqual(['Paleta A', 'Paleta B']);
});

test('Legacy raw collections migrate exactly once and a corrupt or deleted mirror cannot erase them', async ({ page }) => {
  const designs = [{ id: 'legacy', name: 'Diseño antiguo', config: { ...BASE, title: 'Antiguo', elements: { trend_copy1: { dateTable: 'CalendarLegacy', dateColumn: 'Day', measure: '[Ventas]' } } } }];
  const palettes = [{ id: 'legacy-palette', name: 'Paleta antigua', colors: paletteFrom(BASE) }];
  await page.addInitScript(({ designs, palettes }) => {
    if (sessionStorage.getItem('legacy-seeded')) return;
    localStorage.setItem('kpi-atelier-saved', JSON.stringify(designs));
    localStorage.setItem('kpi-atelier-themes', JSON.stringify(palettes));
    sessionStorage.setItem('legacy-seeded', 'true');
  }, { designs, palettes });
  await prepare(page);
  expect(JSON.parse(await durableCollection(page, 'kpi-atelier-saved'))).toEqual(designs);
  expect(JSON.parse(await durableCollection(page, 'kpi-atelier-themes'))).toEqual(palettes);
  expect(await page.evaluate(async () => (await import('/state.mjs')).getSaved()[0].normalizationWarnings)).toEqual(expect.arrayContaining([expect.stringContaining('calendario compartido')]));
  await page.evaluate(() => localStorage.setItem('kpi-atelier-saved', '{damaged-cache'));
  await page.reload();
  expect(await page.evaluate(async () => (await import('/state.mjs')).getActiveContext().collectionsReady)).toBe(true);
  expect(await saved(page)).toEqual(designs);
  expect(await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('kpi-atelier-storage', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('collections', 'readonly'), entries = tx.objectStore('collections').getAll();
      entries.onsuccess = () => resolve(entries.result.some(entry => entry?.value === '{damaged-cache'));
      tx.oncomplete = () => db.close();
    };
  }))).toBe(true);
  await page.evaluate(() => { localStorage.removeItem('kpi-atelier-saved'); localStorage.removeItem('kpi-atelier-themes'); });
  await page.reload();
  expect(await page.evaluate(async () => (await import('/state.mjs')).getActiveContext().collectionsReady)).toBe(true);
  expect(await saved(page)).toEqual(designs);
  expect(await themes(page)).toEqual(palettes);
  await expect(page.locator('[data-action="view-saved"] .count')).toHaveText('1');
});

test('Unavailable IndexedDB rejects collection writes and leaves edits and original data intact', async ({ page }) => {
  const original = JSON.stringify([{ id: 'original', name: 'Conservado', config: BASE }]);
  await page.addInitScript(raw => {
    localStorage.setItem('kpi-atelier-saved', raw);
    Object.defineProperty(indexedDB, 'open', { value() { throw new DOMException('Storage blocked', 'SecurityError'); } });
  }, original);
  await prepare(page, false);
  expect(await page.evaluate(async () => {
    const state = await import('/state.mjs'), { paletteFrom } = await import('/colors.mjs');
    state.setC({ ...state.getC(), title: 'Cambios pendientes' });
    const saved = await state.saveCurrent('No debe guardarse'), theme = await state.saveCustomTheme('No debe guardarse', paletteFrom(state.getC()));
    return { saved, theme, dirty: state.dirty(), title: state.getC().title, raw: localStorage.getItem('kpi-atelier-saved') };
  })).toEqual({ saved: false, theme: null, dirty: true, title: 'Cambios pendientes', raw: original });
});

test('A committed collection remains visible and recoverable when the local mirror exceeds its quota', async ({ context, page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && ['kpi-atelier-saved', 'kpi-atelier-themes'].includes(key)) throw new DOMException('Cache quota exceeded', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.locator('[data-action="save"]').first().click();
  await page.locator('#design-name').fill('Guardado durable');
  await page.locator('[data-action="confirm-save"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await page.evaluate(async () => (await import('/state.mjs')).getSaved().map(entry => entry.name))).toContain('Guardado durable');
  await expect(page.locator('#toast')).toContainText(/colección|almacenamiento compartido|caché/i);
  expect(JSON.parse(await durableCollection(page, 'kpi-atelier-saved'))[0].name).toBe('Guardado durable');
  expect(await page.evaluate(() => localStorage.getItem('kpi-atelier-saved'))).toBeNull();
  await openPalette(page, 'Paleta durable', '#123456');
  await page.locator('[data-action="save-theme"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('#toast')).toContainText(/colección|almacenamiento compartido|caché/i);
  expect(JSON.parse(await durableCollection(page, 'kpi-atelier-themes'))[0].name).toBe('Paleta durable');
  const reopened = await context.newPage();
  await prepare(reopened);
  expect((await saved(reopened))[0].name).toBe('Guardado durable');
  expect((await themes(reopened))[0].name).toBe('Paleta durable');
});

test('A recovery changed between review and IndexedDB commit is preserved', async ({ page }) => {
  await prepare(page);
  expect(await page.evaluate(async base => {
    const state = await import('/state.mjs');
    const key = 'kpi-atelier-recovery:external-window';
    const old = { date: '2026-01-01', config: { ...base, title: 'Revisión anterior' } };
    const latest = { date: '2026-01-02', config: { ...base, title: 'Versión nueva' } };
    localStorage.setItem(key, JSON.stringify(old));
    const reviewed = structuredClone(state.getSaved().find(entry => entry.id === 'draft:external-window'));
    const put = IDBObjectStore.prototype.put;
    let updated = false;
    IDBObjectStore.prototype.put = function (value, collectionKey) {
      if (!updated && collectionKey === 'kpi-atelier-saved') { updated = true; localStorage.setItem(key, JSON.stringify(latest)); }
      return put.call(this, value, collectionKey);
    };
    const deleted = await state.deleteSaved(reviewed.id, reviewed);
    IDBObjectStore.prototype.put = put;
    return { deleted, raw: JSON.parse(localStorage.getItem(key)) };
  }, BASE)).toEqual({ deleted: false, raw: { date: '2026-01-02', config: { ...BASE, title: 'Versión nueva' } } });
});
