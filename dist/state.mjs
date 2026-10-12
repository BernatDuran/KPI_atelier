/**
 * KPI Atelier - Módulo de Estado Centralizado, Persistencia e Historial (dist/state.mjs)
 * Gestiona el estado reactivo, la memoria local, la pila undo/redo y la sincronización con el contexto.
 */

import { BASE, sanitizeConfig, THEMES, FAMILIES, TEMPLATES, familyName } from './model.mjs';
import { sanitizePalette } from './colors.mjs';
import { icon, esc, cardHTML } from './cards.mjs';
import { sanitizeModelCatalog, validateImportedJSON } from './schema.mjs';
import { ELEMENT_IDS } from './elements.mjs';
import { COLLECTION_LOCKS, collectionValue, collectionTransaction, hydrateCollections } from './collection-store.mjs';

// Utilería para lectura segura de LocalStorage y DOM
export const $ = (s, el) => {
  const doc = (activeCtx && activeCtx.document) || (typeof document !== 'undefined' ? document : null);
  const root = el || doc;
  return root && typeof root.querySelector === 'function' ? root.querySelector(s) : null;
};
export const btn = (action, label, ico, cl = '', extra = '') => `<button class="${cl}" data-action="${action}" ${extra}>${ico ? icon(ico) : ''}<span>${label}</span></button>`;
export const ib = (action, label, ico, extra = '') => `<button class="icon-btn" data-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(ico)}</button>`;

export const read = (k, f) => {
  try {
    const storage = (activeCtx && activeCtx.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    const val = storage ? storage.getItem(k) : null;
    return val !== null ? JSON.parse(val) : f;
  } catch {
    return f;
  }
};

// Puntero de Contexto Activo (garantiza sincronización tanto en navegador como en test sandbox de Node vm)
let activeCtx = typeof globalThis !== 'undefined' ? globalThis : null;
const SAVED_KEY = 'kpi-atelier-saved';
const THEMES_KEY = 'kpi-atelier-themes';
const DRAFT_SESSION_KEY = 'kpi-atelier-window-draft';
const RECOVERY_PREFIX = 'kpi-atelier-recovery:';
let draftId = null;
let previousDraftId = null;
let editingSavedRevision = null;
let storageListener = null;
let storageEventTarget = null;
const themeListeners = new Set();
const storageOf = (ctx = activeCtx) => ctx?.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
function sessionOf(ctx = activeCtx) {
  try { return ctx?.sessionStorage || ctx?.window?.sessionStorage || null; } catch { return null; }
}
function parseStorage(storage, key, fallback = null) {
  try { const value = collectionValue(storage, key); return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}
function storedDesignEntries(storage = storageOf(), strict = false) {
  const entries = parseStorage(storage, SAVED_KEY, strict ? null : []);
  if (strict && collectionValue(storage, SAVED_KEY) !== null && (!Array.isArray(entries) || entries.some(x => !x || typeof x.id !== 'string' || !x.config))) throw new Error('La colección guardada está dañada. Exporta tus cambios; la colección original se ha conservado.');
  return Array.isArray(entries) ? entries.filter(x => x && typeof x.id === 'string' && x.config) : [];
}
function normalizedSavedDesign(raw, revision = JSON.stringify(raw)) {
  const validation = validateImportedJSON(raw.config);
  const warnings = [...validation.warnings];
  if (!validation.valid) warnings.push('Se adaptarán ajustes no compatibles del diseño guardado: ' + validation.errors.slice(0, 3).join('; '));
  const { normalizationWarnings: _warnings, storageRevision: _revision, ...entry } = raw;
  return { ...entry, config: validation.config || sanitizeConfig(raw.config), storageRevision: revision, ...(warnings.length ? { normalizationWarnings: warnings } : {}) };
}
function storedDesigns(storage = storageOf(), strict = false) {
  return storedDesignEntries(storage, strict).map(entry => normalizedSavedDesign(entry));
}
// Runtime notices never form part of a saved revision or reach localStorage.
function savedRevision(entry) {
  if (typeof entry.storageRevision === 'string') return entry.storageRevision;
  const { normalizationWarnings: _warnings, storageRevision: _revision, ...record } = entry;
  return JSON.stringify(record);
}
function recoveryEntry(id, draft) {
  return normalizedSavedDesign({ id, name: 'Borrador recuperable · ' + String(draft.config.title || 'Sin título'), date: draft.date, config: draft.config }, JSON.stringify(draft));
}
function recoveryDesigns(storage = storageOf()) {
  const entries = [];
  for (let i = 0; storage && i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(RECOVERY_PREFIX) || key === RECOVERY_PREFIX + draftId || key === RECOVERY_PREFIX + previousDraftId) continue;
    const draft = parseStorage(storage, key);
    if (!draft?.config || typeof draft.date !== 'string') continue;
    entries.push(recoveryEntry('draft:' + key.slice(RECOVERY_PREFIX.length), draft));
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
function refreshSaved() {
  setSaved([...storedDesigns(), ...recoveryDesigns()]);
}
function storedCustomThemes(storage = storageOf(), strict = false) {
  const entries = parseStorage(storage, THEMES_KEY, strict ? null : []);
  const valid = theme => theme && typeof theme.id === 'string' && /^[\w-]+$/.test(theme.id) && typeof theme.name === 'string' && sanitizePalette(theme.colors);
  if (strict && collectionValue(storage, THEMES_KEY) !== null && (!Array.isArray(entries) || entries.some(theme => !valid(theme)) || new Set(entries.map(theme => theme.id)).size !== entries.length)) {
    throw new Error('La colección de paletas está dañada. Las paletas originales se han conservado.');
  }
  return Array.isArray(entries) ? entries.filter(valid).map(theme => ({ ...theme, name: theme.name.slice(0, 40), colors: sanitizePalette(theme.colors) })) : [];
}
function refreshCustomThemes() {
  const next = storedCustomThemes();
  if (JSON.stringify(next) === JSON.stringify(customThemes)) return;
  customThemes.splice(0, customThemes.length, ...next);
  for (const listener of themeListeners) listener();
}
export function getCustomThemes() { refreshCustomThemes(); return customThemes; }
/** Update the palette library without replacing an open colour editor. */
export function subscribeCustomThemes(listener) {
  themeListeners.add(listener);
  return () => { themeListeners.delete(listener); };
}
function installStorageSync(ctx) {
  if (storageListener) storageEventTarget?.removeEventListener?.('storage', storageListener);
  storageEventTarget = ctx?.window || ctx;
  storageListener = event => {
    if (event.storageArea && event.storageArea !== storageOf(ctx)) return;
    if (ctx?.indexedDB || ctx?.window?.indexedDB) {
      const keys = event.key === null ? [...COLLECTION_LOCKS.values()] : COLLECTION_LOCKS.has(event.key + '-collection') ? [event.key] : [];
      if (keys.length) {
        hydrateCollections(ctx, keys).then(() => {
          if (activeCtx !== ctx) return;
          refreshSaved(); refreshCustomThemes();
          if (getView() === 'saved') callCtx('render');
          reportCollectionWarning(ctx);
        }).catch(error => { if (activeCtx === ctx) toast(error.message); });
        return;
      }
    }
    if (event.key === null || event.key === THEMES_KEY) refreshCustomThemes();
    if (event.key !== null && event.key !== SAVED_KEY && !event.key?.startsWith(RECOVERY_PREFIX)) return;
    refreshSaved();
    // Never replace an editor's DOM or its draft because another window saved.
    if (getView() === 'saved') callCtx('render');
  };
  storageEventTarget?.addEventListener?.('storage', storageListener);
}
export function setContext(ctx) {
  activeCtx = ctx;
  if (typeof globalThis !== 'undefined' && ctx) {
    if (ctx.document) {
      try { globalThis.document = ctx.document; } catch {}
    }
    if (ctx.localStorage) {
      try { globalThis.localStorage = ctx.localStorage; } catch {}
    }
    if (ctx.window) {
      try { globalThis.window = ctx.window; } catch {}
    }
  }
  const windowDraft = parseStorage(sessionOf(ctx), DRAFT_SESSION_KEY);
  previousDraftId = typeof windowDraft?.id === 'string' ? windowDraft.id : null;
  draftId = crypto.randomUUID();
  c = sanitizeConfig(windowDraft?.config || read('kpi-atelier-draft', BASE));
  designBindingsLocked = Boolean(windowDraft?.config) || read('kpi-atelier-draft', null) !== null;
  saved = [...storedDesigns(), ...recoveryDesigns()];
  refreshCustomThemes();
  pbipModel = sanitizeModelCatalog(read('kpi-atelier-pbip-cache', null));
  const restoredEditState = windowDraft || read('kpi-atelier-edit-state', null);
  baseline = restoredEditState?.baseline ? sanitizeConfig(restoredEditState.baseline) : structuredClone(c);
  editingSavedId = typeof restoredEditState?.savedId === 'string' ? restoredEditState.savedId : null;
  editingSavedRevision = restoredEditState?.savedRevision || null;
  undo = [];
  redo = [];
  lastEdit = 0;
  cardSelected = false;
  selectedElement = null;
  selectedElements = new Set();
  gesture = null;
  formatPainterSource = null;
  deleteConfirmLayer = null;
  view = 'designer';
  const restoredMode = read('kpi-atelier-mode', 'essential');
  mode = restoredMode === 'advanced' || restoredMode === 'pro' ? 'advanced' : 'essential';
  uiTheme = read('kpi-atelier-ui-theme', 'light') === 'dark' ? 'dark' : 'light';
  tab = 'content';
  filter = 'all';
  query = '';
  context = false;
  railCollapsed = read('kpi-atelier-rail-collapsed', false);
  if (ctx) {
    ctx.designRevision = (ctx.designRevision || 0) + 1;
    ctx.savePending = false;
    ctx.c = c;
    ctx.baseline = baseline;
    ctx.editingSavedId = editingSavedId;
    ctx.editingSavedRevision = editingSavedRevision;
    ctx.saved = saved;
    ctx.pbipModel = pbipModel;
    ctx.undo = undo;
    ctx.redo = redo;
    ctx.lastEdit = lastEdit;
    ctx.lastEditKey = null;
    ctx.cardSelected = cardSelected;
    ctx.selectedElement = selectedElement;
    ctx.selectedElements = selectedElements;
    ctx.gesture = gesture;
    ctx.formatPainterSource = formatPainterSource;
    ctx.deleteConfirmLayer = deleteConfirmLayer;
    ctx.uiTheme = uiTheme;
    ctx.railCollapsed = railCollapsed;
    ctx.view = view;
    ctx.mode = mode;
    ctx.tab = tab;
    ctx.filter = filter;
    ctx.query = query;
    ctx.context = context;
    ctx.inspectorSections = inspectorSections;
    ctx.inspectorPositions = inspectorPositions;
    if (ctx.document?.documentElement) {
      try { ctx.document.documentElement.setAttribute('data-ui-theme', uiTheme); } catch {}
    }
  }
  installStorageSync(ctx);
  if (ctx) ctx.collectionsReady = hydrateCollections(ctx, [...COLLECTION_LOCKS.values()], true).then(() => {
    if (activeCtx !== ctx) return true;
    refreshSaved(); refreshCustomThemes();
    if (getView() === 'saved') callCtx('render');
    reportCollectionWarning(ctx);
    return true;
  }).catch(error => { if (activeCtx === ctx) toast(error.message); return false; });
}

function reportCollectionWarning(ctx) {
  if (ctx.collectionSyncWarning && activeCtx === ctx) {
    ctx.lastCollectionSyncWarning = ctx.collectionSyncWarning;
    toast(ctx.collectionSyncWarning);
    ctx.collectionSyncWarning = null;
  }
}
/** @returns {any} */
export function getActiveContext() { return activeCtx || (typeof globalThis !== 'undefined' ? globalThis : {}); }
/** A document identity, independent of ordinary edits made while saving.
 * @returns {import('./types.d.ts').DesignSession}
 */
export function captureDesignSession() {
  const context = getActiveContext();
  return { context, revision: context.designRevision || 0 };
}
/** @param {import('./types.d.ts').DesignSession} session */
export function isDesignSessionCurrent(session) {
  return session.context === getActiveContext() && session.revision === (getActiveContext().designRevision || 0);
}
export const callCtx = (fnName, ...args) => {
  if (activeCtx && typeof activeCtx[fnName] === 'function') return activeCtx[fnName](...args);
  if (typeof globalThis[fnName] === 'function') return globalThis[fnName](...args);
};

// Helpers de resolución de variables vinculadas al contexto activo
export function getC() { return (activeCtx && activeCtx.c !== undefined) ? activeCtx.c : c; }
export function setC(val) {
  c = val;
  if (activeCtx) activeCtx.c = val;
  // Undoing a duplication can remove the selected object. Keep selection tied
  // to the document, instead of exposing a stale inspector for a missing copy.
  const exists = id => ELEMENT_IDS.includes(id) || Object.hasOwn(val.elements || {}, id);
  const selection = getSelectedElements();
  for (const id of selection) if (!exists(id)) selection.delete(id);
  const current = getSelectedElement();
  if (current && !exists(current)) {
    setSelectedElement(selection.values().next().value || null);
    if (!getSelectedElement() && getTab() === 'element') setTab('content');
  }
  return c;
}
export function getBaseline() { return (activeCtx && activeCtx.baseline !== undefined) ? activeCtx.baseline : baseline; }
export function setBaseline(val) { baseline = val; if (activeCtx) activeCtx.baseline = val; }
export function getMode() { return (activeCtx && activeCtx.mode !== undefined) ? activeCtx.mode : mode; }
export function setMode(val) { mode = val; if (activeCtx) activeCtx.mode = val; }
export function getTab() { return (activeCtx && activeCtx.tab !== undefined) ? activeCtx.tab : tab; }
export function setTab(val) { tab = val; if (activeCtx) activeCtx.tab = val; }
export function getView() { return (activeCtx && activeCtx.view !== undefined) ? activeCtx.view : view; }
export function setView(val) { view = val; if (activeCtx) activeCtx.view = val; }
export function getSelectedElement() { return (activeCtx && activeCtx.selectedElement !== undefined) ? activeCtx.selectedElement : selectedElement; }
export function setSelectedElement(val) { selectedElement = val; if (activeCtx) activeCtx.selectedElement = val; }
export function getCardSelected() { return (activeCtx && activeCtx.cardSelected !== undefined) ? activeCtx.cardSelected : cardSelected; }
export function setCardSelected(val) { cardSelected = val; if (activeCtx) activeCtx.cardSelected = val; }
export function getSelectedElements() { return (activeCtx && activeCtx.selectedElements !== undefined) ? activeCtx.selectedElements : selectedElements; }
/** @returns {import('./types.d.ts').ModelCatalog | null} */
export function getPbipModel() { return (activeCtx && activeCtx.pbipModel !== undefined) ? activeCtx.pbipModel : pbipModel; }
export function getUndo() { return (activeCtx && activeCtx.undo !== undefined) ? activeCtx.undo : undo; }
export function getRedo() { return (activeCtx && activeCtx.redo !== undefined) ? activeCtx.redo : redo; }
/** @returns {import('./types.d.ts').SavedDesign[]} */
export function getSaved() {
  // Read the shared collection at the point of use, including a window opened
  // before the latest save or a recovery draft left by an interrupted session.
  refreshSaved();
  return (activeCtx && activeCtx.saved !== undefined) ? activeCtx.saved : saved;
}
export function setSaved(val) {
  saved = val;
  if (activeCtx) activeCtx.saved = val;
  const count = $('[data-action="view-saved"] .count');
  if (count) count.textContent = String(val.length);
}

export function getZoom() { return (activeCtx && activeCtx.zoom !== undefined) ? activeCtx.zoom : zoom; }
export function setZoom(val) { zoom = val; if (activeCtx) activeCtx.zoom = val; }
export function getCanvasDark() { return (activeCtx && activeCtx.canvasDark !== undefined) ? activeCtx.canvasDark : canvasDark; }
export function setCanvasDark(val) { canvasDark = val; if (activeCtx) activeCtx.canvasDark = val; }
export function getContextPreview() { return (activeCtx && activeCtx.context !== undefined) ? activeCtx.context : context; }
export function setContextPreview(val) { context = val; if (activeCtx) activeCtx.context = val; }
export function getMoveStep() { return (activeCtx && activeCtx.moveStep !== undefined) ? activeCtx.moveStep : moveStep; }
export function setMoveStep(val) { moveStep = val; if (activeCtx) activeCtx.moveStep = val; }
export function getLayersOpen() { return (activeCtx && activeCtx.layersOpen !== undefined) ? activeCtx.layersOpen : layersOpen; }
export function setLayersOpen(val) { layersOpen = val; if (activeCtx) activeCtx.layersOpen = val; }
export function getGuidesEnabled() { return (activeCtx && activeCtx.guidesEnabled !== undefined) ? activeCtx.guidesEnabled : guidesEnabled; }
export function setGuidesEnabled(val) { guidesEnabled = val; if (activeCtx) activeCtx.guidesEnabled = val; }
export function getFormatPainterSource() { return (activeCtx && activeCtx.formatPainterSource !== undefined) ? activeCtx.formatPainterSource : formatPainterSource; }
export function setFormatPainterSource(val) { formatPainterSource = val; if (activeCtx) activeCtx.formatPainterSource = val; }
export function getGesture() { return (activeCtx && activeCtx.gesture !== undefined) ? activeCtx.gesture : gesture; }
export function setGesture(val) { gesture = val; if (activeCtx) activeCtx.gesture = val; }
export function getDeleteConfirmLayer() { return (activeCtx && activeCtx.deleteConfirmLayer !== undefined) ? activeCtx.deleteConfirmLayer : deleteConfirmLayer; }
export function setDeleteConfirmLayer(val) { deleteConfirmLayer = val; if (activeCtx) activeCtx.deleteConfirmLayer = val; }
export function getClipboardElement() { return (activeCtx && activeCtx.clipboardElement !== undefined) ? activeCtx.clipboardElement : clipboardElement; }
export function setClipboardElement(val) { clipboardElement = val; if (activeCtx) activeCtx.clipboardElement = val; }
export function getClipboardElements() { return (activeCtx && activeCtx.clipboardElements !== undefined) ? activeCtx.clipboardElements : clipboardElements; }
export function setClipboardElements(val) { clipboardElements = val; if (activeCtx) activeCtx.clipboardElements = val; }
export function getPaletteDraft() { return (activeCtx && activeCtx.paletteDraft !== undefined) ? activeCtx.paletteDraft : paletteDraft; }
export function setPaletteDraft(val) { paletteDraft = val; if (activeCtx) activeCtx.paletteDraft = val; }
export function getColorRole() { return (activeCtx && activeCtx.colorRole !== undefined) ? activeCtx.colorRole : colorRole; }
export function setColorRole(val) { colorRole = val; if (activeCtx) activeCtx.colorRole = val; }
export function getColorHSV() { return (activeCtx && activeCtx.colorHSV !== undefined) ? activeCtx.colorHSV : colorHSV; }
export function setColorHSV(val) { colorHSV = val; if (activeCtx) activeCtx.colorHSV = val; }
export function getColorPointer() { return (activeCtx && activeCtx.colorPointer !== undefined) ? activeCtx.colorPointer : colorPointer; }
export function setColorPointer(val) { colorPointer = val; if (activeCtx) activeCtx.colorPointer = val; }
export function getContextResolution() { return (activeCtx && activeCtx.contextResolution !== undefined) ? activeCtx.contextResolution : contextResolution; }
export function setContextResolution(val) { contextResolution = val; if (activeCtx) activeCtx.contextResolution = val; }
export function getFilter() { return (activeCtx && activeCtx.filter !== undefined) ? activeCtx.filter : filter; }
export function setFilter(val) { filter = val; if (activeCtx) activeCtx.filter = val; }
export function getQuery() { return (activeCtx && activeCtx.query !== undefined) ? activeCtx.query : query; }
export function setQuery(val) { query = val; if (activeCtx) activeCtx.query = val; }
export function getPendingRoundtripConf() { return (activeCtx && activeCtx.pendingRoundtripConf !== undefined) ? activeCtx.pendingRoundtripConf : pendingRoundtripConf; }
export function setPendingRoundtripConf(val) { pendingRoundtripConf = val; if (activeCtx) activeCtx.pendingRoundtripConf = val; }
export function getPendingRoundtripName() { return (activeCtx && activeCtx.pendingRoundtripName !== undefined) ? activeCtx.pendingRoundtripName : pendingRoundtripName; }
export function setPendingRoundtripName(val) { pendingRoundtripName = val; if (activeCtx) activeCtx.pendingRoundtripName = val; }
export function getUiTheme() { return (activeCtx && activeCtx.uiTheme !== undefined) ? activeCtx.uiTheme : uiTheme; }
export function setUiTheme(val) {
  uiTheme = val === 'dark' ? 'dark' : 'light';
  if (activeCtx) activeCtx.uiTheme = uiTheme;
  try {
    const storage = (activeCtx && activeCtx.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) storage.setItem('kpi-atelier-ui-theme', JSON.stringify(uiTheme));
  } catch {}
  const doc = (activeCtx && activeCtx.document) || (typeof document !== 'undefined' ? document : null);
  if (doc?.documentElement) {
    try { doc.documentElement.setAttribute('data-ui-theme', uiTheme); } catch {}
  }
  return uiTheme;
}
export function toggleUiTheme() {
  return setUiTheme(getUiTheme() === 'dark' ? 'light' : 'dark');
}

export function getRailCollapsed() { return (activeCtx && activeCtx.railCollapsed !== undefined) ? Boolean(activeCtx.railCollapsed) : Boolean(railCollapsed); }
export function setRailCollapsed(val) {
  railCollapsed = Boolean(val);
  if (activeCtx) activeCtx.railCollapsed = railCollapsed;
  try {
    const storage = (activeCtx && activeCtx.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) storage.setItem('kpi-atelier-rail-collapsed', JSON.stringify(railCollapsed));
  } catch {}
  return railCollapsed;
}
export function toggleRailCollapsed() {
  return setRailCollapsed(!getRailCollapsed());
}

export let railCollapsed = read('kpi-atelier-rail-collapsed', false);
export let uiTheme = read('kpi-atelier-ui-theme', 'light');
if (uiTheme !== 'dark' && uiTheme !== 'light') uiTheme = 'light';
if (typeof document !== 'undefined' && document.documentElement) {
  try { document.documentElement.setAttribute('data-ui-theme', uiTheme); } catch {}
}

// Estado Base Inicial
export let clipboardElement = null;
export let clipboardElements = [];

// Estado Base Inicial
export let c = sanitizeConfig(read('kpi-atelier-draft', BASE));
export let saved = storedDesigns();

export let view = 'designer';
export let mode = read('kpi-atelier-mode', 'essential');
if (!['essential', 'advanced'].includes(mode)) mode = mode === 'pro' ? 'advanced' : 'essential';
export let tab = 'content';
export let filter = 'all';
export let query = '';
export let context = false;
export let zoom = 100;
export let canvasDark = false;

export let undo = [];
export let redo = [];
export let lastEdit = 0;
export let resizeObserver = null;
export let toastTimer = null;
export let lastFocus = null;

export let cardSelected = false;
export let selectedElement = null;
export let selectedElements = new Set();
export let moveStep = read('kpi-atelier-step', 1) === 5 ? 5 : 1;
export let layersOpen = false;
export let gesture = null;
export let ignoreCanvasClick = false;
export let formatPainterSource = null;
export let deleteConfirmLayer = null;
export let deleteConfirmTimer = null;
export let draggedLayer = null;

export let guidesEnabled = read('kpi-atelier-guides', true) !== false;
export let guidePreviewUntil = 0;
export let guideTimer = null;

export const inspectorSections = new Map();
export const inspectorPositions = new Map();

export const customThemes = storedCustomThemes();

export let paletteDraft = null;
export let colorRole = 'accent';
export let colorHSV = null;
export let colorPointer = null;

export let pbipModel = sanitizeModelCatalog(read('kpi-atelier-pbip-cache', null));
export let contextResolution = read('kpi-atelier-context-res', '1280x720');
export let pendingRoundtripConf = null;
export let pendingRoundtripName = '';

export const editState = read('kpi-atelier-edit-state', null);
export let baseline = editState?.baseline ? sanitizeConfig(editState.baseline) : structuredClone(c);
export let editingSavedId = editState?.savedId || null;
export let pendingNavigation = null;
let designBindingsLocked = read('kpi-atelier-draft', null) !== null;

// Helpers de Modelo PBIP
export function getFriendlyReportName(model) {
  if (!model) return '';
  const rep = model.reportName || model.modelName || '';
  if (rep && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rep) && rep !== 'Model') {
    return rep;
  }
  return 'Power BI Desktop';
}

export function applyPbipCalendarDefaults(catalog) {
  if (!catalog || !Array.isArray(catalog.dateTables) || !catalog.dateTables.length) return false;
  // Connecting metadata must not rewrite the bindings of an existing design.
  if (designBindingsLocked || getC()._dateCustomized || getC()._measureBound) return false;
  const bestTable = catalog.dateTables[0];
  const bestColumn = bestTable.primaryDateColumn || bestTable.dateColumns?.[0] || '';
  const patch = {};
  if (bestTable.name) patch.dateTable = bestTable.name;
  if (bestColumn) patch.dateColumn = bestColumn;
  if (Object.keys(patch).length) {
    setC(sanitizeConfig({ ...getC(), ...patch }));
    persist();
    callCtx('refreshCard');
    return true;
  }
  return false;
}

export let lastPbiSyncTime = read('kpi-atelier-pbip-sync-time', null);
export function getLastPbiSyncTime() { return (activeCtx && activeCtx.lastPbiSyncTime !== undefined) ? activeCtx.lastPbiSyncTime : lastPbiSyncTime; }
export function setLastPbiSyncTime(val) {
  lastPbiSyncTime = val;
  if (activeCtx) activeCtx.lastPbiSyncTime = val;
  try {
    const storage = (activeCtx && activeCtx.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      if (val) storage.setItem('kpi-atelier-pbip-sync-time', JSON.stringify(val));
      else storage.removeItem('kpi-atelier-pbip-sync-time');
    }
  } catch {}
}
export function formatSyncTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yy = String(d.getFullYear()).slice(-2);
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${dd}/${mm}/${yy} - ${hh}:${min}:${ss}`;
}

export function setPbipModel(model, autoAssign = false) {
  const safe = model === null ? null : sanitizeModelCatalog(model);
  if (model !== null && !safe) {
    toast('El catálogo del modelo no es válido. Vuelve a conectarlo o importa su carpeta PBIP.');
    return false;
  }
  model = safe;
  pbipModel = safe;
  if (activeCtx) activeCtx.pbipModel = safe;
  if (model) {
    setLastPbiSyncTime(Date.now());
  }
  try {
    const storage = (activeCtx && activeCtx.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      if (model) storage.setItem('kpi-atelier-pbip-cache', JSON.stringify(model));
      else storage.removeItem('kpi-atelier-pbip-cache');
    }
  } catch {}
  if (autoAssign && model) {
    applyPbipCalendarDefaults(model);
  }
  callCtx('renderInspector');
  callCtx('renderStatus');
  return true;
}

// Persistencia y Detección de Cambios
export const dirty = () => JSON.stringify(getC()) !== JSON.stringify(getBaseline());

export function showDirty() {
  const node = $('#save-state');
  if (node) {
    const isDirty = dirty();
    node.textContent = isDirty ? 'Cambios sin guardar' : 'Sin cambios pendientes';
    node.classList.toggle('dirty', isDirty);
  }
}

export function toast(s) {
  const t = $('#toast');
  if (!t) return;
  const modal = $('#modal');
  if (modal && modal.open && modal.appendChild) {
    if (t.parentElement !== modal) modal.appendChild(t);
  } else {
    const doc = (activeCtx && activeCtx.document) || (typeof document !== 'undefined' ? document : null);
    if (doc?.body?.appendChild && t.parentElement !== doc.body) doc.body.appendChild(t);
  }
  t.textContent = s;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3300);
}

export function persist() {
  showDirty();
  try {
    const storage = (activeCtx && activeCtx.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) throw new Error('No storage available');
    const snapshot = { id: draftId, config: getC(), baseline: getBaseline(), savedId: editingSavedId, savedRevision: editingSavedRevision, date: new Date().toISOString() };
    // sessionStorage belongs to this window. A unique durable backup also
    // survives closing/crashing it; other backups remain available in Mis diseños.
    sessionOf()?.setItem(DRAFT_SESSION_KEY, JSON.stringify(snapshot));
    if (dirty()) storage.setItem(RECOVERY_PREFIX + draftId, JSON.stringify(snapshot));
    else storage.removeItem(RECOVERY_PREFIX + draftId);
    if (previousDraftId) {
      // sessionStorage is copied into an opener's new window. Matching content
      // does not prove ownership: only this document's backup may be retired.
      // Keep inherited/reloaded backups recoverable until explicitly reviewed.
      previousDraftId = null;
    }
    // Compatibility checkpoint for first launch/new windows. Existing windows
    // restore their own session snapshot, never this last-writer checkpoint.
    storage.setItem('kpi-atelier-draft', JSON.stringify(getC()));
    storage.setItem('kpi-atelier-edit-state', JSON.stringify({ baseline: getBaseline(), savedId: editingSavedId, savedRevision: editingSavedRevision }));
    storage.setItem('kpi-atelier-mode', JSON.stringify(getMode()));
    return true;
  } catch {
    toast('No se pudo guardar en este navegador. Exporta tu configuración JSON.');
    return false;
  }
}

export function record() {
  const curUndo = getUndo();
  curUndo.push(structuredClone(getC()));
  if (curUndo.length > 60) curUndo.shift();
  getRedo().length = 0;
  callCtx('updateHistoryButtons');
}

/** Coalesce continuous input on one control, never changes to different fields. */
export function recordEdit(key, discrete = false) {
  const ctx = getActiveContext();
  const now = Date.now();
  if (discrete || ctx.lastEditKey !== key || now - (ctx.lastEdit || 0) > 700 || getRedo().length) record();
  ctx.lastEditKey = key;
  ctx.lastEdit = now;
}

/** Restore a cancelled edit without losing the history that preceded it. */
export function restoreHistory(previousUndo = [], previousRedo = []) {
  getUndo().splice(0, getUndo().length, ...previousUndo);
  getRedo().splice(0, getRedo().length, ...previousRedo);
  const ctx = getActiveContext();
  ctx.lastEdit = 0;
  ctx.lastEditKey = null;
  callCtx('updateHistoryButtons');
}

export function clearSelection() {
  setSelectedElement(null);
  setCardSelected(false);
  getSelectedElements().clear();
  setFormatPainterSource(null);
  setDeleteConfirmLayer(null);
}

export function setConfig(patch, full = false) {
  const nextC = sanitizeConfig(full ? patch : { ...getC(), ...patch });
  if (JSON.stringify(nextC) === JSON.stringify(getC())) return false;
  record();
  setC(nextC);
  if (full) {
    getActiveContext().designRevision = (getActiveContext().designRevision || 0) + 1;
    clearSelection();
    if (activeCtx) {
      activeCtx.context = false;
      activeCtx.cardSelected = false;
      activeCtx.selectedElement = null;
      if (['element', 'card'].includes(activeCtx.tab)) activeCtx.tab = 'content';
    } else {
      context = false;
      cardSelected = false;
      selectedElement = null;
      if (['element', 'card'].includes(tab)) tab = 'content';
    }
  }
  persist();
  callCtx('render');
  return true;
}

export function themeSelect(key) {
  const custom = getCustomThemes().find(t => t.id === key);
  if (custom) setConfig({ ...custom.colors, theme: 'custom', customThemeName: custom.name });
  else if (THEMES[key]) setConfig({ ...THEMES[key], theme: key, customThemeName: '' });
}

export function filtered() {
  const rawFilter = (activeCtx?.filter !== undefined ? activeCtx.filter : filter);
  const curFilter = (rawFilter && FAMILIES.some(f => f.id === rawFilter)) ? rawFilter : 'all';
  const curQuery = ((activeCtx?.query !== undefined ? activeCtx.query : query) || '').trim().toLowerCase();
  return TEMPLATES.filter(t => (curFilter === 'all' || t.category === curFilter) &&
    (!curQuery || `${t.name} ${t.description} ${t.config.title} ${familyName(t.category)}`.toLowerCase().includes(curQuery)));
}

export function thumb(conf, cl = '') {
  const w = conf.width || 340;
  const h = conf.height || 140;
  return `<div class="mini-viewport ${cl}" data-base-width="${w}" data-base-height="${h}" style="aspect-ratio:${w}/${h};min-height:48px;"><div class="mini-inner" style="width:${w}px">${cardHTML(conf)}</div></div>`;
}

export function loadDesign(config, savedId = null, { template = false } = {}) {
  getActiveContext().designRevision = (getActiveContext().designRevision || 0) + 1;
  designBindingsLocked = !template;
  const curC = getC();
  const prevDateTable = curC?.dateTable;
  const prevDateColumn = curC?.dateColumn;
  const prevDateCustomized = curC?._dateCustomized;
  let nextC = sanitizeConfig(config);
  if (template) {
    nextC._measureBound = false;
    nextC.measure = '';
    if (!nextC.measureName || !nextC.measureName.trim()) {
      const cleanTitle = (nextC.title || 'Medida').replace(/[^\p{L}\p{N}_]/gu, '_').replace(/^_+|_+$/g, '') || 'Medida';
      nextC.measureName = cleanTitle.startsWith('KPI_') ? cleanTitle : `KPI_${cleanTitle}`;
    }
  }
  const curPbip = getPbipModel();
  if (template && curPbip) {
    const modelDateTables = curPbip.dateTables || [];
    const modelTableNames = (curPbip.tables || []).map(t => t.toLowerCase());
    const prevFound = modelDateTables.find(dt => dt.name.toLowerCase() === (prevDateTable || '').trim().toLowerCase())
      || modelTableNames.includes((prevDateTable || '').trim().toLowerCase());
    if (prevDateTable && prevFound) {
      nextC.dateTable = prevDateTable;
      nextC.dateColumn = prevDateColumn || nextC.dateColumn;
      nextC._dateCustomized = true;
    } else if (modelDateTables.length) {
      const bestDt = modelDateTables.find(dt => dt.isMarkedDateTable) || modelDateTables.find(dt => dt.isLikelyCalendar) || modelDateTables[0];
      if (bestDt) {
        nextC.dateTable = bestDt.name;
        nextC.dateColumn = bestDt.primaryDateColumn || bestDt.dateColumns?.[0] || nextC.dateColumn;
        nextC._dateCustomized = true;
      }
    }
  } else if (template && prevDateCustomized && prevDateTable) {
    nextC.dateTable = prevDateTable;
    nextC.dateColumn = prevDateColumn || nextC.dateColumn;
    nextC._dateCustomized = true;
  }
  setC(nextC);
  clearSelection();
  setGesture(null);
  setBaseline(structuredClone(nextC));
  editingSavedId = savedId;
  const loadedEntry = [...storedDesigns(), ...recoveryDesigns()].find(entry => entry.id === savedId);
  editingSavedRevision = loadedEntry ? savedRevision(loadedEntry) : null;
  restoreHistory();
  if (activeCtx) {
    activeCtx.editingSavedId = savedId;
    activeCtx.editingSavedRevision = editingSavedRevision;
    activeCtx.undo = [];
    activeCtx.redo = [];
    activeCtx.lastEdit = 0;
    activeCtx.view = 'designer';
    activeCtx.context = false;
    activeCtx.zoom = 100;
    activeCtx.selectedElement = null;
    activeCtx.cardSelected = false;
    if (['element', 'card'].includes(activeCtx.tab)) activeCtx.tab = 'content';
  } else {
    undo = [];
    redo = [];
    lastEdit = 0;
    view = 'designer';
    context = false;
    zoom = 100;
    selectedElement = null;
    cardSelected = false;
    if (['element', 'card'].includes(tab)) tab = 'content';
  }
  persist();
  callCtx('render');
}

async function withStorageLock(ctx, name, operation) {
  ctx.lastCollectionSyncWarning = null;
  const locks = ctx?.navigator?.locks || ctx?.window?.navigator?.locks;
  if (!locks?.request) throw new Error('Este navegador no permite guardar con seguridad entre ventanas. Abre la app en una versión actual de Edge o Chrome y exporta el JSON.');
  if (await ctx.collectionsReady === false) throw new Error('El almacenamiento compartido no está disponible. Tus cambios siguen abiertos; exporta el JSON.');
  const key = COLLECTION_LOCKS.get(name);
  const result = await locks.request(name, { mode: 'exclusive' }, () => collectionTransaction(ctx, key, operation));
  reportCollectionWarning(ctx);
  return result;
}
const withSavedLock = (ctx, operation) => withStorageLock(ctx, 'kpi-atelier-saved-collection', operation);

export async function saveCurrent(name) {
  name = String(name ?? '').trim().slice(0, 80);
  if (!name) { toast('Añade un nombre para el diseño.'); return false; }
  const ctx = getActiveContext();
  if (ctx.savePending) { toast('El guardado anterior sigue en curso. Espera a que termine.'); return false; }
  const session = captureDesignSession();
  ctx.savePending = true;
  ctx.lastSaveConflict = false;
  const config = structuredClone(getC());
  const expected = structuredClone(getBaseline());
  const sourceId = ctx.editingSavedId ?? editingSavedId;
  const expectedRevision = ctx.editingSavedRevision ?? editingSavedRevision;
  const storage = storageOf(ctx);
  let result;
  try {
    if (!storage) throw new Error('No storage available');
    result = await withSavedLock(ctx, transactionStorage => {
      const rawCurrent = storedDesignEntries(transactionStorage, true);
      const current = rawCurrent.map(entry => normalizedSavedDesign(entry));
      const original = current.find(s => s.id === sourceId);
      const conflict = Boolean(sourceId && !sourceId.startsWith('draft:') && (!original || JSON.stringify(original.config) !== JSON.stringify(expected) || (expectedRevision && savedRevision(original) !== expectedRevision)));
      const id = original && !conflict ? original.id : crypto.randomUUID();
      const savedName = conflict ? name.slice(0, 62) + ' · Copia en conflicto' : name;
      const entry = { id, name: savedName, date: new Date().toISOString(), config };
      // Preserve unrelated raw configurations so their compatibility notices
      // remain available until the user actually opens and reviews them.
      transactionStorage.setItem(SAVED_KEY, JSON.stringify([entry, ...rawCurrent.filter(s => s.id !== id)]));
      if (sourceId?.startsWith('draft:')) {
        const key = RECOVERY_PREFIX + sourceId.slice(6);
        const recovery = parseStorage(transactionStorage, key);
        if (recovery && (!expectedRevision || JSON.stringify(recovery) === expectedRevision) && JSON.stringify(sanitizeConfig(recovery.config)) === JSON.stringify(expected)) transactionStorage.removeItem(key);
      }
      return { id, conflict, revision: JSON.stringify(entry) };
    });
  } catch (error) {
    toast(/entre ventanas|colección guardada/.test(error.message) ? error.message : 'No se pudo guardar. Los cambios siguen abiertos; puedes exportar el JSON.');
    return false;
  } finally {
    ctx.savePending = false;
  }
  if (!isDesignSessionCurrent(session)) {
    refreshSaved();
    toast('El diseño anterior se guardó en tu colección. El diseño abierto conserva sus propios cambios.');
    return true;
  }
  editingSavedId = result.id;
  ctx.editingSavedId = result.id;
  editingSavedRevision = result.revision;
  ctx.editingSavedRevision = result.revision;
  ctx.lastSaveConflict = result.conflict;
  setBaseline(config);
  if (!persist()) {
    ctx.lastCollectionSyncWarning = 'El diseño se guardó en la colección compartida. No se pudo actualizar su copia de recuperación local; la versión guardada se conserva.';
    toast(ctx.lastCollectionSyncWarning);
  }
  refreshSaved();
  showDirty();
  if (result.conflict) toast('Otra ventana modificó o eliminó este diseño. Tus cambios se guardaron como «Copia en conflicto»; ambas versiones se conservan.');
  return true;
}

/**
 * Only delete the complete revision reviewed before opening confirmation.
 * @param {string} id
 * @param {import('./types.d.ts').SavedDesign} reviewedEntry
 */
export async function deleteSaved(id, reviewedEntry) {
  const ctx = getActiveContext();
  const storage = storageOf(ctx);
  ctx.lastDeleteConflict = false;
  if (!reviewedEntry || reviewedEntry.id !== id || !reviewedEntry.config) {
    toast('Vuelve a abrir la confirmación para revisar el diseño que quieres eliminar.');
    return false;
  }
  const expected = structuredClone(reviewedEntry);
  try {
    if (!storage) throw new Error('No storage available');
    await withSavedLock(ctx, transactionStorage => {
      if (id.startsWith('draft:')) {
        const key = RECOVERY_PREFIX + id.slice(6);
        const latest = parseStorage(transactionStorage, key);
        const latestEntry = latest?.config && typeof latest.date === 'string' ? recoveryEntry(id, latest) : null;
        if (transactionStorage.getItem(key) !== null && (!latestEntry || savedRevision(latestEntry) !== savedRevision(expected))) throw new Error('changed');
        transactionStorage.removeItem(key);
        return;
      }
      const rawCurrent = storedDesignEntries(transactionStorage, true);
      const current = rawCurrent.map(entry => normalizedSavedDesign(entry));
      const latest = current.find(s => s.id === id);
      if (latest && savedRevision(latest) !== savedRevision(expected)) throw new Error('changed');
      transactionStorage.setItem(SAVED_KEY, JSON.stringify(rawCurrent.filter(s => s.id !== id)));
    });
    refreshSaved();
    return true;
  } catch (error) {
    ctx.lastDeleteConflict = error.message === 'changed';
    refreshSaved();
    toast(error.message === 'changed' ? 'El diseño cambió en otra ventana. Revisa la versión actual antes de eliminarlo.' : error.message?.includes('entre ventanas') ? error.message : 'No se pudo eliminar el diseño. Inténtalo de nuevo.');
    return false;
  }
}

/** Merge with the current collection under the same lock used by all windows. */
export async function saveCustomTheme(name, palette, reviewedTheme = null) {
  const ctx = getActiveContext(), storage = storageOf(ctx);
  const colors = sanitizePalette(palette);
  name = String(name ?? '').trim().slice(0, 40);
  if (!name || !colors) { toast('Revisa el nombre y los colores de la paleta.'); return null; }
  const expected = reviewedTheme ? structuredClone(reviewedTheme) : null;
  ctx.lastThemeSaveConflict = false;
  try {
    if (!storage) throw new Error('No storage available');
    const result = await withStorageLock(ctx, 'kpi-atelier-themes-collection', transactionStorage => {
      const current = storedCustomThemes(transactionStorage, true);
      const original = expected ? current.find(theme => theme.id === expected.id) : null;
      const nameCollision = current.some(theme => theme.name === name && theme.id !== expected?.id);
      const conflict = nameCollision || Boolean(expected && (!original || JSON.stringify(original) !== JSON.stringify(expected)));
      let savedName = conflict ? name.slice(0, 20) + ' · Copia en conflicto' : name;
      let suffix = 2;
      const rootName = savedName;
      while (conflict && current.some(theme => theme.name === savedName)) {
        const number = ` (${suffix++})`;
        savedName = rootName.slice(0, 40 - number.length) + number;
      }
      const theme = { id: original && !conflict ? original.id : crypto.randomUUID(), name: savedName, colors };
      transactionStorage.setItem(THEMES_KEY, JSON.stringify([...current.filter(entry => entry.id !== theme.id), theme]));
      return { theme, conflict };
    });
    ctx.lastThemeSaveConflict = result.conflict;
    refreshCustomThemes();
    return result.theme;
  } catch (error) {
    toast(/entre ventanas|colección de paletas/.test(error.message) ? error.message : 'No se pudo guardar la paleta. Tu edición sigue abierta.');
    return null;
  }
}

export async function deleteCustomTheme(id, reviewedTheme) {
  const ctx = getActiveContext(), storage = storageOf(ctx);
  if (!reviewedTheme || reviewedTheme.id !== id) { toast('Revisa la paleta actual antes de eliminarla.'); return false; }
  const expected = structuredClone(reviewedTheme);
  try {
    if (!storage) throw new Error('No storage available');
    await withStorageLock(ctx, 'kpi-atelier-themes-collection', transactionStorage => {
      const current = storedCustomThemes(transactionStorage, true), latest = current.find(theme => theme.id === id);
      if (latest && JSON.stringify(latest) !== JSON.stringify(expected)) throw new Error('changed');
      transactionStorage.setItem(THEMES_KEY, JSON.stringify(current.filter(theme => theme.id !== id)));
    });
    refreshCustomThemes();
    return true;
  } catch (error) {
    refreshCustomThemes();
    toast(error.message === 'changed' ? 'La paleta cambió en otra ventana. Revisa sus colores antes de eliminarla.' : /entre ventanas|colección de paletas/.test(error.message) ? error.message : 'No se pudo eliminar la paleta.');
    return false;
  }
}

export function requestNavigation(go) {
  if (!dirty()) { go(); return; }
  pendingNavigation = go;
  if (activeCtx) activeCtx.pendingNavigation = go;
  const curSaved = getSaved();
  const curC = getC();
  const name = curSaved.find(s => s.id === editingSavedId)?.name || curC.title + ' · Mi diseño';
  const openModalFn = activeCtx?.openModal || (typeof globalThis !== 'undefined' && globalThis.openModal);
  if (typeof openModalFn === 'function') {
    openModalFn(
      'Tienes cambios sin guardar',
      'Decide qué hacer antes de salir de esta tarjeta.',
      `<p class="field-help">Puedes guardar el diseño, descartar los cambios pendientes o seguir editándolo.</p><label class="save-label" for="guard-name">Nombre del diseño</label><input id="guard-name" class="save-input" maxlength="80" value="${esc(name)}">`,
      `<button class="button secondary" data-action="close-modal"><span>Seguir editando</span></button><button class="button quiet" data-action="guard-discard"><span>Descartar y continuar</span></button><button class="button primary" data-action="guard-save"><span>Guardar y continuar</span></button>`,
      'leave-modal'
    );
    $('#modal')?.querySelector('[data-action="close-modal"].button')?.focus();
  } else toast('Guarda o exporta los cambios antes de continuar.');
}
