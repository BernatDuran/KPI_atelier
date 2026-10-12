import { installEditorEvents } from './editor-events.mjs';
import { chooseModelFolder, importModelFiles, cancelModelScan } from './model-import.mjs';
import { installLayerEvents } from './layer-events.mjs';
import { initLiveConnection } from './live-connection.mjs';
import { beginModelRequest, cancelModelRequest } from './model-session.mjs';
import { handleStudioClick, handleStudioInput, installStudioPointerEvents } from './studio-ui.mjs';
import { recordEdit } from './state.mjs';
import { captureDesignSession, isDesignSessionCurrent } from './state.mjs';
import { getModalRevision, getPendingWriteReviewAction, clearPendingWriteReviewAction } from './modals.mjs';
import { validateImportedJSON, MAX_CONFIG_BYTES } from './schema.mjs';
import { applyLiveMeasure } from './measure-write.mjs';
import { render, railCards, galleryCards } from './shell-ui.mjs';
/**
 * KPI Atelier - Orquestador Principal (dist/app.mjs)
 * Coordina el ciclo de vida de la aplicación, vistas de alto nivel (diseñador, biblioteca, mis diseños),
 * delegación central de eventos del DOM y arranque de conexiones Power BI en vivo.
 */

import { applyLayout } from './layout.mjs';
import { BASE, TEMPLATES, sanitizeConfig } from './model.mjs';
import { icon, esc, cardHTML } from './cards.mjs';
import { generateDAX } from './dax.mjs';
import { ELEMENTS, elementState, elementVisible, updateElement, moveElement, restoreElement, restorationIssue, moveLayer } from './elements.mjs';
import { fetchLivePbiModel, discoverLivePbi } from './pbip.mjs';

import { $, btn, setContext, getActiveContext, getC, setC, getBaseline, setMode, getTab, setTab, getView, setView, getSelectedElement, setSelectedElement, getSelectedElements, getPbipModel, setPbipModel, getUndo, getRedo, getSaved, deleteSaved, getZoom, setZoom, getCanvasDark, setCanvasDark, getContextPreview, setContextPreview, getMoveStep, setMoveStep, getLayersOpen, setLayersOpen, getGuidesEnabled, setGuidesEnabled, getFormatPainterSource, setFormatPainterSource, getDeleteConfirmLayer, setDeleteConfirmLayer, getContextResolution, setContextResolution, setFilter, setQuery, getPendingRoundtripConf, setPendingRoundtripConf, getPendingRoundtripName, setPendingRoundtripName, dirty, toast, persist, setConfig, themeSelect, loadDesign, saveCurrent, requestNavigation, toggleUiTheme, toggleRailCollapsed } from './state.mjs';
import { renderStage, fitThumbs, fitMain, resetContextViewport,setContextManualZoom,measureElementFrame, renderCanvasBar, commitLayerOrder, positionSelection, refreshCard, renderGuides, selectElement, selectCard, deselect, directChange, elementAction } from './canvas.mjs';
import { field, renderInspector, renderStatus, updateHistoryButtons, rememberInspector, editAppearance, syncElementControls, syncCardControls, commitNumber } from './inspector.mjs';
import { openModal, closeModal, filename, download, downloadJSON, copyDax, exportModal, openMeasureReviewModal, validationModal, chooseLiveInstanceModal, guide, openIconPicker, iconGrid, openThemeStudio, ELEMENT_TO_FIELD, getBindingFieldsForElement, highlightBindingContext, renderBindingDropdown, closeAllBindingDropdowns, applyBindingFieldValue, openDataBindingModal, shortcutsModal, pbiInfographicModal, getPendingInjectAction, clearPendingInjectAction } from './modals.mjs';
import { cancelBindingReveal, revealBindingFields, openBindingDropdown, confirmExport } from './modals.mjs';

// Sincronizar contexto activo y registrar funciones orquestadoras para ESM y sandbox
const activeContext = typeof globalThis !== 'undefined' ? globalThis : this;
activeContext.render = render;
activeContext.renderStage = renderStage;
activeContext.refreshCard = refreshCard;
activeContext.renderInspector = renderInspector;
activeContext.renderStatus = renderStatus;
activeContext.openModal = openModal;
activeContext.fitThumbs = fitThumbs;
Object.assign(activeContext, {
  updateHistoryButtons, syncElementControls, syncCardControls, rememberInspector,
  renderCanvasBar, positionSelection, renderGuides, deselect, measureElementFrame
});
setContext(activeContext);
installStudioPointerEvents();

const app = $('#app') || (typeof document !== 'undefined' ? (document.querySelector('#app') || document.body) : null);
installLayerEvents(app);
let reviewedDelete = null;
const importWarningsHTML = warnings => warnings.length ? `<div class="measure-review-issues" role="status"><p>Se han aplicado estos ajustes de compatibilidad:</p><ul>${warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul></div>` : '';

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
  } else if (!e.target.closest?.('button') && bindingField) {
    // The label, selected name and free space open the same menu as the chevron.
    openBindingDropdown(bindingField.dataset.bindingField);
  }
  const t = e.target.closest('button,a[data-action]');
  if (!t) return;
  const studioAction = handleStudioClick(t);
  if (studioAction) return Promise.resolve(studioAction).catch(err => toast(err.message || 'No se pudo actualizar la paleta.'));
  if (t.dataset.action === 'home') e.preventDefault();
  if (t.dataset.template) {
    const selected = TEMPLATES.find(x => x.id === t.dataset.template);
    if (selected) requestNavigation(() => loadDesign(selected.config, null, { template: true }));
    return;
  }
  if (t.dataset.theme) { themeSelect(t.dataset.theme); render(); return; }
  if (t.dataset.mode) { rememberInspector(); setMode(t.dataset.mode); persist(); render(); return; }
  if (t.dataset.tab) { rememberInspector(); setTab(t.dataset.tab); renderInspector(); return; }
  if (t.dataset.filter) { setFilter(t.dataset.filter); render(); return; }
  if (t.dataset.load) {
    const s = getSaved().find(x => x.id === t.dataset.load);
    if (s) requestNavigation(() => {
      loadDesign(s.config, s.id);
      if (s.normalizationWarnings?.length) openModal('Diseño abierto con ajustes', 'Revisa los cambios de compatibilidad de este diseño guardado.', importWarningsHTML(s.normalizationWarnings), btn('close-modal', 'Entendido', 'check', 'button primary'));
      else toast('Diseño abierto.');
    });
    return;
  }
  if (t.dataset.surface) { setConfig({ surfaceEffect: t.dataset.surface }); return; }
  if (t.dataset.layout) { directChange(applyLayout(getC(), t.dataset.layout), true, true); return; }
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
    if (!elementVisible(getC(), id)) {
      const issue = restorationIssue(getC(), id);
      if (issue) { toast(issue); return; }
    }
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
    applyBindingFieldValue(dupId + '__' + prop, '');
    document.getElementById('f-bind-' + fieldKey)?.focus();
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
      resetContextViewport();
      setZoom(100);
      render();
    },
    'canvas-color': () => { setCanvasDark(!getCanvasDark()); renderStage(); },
    'toggle-ui-theme': () => { toggleUiTheme(); render(); },
    'toggle-rail': () => { toggleRailCollapsed(); render(); },
    'zoom-in': () => {
      if(getContextPreview())setContextManualZoom();
      const cur = getZoom();
      const next = Math.min(200, Math.floor(cur / 5) * 5 + 5);
      setZoom(next);
      renderStage();
    },
    'zoom-out': () => {
      if(getContextPreview())setContextManualZoom();
      const cur = getZoom();
      const prev = Math.max(getContextPreview()?1:25, Math.ceil(cur / 5) * 5 - 5);
      setZoom(prev);
      renderStage();
    },
    'zoom-fit': () => {
      const stage = $('#stage');
      const c = getC();
      if (getContextPreview()) {
        resetContextViewport();
        setZoom(100);
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
      resetContextViewport();
      setContextResolution(t.dataset.res || '1280x720');
      try { localStorage.setItem('kpi-atelier-context-res', JSON.stringify(getContextResolution())); } catch {}
      setZoom(100);
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
      setConfig((TEMPLATES.find(x => x.id === c.id) || TEMPLATES[0]).config, true);
      toast('Plantilla restaurada.');
    },
    guide,
    validation: validationModal,
    export: exportModal,
    'review-live-measure': () => {
      const review = getPendingWriteReviewAction();
      clearPendingWriteReviewAction();
      return review ? review() : openMeasureReviewModal();
    },
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
      document.getElementById(`f-bind-${fieldKey}`)?.focus();
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
    'confirm-save': async () => {
      const name = $('#design-name')?.value || '';
      const session = captureDesignSession(), revision = getModalRevision();
      t.disabled = true;
      try {
        if (await saveCurrent(name)) {
          if (!isDesignSessionCurrent(session)) return;
          if (getModalRevision() === revision) closeModal();
          render();
          if (!getActiveContext().lastSaveConflict) toast(getActiveContext().lastCollectionSyncWarning || 'Diseño guardado en tu colección.');
        }
      } finally { t.disabled = false; }
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
    'guard-save': async () => {
      const ctx = getActiveContext();
      const go = ctx.pendingNavigation;
      const name = $('#guard-name')?.value || '';
      const session = captureDesignSession(), revision = getModalRevision();
      t.disabled = true;
      try {
        if (await saveCurrent(name) && isDesignSessionCurrent(session) && getModalRevision() === revision && ctx.pendingNavigation === go) {
          closeModal(); go?.();
        }
      } finally { t.disabled = false; }
    },
    'saved-json': () => {
      const s = getSaved().find(item => item.id === t.dataset.id);
      if (s) downloadJSON(s.config, s.name.replace(/[^\p{L}\p{N}_-]/gu, '_'));
    },
    delete: () => {
      const s = getSaved().find(item => item.id === t.dataset.id);
      reviewedDelete = s ? structuredClone(s) : null;
      if (s) openModal('¿Eliminar este diseño?', esc(s.name), '<p>Se eliminará la versión que acabas de revisar. El borrador actual se conservará.</p>', btn('close-modal', 'Cancelar', null, 'button secondary') + btn('confirm-delete', 'Eliminar', 'trash', 'button danger', `data-id="${s.id}"`));
    },
    'confirm-delete': async () => {
      const reviewed = reviewedDelete;
      reviewedDelete = null;
      if (!reviewed || reviewed.id !== t.dataset.id) return;
      try {
        if (!await deleteSaved(t.dataset.id, reviewed)) { closeModal(); render(); return; }
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
    'connect-pbip': chooseModelFolder,
    'disconnect-pbip': () => {
      cancelModelRequest();
      setPbipModel(null);
      refreshCard();
      toast('Modelo desconectado. Las referencias del diseño se han conservado.');
      openDataBindingModal();
    },
    'refresh-live-pbi': async () => {
      const pbipModel = getPbipModel();
      if (!pbipModel?.server) return;
      const request = beginModelRequest();
      try {
        toast('Actualizando modelo desde Power BI Desktop…');
        const catalog = await fetchLivePbiModel(pbipModel.server, pbipModel.databaseId || pbipModel.database || '', { signal: request.signal });
        if (!request.commit(catalog, false)) return;
        toast(`Modelo actualizado (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
        openDataBindingModal();
      } catch (err) {
        if (request.isCurrent()) toast(`Error al actualizar: ${err.message}`);
      } finally { request.finish(); }
    },
    'connect-live-pbi': async () => {
      const request = beginModelRequest();
      const connectBtn = $('#modal')?.querySelector('[data-action="connect-live-pbi"]');
      const origContent = connectBtn ? connectBtn.innerHTML : '';
      if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.innerHTML = `${icon('sparkles', 13)} <span>Buscando informes…</span>`;
      }
      toast('Buscando informes abiertos en Power BI Desktop…');
      try {
        const instances = await discoverLivePbi({ signal: request.signal });
        if (!request.isCurrent()) return;
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
        const catalog = await fetchLivePbiModel(first.server, first.database || '', { signal: request.signal });
        if (!request.commit(catalog, true)) return;
        toast(`⚡ Conectado con éxito a '${catalog.reportName || catalog.modelName}' (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
        openDataBindingModal();
      } catch (err) {
        if (request.isCurrent()) toast(`Error al conectar con Power BI: ${err.message}`);
      } finally {
        request.finish();
        if (connectBtn) {
          connectBtn.disabled = false;
          connectBtn.innerHTML = origContent;
        }
      }
    },
    'select-live-instance': async () => {
      const request = beginModelRequest();
      const srv = t.dataset.server;
      const db = t.dataset.db || '';
      const repName = t.dataset.report || 'Power BI';
      t.disabled = true;
      t.innerHTML = `${icon('sparkles', 13)} Conectando…`;
      toast(`Conectando con '${repName}'…`);
      try {
        const catalog = await fetchLivePbiModel(srv, db, { signal: request.signal });
        if (!request.commit(catalog, true)) return;
        toast(`⚡ Conectado en vivo a '${catalog.reportName || catalog.modelName}' (${catalog.measures.length} medidas, ${catalog.dateTables.length} tablas con fecha).`);
        openDataBindingModal();
      } catch (err) {
        if (!request.isCurrent()) return;
        toast(`Error al conectar: ${err.message}`);
        t.disabled = false;
        t.innerHTML = `${icon('sparkles', 13)} Conectar informe`;
      } finally { request.finish(); }
    },
    'load-roundtrip-measure': () => {
      const mName = t.dataset.measure;
      const pbipModel = getPbipModel();
      if (!mName || !pbipModel?.measures) return;
      const rm = pbipModel.measures.find(m => m.name === mName);
      if (rm?.configAnnotation) {
        try {
          const conf = typeof rm.configAnnotation === 'string' ? JSON.parse(rm.configAnnotation) : rm.configAnnotation;
          const validation = validateImportedJSON(conf);
          if (!validation.valid) throw new Error(validation.errors.slice(0, 3).join('; '));
          setPendingRoundtripConf(validation.config);
          setPendingRoundtripName(rm.name);
          openModal(
            '¿Cargar diseño en el lienzo?',
            `Se sustituirá el diseño actual por la configuración de la tarjeta '${esc(rm.name)}'.`,
            '<p class="field-help">Los cambios no guardados se reemplazarán por esta tarjeta. Puedes recuperar el diseño previo con Deshacer.</p>' + importWarningsHTML([...new Set([...(rm.configWarnings || []), ...validation.warnings])]),
            btn('cancel-roundtrip-load', 'Cancelar', null, 'button secondary') +
            `<button type="button" class="button primary" data-action="confirm-roundtrip-load">${icon('sparkles', 14)} <span>Cargar en lienzo</span></button>`,
            'roundtrip-confirm-modal'
          );
        } catch (err) {
          toast(`No se pudo leer la configuración de '${rm.name}': ${err.message}`);
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
    'inject-live-measure': () => applyLiveMeasure(),
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

  try {
    return Promise.resolve(actions[a]?.()).catch(err => toast(err.message || 'No se pudo completar la acción.'));
  } catch (err) { toast(err.message || 'No se pudo completar la acción.'); }
});

// Eventos de entrada de datos en lienzo y diseñador
app.addEventListener('input', e => {
  const t = e.target;
  if (t.type === 'number') return;
  const applyInput = (next, structural = false) => {
    const normalized = sanitizeConfig(next);
    if (JSON.stringify(normalized) === JSON.stringify(getC())) return;
    const key = [getSelectedElement(), t.id, t.dataset.key, t.dataset.dupid, t.dataset.dupval, t.dataset.elprop, t.dataset.duptext, t.dataset.dupsize].join(':');
    recordEdit(key, t.tagName === 'SELECT' || t.type === 'checkbox');
    directChange(normalized, false, structural);
  };
  if (t.id === 'template-search' || t.id === 'gallery-search') {
    setQuery(t.value);
    const target = $(t.id === 'template-search' ? '#rail-cards' : '#gallery-grid');
    if (target) target.innerHTML = t.id === 'template-search' ? railCards() : galleryCards();
    fitThumbs();
    return;
  }
  if (t.dataset.duptext) {
    const id = t.dataset.dupid || t.dataset.duptext;
    applyInput(updateElement(getC(), id, { text: t.value }));
    return;
  }
  if (t.dataset.dupsize) {
    const id = t.dataset.dupid || t.dataset.dupsize || getSelectedElement();
    if (id) {
      const val = Number(t.value);
      if (t.nextElementSibling?.tagName === 'OUTPUT') t.nextElementSibling.textContent = val + 'px';
      applyInput(updateElement(getC(), id, { size: val }));
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
      applyInput(updateElement(getC(), id, { [prop]: val }), isStructural);
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
    applyInput(next);
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
    applyInput(next, isStructural);
  }
});

// Eventos de entrada de datos en diálogos y buscador de iconos
document.addEventListener('input', e => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  if (handleStudioInput(input)) return;
  if (input.id === 'icon-search') {
    const grid = $('#icon-grid');
    if (grid) grid.innerHTML = iconGrid(input.value);
    return;
  }
  const key = input.id === 'f-bind-granularity' ? 'granularity' : input.dataset?.bindFieldKey || input.dataset?.bindKey || (input.dataset?.bindDup ? input.dataset.bindDup + '__' + (input.dataset.bindDupprop || 'measure') : null);
  if (!key) return;
  applyBindingFieldValue(key, input.value);
  const menu = document.getElementById('dropdown-menu-' + key);
  if (menu && getPbipModel()) {
    closeAllBindingDropdowns();
    openBindingDropdown(key, false, input.value);
  }
});

// Eventos de cambio (confirmación de campos numéricos, select, checkbox)
app.addEventListener('change', e => {
  const t = e.target;
  if (t.type === 'number' && (t.dataset.key || t.dataset.elprop || t.dataset.dupval)) { commitNumber(t); return; }
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

installEditorEvents(app, focusBindingElement);

// Persistent folder input supports browsers without showDirectoryPicker.
document.addEventListener('change', e => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  if (input.id !== 'pbip-folder-input') return;
  const files = Array.from(input.files || []);
  input.value = '';
  importModelFiles(files);
});
window.addEventListener('pagehide', cancelModelScan);

// Importación de archivos JSON
$('#file-import')?.addEventListener('change', async e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > MAX_CONFIG_BYTES) { toast('El JSON es demasiado grande (máximo 512 KB).'); return; }
  try {
    const data = JSON.parse(await f.text());
    if (data.schema !== 'kpi-atelier' || data.version !== 1 || !data.config || typeof data.config !== 'object' || Array.isArray(data.config)) {
      throw Error('Selecciona un JSON de configuración de KPI Atelier v1.');
    }
    const validation = validateImportedJSON(data);
    if (!validation.valid) throw new Error('Configuración inválida: ' + validation.errors.slice(0, 3).join('; '));
    const conf = sanitizeConfig(validation.config);
    requestNavigation(() => {
      loadDesign(conf);
      if (validation.warnings.length) openModal('Configuración importada con ajustes', 'Revisa los cambios realizados al cargar este diseño.', importWarningsHTML(validation.warnings), btn('close-modal', 'Entendido', 'check', 'button primary'));
      else toast('Configuración importada.');
    });
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
initLiveConnection(render);
window.addEventListener('pageshow', event => { if (event.persisted) initLiveConnection(render); });
render();
