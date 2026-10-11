/**
 * KPI Atelier - Submódulo Canvas, Manipulación Directa y Gestos (dist/canvas.mjs)
 * Gestiona el lienzo visual, transformación de escala, guías de alineación,
 * selección múltiple, reordenación de capas, portapapeles y motor de gestos.
 */

import { resizeCard, applyLayout } from './layout.mjs';
import { appearance } from './appearance.mjs';
import { copyElementData, pasteElementData } from './editor-clipboard.mjs';
import { alignmentGuides } from './guides.mjs';
import {
  ELEMENTS, ELEMENT_IDS, SIZE_LIMITS, elementState, elementSize,
  elementAvailable, elementEnabled, elementVisible, updateElement,
  moveElement, resizeElement, restoreElement, clamp, frameFromBounds,
  detachElement, releaseElement, layerOrder, moveLayer, reorderLayer,
  resolveElementDef
} from './elements.mjs';
import { icon, esc, cardHTML } from './cards.mjs';
import { TEMPLATES, BASE, sanitizeConfig } from './model.mjs';
import {
  $, btn, ib, getC, setC, getBaseline, setBaseline, dirty,
  persist, record, restoreHistory, toast, getSelectedElement, setSelectedElement,
  getSelectedElements, getCardSelected, setCardSelected,
  getZoom, setZoom, getCanvasDark, setCanvasDark,
  getContextPreview, setContextPreview, getMoveStep, setMoveStep,
  getLayersOpen, setLayersOpen, getGuidesEnabled, setGuidesEnabled,
  getFormatPainterSource, setFormatPainterSource, getGesture, setGesture,
  getDeleteConfirmLayer, setDeleteConfirmLayer, getClipboardElement,
  setClipboardElement, getClipboardElements, setClipboardElements,
  getContextResolution, getActiveContext, getUndo, getRedo
} from './state.mjs';

// Llamadas dinámicas para resolver referencias circulares y entornos de prueba
function callInspector() {
  const ctx = getActiveContext();
  if (typeof ctx.renderInspector === 'function') ctx.renderInspector();
}
function callStatus() {
  const ctx = getActiveContext();
  if (typeof ctx.renderStatus === 'function') ctx.renderStatus();
}
function callHistory() {
  const ctx = getActiveContext();
  if (typeof ctx.updateHistoryButtons === 'function') ctx.updateHistoryButtons();
}
function callSyncElement() {
  const ctx = getActiveContext();
  if (typeof ctx.syncElementControls === 'function') ctx.syncElementControls();
}
function callSyncCard() {
  const ctx = getActiveContext();
  if (typeof ctx.syncCardControls === 'function') ctx.syncCardControls();
}
function callRememberInspector() {
  const ctx = getActiveContext();
  if (typeof ctx.rememberInspector === 'function') ctx.rememberInspector();
}

let guidePreviewUntil = 0;
let guideTimer = null;
let draggedLayer = null;

// Motor de Patching DOM Directo (GPU-accelerated transformations)
export function patchCardElementTransform(id, x, y) {
  const app = $('#app');
  const node = app?.querySelector(`[data-element="${id}"]`);
  if (node) {
    node.style.transform = `translate(${x}px, ${y}px)`;
  }
}

export function patchCardDimensions(w, h) {
  const inner = $('#main-card');
  const fit = $('#card-fit');
  const zoom = getZoom();
  const factor = zoom / 100;
  if (inner) inner.style.width = `${w}px`;
  if (fit) {
    fit.style.width = `${w * factor}px`;
    fit.style.height = `${h * factor}px`;
  }
}

export function renderStage() {
  const stage = $('#stage');
  if (!stage) return;
  const c = getC();
  const canvasDark = getCanvasDark();
  const context = getContextPreview();
  const contextResolution = getContextResolution();
  const zoom = getZoom();

  stage.className = 'stage' + (c.surfaceEffect === 'glass' ? ' glass-stage' : '') + (canvasDark ? ' dark-stage' : '') + (context ? ' context-stage' : '');
  stage.style.setProperty('--glass-accent', c.accent + '38');

  if (context) {
    const [resW, resH] = contextResolution === '1920x1080' ? [1920, 1080] : [1280, 720];
    stage.innerHTML = `
      <div class="context-fit" id="context-fit">
      <div class="context-report-canvas" id="context-viewport" style="width:${resW}px;height:${resH}px">
        <div class="context-report-topbar">
          <div class="context-topbar-left">
            <span class="context-report-title">Executive Overview · Performance Dashboard</span>
            <span class="context-canvas-badge">${icon('grid', 12)} Lienzo Power BI: ${resW} × ${resH} px (16:9)</span>
          </div>
          <div class="context-topbar-slicers">
            <span class="context-slicer">Año: <strong>2026</strong></span>
            <span class="context-slicer">Período: <strong>Acumulado</strong></span>
            <span class="context-slicer">Canal: <strong>Todos</strong></span>
          </div>
        </div>
        <div class="context-report-grid">
          <div class="context-cards-row">
            <div class="context-card-slot active-card-slot" style="width:${c.width}px;height:${c.height}px">
              <span class="context-card-badge">Tu tarjeta · ${c.width} × ${c.height} px</span>
              ${cardHTML(c, undefined, true)}
            </div>
            <div class="context-mock-kpi" style="height:${c.height}px">
              <span class="mock-kpi-label">MARGEN OPERATIVO</span>
              <span class="mock-kpi-val">34,8 %</span>
              <span class="mock-kpi-delta positive">↑ +2.4 pp vs. objetivo</span>
              <div class="mock-kpi-bar"><div style="width:78%"></div></div>
            </div>
            <div class="context-mock-kpi" style="height:${c.height}px">
              <span class="mock-kpi-label">CLIENTES ACTIVOS</span>
              <span class="mock-kpi-val">18.420</span>
              <span class="mock-kpi-delta positive">↑ +12 % vs. mes ant.</span>
              <div class="mock-kpi-spark"></div>
            </div>
          </div>
          <div class="context-report-lower">
            <div class="context-mock-visual chart-visual">
              <div class="mock-visual-head">
                <strong>Evolución mensual del negocio</strong>
                <small>Vista agregada anual</small>
              </div>
              <svg viewBox="0 0 740 120" preserveAspectRatio="none" class="mock-chart-svg">
                <path d="M0 100L60 92L120 102L180 75L240 82L300 60L360 68L420 42L480 50L540 28L600 34L680 12L740 8" fill="none" stroke="${c.accent}" stroke-width="2.5"/>
                <path d="M0 100L60 92L120 102L180 75L240 82L300 60L360 68L420 42L480 50L540 28L600 34L680 12L740 8L740 120L0 120Z" fill="${c.accent}" opacity="0.12"/>
              </svg>
              <div class="context-chart-axis"><span>ENE</span><span>FEB</span><span>MAR</span><span>ABR</span><span>MAY</span><span>JUN</span><span>JUL</span><span>AGO</span><span>SEP</span><span>OCT</span><span>NOV</span><span>DIC</span></div>
            </div>
            <div class="context-mock-visual table-visual">
              <div class="mock-visual-head">
                <strong>Top categorías</strong>
                <small>Rendimiento por unidad</small>
              </div>
              <div class="mock-table-grid">
                <div class="mock-tr head"><span>Categoría</span><span>Importe</span><span>% Total</span></div>
                <div class="mock-tr"><span>Bicicletas</span><strong>842.150 €</strong><span>54 %</span></div>
                <div class="mock-tr"><span>Componentes</span><strong>412.300 €</strong><span>26 %</span></div>
                <div class="mock-tr"><span>Accesorios</span><strong>215.420 €</strong><span>14 %</span></div>
                <div class="mock-tr"><span>Ropa & Otros</span><strong>93.680 €</strong><span>6 %</span></div>
              </div>
            </div>
          </div>
        </div>
      </div></div>`;
  } else {
    const existingFit = stage.querySelector('#card-fit');
    const existingMain = stage.querySelector('#main-card');
    if (existingFit && existingMain) {
      existingMain.style.width = c.width + 'px';
      existingMain.innerHTML = cardHTML(c, undefined, true);
      const previewLabel = stage.querySelector('.preview-label span:first-child');
      if (previewLabel) previewLabel.textContent = TEMPLATES.find(t => t.id === c.id)?.name || 'Tu diseño';
    } else {
      stage.innerHTML = `<span class="canvas-corner top-left"></span><span class="canvas-corner bottom-right"></span><div class="preview-label"><span>${TEMPLATES.find(t => t.id === c.id)?.name || 'Tu diseño'}</span><span>LIVE PREVIEW <i></i></span></div><div class="card-fit" id="card-fit"><div class="main-card" id="main-card" style="width:${c.width}px">${cardHTML(c, undefined, true)}</div><div id="smart-guides" aria-hidden="true"></div><div id="selection-overlay" hidden></div></div><div class="preview-caption">${icon('cursor', 12)} Selecciona · arrastra · ajusta con las flechas</div>`;
    }
  }

  if (context) {
    const [resW, resH] = contextResolution === '1920x1080' ? [1920, 1080] : [1280, 720];
    const dim = $('#dimensions');
    if (dim) dim.innerHTML = `${icon('grid', 13)} Lienzo Power BI: ${resW} × ${resH} px · Tarjeta: ${c.width} × ${c.height} px`;
  } else {
    const dim = $('#dimensions');
    if (dim) dim.innerHTML = `${icon('square', 13)} ${c.width} × ${c.height} px`;
  }

  const zoomText = $('#zoom-text');
  if (zoomText) zoomText.textContent = zoom + '%';

  fitThumbs();
  fitMain();
  callStatus();
  renderCanvasBar();
}

export function fitThumbs() {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      document.querySelectorAll('.mini-viewport').forEach(v => {
        const inner = v.firstElementChild;
        if (!inner) return;
        const baseWidth = Number(v.dataset.baseWidth || 340);
        const baseHeight = Number(v.dataset.baseHeight || 140);
        const w = v.clientWidth || v.getBoundingClientRect().width || baseWidth;
        const factor = baseWidth > 0 ? (w / baseWidth) : 1;
        inner.style.transform = `scale(${factor})`;
        const cardEl = inner.firstElementChild;
        const h = (cardEl?.offsetHeight || baseHeight) * factor;
        if (h > 0) {
          v.style.height = `${h}px`;
        }
      });
    });
  }
}

export function fitMain() {
  const context = getContextPreview();
  const zoom = getZoom();
  const gesture = getGesture();
  let c = getC();

  if (context) {
    const stage = $('#stage');
    const fit = $('#context-fit');
    const v = $('#context-viewport');
    if (!stage || !v || !fit) return;
    const contextResolution = getContextResolution();
    const [resW, resH] = contextResolution === '1920x1080' ? [1920, 1080] : [1280, 720];
    const factor = zoom / 100;
    fit.style.width = (resW * factor) + 'px';
    fit.style.height = (resH * factor) + 'px';
    v.style.transformOrigin = 'top left';
    v.style.transform = `scale(${factor})`;
    return;
  }

  const v = $('#card-fit');
  const inner = $('#main-card');
  if (!v || !inner) return;

  inner.style.transform = '';
  const factor = gesture?.scale || (zoom / 100);
  inner.style.transform = `scale(${factor})`;

  // Freeze legacy flow at its current measured positions before editing.
  if (c.geometryVersion !== 2) {
    const wasClean = !dirty();
    const actualHeight = inner.firstElementChild?.offsetHeight || c.height;
    let migrated = c;
    for (const id of ELEMENT_IDS) {
      if (!elementState(c, id).frame) {
        migrated = detachElement(migrated, id, measureElementFrame(id));
      }
    }
    c = sanitizeConfig({ ...migrated, geometryVersion: 2, height: actualHeight });
    setC(c);
    if (wasClean) setBaseline(structuredClone(c));
    persist();
    inner.innerHTML = cardHTML(c, undefined, true);
    callInspector();
  }

  inner.style.width = c.width + 'px';
  v.style.width = (c.width * factor) + 'px';
  v.style.height = ((inner.firstElementChild?.offsetHeight || c.height) * factor) + 'px';

  if (gesture?.card) {
    v.style.transform = '';
    const bounds = v.getBoundingClientRect();
    v.style.transform = `translate(${gesture.anchor.left - bounds.left}px,${gesture.anchor.top - bounds.top}px)`;
  } else {
    v.style.transform = '';
  }

  positionSelection();
  renderGuides();
  reportOverflow();
}

export function measureElementFrame(id) {
  const app = $('#app');
  const node = app?.querySelector(`[data-element="${id}"]`);
  const surface = $('#main-card')?.firstElementChild;
  if (!node || !surface) return null;
  const c = getC();
  const bounds = surface.getBoundingClientRect();
  return frameFromBounds(c, id, node.getBoundingClientRect(), bounds, bounds.width / c.width);
}

export function renderCanvasBar() {
  const bar = $('#canvas-edit-bar');
  if (!bar) return;
  const context = getContextPreview();
  const contextResolution = getContextResolution();
  const selectedElements = getSelectedElements();
  const selectedElement = getSelectedElement();
  const cardSelected = getCardSelected();
  const formatPainterSource = getFormatPainterSource();
  const moveStep = getMoveStep();
  const guidesEnabled = getGuidesEnabled();
  const layersOpen = getLayersOpen();
  const c = getC();

  if (context) {
    bar.innerHTML = `<div class="canvas-object-label">${icon('grid', 13)}<span>Lienzo del informe</span></div><div class="canvas-context-center"><div class="segmented small context-res-selector" aria-label="Resolución del informe"><button data-action="context-res" data-res="1280x720" class="${contextResolution === '1280x720' ? 'active' : ''}" title="Lienzo Estándar 1280 × 720 px">1280 × 720</button><button data-action="context-res" data-res="1920x1080" class="${contextResolution === '1920x1080' ? 'active' : ''}" title="Lienzo Full HD 1920 × 1080 px">1920 × 1080</button></div></div>`;
    return;
  }

  const layerScroll = bar.querySelector('.layers-popover')?.scrollTop || 0;
  const isMulti = selectedElements.size > 1;
  const def = selectedElement ? (resolveElementDef(selectedElement) || ELEMENTS[selectedElement]) : null;
  const labelText = isMulti ? `Selección múltiple (${selectedElements.size})` : def ? def.label : cardSelected ? 'Tarjeta seleccionada' : 'Selecciona un elemento';
  const formatPainterBtn = selectedElement && !isMulti ? `<button class="icon-btn format-painter-btn ${formatPainterSource ? 'active' : ''}" data-action="format-painter" title="${formatPainterSource ? 'Copiar formato activo · Haz clic en otro elemento para aplicar (Esc para cancelar)' : `Copiar formato de ${def?.label || selectedElement}`}" aria-pressed="${Boolean(formatPainterSource)}">${icon('brush', 13)}</button>` : '';
  const elementActions = selectedElement ? `${ib('smaller-element', 'Reducir tamaño', 'minus')}${ib('bigger-element', 'Aumentar tamaño', 'plus')}${ib('hide-element', elementState(c, selectedElement).hidden ? 'Mostrar elemento' : 'Ocultar elemento', 'eyeOff')}${ib('delete-element', 'Eliminar elemento', 'trash')}${formatPainterBtn}` : '';

  bar.innerHTML = `<div class="canvas-object-label">${icon(selectedElement ? 'cursor' : 'move', 13)}<span>${labelText}</span></div><div class="canvas-object-actions"><button class="card-select-btn ${cardSelected ? 'active' : ''}" data-action="select-card" aria-pressed="${cardSelected}" title="Seleccionar tarjeta y ajustar bordes / tamaño">${icon('card', 14)}<span>Tarjeta</span></button>${elementActions}<div class="pixel-step" aria-label="Paso de movimiento"><button data-move-step="1" class="${moveStep === 1 ? 'active' : ''}" aria-pressed="${moveStep === 1}" title="Mover de 1 en 1 píxel con las flechas">1 px</button><button data-move-step="5" class="${moveStep === 5 ? 'active' : ''}" aria-pressed="${moveStep === 5}" title="Mover de 5 en 5 píxeles con las flechas">5 px</button></div>${ib('guides', guidesEnabled ? 'Ocultar guías de alineación (regla)' : 'Mostrar guías de alineación (regla)', 'ruler', `aria-pressed="${guidesEnabled}" title="${guidesEnabled ? 'Ocultar guías de alineación (regla)' : 'Mostrar guías de alineación (regla)'}"`)}<button class="layers-button ${layersOpen ? 'active' : ''}" data-action="layers" aria-expanded="${layersOpen}" title="Ver y reordenar capas">${icon('layers', 14)}<span>Capas</span></button></div>${layersOpen ? layersPanel() : ''}`;

  const popup = bar.querySelector('.layers-popover');
  if (popup) popup.scrollTop = layerScroll;
}

export function layersPanel() {
  const c = getC();
  const selectedElements = getSelectedElements();
  const deleteConfirmLayer = getDeleteConfirmLayer();
  const ids = layerOrder(c).filter(id => elementAvailable(c, id) && !elementState(c, id).deleted);

  return `<div class="layers-popover" role="region" aria-label="Capas de la tarjeta"><div class="layers-heading"><strong>Elementos de la tarjeta</strong>${ib('layers', 'Cerrar capas', 'close')}</div><p class="layers-hint">Arriba = delante <span>Arrastra o usa ↑ ↓</span></p>${ids.map((id, index) => {
    const state = elementState(c, id);
    const visible = elementVisible(c, id);
    const def = resolveElementDef(id) || ELEMENTS[id];
    const label = def?.label || id;
    const isConfirming = deleteConfirmLayer === id;
    const isSelected = selectedElements.has(id);
    const deleteBtn = `<button class="layer-delete ${isConfirming ? 'confirming' : ''}" data-layer-delete="${id}" title="${isConfirming ? 'Clic para confirmar eliminación' : 'Eliminar capa'}" aria-label="Eliminar ${label}">${isConfirming ? '¿Borrar?' : icon('trash', 13)}</button>`;
    return `<div class="layer-row ${isSelected ? 'active' : ''}" data-layer-row="${id}"><button class="layer-drag" draggable="true" data-layer-drag="${id}" aria-label="Arrastrar capa ${label}" title="Arrastrar · Alt + ↑/↓ para ordenar">${icon('grip', 13)}</button><button class="layer-select" data-select-element="${id}" aria-pressed="${isSelected}">${icon(def?.kind === 'text' ? 'text' : id === 'icon' || def?.kind === 'icon' ? (state.icon || c.icon) : id === 'trend' || def?.kind === 'chart' ? 'trend' : 'signal', 14)}<span>${label}<small>${visible ? 'Visible' : 'Oculto'}${state.frame ? ' · Posición libre' : ''}</small></span></button><div class="layer-controls"><button class="layer-order-button" data-layer-id="${id}" data-layer-move="-1" ${index === 0 ? 'disabled' : ''} title="Subir: traer delante" aria-label="Subir capa ${label}">${icon('arrowUp', 13)}</button><button class="layer-order-button" data-layer-id="${id}" data-layer-move="1" ${index === ids.length - 1 ? 'disabled' : ''} title="Bajar: enviar detrás" aria-label="Bajar capa ${label}">${icon('arrowDown', 13)}</button><button class="layer-visibility" data-layer-visibility="${id}" title="${visible ? 'Ocultar' : 'Mostrar'}" aria-label="${visible ? 'Ocultar' : 'Mostrar'} ${label}">${icon(visible ? 'eye' : 'eyeOff', 15)}</button>${deleteBtn}</div></div>`;
  }).join('')}<p class="layers-footnote">El orden cambia la superposición, conserva las posiciones.</p></div>`;
}

export function commitLayerOrder(next, id, direction = null) {
  const c = getC();
  if (next === c) return;
  directChange(next);
  const app = $('#app');
  const row = app?.querySelector(`[data-layer-row="${id}"]`);
  const button = direction ? row?.querySelector(`[data-layer-move="${direction}"]:not(:disabled)`) : null;
  (button || row?.querySelector('.layer-drag'))?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest' });
  const newC = getC();
  toast(`${ELEMENTS[id]?.label || id}: capa ${layerOrder(newC).filter(key => elementAvailable(newC, key)).indexOf(id) + 1}, de delante hacia atrás.`);
}

export function clearLayerDrop() {
  const app = $('#app');
  app?.querySelectorAll('.drop-before,.drop-after,.layer-dragging').forEach(node => node.classList.remove('drop-before', 'drop-after', 'layer-dragging'));
}

export function positionSelection() {
  const overlay = $('#selection-overlay');
  const fit = $('#card-fit');
  const app = $('#app');
  if (!overlay || !fit) return;
  const c = getC();
  const selectedElements = getSelectedElements();
  const selectedElement = getSelectedElement();
  const cardSelected = getCardSelected();
  const focusedHandle = document.activeElement?.dataset?.cardResize;

  app?.querySelectorAll('[data-element]').forEach(e => {
    const isSel = selectedElements.has(e.dataset.element);
    e.classList.toggle('is-selected', isSel);
    e.classList.toggle('is-multi-selected', isSel && selectedElements.size > 1);
    e.setAttribute('aria-pressed', isSel ? 'true' : 'false');
  });

  if (selectedElements.size > 1) {
    const nodes = [...selectedElements].map(id => app?.querySelector(`[data-element="${id}"]`)).filter(Boolean);
    if (!nodes.length) { overlay.hidden = true; return; }
    const rects = nodes.map(n => n.getBoundingClientRect());
    const minL = Math.min(...rects.map(r => r.left)), minT = Math.min(...rects.map(r => r.top));
    const maxR = Math.max(...rects.map(r => r.right)), maxB = Math.max(...rects.map(r => r.bottom));
    const parent = fit.getBoundingClientRect();
    overlay.hidden = false;
    overlay.style.cssText = `left:${minL - parent.left}px;top:${minT - parent.top}px;width:${maxR - minL}px;height:${maxB - minT}px;`;
    overlay.innerHTML = `<span class="selection-name group-selection-badge">${selectedElements.size} elementos seleccionados</span>`;
    return;
  }

  const el = cardSelected ? $('#main-card')?.firstElementChild : selectedElement ? app?.querySelector(`[data-element="${selectedElement}"]`) : null;
  if (!el || (!cardSelected && !elementVisible(c, selectedElement))) {
    overlay.hidden = true;
    return;
  }

  const box = el.getBoundingClientRect();
  const parent = fit.getBoundingClientRect();
  overlay.hidden = false;
  overlay.style.cssText = `left:${box.left - parent.left}px;top:${box.top - parent.top}px;width:${box.width}px;height:${box.height}px;`;

  if (cardSelected) {
    overlay.innerHTML = `<span class="selection-name">Tarjeta · ${c.width} × ${c.height} px</span>${['e', 's', 'se'].map(dir => `<button data-card-resize="${dir}" class="resize-handle handle-${dir}" aria-label="Cambiar ${dir === 'e' ? 'ancho' : dir === 's' ? 'alto' : 'tamaño'} de tarjeta" title="Arrastra · mínimo 200 px"></button>`).join('')}`;
    if (focusedHandle) overlay.querySelector(`[data-card-resize="${focusedHandle}"]`)?.focus({ preventScroll: true });
    return;
  }

  overlay.innerHTML = `<span class="selection-name">${(resolveElementDef(selectedElement)?.label || ELEMENTS[selectedElement]?.label || selectedElement)}</span><button data-resize="nw" aria-label="Cambiar tamaño del elemento (superior izquierda)" class="resize-handle handle-nw" title="Arrastra para cambiar el tamaño"></button><button data-resize="se" aria-label="Cambiar tamaño del elemento (inferior derecha)" class="resize-handle handle-se" title="Arrastra para cambiar el tamaño"></button>`;
}

export function refreshCard() {
  const c = getC();
  const inner = $('#main-card');
  if (inner) {
    inner.innerHTML = cardHTML(c, undefined, true);
    fitMain();
  } else {
    renderStage();
  }
  callStatus();
}

export function flashGuides() {
  guidePreviewUntil = Date.now() + 850;
  clearTimeout(guideTimer);
  guideTimer = setTimeout(() => {
    guidePreviewUntil = 0;
    renderGuides();
  }, 900);
}

export function renderGuides() {
  const overlay = $('#smart-guides');
  const fit = $('#card-fit');
  const main = $('#main-card');
  const app = $('#app');
  if (!overlay || !fit || !main) return;
  const c = getC();
  const selectedElement = getSelectedElement();
  const guidesEnabled = getGuidesEnabled();
  const gesture = getGesture();
  const selected = selectedElement ? app?.querySelector(`[data-element="${selectedElement}"]`) : null;

  if (!guidesEnabled || !selected || !elementVisible(c, selectedElement)) {
    overlay.innerHTML = '';
    $('#stage')?.classList.remove('guides-active');
    return;
  }

  const parent = fit.getBoundingClientRect();
  const surface = (main.firstElementChild || main).getBoundingClientRect();
  const scale = surface.width / c.width;
  if (!scale) return;

  const rect = node => {
    const r = node.getBoundingClientRect();
    const id = node.dataset.element;
    const def = resolveElementDef(id) || ELEMENTS[id];
    return {
      id,
      label: def?.label || id,
      left: (r.left - surface.left) / scale,
      top: (r.top - surface.top) / scale,
      width: r.width / scale,
      height: r.height / scale
    };
  };

  const box = rect(selected);
  const card = { width: surface.width / scale, height: surface.height / scale };
  const peers = [...main.querySelectorAll('[data-element]')].filter(node => node !== selected && elementVisible(c, node.dataset.element)).map(rect);
  const result = alignmentGuides(box, card, peers, c.padding + c.borderWidth, 3 / scale);
  const active = !!gesture || Date.now() < guidePreviewUntil;

  if (!active && !result.outside) {
    overlay.innerHTML = '';
    $('#stage')?.classList.remove('guides-active');
    return;
  }

  const left = surface.left - parent.left;
  const top = surface.top - parent.top;
  const w = surface.width;
  const h = surface.height;
  const inset = (c.padding + c.borderWidth) * scale;

  const boundaryClasses = ['guide-boundary'];
  if (result.outside) boundaryClasses.push('outside');
  if (result.edgeSnaps?.left) boundaryClasses.push('snap-left');
  if (result.edgeSnaps?.right) boundaryClasses.push('snap-right');
  if (result.edgeSnaps?.top) boundaryClasses.push('snap-top');
  if (result.edgeSnaps?.bottom) boundaryClasses.push('snap-bottom');

  let html = `<div class="${boundaryClasses.join(' ')}" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;border-radius:${c.radius * scale}px"></div>`;
  if (active) {
    const safeClasses = ['guide-safe-area'];
    if (result.marginSnaps?.left) safeClasses.push('snap-left');
    if (result.marginSnaps?.right) safeClasses.push('snap-right');
    if (result.marginSnaps?.top) safeClasses.push('snap-top');
    if (result.marginSnaps?.bottom) safeClasses.push('snap-bottom');
    if (result.marginBreach?.left) safeClasses.push('breach-left');
    if (result.marginBreach?.right) safeClasses.push('breach-right');
    if (result.marginBreach?.top) safeClasses.push('breach-top');
    if (result.marginBreach?.bottom) safeClasses.push('breach-bottom');

    html += `<div class="${safeClasses.join(' ')}" style="left:${left + inset}px;top:${top + inset}px;width:${Math.max(0, w - 2 * inset)}px;height:${Math.max(0, h - 2 * inset)}px"></div>`;
    const snapX = result.edgeSnaps?.left || result.edgeSnaps?.right || result.marginSnaps?.left || result.marginSnaps?.right;
    const snapY = result.edgeSnaps?.top || result.edgeSnaps?.bottom || result.marginSnaps?.top || result.marginSnaps?.bottom;
    const candidateX = result.lines.filter(l => l.axis === 'x' && (!snapX || l.kind === 'peer' || l.kind === 'center'));
    const candidateY = result.lines.filter(l => l.axis === 'y' && (!snapY || l.kind === 'peer' || l.kind === 'center'));
    const bestX = candidateX.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0))[0];
    const bestY = candidateY.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0))[0];
    const minimalLines = [bestX, bestY].filter(Boolean);

    const stage = $('#stage');
    const stageRect = stage ? stage.getBoundingClientRect() : null;
    stage?.classList.toggle('guides-active', true);
    html += minimalLines.map(line => {
      let flipClass = '';
      if (line.exact) {
        if (line.axis === 'y') {
          const spaceRight = stageRect ? (stageRect.right - surface.right) : 200;
          const spaceLeft = stageRect ? (surface.left - stageRect.left) : 200;
          if (spaceRight < 140) { flipClass = spaceLeft >= 140 ? 'flip-left' : 'flip-inside'; }
        } else {
          const spaceTop = stageRect ? (surface.top - stageRect.top) : 100;
          if (spaceTop < 24) flipClass = 'flip-inside';
        }
      }
      return `<span class="smart-guide ${line.axis === 'x' ? 'vertical' : 'horizontal'} ${line.kind} ${line.exact ? 'exact' : ''} ${flipClass}" style="left:${left + (line.axis === 'x' ? line.position * scale : -8)}px;top:${top + (line.axis === 'y' ? line.position * scale : -8)}px;${line.axis === 'x' ? 'height:' + (h + 16) : 'width:' + (w + 16)}px">${line.exact ? `<b>${line.label}</b>` : ''}</span>`;
    }).join('');

    const collidingPeers = new Map();
    if (result.overlaps && result.overlaps.length) {
      for (const ov of result.overlaps) {
        if (ov.peer && !collidingPeers.has(ov.peer.id)) collidingPeers.set(ov.peer.id, ov.peer);
        html += `<div class="guide-overlap-zone" style="left:${left + ov.rect.left * scale}px;top:${top + ov.rect.top * scale}px;width:${ov.rect.width * scale}px;height:${ov.rect.height * scale}px"></div>`;
      }
    }
    for (const peer of collidingPeers.values()) {
      html += `<div class="guide-peer-box collision" style="left:${left + peer.left * scale}px;top:${top + peer.top * scale}px;width:${peer.width * scale}px;height:${peer.height * scale}px" title="Colisión con ${peer.label}"></div>`;
    }
    const alignedPeers = new Map();
    for (const line of minimalLines) {
      if (line.kind === 'peer' && line.peer && !collidingPeers.has(line.peer.id) && !alignedPeers.has(line.peer.id)) {
        alignedPeers.set(line.peer.id, line.peer);
      }
    }
    for (const peer of alignedPeers.values()) {
      html += `<div class="guide-peer-box align" style="left:${left + peer.left * scale}px;top:${top + peer.top * scale}px;width:${peer.width * scale}px;height:${peer.height * scale}px" title="Alineado con ${peer.label}"></div>`;
    }
  }

  const sides = { left: 'izquierda', right: 'derecha', top: 'arriba', bottom: 'abajo' };
  const outside = Object.entries(result.overflow).filter(([, v]) => v).map(([side, n]) => `${n} px ${sides[side]}`).join(' · ');
  const breaches = result.marginBreach ? Object.entries(result.marginBreach).filter(([k, v]) => k !== 'active' && v > 0).map(([side, n]) => `${n} px ${sides[side]}`).join(' · ') : '';
  const snapSides = result.marginSnaps ? Object.entries(result.marginSnaps).filter(([k, v]) => k !== 'exact' && v).map(([side]) => sides[side]).join(', ') : '';
  const edgeSnapSides = result.edgeSnaps ? Object.entries(result.edgeSnaps).filter(([k, v]) => k !== 'exact' && v).map(([side]) => sides[side]).join(', ') : '';

  let readoutText = '', readoutClass = '';
  if (result.outside) {
    readoutText = '⛔ Fuera del borde: ' + outside; readoutClass = 'outside';
  } else if (active && result.overlaps && result.overlaps.length) {
    const peerNames = result.overlaps.map(o => o.peer.label).filter(Boolean);
    readoutText = '⚠️ Solapamiento con ' + (peerNames.join(', ') || 'otro elemento'); readoutClass = 'overlap';
  } else if (edgeSnapSides) {
    readoutText = `🎯 Borde exacto: ${edgeSnapSides} (0 px)`; readoutClass = 'snap';
  } else if (snapSides) {
    readoutText = `🎯 Margen exacto: ${snapSides} (0 px)`; readoutClass = 'snap';
  } else if (breaches) {
    readoutText = `⚠️ En margen: ${breaches}`; readoutClass = 'breach';
  } else {
    readoutText = `${Math.round(box.width)} × ${Math.round(box.height)} px · Guías de alineación`;
  }

  const stage = $('#stage');
  const stageRect = stage ? stage.getBoundingClientRect() : null;
  let roTop = top + h + 12;
  if (stageRect) {
    const spaceBottom = stageRect.bottom - surface.bottom;
    const spaceTop = surface.top - stageRect.top;
    if (spaceBottom < 36) {
      roTop = spaceTop >= 36 ? (top - 32) : Math.max(8, top + h - 28);
    }
  }
  const roLeft = left;
  html += `<span class="guide-readout ${readoutClass}" style="left:${roLeft}px;top:${roTop}px">${readoutText}</span>`;
  overlay.innerHTML = html;
}

export function selectElement(id, focus = true, toggle = false) {
  if (!ELEMENTS[id]) return;
  setCardSelected(false);
  callRememberInspector();
  const selectedElements = getSelectedElements();

  if (toggle) {
    if (selectedElements.has(id)) {
      selectedElements.delete(id);
      if (selectedElements.size === 0) { deselect(); return; }
      setSelectedElement([...selectedElements][selectedElements.size - 1]);
    } else {
      selectedElements.add(id);
      setSelectedElement(id);
    }
  } else {
    selectedElements.clear();
    selectedElements.add(id);
    setSelectedElement(id);
  }

  const ctx = getActiveContext();
  ctx.tab = 'element';
  ctx.inspectorSections?.set('element:Apariencia', true);
  ctx.inspectorPositions?.set('element', 0);

  callInspector();
  renderCanvasBar();
  positionSelection();
  renderGuides();

  if (focus) {
    $('#app')?.querySelector(`[data-element="${id}"]`)?.focus({ preventScroll: true });
  }
}

export function renderCanvasBarWrapper() { renderCanvasBar(); }

export function selectCard() {
  if (getContextPreview()) return;
  callRememberInspector();
  setSelectedElement(null);
  getSelectedElements().clear();
  setCardSelected(true);
  const ctx = getActiveContext();
  ctx.tab = 'card';
  ctx.inspectorPositions?.set('card', 0);

  callInspector();
  renderCanvasBar();
  positionSelection();
  renderGuides();

  const node = $('#main-card');
  node?.setAttribute('tabindex', '0');
  node?.setAttribute('aria-label', 'Tarjeta. Usa las asas para cambiar ancho y alto.');
  node?.focus({ preventScroll: true });
}

export function deselect() {
  callRememberInspector();
  setCardSelected(false);
  setSelectedElement(null);
  getSelectedElements().clear();
  setFormatPainterSource(null);
  setDeleteConfirmLayer(null);

  const ctx = getActiveContext();
  if (['element', 'card'].includes(ctx.tab)) ctx.tab = 'content';

  callInspector();
  renderCanvasBar();
  positionSelection();
  renderGuides();
}

export function directChange(next, saveHistory = true, structural = false) {
  const safe = sanitizeConfig(next);
  if (JSON.stringify(safe) === JSON.stringify(getC())) return;
  if (saveHistory) record();
  setC(safe);
  persist();
  refreshCard();
  if (structural) {
    callInspector();
  } else {
    callSyncElement();
    callSyncCard();
  }
  renderCanvasBar();
  callHistory();
}

export function elementAction(action) {
  const selectedElement = getSelectedElement();
  const selectedElements = getSelectedElements();
  if (!selectedElement && !selectedElements.size) return;
  const c = getC();
  let next = c;
  let isStructural = false;

  if (action === 'hide-element') {
    isStructural = true;
    if (selectedElements.size > 1) {
      for (const selId of selectedElements) {
        const p = elementState(next, selId);
        next = p.hidden || p.deleted || !elementEnabled(next, selId) ? restoreElement(next, selId) : updateElement(next, selId, { hidden: true });
      }
      directChange(next, true, true);
      return;
    }
    const p = elementState(c, selectedElement);
    next = p.hidden || p.deleted || !elementEnabled(c, selectedElement) ? restoreElement(c, selectedElement) : updateElement(c, selectedElement, { hidden: true });
  }

  if (action === 'delete-element') {
    isStructural = true;
    if (selectedElements.size > 1) {
      const count = selectedElements.size;
      for (const selId of selectedElements) {
        next = updateElement(next, selId, { deleted: true, hidden: false });
      }
      toast(`${count} elementos eliminados. Recupéralos con Deshacer (Ctrl+Z).`);
      selectedElements.clear();
      setSelectedElement(null);
      directChange(next, true, true);
      return;
    }
    next = updateElement(c, selectedElement, { deleted: true, hidden: false });
    toast('Elemento eliminado. Recupéralo con Deshacer (Ctrl+Z).');
  }

  if (action === 'restore-element') { next = restoreElement(c, selectedElement); isStructural = true; }
  if (action === 'release-element') { next = releaseElement(c, selectedElement); isStructural = true; }
  if (action === 'smaller-element' || action === 'bigger-element') { next = resizeElement(c, selectedElement, action === 'bigger-element' ? 1 : -1); isStructural = false; }
  if (action === 'reset-element') {
    isStructural = true;
    const template = TEMPLATES.find(t => t.id === c.id)?.config || BASE;
    next = restoreElement({ ...c, elements: { ...c.elements, [selectedElement]: { ...template.elements?.[selectedElement], x: 0, y: 0, width: 0 } } }, selectedElement);
    next[ELEMENTS[selectedElement].sizeKey] = elementSize(template, selectedElement);
  }

  directChange(next, true, isStructural);
  if (selectedElement) {
    $('#app')?.querySelector(`[data-element="${selectedElement}"]`)?.focus({ preventScroll: true });
  }
}

export function reportOverflow() {
  const root = $('#main-card')?.firstElementChild;
  const node = $('#dimensions');
  if (!root || !node) return;
  const c = getC();
  const box = root.getBoundingClientRect();
  const outside = [...root.querySelectorAll('[data-element]')].filter(el => {
    if (!elementVisible(c, el.dataset.element)) return false;
    const b = el.getBoundingClientRect();
    return b.left < box.left - 1 || b.top < box.top - 1 || b.right > box.right + 1 || b.bottom > box.bottom + 1;
  });
  node.innerHTML = `${icon('square', 13)} ${c.width} × ${c.height} px${outside.length ? ` <button class="overflow-hint" data-action="layers" title="${outside.map(el => ELEMENTS[el.dataset.element]?.label || el.dataset.element).join(', ')}">${outside.length} fuera del lienzo · Capas</button>` : ''}`;
}

export function copySelectedElements() {
  if ($('#modal')?.open) return;
  const selectedElements = getSelectedElements();
  const selectedElement = getSelectedElement();
  const c = getC();
  const targets = selectedElements.size > 0 ? [...selectedElements] : (selectedElement ? [selectedElement] : []);
  if (!targets.length) return;

  const elements = targets.map(id => copyElementData(c, id, measureElementFrame(id))).filter(Boolean);
  if (!elements.length) return;

  setClipboardElements(elements);
  setClipboardElement(elements[0]);

  if (elements.length === 1) {
    toast(`Copiado: ${elements[0].label}`);
  } else {
    toast(`Copiados ${elements.length} elementos en bloque.`);
  }
}

export function copySelectedElement() { copySelectedElements(); }

export function pasteElements() {
  const clipboardElements = getClipboardElements();
  const context = getContextPreview();
  if (!clipboardElements.length || $('#modal')?.open || context) return;
  const c = getC();
  const result = pasteElementData(c, clipboardElements, measureElementFrame);
  result.notices.forEach(toast);
  const nextConf = result.config;
  const newIds = result.ids;

  if (newIds.length === 1) {
    directChange(nextConf);
    selectElement(newIds[0]);
    toast(`Duplicado: ${ELEMENTS[newIds[0]]?.label || newIds[0]}`);
  } else if (newIds.length > 1) {
    directChange(nextConf);
    const selectedElements = getSelectedElements();
    selectedElements.clear();
    newIds.forEach(id => selectedElements.add(id));
    setSelectedElement(newIds[0]);
    positionSelection();
    renderCanvasBar();
    toast(`Duplicados ${newIds.length} elementos en bloque.`);
  }
}

export function pasteElement() { pasteElements(); }

export function applyFormatPainter(targetId) {
  const formatPainterSource = getFormatPainterSource();
  if (!formatPainterSource || formatPainterSource === targetId) return false;
  const srcDef = resolveElementDef(formatPainterSource) || ELEMENTS[formatPainterSource];
  const tgtDef = resolveElementDef(targetId) || ELEMENTS[targetId];
  const srcBase = srcDef?.baseId || formatPainterSource;
  const tgtBase = tgtDef?.baseId || targetId;

  if (srcBase !== tgtBase && srcDef?.kind !== tgtDef?.kind) {
    toast(`El copiado de formato solo es compatible entre elementos del mismo tipo (${srcDef?.label || 'origen'}).`);
    return false;
  }

  const c = getC();
  const srcP = elementState(c, formatPainterSource);
  const tgtP = elementState(c, targetId);
  const srcApp = appearance(c, formatPainterSource);
  const appearancePatch = {
    colorMode: srcApp.colorMode,
    color: srcApp.color,
    backgroundColor: srcApp.backgroundColor,
    backgroundMode: srcApp.backgroundMode,
    backgroundOpacity: srcApp.backgroundOpacity,
    opacity: srcApp.opacity
  };
  const srcSize = elementSize(c, formatPainterSource);
  const sizePatch = {};
  if (tgtDef.isDuplicate) {
    sizePatch.size = srcSize;
  } else if (tgtDef.sizeKey) {
    sizePatch[tgtDef.sizeKey] = srcSize;
  }
  if (srcP.width) {
    sizePatch.width = srcP.width;
  }
  const formatPatch = {};
  if (srcP.format !== undefined) formatPatch.format = srcP.format;
  else if (srcBase === 'value') formatPatch.format = c.format;
  if (srcP.decimals !== undefined) formatPatch.decimals = srcP.decimals;
  else if (srcBase === 'value') formatPatch.decimals = c.decimals;
  if (srcP.currency !== undefined) formatPatch.currency = srcP.currency;
  else if (srcBase === 'value') formatPatch.currency = c.currency;
  if (srcP.unit !== undefined) formatPatch.unit = srcP.unit;
  else if (srcBase === 'value') formatPatch.unit = c.unit;
  if (srcP.suffix !== undefined) formatPatch.suffix = srcP.suffix;
  else if (srcBase === 'value') formatPatch.suffix = c.suffix;
  if (srcP.deltaMode !== undefined) formatPatch.deltaMode = srcP.deltaMode;
  else if (srcBase === 'delta') formatPatch.deltaMode = c.deltaMode;

  let next = c;
  if (!tgtDef.isDuplicate) {
    if (srcSize && tgtDef.sizeKey) next = { ...next, [tgtDef.sizeKey]: srcSize };
    if (tgtBase === 'value') {
      if (formatPatch.format) next.format = formatPatch.format;
      if (formatPatch.decimals !== undefined) next.decimals = formatPatch.decimals;
      if (formatPatch.currency) next.currency = formatPatch.currency;
      if (formatPatch.unit) next.unit = formatPatch.unit;
      if (formatPatch.suffix !== undefined) next.suffix = formatPatch.suffix;
    }
    if (tgtBase === 'delta' && formatPatch.deltaMode) {
      next.deltaMode = formatPatch.deltaMode;
    }
  }

  next = updateElement(next, targetId, {
    ...tgtP,
    ...appearancePatch,
    ...sizePatch,
    ...formatPatch
  });

  setFormatPainterSource(null);
  directChange(next);
  selectElement(targetId);
  toast(`🎨 Formato copiado a '${tgtDef.label}'.`);
  return true;
}

export function startCardGesture(e, kind) {
  const node = $('#main-card');
  const fit = $('#card-fit');
  const app = $('#app');
  const c = getC();
  const gesture = {
    card: true,
    kind,
    startX: e.clientX,
    startY: e.clientY,
    start: structuredClone(c),
    scale: node ? node.getBoundingClientRect().width / c.width : 1,
    anchor: fit ? fit.getBoundingClientRect() : { left: 0, top: 0 },
    changed: false,
    pointer: e.pointerId,
    undoSnapshot: [...getUndo()],
    redo: [...getRedo()]
  };
  setGesture(gesture);
  if (app?.setPointerCapture) app.setPointerCapture(e.pointerId);
  e.preventDefault();
}

export function finishGesture(cancel = false) {
  const gesture = getGesture();
  if (!gesture) return;
  const g = gesture;
  setGesture(null);
  const app = $('#app');
  app?.classList.remove('is-dragging');
  if (app?.hasPointerCapture && app.hasPointerCapture(g.pointer)) {
    app.releasePointerCapture(g.pointer);
  }

  if (g.changed && (cancel || JSON.stringify(getC()) === JSON.stringify(g.start))) {
    setC(g.start);
    restoreHistory(g.undoSnapshot, g.redo);
    refreshCard();
  }

  if (g.changed) {
    persist();
    callInspector();
    callHistory();
    const ctx = getActiveContext();
    ctx.ignoreCanvasClick = true;
    setTimeout(() => { ctx.ignoreCanvasClick = false; }, 0);
  }

  if (g.card) {
    fitMain();
    $('#main-card')?.focus({ preventScroll: true });
  } else if (g.kind === 'group-move') {
    positionSelection();
    renderGuides();
  } else if (g.id) {
    app?.querySelector(`[data-element="${g.id}"]`)?.focus({ preventScroll: true });
  }

  positionSelection();
  renderGuides();
}
