/**
 * KPI Atelier - Orquestador Principal (dist/app.mjs)
 * Coordina el ciclo de vida de la aplicación, vistas de alto nivel (diseñador, biblioteca, mis diseños),
 * delegación central de eventos del DOM y arranque de conexiones Power BI en vivo.
 */

import { resizeCard, applyLayout } from './layout.mjs';
import { COLOR_SPEC, colorModes, appearance, elementColor, elementBackground, trendFill, SURFACE_EFFECTS } from './appearance.mjs';
import { alignmentGuides } from './guides.mjs';
import { BASE, TEMPLATES, THEMES, FAMILIES, sanitizeConfig, checks, getCircularConflict, familyName, needsTrend, needsDate, needsGoal, needsCompare, isValidMeasureName } from './model.mjs';
import { icon, esc, cardHTML, sampleData, comparisonLabel } from './cards.mjs';
import { generateDAX } from './dax.mjs';
import { reviewMeasure, measureDestination } from './preflight.mjs';
import { ELEMENTS, ELEMENT_IDS, SIZE_LIMITS, elementState, elementSize, elementAvailable, elementEnabled, elementVisible, updateElement, moveElement, resizeElement, restoreElement, clamp, frameFromBounds, detachElement, releaseElement, layerOrder, moveLayer, reorderLayer, resolveElementDef } from './elements.mjs';
import { COLOR_ROLES, hexToHSV, hsvToHex, contrastRatio, paletteFrom, sanitizePalette } from './colors.mjs';
import { ICON_OPTIONS } from './icons.mjs';
import { scanDirectoryHandle, scanFileList, fetchLivePbiModel, fetchLivePbiStatus, injectMeasureToLivePbi, discoverLivePbi, initLivePbiStream } from './pbip.mjs';

import { $, btn, ib, read, setContext, getActiveContext, getC, setC, getBaseline, setBaseline, getMode, setMode, getTab, setTab, getView, setView, getSelectedElement, setSelectedElement, getCardSelected, setCardSelected, getSelectedElements, getPbipModel, setPbipModel, getUndo, getRedo, getSaved, setSaved, getZoom, setZoom, getCanvasDark, setCanvasDark, getContextPreview, setContextPreview, getMoveStep, setMoveStep, getLayersOpen, setLayersOpen, getGuidesEnabled, setGuidesEnabled, getFormatPainterSource, setFormatPainterSource, getGesture, setGesture, getDeleteConfirmLayer, setDeleteConfirmLayer, getClipboardElement, setClipboardElement, getClipboardElements, setClipboardElements, getPaletteDraft, setPaletteDraft, getColorRole, setColorRole, getColorHSV, setColorHSV, getColorPointer, setColorPointer, getContextResolution, setContextResolution, getFilter, setFilter, getQuery, setQuery, c, saved, view, mode, tab, filter, query, context, zoom, canvasDark, undo, redo, lastEdit, resizeObserver, toastTimer, lastFocus, cardSelected, selectedElement, selectedElements, moveStep, layersOpen, gesture, ignoreCanvasClick, formatPainterSource, deleteConfirmLayer, deleteConfirmTimer, draggedLayer, guidesEnabled, guidePreviewUntil, guideTimer, inspectorSections, inspectorPositions, customThemes, paletteDraft, colorRole, colorHSV, colorPointer, pbipModel, contextResolution, pendingRoundtripConf, pendingRoundtripName, getPendingRoundtripConf, setPendingRoundtripConf, getPendingRoundtripName, setPendingRoundtripName, editState, baseline, editingSavedId, pendingNavigation, getFriendlyReportName, applyPbipCalendarDefaults, dirty, showDirty, toast, persist, record, setConfig, themeSelect, filtered, thumb, loadDesign, saveCurrent, requestNavigation, uiTheme, getUiTheme, setUiTheme, toggleUiTheme, railCollapsed, getRailCollapsed, setRailCollapsed, toggleRailCollapsed, lastPbiSyncTime, getLastPbiSyncTime, setLastPbiSyncTime, formatSyncTimestamp } from './state.mjs';
import { renderStage, fitThumbs, fitMain, measureElementFrame, renderCanvasBar, layersPanel, commitLayerOrder, clearLayerDrop, positionSelection, refreshCard, flashGuides, renderGuides, selectElement, selectCard, deselect, directChange, elementAction, reportOverflow, copySelectedElements, copySelectedElement, pasteElements, pasteElement, applyFormatPainter, startCardGesture, finishGesture, patchCardElementTransform, patchCardDimensions } from './canvas.mjs';
import { field, select, range, check, percentRange, section, formats, comparisons, duplicateContentFields, renderInspector, renderStatus, updateHistoryButtons, rememberInspector, updateInspectorTabs, iconPickerField, surfaceInspector, appearanceSelect, appearanceRange, appearanceColor, elementAppearancePanel, editAppearance, elementInspector, cardDimensionsPanel, layoutPanel, chartPanel, cardInspector, dataSummaryCard, syncElementControls, syncCardControls, commitNumber } from './inspector.mjs';
import { openModal, closeModal, filename, download, downloadJSON, copyDax, exportModal, openMeasureReviewModal, validationModal, chooseLiveInstanceModal, showInjectConfirmModal, showInjectSuccessModal, showInjectErrorModal, guide, openIconPicker, iconGrid, themeTile, openThemeStudio, updateColorStudio, colorFromPointer, FIELD_TO_ELEMENTS, ELEMENT_TO_FIELD, getBindingElements, getBindingFieldsForElement, highlightBindingContext, highlightBindingElements, updateBindingFieldStatus, updateBindingModalStatus, updateBindableElements, fitBindingCard, getBindingFieldOptions, renderBindingDropdown, closeAllBindingDropdowns, applyBindingFieldValue, openDataBindingModal, shortcutsModal, pbiInfographicModal, setPendingInjectAction, getPendingInjectAction, clearPendingInjectAction } from './modals.mjs';
import { cancelBindingReveal, revealBindingFields, openBindingDropdown, requestExport, confirmExport } from './modals.mjs';

// Sincronizar contexto activo y registrar funciones orquestadoras para ESM y sandbox
const activeContext = typeof globalThis !== 'undefined' ? globalThis : this;
activeContext.render = render;
activeContext.renderStage = renderStage;
activeContext.refreshCard = refreshCard;
activeContext.renderInspector = renderInspector;
activeContext.renderStatus = renderStatus;
activeContext.openModal = openModal;
activeContext.fitThumbs = fitThumbs;
setContext(activeContext);

const app = $('#app') || (typeof document !== 'undefined' ? (document.querySelector('#app') || document.body) : null);

function extractBareMeasure(str) {
  if (!str) return '';
  let s = String(str).trim();
  const tableMatch = s.match(/(?:'[^']+'|[A-Za-z0-9_#]+)\[(.*)\]$/);
  if (tableMatch) s = tableMatch[1];
  return s.replace(/^\[|\]$/g, '').trim();
}

// ----------------------------------------------------
// Vistas Principales de la Aplicación
// ----------------------------------------------------
function render() {
  rememberInspector();
  const curView = getView();
  const c = getC();
  const pbipModel = getPbipModel();

  app.innerHTML = `
    <header class="app-header">
      <a class="brand" href="#" data-action="home" aria-label="KPI Atelier, inicio">
        <span class="brand-icon">${icon('chart', 19)}</span>
        <strong>kpi<span class="brand-divider">/</span>atelier<span class="brand-dot">.</span></strong>
      </a>
      <nav class="top-nav" aria-label="Navegación principal">
        ${btn('view-designer', 'Diseñador', 'sliders', curView === 'designer' ? 'selected' : '', curView === 'designer' ? 'aria-current="page"' : '')}
        ${btn('view-library', `Biblioteca <span class="count">${TEMPLATES.length}</span>`, 'grid', curView === 'library' ? 'selected' : '', curView === 'library' ? 'aria-current="page"' : '')}
        ${btn('view-saved', `Mis diseños <span class="count">${getSaved().length}</span>`, 'folder', curView === 'saved' ? 'selected' : '', curView === 'saved' ? 'aria-current="page"' : '')}
      </nav>
      <div class="header-right">
        ${pbipModel?.isLiveConnection ? `<span class="pbip-live-pill" title="Power BI Desktop conectado: ${esc(getFriendlyReportName(pbipModel))}"><i class="pbip-live-dot"></i> ${esc(getFriendlyReportName(pbipModel))}</span>` : ''}
        ${ib('toggle-ui-theme', getUiTheme() === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro', getUiTheme() === 'dark' ? 'sun' : 'moon')}
        ${ib('shortcuts-modal', 'Atajos de teclado (?)', 'keyboard')}
        ${ib('guide', 'Guía de uso', 'book')}
        <span class="avatar">BD</span>
      </div>
    </header>
    <div class="page-heading ${curView === 'designer' ? 'designer-heading' : ''}">
      <div>
        <div class="eyebrow">TU ESTUDIO DE DISEÑO <span> / </span> POWER BI</div>
        <h1>${curView === 'designer' ? 'Grandes datos. <em>Mejor diseño.</em>' : curView === 'library' ? 'Un buen diseño empieza aquí.' : 'Tus ideas, listas para volver.'}</h1>
        ${curView === 'designer' ? '' : `<p>${curView === 'library' ? `${TEMPLATES.length} puntos de partida. Infinitas posibilidades. Todo editable.` : 'Guarda tus tarjetas y construye tu propio lenguaje visual.'}</p>`}
      </div>
      <div class="heading-actions">
        <span id="save-state" class="save-state"></span>
        ${btn('import', 'Importar', 'upload', 'button secondary')}
        ${btn('save', 'Guardar diseño', 'save', 'button secondary')}
        ${btn('open-data-modal', 'Conectar datos', 'sliders', 'button secondary')}
        ${btn('export', 'Generar medida DAX', 'code', 'button primary')}
      </div>
    </div>
    ${curView === 'designer' ? designer() : curView === 'library' ? library() : savedView()}
    <footer class="app-footer">
      <span><i class="tiny-dot"></i> Diseño en directo</span>
      <span>KPI Atelier</span>
    </footer>`;

  if (curView === 'designer') {
    renderInspector();
    renderStage();
  }
  fitThumbs();
  showDirty();
}

function designer() {
  const c = getC();
  const filter = getFilter();
  const query = getQuery();
  const context = getContextPreview();
  const canvasDark = getCanvasDark();
  const undo = getUndo();
  const redo = getRedo();
  const zoom = getZoom();
  const mode = getMode();
  const tab = getTab();
  const railCollapsed = getRailCollapsed();

  return `<div class="workspace${railCollapsed ? ' rail-collapsed' : ''}">
    <aside class="template-rail${railCollapsed ? ' is-collapsed' : ''}">
      ${railCollapsed ? `
        <div class="rail-collapsed-bar">
          <button class="icon-btn rail-toggle-btn" data-action="toggle-rail" title="Expandir barra de plantillas (Ctrl+B)" aria-label="Expandir barra de plantillas">
            ${icon('chevronRight', 14)}
          </button>
          <span class="rail-collapsed-label">Plantillas</span>
        </div>
      ` : `
        <div class="rail-heading">
          <h2>Elige tu punto de partida</h2>
          <div class="rail-heading-actions">
            <span>01—${TEMPLATES.length}</span>
            <button class="icon-btn rail-toggle-btn" data-action="toggle-rail" title="Colapsar barra de plantillas (Ctrl+B)" aria-label="Colapsar barra de plantillas">
              ${icon('chevronLeft', 14)}
            </button>
          </div>
        </div>
        <label class="search-box">${icon('search', 15)}<input id="template-search" placeholder="Buscar una tarjeta…" aria-label="Buscar plantillas" value="${esc(query)}"></label>
        <select id="family-filter" aria-label="Familia de tarjetas">${FAMILIES.map(f => `<option value="${f.id}" ${filter === f.id ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
        <div id="rail-cards" class="rail-cards">${railCards()}</div>
        <button class="rail-more" data-action="view-library">Explorar la biblioteca ${icon('arrow', 15)}</button>
      `}
    </aside>
    <main class="design-main">
      <div class="canvas-toolbar">
        <div class="live-label"><i></i>VISTA PREVIA</div>
        <div class="segmented small">
          <button data-action="single" class="${!context ? 'active' : ''}" title="Vista individual de la tarjeta">${icon('card', 14)}Tarjeta</button>
          <button data-action="context" class="${context ? 'active' : ''}" title="Vista de la tarjeta en contexto del informe">${icon('grid', 14)}En contexto</button>
        </div>
        <div class="toolbar-icons">
          ${ib('undo', 'Deshacer', 'undo', undo.length ? '' : 'disabled')}
          ${ib('redo', 'Rehacer', 'redo', redo.length ? '' : 'disabled')}
        </div>
      </div>
      <div id="canvas-edit-bar" class="canvas-edit-bar"></div>
      <div id="stage" class="stage ${canvasDark ? 'dark-stage' : ''}"></div>
      <div class="canvas-bottom">
        <span id="dimensions"></span>
        <div class="zoom-controls">
          ${ib('canvas-color', 'Cambiar fondo del lienzo', 'palette')}
          <span class="divider"></span>
          <button data-action="zoom-out" aria-label="Alejar">−</button>
          <span id="zoom-text">${zoom}%</span>
          <button data-action="zoom-in" aria-label="Acercar">+</button>
          ${ib('zoom-fit', 'Ajustar vista', 'expand')}
        </div>
        <span class="sample-tag">DATOS DE MUESTRA</span>
      </div>
      <div class="palette-section">
        <div class="theme-swatches">
          ${Object.entries(THEMES).map(([key, t]) => `<button data-theme="${key}" class="theme-swatch ${c.theme === key ? 'active' : ''}" title="${t.name}" aria-label="Aplicar tema ${t.name}" style="--swatch:${t.background};--dot:${t.accent}"><span></span><small>${t.name}</small></button>`).join('')}
          <button class="theme-swatch theme-add" data-action="themes" title="Crear o editar una paleta"><span>${icon('plus', 15)}</span><small>Crear tema</small></button>
        </div>
      </div>
    </main>
    <aside class="inspector">
      <div class="inspector-title"><h2>Nivel de detalle</h2>${ib('reset', 'Restaurar esta plantilla', 'reset')}</div>
      <div class="mode-switch">${[['essential', 'Esencial'], ['advanced', 'Avanzado']].map(([id, label]) => `<button data-mode="${id}" class="${mode === id ? 'active' : ''}" aria-pressed="${mode === id}">${label}</button>`).join('')}</div>
      <div class="inspector-tabs" role="tablist">${[['content', 'Contenido'], ['style', 'Estilo'], ['data', 'Datos & DAX']].map(([id, label]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</div>
      <div id="inspector-fields" class="inspector-fields"></div>
    </aside>
  </div>`;
}

function railCards() {
  const c = getC();
  return filtered().map(t => `<button class="template-item ${c.id === t.id ? 'chosen' : ''}" data-template="${t.id}" aria-label="Usar ${t.name}">${thumb(t.config)}<div><strong>${t.name}</strong>${c.id === t.id ? '<span class="chosen-mark">' + icon('check', 12) + '</span>' : '<span>' + icon('arrow', 12) + '</span>'}</div><small>${familyName(t.category)}</small></button>`).join('') || '<p class="empty-hint">No hay plantillas con ese nombre.</p>';
}

function library() {
  const filter = getFilter();
  const query = getQuery();
  return `<main class="library-view">
    <div class="library-top">
      <div class="filter-pills">${FAMILIES.map(f => `<button data-filter="${f.id}" class="${filter === f.id ? 'active' : ''}">${f.id === 'all' ? 'Todas' : f.name}</button>`).join('')}</div>
      <label class="search-box">${icon('search', 16)}<input id="gallery-search" placeholder="Buscar plantilla…" aria-label="Buscar plantilla" value="${esc(query)}"></label>
    </div>
    <div id="gallery-grid" class="gallery-grid">${galleryCards()}</div>
    <div class="library-foot">
      <span>${icon('sliders', 16)} Todas las plantillas incluyen modos de edición esencial y avanzado.</span>
      <span>Hechas para tus datos. Diseñadas para destacar.</span>
    </div>
  </main>`;
}

function galleryCards() {
  return filtered().map((t, i) => `<button class="gallery-card" data-template="${t.id}"><div class="gallery-preview">${thumb(t.config)}<span class="gallery-use">Personalizar ${icon('arrow', 15)}</span></div><div class="gallery-description"><div><span class="overline">${familyName(t.category)}</span><h3>${t.name}</h3><p>${t.description}</p></div><span class="gallery-number">${String(TEMPLATES.indexOf(t) + 1).padStart(2, '0')}</span></div></button>`).join('') || '<div class="empty-state">No encontramos esa tarjeta. Prueba con otra búsqueda.</div>';
}

function savedView() {
  const saved = getSaved();
  return `<main class="library-view">
    <div class="saved-info">${icon('info', 16)} Tus diseños se guardan en este navegador. Exporta un JSON para llevarlos a otro equipo.</div>
    ${saved.length ? `<div class="gallery-grid">${saved.map(s => `<article class="gallery-card saved-card"><button data-load="${s.id}" class="saved-preview" aria-label="Abrir ${esc(s.name)}">${thumb(s.config)}</button><div class="gallery-description"><div><span class="overline">${familyName(s.config.type)}</span><h3>${esc(s.name)}</h3><p>${new Date(s.date).toLocaleDateString('es-ES')}</p></div><div class="saved-actions">${ib('saved-json', 'Exportar configuración', 'download', `data-id="${s.id}"`)}${ib('delete', 'Eliminar diseño', 'trash', `data-id="${s.id}"`)}</div></div></article>`).join('')}</div>` : `<div class="empty-state">${icon('folder', 44)}<h2>Aquí empieza tu colección.</h2><p>Guarda una tarjeta y vuelve a ella siempre que quieras.</p>${btn('view-library', 'Encontrar mi primera plantilla', 'arrow', 'button primary')}</div>`}
  </main>`;
}

// ----------------------------------------------------
// Delegación Central de Eventos del DOM
// ----------------------------------------------------
function bindingContextAt(target) {
  const field = target?.closest?.('[data-binding-field]');
  if (field) return { keys: [field.dataset.bindingField] };
  const element = target?.closest?.('#binding-card-inner [data-element]');
  if (element) return { element: element.dataset.element, keys: getBindingFieldsForElement(element.dataset.element) };
  return target?.closest?.('#binding-card-inner') ? { keys: [] } : null;
}

function focusBindingElement(target) {
  const element = target?.closest?.('#binding-card-inner .is-bindable');
  if (!element) return false;
  const id = element.dataset.element;
  const keys = getBindingFieldsForElement(id);
  const key = keys.find(k => k === id || k.startsWith(id + '__')) ||
    keys.find(k => k === ELEMENT_TO_FIELD[id]) || keys[0];
  const input = document.getElementById(`f-bind-${key}`);
  input?.focus({ preventScroll: true });
  revealBindingFields([key], id);
  return true;
}

document.addEventListener('pointerover', e => highlightBindingContext(bindingContextAt(e.target)));
document.addEventListener('pointerout', e => highlightBindingContext(bindingContextAt(e.relatedTarget)));
document.addEventListener('focusin', e => highlightBindingContext(bindingContextAt(e.target), 'focus'));
document.addEventListener('focusout', e => highlightBindingContext(bindingContextAt(e.relatedTarget), 'focus'));
document.addEventListener('wheel', cancelBindingReveal, { passive: true });
document.addEventListener('pointerdown', cancelBindingReveal);

document.addEventListener('click', e => {
  if (focusBindingElement(e.target)) return;
  const bindingField = e.target.closest?.('[data-binding-field]');
  const bindingWrap = e.target.closest?.('.binding-dropdown-wrap') || bindingField?.querySelector?.('.binding-dropdown-wrap.has-dropdown');
  if (!bindingWrap) {
    closeAllBindingDropdowns();
  } else if (!e.target.closest?.('button')) {
    openBindingDropdown(bindingField.dataset.bindingField);
  }
  const t = e.target.closest('button,a[data-action]');
  if (!t) return;
  if (t.dataset.action === 'home') e.preventDefault();
  if (t.dataset.template) {
    const selected = TEMPLATES.find(x => x.id === t.dataset.template);
    if (selected) requestNavigation(() => loadDesign(selected.config));
    return;
  }
  if (t.dataset.theme) { themeSelect(t.dataset.theme); render(); return; }
  if (t.dataset.mode) { rememberInspector(); setMode(t.dataset.mode); persist(); render(); return; }
  if (t.dataset.tab) { rememberInspector(); setTab(t.dataset.tab); renderInspector(); return; }
  if (t.dataset.filter) { setFilter(t.dataset.filter); render(); return; }
  if (t.dataset.load) {
    const s = getSaved().find(x => x.id === t.dataset.load);
    if (s) requestNavigation(() => { loadDesign(s.config, s.id); toast('Diseño abierto.'); });
    return;
  }
  if (t.dataset.surface) { setConfig({ surfaceEffect: t.dataset.surface }); return; }
  if (t.dataset.elementColor && getSelectedElement()) { directChange(updateElement(getC(), getSelectedElement(), { [t.dataset.elementColor]: getC()[t.dataset.roleColor] })); return; }
  if (t.dataset.action === 'reset-appearance' && getSelectedElement()) {
    const sel = getSelectedElement();
    const p = { ...elementState(getC(), sel) };
    for (const key of ['colorMode', 'color', 'opacity', 'backgroundMode', 'backgroundColor', 'backgroundOpacity', 'fillMode', 'fillColor']) delete p[key];
    directChange({ ...getC(), elements: { ...getC().elements, [sel]: p } });
    return;
  }
  if (t.dataset.moveStep) {
    setMoveStep(Number(t.dataset.moveStep));
    try { localStorage.setItem('kpi-atelier-step', String(getMoveStep())); } catch {}
    renderCanvasBar();
    if (getTab() === 'element') renderInspector();
    return;
  }
  if (t.dataset.selectElement) { selectElement(t.dataset.selectElement); return; }
  if (t.dataset.layerMove) { commitLayerOrder(moveLayer(getC(), t.dataset.layerId, Number(t.dataset.layerMove)), t.dataset.layerId, t.dataset.layerMove); return; }
  if (t.dataset.layerVisibility) {
    const id = t.dataset.layerVisibility;
    setSelectedElement(id);
    directChange(elementVisible(getC(), id) ? updateElement(getC(), id, { hidden: true }) : restoreElement(getC(), id));
    return;
  }
  if (t.dataset.layerDelete) {
    const id = t.dataset.layerDelete;
    if (getDeleteConfirmLayer() === id) {
      setDeleteConfirmLayer(null);
      const wasSelected = getSelectedElement() === id || getSelectedElements().has(id);
      let next = updateElement(getC(), id, { deleted: true, hidden: false });
      if (wasSelected) {
        getSelectedElements().delete(id);
        if (getSelectedElement() === id) setSelectedElement([...getSelectedElements()][0] || null);
      }
      toast(`Elemento '${ELEMENTS[id]?.label || id}' eliminado.`);
      directChange(next);
      renderCanvasBar();
    } else {
      setDeleteConfirmLayer(id);
      renderCanvasBar();
    }
    return;
  }

  const clearDupBtn = e.target.closest?.('[data-action="clear-bind-dup"]');
  if (clearDupBtn) {
    const dupId = clearDupBtn.dataset.dup;
    const prop = clearDupBtn.dataset.prop || 'measure';
    const fieldKey = clearDupBtn.dataset.field || dupId;
    setC(updateElement(getC(), dupId, { [prop]: '' }));
    persist();
    const input = document.getElementById(`f-bind-${fieldKey}`) || document.getElementById(`f-bind-${dupId}`);
    if (input) { input.value = ''; input.focus(); }
    clearDupBtn.classList.remove('is-visible');
    const inner = document.getElementById('binding-card-inner');
    if (inner) {
      inner.innerHTML = cardHTML(getC(), undefined, true);
      fitBindingCard();
    }
    refreshCard();
    renderStatus();
    updateBindingModalStatus();
    return;
  }
  const clearBtn = e.target.closest?.('[data-action="clear-bind-field"]');
  if (clearBtn) {
    const fieldKey = clearBtn.dataset.field;
    applyBindingFieldValue(fieldKey, '');
    const input = document.getElementById(`f-bind-${fieldKey}`);
    if (input) { input.value = ''; input.focus(); }
    clearBtn.classList.remove('is-visible');
    const menu = document.getElementById(`dropdown-menu-${fieldKey}`);
    if (menu && menu.classList.contains('is-open')) closeAllBindingDropdowns();
    return;
  }

  const a = t.dataset.action;
  if (!a) return;
  if (a.startsWith('view-')) {
    const next = a.slice(5);
    if (next !== getView()) requestNavigation(() => { setView(next); setQuery(''); setFilter('all'); render(); });
    return;
  }

  const actions = {
    home: () => { if (getView() !== 'designer') requestNavigation(() => { setView('designer'); setQuery(''); setFilter('all'); render(); }); },
    single: () => { setContextPreview(false); setZoom(100); renderStage(); render(); },
    context: () => {
      setContextPreview(true);
      const stage = $('#stage');
      const [resW, resH] = getContextResolution() === '1920x1080' ? [1920, 1080] : [1280, 720];
      const availW = Math.max(300, (stage?.clientWidth || 800) - 80);
      const availH = Math.max(240, (stage?.clientHeight || 500) - 80);
      setZoom(Math.max(25, Math.min(100, Math.round(Math.min(availW / resW, availH / resH) * 100))));
      render();
    },
    'canvas-color': () => { setCanvasDark(!getCanvasDark()); renderStage(); },
    'toggle-ui-theme': () => { toggleUiTheme(); render(); },
    'toggle-rail': () => { toggleRailCollapsed(); render(); },
    'zoom-in': () => {
      const cur = getZoom();
      const next = Math.min(200, Math.floor(cur / 5) * 5 + 5);
      setZoom(next);
      renderStage();
    },
    'zoom-out': () => {
      const cur = getZoom();
      const prev = Math.max(25, Math.ceil(cur / 5) * 5 - 5);
      setZoom(prev);
      renderStage();
    },
    'zoom-fit': () => {
      const stage = $('#stage');
      const c = getC();
      if (getContextPreview()) {
        const [resW, resH] = getContextResolution() === '1920x1080' ? [1920, 1080] : [1280, 720];
        const availW = Math.max(300, (stage?.clientWidth || 800) - 80);
        const availH = Math.max(240, (stage?.clientHeight || 500) - 80);
        setZoom(Math.max(25, Math.min(100, Math.round(Math.min(availW / resW, availH / resH) * 100))));
      } else {
        const cardH = $('#main-card')?.firstElementChild?.offsetHeight || c.height || 300;
        const cardW = c.width || 400;
        const availW = Math.max(200, (stage?.clientWidth || 800) - 72);
        const availH = Math.max(160, (stage?.clientHeight || 460) - 110);
        const fitRatio = Math.min(availW / cardW, availH / cardH);
        const fitted = Math.max(25, Math.min(100, Math.round(fitRatio * 100)));
        setZoom(getZoom() === fitted && fitted < 100 ? 100 : fitted);
      }
      if (stage) { stage.scrollTop = 0; stage.scrollLeft = 0; }
      renderStage();
      toast(`Vista ajustada (${getZoom()} %)`);
    },
    'context-res': () => {
      setContextResolution(t.dataset.res || '1280x720');
      try { localStorage.setItem('kpi-atelier-context-res', JSON.stringify(getContextResolution())); } catch {}
      const stage = $('#stage');
      const [resW, resH] = getContextResolution() === '1920x1080' ? [1920, 1080] : [1280, 720];
      const availW = Math.max(300, (stage?.clientWidth || 800) - 80);
      const availH = Math.max(240, (stage?.clientHeight || 500) - 80);
      setZoom(Math.max(25, Math.min(100, Math.round(Math.min(availW / resW, availH / resH) * 100))));
      renderStage();
      render();
    },
    'fix-check-issue': () => {
      const f = t.dataset.field;
      if (!f) return;
      closeModal();
      if (['measure', 'measureName', 'dateTable', 'dateColumn', 'targetMeasure', 'compareMeasure'].includes(f)) {
        openDataBindingModal(f);
      } else {
        setTab(f === 'title' || f === 'goodThreshold' ? 'content' : 'style');
        render();
        const targetNode = $(`#f-${f}`);
        if (targetNode) {
          const det = targetNode.closest('details');
          if (det) det.open = true;
          targetNode.focus();
          targetNode.select?.();
        }
        toast('Corrige el campo indicado para continuar.');
      }
    },
    undo: () => {
      const curUndo = getUndo();
      const curRedo = getRedo();
      if (curUndo.length) {
        curRedo.push(structuredClone(getC()));
        setC(curUndo.pop());
        persist();
        render();
      }
    },
    redo: () => {
      const curUndo = getUndo();
      const curRedo = getRedo();
      if (curRedo.length) {
        curUndo.push(structuredClone(getC()));
        setC(curRedo.pop());
        persist();
        render();
      }
    },
    reset: () => {
      const c = getC();
      const template = TEMPLATES.find(x => x.id === c.id) || TEMPLATES[0];
      openModal('¿Restaurar la plantilla?', 'Volverás a los ajustes originales de ' + template.name + '.', '<p>Podrás recuperar los cambios con Deshacer.</p>', btn('close-modal', 'Cancelar', null, 'button secondary') + btn('confirm-reset', 'Restaurar', 'reset', 'button primary'));
    },
    'confirm-reset': () => {
      closeModal();
      const c = getC();
      loadDesign((TEMPLATES.find(x => x.id === c.id) || TEMPLATES[0]).config);
      toast('Plantilla restaurada.');
    },
    guide,
    validation: validationModal,
    export: exportModal,
    'review-live-measure': openMeasureReviewModal,
    'open-data-modal': () => openDataBindingModal(),
    'close-modal': closeModal,
    'toggle-bind-dropdown': () => {
      openBindingDropdown(t.dataset.field, true);
    },
    'select-binding-item': () => {
      const fieldKey = t.dataset.field;
      const val = t.dataset.value;
      applyBindingFieldValue(fieldKey, val);
      closeAllBindingDropdowns();
    },
    'pbi-infographic': () => pbiInfographicModal(),
    'back-to-export': () => exportModal(),
    'shortcuts-modal': () => shortcutsModal(),
    'copy-dax': copyDax,
    'confirm-export-anyway': confirmExport,
    'download-dax': () => download(filename() + '.dax', generateDAX(getC(), { allowIncomplete: true }), 'text/plain;charset=utf-8'),
    'download-json': () => downloadJSON(),
    'download-html': () => {
      const c = getC();
      download(filename() + '.html', `<!doctype html><html lang="es"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)} · Vista de muestra</title><body style="margin:0;min-height:100vh;background:#eceee9;display:grid;place-items:center;padding:24px;box-sizing:border-box"><main style="width:${c.width}px;max-width:100%">${cardHTML(c)}<p style="font:12px Arial;color:#737c77;text-align:center">KPI Atelier · Datos de ejemplo, no conectado a Power BI</p></main></body></html>`, 'text/html;charset=utf-8');
    },
    import: () => $('#file-import')?.click(),
    save: () => {
      const c = getC();
      const saved = getSaved();
      const ctx = getActiveContext();
      openModal('Una idea que merece quedarse.', 'Guarda esta tarjeta en tu colección personal.', `<label class="save-label" for="design-name">Nombre del diseño</label><input class="save-input" id="design-name" maxlength="80" value="${esc(saved.find(s => s.id === ctx.editingSavedId)?.name || c.title + ' · ' + (TEMPLATES.find(x => x.id === c.id)?.name || 'Mi diseño'))}" autofocus><p class="field-help">Se guardará en este navegador. Puedes exportar el JSON como copia.</p>`, btn('close-modal', 'Cancelar', null, 'button secondary') + btn('confirm-save', 'Guardar diseño', 'save', 'button primary'));
    },
    'confirm-save': () => {
      const name = $('#design-name')?.value || '';
      if (saveCurrent(name)) { closeModal(); render(); toast('Diseño guardado en tu colección.'); }
    },
    'guard-discard': () => {
      const ctx = getActiveContext();
      const go = ctx.pendingNavigation;
      setC(structuredClone(getBaseline()));
      getUndo().length = 0;
      getRedo().length = 0;
      persist();
      closeModal();
      go?.();
    },
    'guard-save': () => {
      const ctx = getActiveContext();
      const go = ctx.pendingNavigation;
      const name = $('#guard-name')?.value || '';
      if (saveCurrent(name)) { closeModal(); go?.(); }
    },
    'saved-json': () => {
      const s = getSaved().find(item => item.id === t.dataset.id);
      if (s) downloadJSON(s.config, s.name.replace(/[^\p{L}\p{N}_-]/gu, '_'));
    },
    delete: () => {
      const s = getSaved().find(item => item.id === t.dataset.id);
      if (s) openModal('¿Eliminar este diseño?', esc(s.name), '<p>El borrador actual no se eliminará.</p>', btn('close-modal', 'Cancelar', null, 'button secondary') + btn('confirm-delete', 'Eliminar', 'trash', 'button danger', `data-id="${s.id}"`));
    },
    'confirm-delete': () => {
      const next = getSaved().filter(s => s.id !== t.dataset.id);
      try {
        localStorage.setItem('kpi-atelier-saved', JSON.stringify(next));
        setSaved(next);
        closeModal();
        render();
        toast('Diseño eliminado.');
      } catch {
        toast('No se pudo eliminar el diseño.');
      }
    },
    scenario: () => {
      setTab('data');
      render();
      const details = $('#f-sampleScenario')?.closest('details');
      if (details) { details.open = true; details.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $('#f-sampleScenario')?.focus(); }
    },
    'select-card': selectCard,
    deselect: deselect,
    'format-painter': () => {
      const src = getFormatPainterSource();
      const sel = getSelectedElement();
      if (src) {
        setFormatPainterSource(null);
        toast('Copiar formato cancelado.');
      } else if (sel) {
        setFormatPainterSource(sel);
        toast(`Formato de '${ELEMENTS[sel]?.label || sel}' copiado. Haz clic en otro elemento del mismo tipo.`);
      }
      renderCanvasBar();
    },
    layers: () => { setLayersOpen(!getLayersOpen()); renderCanvasBar(); },
    guides: () => {
      const next = !getGuidesEnabled();
      setGuidesEnabled(next);
      try { localStorage.setItem('kpi-atelier-guides', JSON.stringify(next)); } catch {}
      renderCanvasBar();
      renderGuides();
    },
    icons: openIconPicker,
    themes: openThemeStudio,
    'connect-pbip': () => {
      const fallbackInput = document.getElementById('pbip-folder-input');
      if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
        window.showDirectoryPicker({ mode: 'read' }).then(async handle => {
          try {
            const catalog = await scanDirectoryHandle(handle);
            setPbipModel(catalog, true);
            const appliedCal = (catalog.dateTables || [])[0];
            const calMsg = appliedCal ? ` · Calendario: ${appliedCal.name}[${appliedCal.primaryDateColumn || appliedCal.dateColumns[0]}]` : '';
            toast(`Modelo '${catalog.modelName}' conectado (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha)${calMsg}.`);
            openDataBindingModal();
          } catch (err) {
            toast(`Error al leer PBIP: ${err.message}`);
          }
        }).catch(err => {
          if (err && err.name !== 'AbortError' && fallbackInput) {
            fallbackInput.click();
          }
        });
      } else if (fallbackInput) {
        fallbackInput.click();
      }
    },
    'disconnect-pbip': () => {
      setPbipModel(null);
      const c = getC();
      const tpl = TEMPLATES.find(x => x.id === c.id) || TEMPLATES[0];
      setC(sanitizeConfig({ ...c, dateTable: tpl.config.dateTable || 'Calendario', dateColumn: tpl.config.dateColumn || 'Fecha' }));
      persist();
      refreshCard();
      toast('Modelo desconectado.');
      openDataBindingModal();
    },
    'refresh-live-pbi': async () => {
      const pbipModel = getPbipModel();
      if (!pbipModel?.server) return;
      try {
        toast('Actualizando modelo desde Power BI Desktop…');
        const catalog = await fetchLivePbiModel(pbipModel.server, pbipModel.database || '');
        setPbipModel(catalog, true);
        toast(`Modelo actualizado (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
        openDataBindingModal();
      } catch (err) {
        toast(`Error al actualizar: ${err.message}`);
      }
    },
    'connect-live-pbi': async () => {
      const connectBtn = $('#modal')?.querySelector('[data-action="connect-live-pbi"]');
      const origContent = connectBtn ? connectBtn.innerHTML : '';
      if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.innerHTML = `${icon('sparkles', 13)} <span>Buscando informes…</span>`;
      }
      toast('Buscando informes abiertos en Power BI Desktop…');
      try {
        const instances = await discoverLivePbi();
        if (!instances || !instances.length) {
          toast('No se detectó ninguna instancia abierta de Power BI Desktop. Abre tu archivo en Desktop y vuelve a intentarlo.');
          return;
        }
        if (instances.length > 1) {
          chooseLiveInstanceModal(instances);
          return;
        }
        const first = instances[0];
        const repName = first.reportName ? `'${first.reportName}'` : `(${first.server})`;
        toast(`Conectando con Power BI Desktop ${repName}…`);
        const catalog = await fetchLivePbiModel(first.server, first.database || '');
        setPbipModel(catalog, true);
        toast(`⚡ Conectado con éxito a '${catalog.reportName || catalog.modelName}' (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
        openDataBindingModal();
      } catch (err) {
        toast(`Error al conectar con Power BI: ${err.message}`);
      } finally {
        if (connectBtn) {
          connectBtn.disabled = false;
          connectBtn.innerHTML = origContent;
        }
      }
    },
    'select-live-instance': async () => {
      const srv = t.dataset.server;
      const db = t.dataset.db || '';
      const repName = t.dataset.report || 'Power BI';
      t.disabled = true;
      t.innerHTML = `${icon('sparkles', 13)} Conectando…`;
      toast(`Conectando con '${repName}'…`);
      try {
        const catalog = await fetchLivePbiModel(srv, db);
        setPbipModel(catalog, true);
        toast(`⚡ Conectado en vivo a '${catalog.reportName || catalog.modelName}' (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
        openDataBindingModal();
      } catch (err) {
        toast(`Error al conectar: ${err.message}`);
        t.disabled = false;
        t.innerHTML = `${icon('sparkles', 13)} Conectar informe`;
      }
    },
    'load-roundtrip-measure': () => {
      const mName = t.dataset.measure;
      const pbipModel = getPbipModel();
      if (!mName || !pbipModel?.measures) return;
      const rm = pbipModel.measures.find(m => m.name === mName);
      if (rm?.configAnnotation) {
        try {
          const conf = typeof rm.configAnnotation === 'string' ? JSON.parse(rm.configAnnotation) : rm.configAnnotation;
          setPendingRoundtripConf(conf);
          setPendingRoundtripName(rm.name);
          openModal(
            '¿Cargar diseño en el lienzo?',
            `Se sustituirá el diseño actual por la configuración de la tarjeta '${esc(rm.name)}'.`,
            '<p class="field-help">Los cambios no guardados se reemplazarán por esta tarjeta. Puedes recuperar el diseño previo con Deshacer.</p>',
            btn('cancel-roundtrip-load', 'Cancelar', null, 'button secondary') +
            `<button type="button" class="button primary" data-action="confirm-roundtrip-load">${icon('sparkles', 14)} <span>Cargar en lienzo</span></button>`,
            'roundtrip-confirm-modal'
          );
        } catch (err) {
          toast(`No se pudo leer la configuración de '${esc(rm.name)}'.`);
        }
      }
    },
    'cancel-roundtrip-load': () => {
      setPendingRoundtripConf(null);
      setPendingRoundtripName('');
      openDataBindingModal();
    },
    'confirm-roundtrip-load': () => {
      const pendingConf = getPendingRoundtripConf();
      if (pendingConf) {
        const conf = pendingConf;
        const name = getPendingRoundtripName();
        setPendingRoundtripConf(null);
        setPendingRoundtripName('');
        if (conf.measure && String(conf.measure).trim()) conf._measureBound = true;
        if (conf.targetMeasure && String(conf.targetMeasure).trim()) conf._targetCustomized = true;
        if (conf.dateTable && String(conf.dateTable).trim()) conf._dateCustomized = true;
        setConfig(conf, true);
        openDataBindingModal();
        toast(`⚡ Tarjeta cargada en el lienzo desde '${esc(name)}'.`);
      }
    },
    'inject-live-measure': async () => {
      let pbipModel = getPbipModel();
      const c = structuredClone(getC());
      if (!pbipModel?.server) {
        toast('Buscando informes abiertos en Power BI Desktop…');
        const instances = await discoverLivePbi().catch(() => []);
        if (!instances || instances.length === 0) {
          showInjectErrorModal({
            error: new Error('No se detectó ninguna sesión activa de Power BI Desktop. Abre tu archivo en Power BI Desktop y vuelve a intentarlo.'),
            measureName: c.measureName,
            reportName: '',
            onRetry: () => actions['inject-live-measure']()
          });
          return;
        }
        if (instances.length === 1) {
          const cat = await fetchLivePbiModel(instances[0].server, instances[0].database || '');
          setPbipModel(cat, true);
          pbipModel = cat;
        } else {
          chooseLiveInstanceModal(instances);
          return;
        }
      }
      const b = $('#modal')?.querySelector('[data-action="inject-live-measure"]');
      const circConflict = getCircularConflict(c);
      if (circConflict) {
        openModal(
          'Dependencia circular detectada',
          'Corrige el nombre de la medida en KPI Atelier antes de sincronizar con Power BI.',
          `<div class="inject-confirm-alert error">
            <div class="inject-confirm-icon">${icon('alertTriangle', 20)}</div>
            <div>
              <strong>Conflicto con ${esc(circConflict.type)}</strong>
              <p>La medida DAX resultante se llama <code>${esc(c.measureName)}</code>, que coincide exactamente con la ${esc(circConflict.type)} <code>[${esc(circConflict.name)}]</code>.</p>
              <p>En Power BI, una medida no puede utilizar su propia fórmula para calcularse a sí misma (provocaría un error de dependencia circular en el servidor).</p>
              <p>Modifica el nombre de la medida resultante en KPI Atelier para continuar.</p>
            </div>
          </div>`,
          btn('close-modal', 'Cerrar', null, 'button secondary') +
          `<button type="button" class="button primary" data-action="fix-circular-name">
            ${icon('sparkles', 14)} <span>Renombrar a KPI_${esc(c.measureName.replace(/^\[|\]$/g, '').trim().replace(/[^\p{L}\p{N}_ ]/gu, '').trim().replace(/\s+/g, '_'))}</span>
          </button>`,
          'circular-conflict-modal'
        );
        return;
      }
      const review = reviewMeasure(c, pbipModel);
      const missingItems = [
        ...review.missing,
        ...review.unverified.map(r => ({ type: r.label, detail: `${r.value}: no se pudo verificar esta referencia en el catálogo del modelo.`, field: r.field })),
        ...review.issues.filter(x => x.level === 'error').map(x => ({ type: 'Configuración', detail: x.text, field: x.field }))
      ];
      if (missingItems.length) {
        openModal(
          'Validación de datos con Power BI',
          'No se pudo sincronizar la medida: algunos campos no coinciden con tu modelo actual.',
          `<div class="inject-confirm-alert error">
            <div class="inject-confirm-icon">${icon('alertTriangle', 20)}</div>
            <div>
              <strong>Campos pendientes o no encontrados en el modelo</strong>
              <ul class="missing-refs-list" style="margin:8px 0 0;padding-left:18px;">
                ${missingItems.map(it => `<li style="margin:4px 0;"><strong>${esc(it.type)}:</strong> ${esc(it.detail)}</li>`).join('')}
              </ul>
              <p style="margin-top:10px;">Selecciona los campos reales de tu modelo en <em>Conectar datos del modelo</em> antes de crear la medida.</p>
            </div>
          </div>`,
          btn('close-modal', 'Cancelar', null, 'button secondary') +
          `<button type="button" class="button primary" data-action="fix-missing-model-fields">
            ${icon('link', 14)} <span>Corregir en Conectar datos</span>
          </button>`,
          'missing-refs-modal'
        );
        return;
      }
      const rawMeasureName = extractBareMeasure(c.measureName);
      const cleanNewName = rawMeasureName.toLowerCase();
      const existingMeasure = (pbipModel.measures || []).find(m => (m.name || '').trim().toLowerCase() === cleanNewName);
      const executeInjection = async (overwriteConfirmed = false) => {
        const injectBtn = $('#modal')?.querySelector('[data-action="inject-live-measure"]') || $('#modal')?.querySelector('[data-action="proceed-inject-measure"]') || b;
        if (injectBtn) {
          injectBtn.disabled = true;
          injectBtn.innerHTML = `<span class="loading-spinner"></span> <span>${existingMeasure ? 'Sobrescribiendo…' : 'Inyectando…'}</span>`;
        }
        toast(existingMeasure ? '⚡ Sobrescribiendo medida en Power BI Desktop…' : '⚡ Creando medida en Power BI Desktop…');
        try {
          const freshCatalog = await fetchLivePbiModel(pbipModel.server, pbipModel.database || '');
          if (pbipModel.database && freshCatalog.database !== pbipModel.database) throw new Error('El modelo conectado ha cambiado. Vuelve a conectar el informe.');
          setPbipModel(freshCatalog, false);
          const freshReview = reviewMeasure(c, freshCatalog);
          if (!freshReview.valid) {
            await openMeasureReviewModal();
            toast('Corrige las referencias pendientes antes de aplicar la medida.');
            return;
          }
          if (freshReview.existing && !overwriteConfirmed) {
            showInjectConfirmModal([], freshReview.existing, () => executeInjection(true));
            return;
          }
          pbipModel = freshCatalog;
          const dax = generateDAX(c);
          const escapedName = rawMeasureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const cleanDax = dax.replace(new RegExp(`^\\s*(\\[?${escapedName}\\]?)\\s*=\\s*`, 'u'), '');
          const daxExpression = '\r\n' + cleanDax.trimStart();
          
          const targetTbl = measureDestination(c, pbipModel).table;
          
          let result;
          try {
            result = await injectMeasureToLivePbi({
              server: pbipModel.server,
              database: pbipModel.database || '',
              tableName: targetTbl,
              measureName: rawMeasureName,
              daxExpression: daxExpression,
              formatString: '',
              configAnnotation: c
            });
          } catch (injectErr) {
            const isConnErr = /conexión|connection|denegó|refused|failed|fetch|connect|no se puede establecer/i.test(injectErr.message || '');
            if (isConnErr) {
              const freshInstances = await discoverLivePbi().catch(() => []);
              const matching = freshInstances.find(i => (i.reportName && i.reportName === pbipModel.reportName) || (i.database && i.database === pbipModel.database)) || (freshInstances.length === 1 ? freshInstances[0] : null);
              if (matching) {
                toast(`⚡ Reconectando con Power BI Desktop en ${matching.server}…`);
                const freshCat = await fetchLivePbiModel(matching.server, matching.database || '');
                setPbipModel(freshCat, false);
                if (pbipModel.database && freshCat.database !== pbipModel.database) throw new Error('El informe reconectado no corresponde al modelo validado.');
                const retryReview = reviewMeasure(c, freshCat);
                if (!retryReview.valid) throw new Error('La reconexión contiene referencias pendientes o no encontradas. Corrige los datos antes de aplicar.');
                pbipModel = freshCat;
                if (retryReview.existing && !overwriteConfirmed) {
                  showInjectConfirmModal([], retryReview.existing, () => executeInjection(true));
                  return;
                }
                result = await injectMeasureToLivePbi({
                  server: matching.server,
                  database: matching.database || '',
                  tableName: retryReview.table,
                  measureName: rawMeasureName,
                  daxExpression: daxExpression,
                  formatString: '',
                  configAnnotation: c
                });
              } else if (freshInstances.length > 1) {
                chooseLiveInstanceModal(freshInstances);
                return;
              } else {
                throw injectErr;
              }
            } else {
              throw injectErr;
            }
          }

          toast(existingMeasure ? `⚡ ¡Medida '${result.measureName}' sobrescrita con éxito en Power BI Desktop!` : `⚡ ¡Medida '${result.measureName}' creada con éxito en Power BI Desktop!`);
          fetchLivePbiModel(pbipModel.server, pbipModel.database || '').then(cat => setPbipModel(cat, false)).catch(() => {});
          
          showInjectSuccessModal({
            measureName: result.measureName || rawMeasureName,
            tableName: result.tableName || targetTbl,
            reportName: getFriendlyReportName(pbipModel),
            isNew: result.isNew !== false
          });
        } catch (err) {
          showInjectErrorModal({
            error: err,
            measureName: rawMeasureName,
            reportName: getFriendlyReportName(pbipModel),
            onRetry: executeInjection
          });
        }
      };
      if (existingMeasure) {
        showInjectConfirmModal([], existingMeasure, () => executeInjection(true));
        return;
      }
      await executeInjection();
    },
    'retry-live-injection': async () => {
      const fn = getPendingInjectAction();
      if (fn) {
        await fn();
      } else {
        await actions['inject-live-measure']();
      }
    },
    'cancel-inject-confirm': () => {
      clearPendingInjectAction();
      closeModal();
      exportModal();
    },
    'proceed-inject-measure': async () => {
      const btnEl = $('#modal')?.querySelector('[data-action="proceed-inject-measure"]');
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = `<span class="loading-spinner"></span> <span>Aplicando…</span>`;
      }
      toast('⚡ Aplicando cambios en Power BI Desktop…');
      const fn = getPendingInjectAction();
      if (fn) {
        clearPendingInjectAction();
        await fn();
      } else {
        await actions['inject-live-measure']();
      }
    },
    'fix-circular-name': () => {
      const c = getC();
      const safeName = 'KPI_' + c.measureName.replace(/^\[|\]$/g, '').trim().replace(/[^\p{L}\p{N}_ ]/gu, '').trim().replace(/\s+/g, '_');
      setC(sanitizeConfig({ ...c, measureName: safeName }));
      persist();
      closeModal();
      exportModal();
      toast(`Medida renombrada a '${safeName}'. Ya puedes inyectarla en Power BI.`);
    },
    'fix-missing-model-fields': () => {
      closeModal();
      openDataBindingModal();
      toast('Configura las medidas y fechas según tu modelo de Power BI.');
    }
  };

  if (['hide-element', 'delete-element', 'restore-element', 'reset-element', 'release-element', 'smaller-element', 'bigger-element'].includes(a)) {
    elementAction(a);
    return;
  }

  try { actions[a]?.(); } catch (err) { toast(err.message || 'No se pudo completar la acción.'); }
});

// Eventos de entrada de datos en lienzo y diseñador
app.addEventListener('input', e => {
  const t = e.target;
  if (t.type === 'number') return;
  if (t.id === 'template-search' || t.id === 'gallery-search') {
    setQuery(t.value);
    const target = $(t.id === 'template-search' ? '#rail-cards' : '#gallery-grid');
    if (target) target.innerHTML = t.id === 'template-search' ? railCards() : galleryCards();
    fitThumbs();
    return;
  }
  if (t.dataset.duptext) {
    const id = t.dataset.dupid || t.dataset.duptext;
    directChange(updateElement(getC(), id, { text: t.value }), true, false);
    return;
  }
  if (t.dataset.dupsize) {
    const id = t.dataset.dupid || t.dataset.dupsize || getSelectedElement();
    if (id) {
      const val = Number(t.value);
      if (t.nextElementSibling?.tagName === 'OUTPUT') t.nextElementSibling.textContent = val + 'px';
      directChange(updateElement(getC(), id, { size: val }), true, false);
      return;
    }
  }
  if (t.dataset.dupval) {
    const id = t.dataset.dupid || getSelectedElement();
    if (id) {
      const prop = t.dataset.dupval;
      let val = t.value;
      if (t.type === 'checkbox') val = t.checked;
      else if (['decimals', 'goodThreshold', 'warnThreshold', 'donutThickness', 'lineWidth'].includes(prop) || (t.type === 'range' && prop !== 'fillOpacity')) val = Number(val);
      else if (prop === 'fillOpacity') val = Number(val) / 100;
      if (t.type === 'range') {
        const suffix = t.nextElementSibling?.textContent?.match(/(?:px|%)$/)?.[0] || '';
        if (t.nextElementSibling) t.nextElementSibling.textContent = (prop === 'fillOpacity' ? Math.round(val * 100) : val) + suffix;
      }
      const isStructural = ['comparison', 'chartKind', 'format', 'deltaMode', 'direction'].includes(prop);
      directChange(updateElement(getC(), id, { [prop]: val }), true, isStructural);
      return;
    }
  }
  if (t.dataset.elprop && getSelectedElement()) {
    const sel = getSelectedElement();
    const key = t.dataset.elprop;
    const value = Number(t.value);
    const state = elementState(getC(), sel);
    const next = key === 'x' || key === 'y'
      ? moveElement(getC(), sel, key === 'x' ? value - state.x : 0, key === 'y' ? value - state.y : 0, 1, measureElementFrame(sel))
      : updateElement(getC(), sel, { [key]: value });
    directChange(next, true, false);
    return;
  }
  if (t.dataset.appearance && getSelectedElement()) { editAppearance(t); return; }
  if (t.dataset.key) {
    const k = t.dataset.key;
    const c = getC();
    const next = { ...c, [k]: t.type === 'checkbox' ? t.checked : typeof BASE[k] === 'number' ? Number(t.value) / Number(t.dataset.scale || 1) : t.value };
    if (['accent', 'background', 'text', 'muted', 'positive', 'negative', 'warning', 'borderColor'].includes(k)) next.theme = 'custom';
    if (k === 'format' && next.format !== 'percent' && next.deltaMode === 'pp') next.deltaMode = 'relative';
    if (k === 'format' && next.format === 'percent') next.unit = 'none';
    if (k === 'comparison' && next.elements) {
      const elPatch = {};
      if (next.elements.delta) elPatch.delta = { ...next.elements.delta, comparison: next.comparison };
      if (next.elements.compareLabel) elPatch.compareLabel = { ...next.elements.compareLabel, comparison: next.comparison };
      if (Object.keys(elPatch).length) next.elements = { ...next.elements, ...elPatch };
    }
    if (t.type === 'range') {
      const suffix = t.nextElementSibling?.textContent?.match(/(?:px|%)$/)?.[0] || '';
      if (t.nextElementSibling) t.nextElementSibling.textContent = (t.dataset.scale ? Math.round(next[k] * Number(t.dataset.scale)) : next[k]) + suffix;
    }
    if (t.type === 'color' && t.nextElementSibling) {
      t.nextElementSibling.textContent = next[k].toUpperCase();
      if (t.nextElementSibling.nextElementSibling) t.nextElementSibling.nextElementSibling.style.background = next[k];
    }
    const isStructural = ['showIcon', 'showSubtitle', 'showComparison', 'showTrend', 'showGoal', 'showFooter', 'format', 'comparison', 'type', 'surfaceEffect', 'effectColorMode'].includes(k);
    directChange(next, true, isStructural);
  }
});

// Eventos de entrada de datos en diálogos y buscador de iconos
document.addEventListener('input', e => {
  if (e.target.id === 'f-bind-granularity') {
    setC(sanitizeConfig({ ...getC(), granularity: e.target.value }));
    persist();
    const inner = document.getElementById('binding-card-inner');
    if (inner) {
      inner.innerHTML = cardHTML(getC(), undefined, true);
      highlightBindingElements('granularity', true);
      fitBindingCard();
    }
    refreshCard();
    renderStatus();
  }
  if (e.target.id === 'icon-search') {
    const grid = $('#icon-grid');
    if (grid) grid.innerHTML = iconGrid(e.target.value);
  }
  const dupId = e.target.dataset?.bindDup;
  if (dupId) {
    const prop = e.target.dataset?.bindDupprop || 'measure';
    const fieldKey = e.target.dataset?.bindFieldKey || dupId;
    const val = e.target.value;
    const next = updateElement(getC(), dupId, { [prop]: val });
    setC(next);
    persist();
    const clearBtn = document.querySelector(`[data-action="clear-bind-dup"][data-field="${fieldKey}"]`) || document.querySelector(`[data-action="clear-bind-dup"][data-dup="${dupId}"]`);
    if (clearBtn) clearBtn.classList.toggle('is-visible', Boolean(val));
    const inner = document.getElementById('binding-card-inner');
    if (inner) {
      inner.innerHTML = cardHTML(getC(), undefined, true);
      highlightBindingElements(fieldKey, true);
      fitBindingCard();
    }
    refreshCard();
    renderStatus();
    const menu = document.getElementById(`dropdown-menu-${fieldKey}`) || document.getElementById(`dropdown-menu-${dupId}`);
    if (menu && getPbipModel()) {
      menu.innerHTML = renderBindingDropdown(fieldKey, val);
      menu.classList.add('is-open');
      const toggle = document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${fieldKey}"]`) || document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${dupId}"]`);
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }
    updateBindingModalStatus();
    return;
  }
  const bindKey = e.target.dataset?.bindKey;
  if (bindKey) {
    let curC = getC();
    if (bindKey === 'measure') {
      const val = e.target.value;
      curC._measureBound = Boolean(val.trim());
      const cleanId = val.replace(/^\[|\]$/g, '').trim().replace(/[^\p{L}\p{N}_ ]/gu, '').trim().replace(/\s+/g, '_');
      const autoName = cleanId ? (cleanId.startsWith('KPI_') ? cleanId : `KPI_${cleanId}`) : '';
      const autoTitle = val.replace(/^\[|\]$/g, '').trim();
      const patch = { measure: val };
      if (autoName) {
        patch.measureName = autoName;
        const mnInput = document.getElementById('f-bind-measureName');
        if (mnInput) mnInput.value = autoName;
      }
      if (autoTitle) patch.title = autoTitle;
      curC = sanitizeConfig({ ...curC, ...patch });
    } else if (bindKey === 'measureName') {
      const val = e.target.value;
      const stripped = val.replace(/^kpi[_\s]+/i, '').replace(/_+/g, ' ').trim();
      const autoTitle = stripped || val.trim();
      const patch = { measureName: val };
      if (autoTitle && autoTitle.toLowerCase() !== 'kpi') patch.title = autoTitle;
      curC = sanitizeConfig({ ...curC, ...patch });
    } else {
      if (bindKey === 'targetMeasure') curC._targetCustomized = true;
      if (bindKey === 'dateTable') curC._dateCustomized = true;
      curC = sanitizeConfig({ ...curC, [bindKey]: e.target.value });
    }
    setC(curC);
    persist();
    const clearBtn = document.querySelector(`[data-action="clear-bind-field"][data-field="${bindKey}"]`);
    if (clearBtn) clearBtn.classList.toggle('is-visible', Boolean(e.target.value));
    const menu = document.getElementById(`dropdown-menu-${bindKey}`);
    const pbipModel = getPbipModel();
    if (menu && pbipModel) {
      menu.innerHTML = renderBindingDropdown(bindKey, e.target.value);
      menu.classList.add('is-open');
      const toggle = document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${bindKey}"]`);
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }
    const inner = document.getElementById('binding-card-inner');
    if (inner) {
      inner.innerHTML = cardHTML(curC, undefined, true);
      highlightBindingElements(bindKey, true);
      fitBindingCard();
    }
    updateBindingFieldStatus(bindKey);
    if (bindKey === 'measure') updateBindingFieldStatus('measureName');
    if (bindKey === 'dateTable' && pbipModel) {
      const dlDateCols = document.getElementById('dl-pbip-date-columns');
      if (dlDateCols) {
        const curDt = (pbipModel.dateTables || []).find(dt => dt.name.toLowerCase() === e.target.value.trim().toLowerCase());
        const candidateCols = curDt ? curDt.dateColumns : Array.from(new Set((pbipModel.dateTables || []).flatMap(dt => dt.dateColumns)));
        dlDateCols.innerHTML = candidateCols.map(col => {
          const isKey = curDt && curDt.primaryDateColumn === col;
          const tag = isKey ? '⭐ Columna clave (isKey)' : curDt ? esc(curDt.name) : 'Columna fecha';
          return `<option value="${esc(col)}">${tag}</option>`;
        }).join('');
      }
    }
    updateBindingModalStatus();
    refreshCard();
    renderStatus();
  }
});

// Eventos de cambio (confirmación de campos numéricos, select, checkbox)
app.addEventListener('change', e => {
  const t = e.target;
  if (t.type === 'number' && (t.dataset.key || t.dataset.elprop)) { commitNumber(t); return; }
  if (t.id === 'family-filter') { setFilter(t.value); const rail = $('#rail-cards'); if (rail) rail.innerHTML = railCards(); fitThumbs(); return; }
  if (t.dataset.appearance && getSelectedElement()) {
    if (t.tagName === 'SELECT') renderInspector();
    else if (t.dataset.hex !== undefined && t.getAttribute('aria-invalid') === 'true') toast('Escribe un color HEX de 6 caracteres.');
    return;
  }
  if (t.dataset.elprop && getSelectedElement()) {
    t.value = elementState(getC(), getSelectedElement())[t.dataset.elprop];
    renderInspector();
  }
  if (t.dataset.key && (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'color')) renderInspector();
});

// Gestos con el puntero
app.addEventListener('pointerdown', e => {
  if (getContextPreview() || e.button !== 0) return;
  const cardHandle = e.target.closest('[data-card-resize]');
  if (cardHandle) { startCardGesture(e, cardHandle.dataset.cardResize); return; }
  const handle = e.target.closest('[data-resize]');
  const el = e.target.closest('[data-element]');
  if (!handle && !el) return;

  const formatPainterSource = getFormatPainterSource();
  if (formatPainterSource && el) {
    e.preventDefault();
    applyFormatPainter(el.dataset.element);
    return;
  }

  const isCtrl = e.ctrlKey || e.metaKey;
  if (el) {
    if (isCtrl) { selectElement(el.dataset.element, false, true); return; }
    if (!getSelectedElements().has(el.dataset.element)) selectElement(el.dataset.element);
  }

  const sel = getSelectedElement();
  const c = getC();
  if (!sel || !elementVisible(c, sel)) return;
  const scale = ($('#main-card')?.getBoundingClientRect().width || c.width) / c.width;
  const selectedElements = getSelectedElements();

  if (!handle && selectedElements.size > 1) {
    const items = [...selectedElements].map(mId => {
      const node = app.querySelector(`[data-element="${mId}"]`);
      const frame = c.elements?.[mId]?.frame || measureElementFrame(mId);
      const p = elementState(c, mId);
      const bBox = node ? node.getBoundingClientRect() : null;
      const w = bBox ? bBox.width / scale : (p.width || frame?.width || 100);
      const h = bBox ? bBox.height / scale : (frame?.height || 24);
      const left = (frame?.left || 0) + p.x;
      const top = (frame?.top || 0) + p.y;
      return { id: mId, frame, p, w, h, left, top };
    });
    const gesture = {
      kind: 'group-move',
      id: sel,
      items,
      minDx: Math.max(...items.map(it => -it.left)),
      maxDx: Math.min(...items.map(it => c.width - (it.left + it.w))),
      minDy: Math.max(...items.map(it => -it.top)),
      maxDy: Math.min(...items.map(it => c.height - (it.top + it.h))),
      startX: e.clientX,
      startY: e.clientY,
      start: structuredClone(c),
      scale,
      changed: false,
      pointer: e.pointerId,
      undoSnapshot: [...getUndo()],
      redo: [...getRedo()]
    };
    setGesture(gesture);
    if (app.setPointerCapture) app.setPointerCapture(e.pointerId);
    renderGuides();
    e.preventDefault();
    return;
  }

  const node = app.querySelector(`[data-element="${sel}"]`);
  const gesture = {
    id: sel,
    kind: handle?.dataset.resize || 'move',
    startX: e.clientX,
    startY: e.clientY,
    start: structuredClone(c),
    scale,
    width: node ? node.getBoundingClientRect().width / scale : 100,
    frame: measureElementFrame(sel),
    changed: false,
    pointer: e.pointerId,
    undoSnapshot: [...getUndo()],
    redo: [...getRedo()]
  };
  setGesture(gesture);
  if (app.setPointerCapture) app.setPointerCapture(e.pointerId);
  renderGuides();
  e.preventDefault();
});

app.addEventListener('pointermove', e => {
  const g = getGesture();
  if (!g || e.pointerId !== g.pointer) return;
  if (!g.changed && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 3) return;
  if (!g.changed) { record(); g.changed = true; app.classList.add('is-dragging'); }

  const moveStep = getMoveStep();
  const dx = (e.clientX - g.startX) / g.scale;
  const dy = (e.clientY - g.startY) / g.scale;
  const step = e.shiftKey ? (moveStep === 1 ? 5 : 1) : moveStep;
  let next = g.start;

  if (g.card) {
    next = resizeCard(g.start, g.start.width + (g.kind === 's' ? 0 : Math.round(dx / step) * step), g.start.height + (g.kind === 'e' ? 0 : Math.round(dy / step) * step), true);
  } else if (g.kind === 'group-move') {
    const clampedDx = Math.max(g.minDx, Math.min(g.maxDx, Math.round(dx / step) * step));
    const clampedDy = Math.max(g.minDy, Math.min(g.maxDy, Math.round(dy / step) * step));
    next = g.start;
    for (const it of g.items) {
      next = moveElement(next, it.id, clampedDx, clampedDy, step, it.frame);
    }
  } else if (g.kind === 'move') {
    next = moveElement(g.start, g.id, dx, dy, step, g.frame);
  } else {
    let detached = detachElement(g.start, g.id, g.frame);
    const def = resolveElementDef(g.id) || ELEMENTS[g.id];
    const bounds = SIZE_LIMITS[def.kind];
    const p0 = elementState(detached, g.id);
    const S0 = elementSize(detached, g.id);
    const W0 = Math.round(p0.width || g.width);
    const X0 = p0.x;
    const Y0 = p0.y;

    if (g.kind === 'nw') {
      const clampDy = Math.min(0, dy);
      const snappedDx = Math.round(dx / step) * step;
      const snappedDy = Math.round(clampDy / step) * step;
      const targetW = Math.max(16, Math.min(800, W0 - snappedDx));
      const targetS = clamp(S0 - snappedDy, ...bounds);
      next = updateElement(detached, g.id, { x: X0 - (targetW - W0), y: Y0 - (targetS - S0), width: targetW });
      if (def?.isDuplicate) next = updateElement(next, g.id, { size: targetS });
      else next = { ...next, [def.sizeKey]: targetS };
    } else {
      const clampDy = Math.max(0, dy);
      const snappedDx = Math.round(dx / step) * step;
      const snappedDy = Math.round(clampDy / step) * step;
      const targetW = Math.max(16, Math.min(800, W0 + snappedDx));
      const targetS = clamp(S0 + snappedDy, ...bounds);
      next = updateElement(detached, g.id, { width: targetW });
      if (def?.isDuplicate) next = updateElement(next, g.id, { size: targetS });
      else next = { ...next, [def.sizeKey]: targetS };
    }
  }

  setC(sanitizeConfig(next));
  refreshCard();
  if (g.card) syncCardControls(); else syncElementControls();
  updateHistoryButtons();
});

app.addEventListener('pointerup', () => finishGesture());
app.addEventListener('pointercancel', () => finishGesture(true));
app.addEventListener('click', e => {
  if (getFormatPainterSource()) return;
  const isCtrl = e.ctrlKey || e.metaKey;
  const el = e.target.closest('[data-element]');
  if (el) {
    if (isCtrl) return;
    if (getSelectedElement() !== el.dataset.element || getSelectedElements().size > 1) selectElement(el.dataset.element);
    return;
  }
  if (e.target.closest('[data-card-surface]')) { selectCard(); return; }
  if (e.target.closest('#stage') && !e.target.closest('#selection-overlay') && (getSelectedElement() || getCardSelected())) deselect();
});

// Atajos de teclado generales y de lienzo
document.addEventListener('keydown', e => {
  const target = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && target?.closest?.('#binding-card-inner .is-bindable')) {
    e.preventDefault();
    focusBindingElement(target);
    return;
  }
  const bindKey = target?.dataset?.bindKey;
  if (bindKey) {
    const menu = document.getElementById(`dropdown-menu-${bindKey}`);
    const isOpen = menu && menu.classList.contains('is-open');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        if (menu && getPbipModel()) {
          closeAllBindingDropdowns();
          menu.innerHTML = renderBindingDropdown(bindKey, target.value);
          menu.classList.add('is-open');
          const toggle = document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${bindKey}"]`);
          if (toggle) { toggle.setAttribute('aria-expanded', 'true'); toggle.classList.add('is-open'); }
        }
        return;
      }
      const items = Array.from(menu.querySelectorAll('.binding-dropdown-item'));
      if (!items.length) return;
      const curIdx = items.findIndex(it => it.classList.contains('is-selected'));
      const nextIdx = curIdx < items.length - 1 ? curIdx + 1 : 0;
      items.forEach((it, idx) => it.classList.toggle('is-selected', idx === nextIdx));
      items[nextIdx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!isOpen) return;
      e.preventDefault();
      const items = Array.from(menu.querySelectorAll('.binding-dropdown-item'));
      if (!items.length) return;
      const curIdx = items.findIndex(it => it.classList.contains('is-selected'));
      const prevIdx = curIdx > 0 ? curIdx - 1 : items.length - 1;
      items.forEach((it, idx) => it.classList.toggle('is-selected', idx === prevIdx));
      items[prevIdx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && isOpen) {
      const selectedItem = menu.querySelector('.binding-dropdown-item.is-selected') || menu.querySelector('.binding-dropdown-item');
      if (selectedItem) {
        e.preventDefault();
        e.stopPropagation();
        const val = selectedItem.dataset.value;
        applyBindingFieldValue(bindKey, val);
        closeAllBindingDropdowns();
        target.focus();
        return;
      }
    }
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeAllBindingDropdowns();
      return;
    }
  }
  if (e.key === 'Escape') {
    const openMenu = document.querySelector('.binding-dropdown-menu.is-open');
    if (openMenu) {
      e.preventDefault();
      e.stopPropagation();
      closeAllBindingDropdowns();
      return;
    }
  }
  if (e.key === 'Escape' && getGesture()) { e.preventDefault?.(); finishGesture(true); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B') && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !$('#modal')?.open) {
    e.preventDefault?.();
    toggleRailCollapsed();
    render();
    return;
  }
  if ((e.key === '?' || (e.shiftKey && e.key === '/')) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !$('#modal')?.open) {
    e.preventDefault?.();
    shortcutsModal();
    return;
  }
  if (e.key === 'Tab' && !$('#modal')?.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    const elements = Array.from(document.querySelectorAll('#main-card [data-element]')).filter(el => {
      const s = el.style;
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
    if (elements.length > 0) {
      e.preventDefault?.();
      const cur = getSelectedElement();
      const curIdx = elements.findIndex(el => el.dataset.element === cur);
      const nextIdx = e.shiftKey
        ? (curIdx <= 0 ? elements.length - 1 : curIdx - 1)
        : (curIdx >= elements.length - 1 ? 0 : curIdx + 1);
      const target = elements[nextIdx];
      selectElement(target.dataset.element);
      target.focus({ preventScroll: true });
      return;
    }
  }
  if (!$('#modal')?.open && (e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-element]')) {
    e.preventDefault();
    selectElement(e.target.dataset.element);
    return;
  }
  if (e.target.closest?.('.layers-popover')) return;
  if ($('#modal')?.open || !getSelectedElement() || getContextPreview() || getView() !== 'designer' || !e.target.closest?.('#stage,#canvas-edit-bar')) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); $('#app')?.querySelector('[data-action="save"]')?.click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('#modal')?.open) {
      e.preventDefault();
      $('#app')?.querySelector(`[data-action="${e.shiftKey ? 'redo' : 'undo'}"]`)?.click();
    }
    if ((e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('#modal')?.open) {
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); copySelectedElements(); }
      if (e.key === 'v' || e.key === 'V') { e.preventDefault(); pasteElements(); }
    }
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === 'Escape') {
    if (getFormatPainterSource()) {
      e.preventDefault();
      setFormatPainterSource(null);
      renderCanvasBar();
      toast('Copiar formato cancelado.');
      return;
    }
    e.preventDefault();
    deselect();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); elementAction('delete-element'); return; }
  const moveStep = getMoveStep();
  const step = e.shiftKey ? (moveStep === 1 ? 5 : 1) : moveStep;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    flashGuides();
    const reqDx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const reqDy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const selectedElements = getSelectedElements();
    const c = getC();
    if (selectedElements.size > 1) {
      const members = [...selectedElements];
      const items = members.map(mId => {
        const frame = c.elements?.[mId]?.frame || measureElementFrame(mId);
        const p = elementState(c, mId);
        const w = p.width || frame?.width || 100;
        const h = frame?.height || 24;
        const left = (frame?.left || 0) + p.x;
        const top = (frame?.top || 0) + p.y;
        return { id: mId, frame, w, h, left, top };
      });
      const minDx = Math.max(...items.map(it => -it.left));
      const maxDx = Math.min(...items.map(it => c.width - (it.left + it.w)));
      const minDy = Math.max(...items.map(it => -it.top));
      const maxDy = Math.min(...items.map(it => c.height - (it.top + it.h)));
      const clampedDx = Math.max(minDx, Math.min(maxDx, reqDx));
      const clampedDy = Math.max(minDy, Math.min(maxDy, reqDy));
      if (clampedDx !== 0 || clampedDy !== 0) {
        let next = c;
        for (const it of items) next = moveElement(next, it.id, clampedDx, clampedDy, step, it.frame);
        directChange(next, true, false);
      }
    } else {
      const sel = getSelectedElement();
      directChange(moveElement(c, sel, reqDx, reqDy, step, measureElementFrame(sel)), true, false);
      app.querySelector(`[data-element="${sel}"]`)?.focus({ preventScroll: true });
    }
  }
  if (e.key === '+' || e.key === '=' || e.key === '-') {
    e.preventDefault();
    flashGuides();
    elementAction(e.key === '-' ? 'smaller-element' : 'bigger-element');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); $('#app')?.querySelector('[data-action="save"]')?.click(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('#app')?.querySelector(`[data-action="${e.shiftKey ? 'redo' : 'undo'}"]`)?.click(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelectedElements(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteElements(); }
});

// Importación de archivos JSON
$('#file-import')?.addEventListener('change', async e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 100000) { toast('El JSON es demasiado grande (máximo 100 KB).'); return; }
  try {
    const data = JSON.parse(await f.text());
    if (data.schema !== 'kpi-atelier' || data.version !== 1 || !data.config || typeof data.config !== 'object' || Array.isArray(data.config)) {
      throw Error('Selecciona un JSON de configuración de KPI Atelier v1.');
    }
    const conf = sanitizeConfig(data.config);
    requestNavigation(() => { loadDesign(conf); toast('Configuración importada.'); });
  } catch (err) {
    toast(err.message || 'No se pudo leer el archivo.');
  }
});

// Cierre del modal por clic exterior
$('#modal')?.addEventListener('cancel', e => {
  e.preventDefault();
  closeModal();
});
$('#modal')?.addEventListener('click', e => {
  const modal = $('#modal');
  if (e.target === modal) {
    const r = modal.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal();
  }
});

window.addEventListener('beforeunload', e => {
  if (dirty()) { e.preventDefault(); e.returnValue = ''; }
});

window.addEventListener('resize', () => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => { fitThumbs(); fitMain(); });
  }
});

// ----------------------------------------------------
// Inicialización Power BI Desktop en Vivo y Render Boot
// ----------------------------------------------------
async function initLivePbi() {
  if (typeof window === 'undefined' || !window.location || typeof fetch !== 'function') return;
  const USP = typeof URLSearchParams !== 'undefined' ? URLSearchParams : globalThis.URLSearchParams;
  if (!USP) return;
  const params = new USP(window.location.search || '');
  const server = params.get('server');
  const database = params.get('database');
  if (server) {
    try {
      const catalog = await fetchLivePbiModel(server, database || '');
      setPbipModel(catalog, true);
      const appliedCal = (catalog.dateTables || [])[0];
      const calMsg = appliedCal ? ` · Calendario: ${appliedCal.name}[${appliedCal.primaryDateColumn || appliedCal.dateColumns[0]}]` : '';
      toast(`🟢 Power BI Desktop conectado en vivo (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha)${calMsg}.`);
      return;
    } catch (err) {
      console.warn('No se pudo conectar a Power BI Desktop via URL:', err);
    }
  }
  try {
    const instances = await discoverLivePbi();
    if (instances && instances.length === 1) {
      const first = instances[0];
      const catalog = await fetchLivePbiModel(first.server, first.database || '');
      setPbipModel(catalog, true);
      render();
    }
  } catch {}

  if (typeof window.EventSource !== 'undefined') {
    initLivePbiStream(instances => {
      const current = getPbipModel();
      if (current?.isLiveConnection) {
        const stillActive = (instances || []).some(inst => inst.server === current.server);
        if (!stillActive) {
          toast('Power BI Desktop se ha cerrado o desconectado.');
        }
      }
    });
  }
}

initLivePbi();
render();
