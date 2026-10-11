/**
 * KPI Atelier - Módulo de Estado Centralizado, Persistencia e Historial (dist/state.mjs)
 * Gestiona el estado reactivo, la memoria local, la pila undo/redo y la sincronización con el contexto.
 */

import { BASE, sanitizeConfig, THEMES, FAMILIES, TEMPLATES, familyName } from './model.mjs';
import { sanitizePalette } from './colors.mjs';
import { icon, esc, cardHTML } from './cards.mjs';
import { sanitizeModelCatalog } from './schema.mjs';
import { ELEMENT_IDS } from './elements.mjs';

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
  c = sanitizeConfig(read('kpi-atelier-draft', BASE));
  designBindingsLocked = read('kpi-atelier-draft', null) !== null;
  saved = read('kpi-atelier-saved', []);
  if (!Array.isArray(saved)) saved = [];
  saved = saved.filter(x => x && typeof x.id === 'string' && x.config).map(x => ({ ...x, config: sanitizeConfig(x.config) }));
  pbipModel = sanitizeModelCatalog(read('kpi-atelier-pbip-cache', null));
  const restoredEditState = read('kpi-atelier-edit-state', null);
  baseline = restoredEditState?.baseline ? sanitizeConfig(restoredEditState.baseline) : structuredClone(c);
  editingSavedId = typeof restoredEditState?.savedId === 'string' ? restoredEditState.savedId : null;
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
    ctx.c = c;
    ctx.baseline = baseline;
    ctx.editingSavedId = editingSavedId;
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
}
/** @returns {any} */
export function getActiveContext() { return activeCtx || (typeof globalThis !== 'undefined' ? globalThis : {}); }
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
export function getPbipModel() { return (activeCtx && activeCtx.pbipModel !== undefined) ? activeCtx.pbipModel : pbipModel; }
export function getUndo() { return (activeCtx && activeCtx.undo !== undefined) ? activeCtx.undo : undo; }
export function getRedo() { return (activeCtx && activeCtx.redo !== undefined) ? activeCtx.redo : redo; }
export function getSaved() { return (activeCtx && activeCtx.saved !== undefined) ? activeCtx.saved : saved; }
export function setSaved(val) { saved = val; if (activeCtx) activeCtx.saved = val; }

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
export let saved = read('kpi-atelier-saved', []);
if (!Array.isArray(saved)) saved = [];
saved = saved.filter(x => x && typeof x.id === 'string' && x.config).map(x => ({ ...x, config: sanitizeConfig(x.config) }));

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

export let customThemes = read('kpi-atelier-themes', []);
if (!Array.isArray(customThemes)) customThemes = [];
customThemes = customThemes.filter(t => t && typeof t.id === 'string' && /^[\w-]+$/.test(t.id) && sanitizePalette(t.colors)).map(t => ({ ...t, name: String(t.name).slice(0, 40), colors: sanitizePalette(t.colors) }));

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
    storage.setItem('kpi-atelier-draft', JSON.stringify(getC()));
    storage.setItem('kpi-atelier-edit-state', JSON.stringify({ baseline: getBaseline(), savedId: editingSavedId }));
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
  const custom = customThemes.find(t => t.id === key);
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
  restoreHistory();
  if (activeCtx) {
    activeCtx.editingSavedId = savedId;
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

export function saveCurrent(name) {
  name = String(name ?? '').trim().slice(0, 80);
  if (!name) { toast('Añade un nombre para el diseño.'); return false; }
  const curSaved = getSaved();
  const id = curSaved.some(s => s.id === editingSavedId) ? editingSavedId : crypto.randomUUID();
  const next = [{ id, name, date: new Date().toISOString(), config: structuredClone(getC()) }, ...curSaved.filter(s => s.id !== id)];
  try {
    const storage = (activeCtx && activeCtx.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) throw new Error('No storage available');
    storage.setItem('kpi-atelier-saved', JSON.stringify(next));
  } catch {
    toast('No se pudo guardar. Los cambios siguen abiertos; puedes exportar el JSON.');
    return false;
  }
  setSaved(next);
  editingSavedId = id;
  if (activeCtx) activeCtx.editingSavedId = id;
  setBaseline(structuredClone(getC()));
  persist();
  showDirty();
  return true;
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
