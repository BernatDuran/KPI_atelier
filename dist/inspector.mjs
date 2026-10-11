/**
 * KPI Atelier - Submódulo Inspector y Controles de Propiedades (dist/inspector.mjs)
 * Gestiona el panel lateral inspector, pestañas (contenido, estilo, datos, elemento, tarjeta),
 * acordeones con memoria de estado, generadores de controles de formulario y sincronización de inputs.
 */

import { resizeCard } from './layout.mjs';
import {
  COLOR_SPEC, colorModes, appearance, elementColor, elementBackground,
  trendFill, SURFACE_EFFECTS
} from './appearance.mjs';
import {
  THEMES, FAMILIES, needsTrend, needsDate, needsGoal, needsCompare,
  sanitizeConfig
} from './model.mjs';
import { icon, esc, sampleData, comparisonLabel } from './cards.mjs';
import {
  ELEMENTS, SIZE_LIMITS, elementState, elementSize, elementAvailable,
  elementEnabled, updateElement, moveElement, resolveElementDef
} from './elements.mjs';
import { COLOR_ROLES } from './colors.mjs';
import { ICON_OPTIONS } from './icons.mjs';
import {
  $, btn, ib, getC, setC, getBaseline, setBaseline, dirty,
  persist, record, toast, getSelectedElement, setSelectedElement,
  getSelectedElements, getCardSelected, setCardSelected,
  getMode, setMode, getTab, setTab, getMoveStep, setMoveStep,
  inspectorSections, inspectorPositions, getPbipModel,
  getFriendlyReportName, getActiveContext, getUndo, getRedo
} from './state.mjs';

// Llamadas dinámicas a funciones del canvas
function callRefreshCard() {
  const ctx = getActiveContext();
  if (typeof ctx.refreshCard === 'function') ctx.refreshCard();
}
function callRenderCanvasBar() {
  const ctx = getActiveContext();
  if (typeof ctx.renderCanvasBar === 'function') ctx.renderCanvasBar();
}
function callPositionSelection() {
  const ctx = getActiveContext();
  if (typeof ctx.positionSelection === 'function') ctx.positionSelection();
}
function callRenderGuides() {
  const ctx = getActiveContext();
  if (typeof ctx.renderGuides === 'function') ctx.renderGuides();
}
function callDeselect() {
  const ctx = getActiveContext();
  if (typeof ctx.deselect === 'function') ctx.deselect();
}
function callMeasureElementFrame(id) {
  const ctx = getActiveContext();
  if (typeof ctx.measureElementFrame === 'function') return ctx.measureElementFrame(id);
  return null;
}

export const formats = [['currency', 'Moneda'], ['number', 'Número'], ['percent', 'Porcentaje']];
export const comparisons = [
  ['yoy', 'Año anterior · YoY'],
  ['mom', 'Mes anterior · MoM'],
  ['previous', 'Período anterior'],
  ['target', 'Objetivo'],
  ['custom', 'Medida de referencia'],
  ['none', 'Sin comparación']
];

export function field(key, label, type = 'text', opts = {}) {
  const c = getC();
  const val = c[key];
  let input;
  if (type === 'select') input = `<select data-key="${key}" id="f-${key}">${opts.options.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  else if (type === 'check') return `<label class="toggle-field" for="f-${key}"><span>${label}</span><input id="f-${key}" type="checkbox" data-key="${key}" ${val ? 'checked' : ''}><span class="toggle-track"></span></label>`;
  else if (type === 'range') input = `<div class="range-wrap"><input id="f-${key}" data-key="${key}" type="range" min="${opts.min}" max="${opts.max}" step="${opts.step || 1}" ${opts.scale ? `data-scale="${opts.scale}"` : ''} value="${opts.scale ? Math.round(val * opts.scale) : val}"><output for="f-${key}">${opts.scale ? Math.round(val * opts.scale) : val}${opts.unit || ''}</output></div>`;
  else if (type === 'color') input = `<div class="color-wrap"><input id="f-${key}" data-key="${key}" type="color" value="${val}"><span>${val.toUpperCase()}</span><span class="color-dot" style="background:${val}"></span></div>`;
  else if (type === 'textarea') input = `<textarea id="f-${key}" data-key="${key}" rows="3">${esc(val)}</textarea>`;
  else input = `<input id="f-${key}" data-key="${key}" type="${type}" value="${esc(val)}" ${opts.min !== undefined ? `min="${opts.min}"` : ''} ${opts.max !== undefined ? `max="${opts.max}"` : ''} ${type === 'number' ? `step="${['width', 'height'].includes(key) ? 1 : 'any'}"` : ''} ${opts.placeholder ? `placeholder="${opts.placeholder}"` : ''} ${type === 'text' ? 'maxlength="160"' : ''}>`;
  return `<div class="field"><label for="f-${key}">${label}${opts.tag ? `<span class="field-tag">${opts.tag}</span>` : ''}</label>${input}${opts.help ? `<small>${opts.help}</small>` : ''}</div>`;
}

export const select = (k, l, options, help) => field(k, l, 'select', { options, help });
export const range = (k, l, min, max, unit = 'px', step = 1) => field(k, l, 'range', { min, max, unit, step });
export const check = (k, l) => field(k, l, 'check');
export const percentRange = (k, l) => field(k, l, 'range', { min: 0, max: 100, unit: '%', scale: 100 });
export const section = (n, label, body, open = true) => {
  const tab = getTab();
  const key = tab + ':' + label;
  const sections = getActiveContext().inspectorSections || inspectorSections;
  return `<details class="field-section" data-section="${esc(key)}" ${(sections.get(key) ?? open) ? 'open' : ''}><summary><span><b>${n}</b>${label}</span>${icon('chevron', 14)}</summary><div class="section-body">${body}</div></details>`;
};

export function duplicateContentFields(baseIds) {
  const c = getC();
  if (!c.elements) return '';
  const matchingDups = Object.entries(c.elements).filter(([id, st]) => {
    if (st?.deleted) return false;
    const def = resolveElementDef(id);
    return def?.isDuplicate && baseIds.includes(def.baseId);
  });
  if (!matchingDups.length) return '';
  return matchingDups.map(([dupId, st]) => {
    const def = resolveElementDef(dupId);
    let fields = '';
    if (def.baseId === 'value') {
      const curFmt = st.format || c.format;
      const curCurr = st.currency || c.currency;
      const curUnit = st.unit || c.unit;
      const curDec = st.decimals ?? c.decimals;
      const curSuf = st.suffix !== undefined ? st.suffix : (c.suffix || '');
      fields = `<div class="field"><label for="f-dup-fmt-${dupId}">Formato del valor</label><select id="f-dup-fmt-${dupId}" data-dupval="format" data-dupid="${dupId}">${formats.map(([k, l]) => `<option value="${k}" ${curFmt === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        (curFmt === 'currency' ? `<div class="field"><label for="f-dup-cur-${dupId}">Moneda</label><select id="f-dup-cur-${dupId}" data-dupval="currency" data-dupid="${dupId}">${[['EUR', 'Euro · €'], ['USD', 'Dólar · $'], ['GBP', 'Libra · £']].map(([k, l]) => `<option value="${k}" ${curCurr === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : '') +
        `<div class="field-row"><div class="field"><label for="f-dup-u-${dupId}">Escala</label><select id="f-dup-u-${dupId}" data-dupval="unit" data-dupid="${dupId}">${[['auto', 'Automática'], ['none', 'Sin escalar'], ['k', 'Miles'], ['m', 'Millones']].map(([k, l]) => `<option value="${k}" ${curUnit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        `<div class="field"><label for="f-dup-dec-${dupId}">Decimales</label><select id="f-dup-dec-${dupId}" data-dupval="decimals" data-dupid="${dupId}">${[[0, '0'], [1, '1'], [2, '2'], [3, '3']].map(([k, l]) => `<option value="${k}" ${curDec === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>` +
        `<div class="field"><label for="f-dup-suf-${dupId}">Sufijo del valor</label><input id="f-dup-suf-${dupId}" data-dupval="suffix" data-dupid="${dupId}" value="${esc(curSuf)}" placeholder="ej. € o %"></div>`;
    } else if (def.baseId === 'delta') {
      const curComp = st.comparison || c.comparison;
      const curDir = st.direction || c.direction;
      const curMode = st.deltaMode || c.deltaMode;
      fields = `<div class="field"><label for="f-dup-cmpmode-${dupId}">Comparar con</label><select id="f-dup-cmpmode-${dupId}" data-dupval="comparison" data-dupid="${dupId}">${comparisons.map(([k, l]) => `<option value="${k}" ${curComp === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        `<div class="field"><label for="f-dup-dir-${dupId}">¿Qué significa mejorar?</label><select id="f-dup-dir-${dupId}" data-dupval="direction" data-dupid="${dupId}">${[['up', 'Cuanto más, mejor ↑'], ['down', 'Cuanto menos, mejor ↓'], ['neutral', 'Sin valoración favorable']].map(([k, l]) => `<option value="${k}" ${curDir === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        `<div class="field"><label for="f-dup-dm-${dupId}">Mostrar diferencia</label><select id="f-dup-dm-${dupId}" data-dupval="deltaMode" data-dupid="${dupId}">${[['relative', 'Porcentaje'], ['absolute', 'Diferencia absoluta'], ['pp', 'Puntos porcentuales']].map(([k, l]) => `<option value="${k}" ${curMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    } else if (def.baseId === 'compareLabel') {
      const curComp = st.comparison || c.comparison;
      const curTxt = st.text !== undefined ? st.text : '';
      const autoLbl = comparisonLabel({ comparison: curComp });
      fields = `<div class="field"><label for="f-dup-clcmp-${dupId}">Comparar con</label><select id="f-dup-clcmp-${dupId}" data-dupval="comparison" data-dupid="${dupId}">${comparisons.map(([k, l]) => `<option value="${k}" ${curComp === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        `<div class="field"><label for="f-dup-txt-${dupId}">Texto de comparación</label><input id="f-dup-txt-${dupId}" data-duptext="${dupId}" data-dupid="${dupId}" value="${esc(curTxt)}" placeholder="${esc(autoLbl)} (automático)"></div>`;
    } else if (def.baseId === 'status') {
      const curGood = st.statusGood !== undefined ? st.statusGood : (c.statusGood || 'Favorable');
      const curWarn = st.statusWarn !== undefined ? st.statusWarn : (c.statusWarn || 'En alerta');
      const curBad = st.statusBad !== undefined ? st.statusBad : (c.statusBad || 'Desfavorable');
      const curGTh = st.goodThreshold !== undefined ? st.goodThreshold : c.goodThreshold;
      const curWTh = st.warnThreshold !== undefined ? st.warnThreshold : c.warnThreshold;
      fields = `<div class="field-row"><div class="field"><label for="f-dup-gth-${dupId}">Umbral favorable</label><input id="f-dup-gth-${dupId}" type="number" data-dupval="goodThreshold" data-dupid="${dupId}" value="${curGTh}"></div>` +
        `<div class="field"><label for="f-dup-wth-${dupId}">Umbral alerta</label><input id="f-dup-wth-${dupId}" type="number" data-dupval="warnThreshold" data-dupid="${dupId}" value="${curWTh}"></div></div>` +
        `<div class="field"><label for="f-dup-sg-${dupId}">Texto favorable</label><input id="f-dup-sg-${dupId}" data-dupval="statusGood" data-dupid="${dupId}" value="${esc(curGood)}"></div>` +
        `<div class="field"><label for="f-dup-sw-${dupId}">Texto alerta</label><input id="f-dup-sw-${dupId}" data-dupval="statusWarn" data-dupid="${dupId}" value="${esc(curWarn)}"></div>` +
        `<div class="field"><label for="f-dup-sb-${dupId}">Texto desfavorable</label><input id="f-dup-sb-${dupId}" data-dupval="statusBad" data-dupid="${dupId}" value="${esc(curBad)}"></div>`;
    } else if (['referenceLabel', 'referenceValue'].includes(def.baseId)) {
      const curComp = st.comparison || c.comparison;
      fields = `<div class="field"><label for="f-dup-rcmp-${dupId}">Comparar con</label><select id="f-dup-rcmp-${dupId}" data-dupval="comparison" data-dupid="${dupId}">${comparisons.map(([k, l]) => `<option value="${k}" ${curComp === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    } else if (def.baseId === 'icon') {
      const curIcon = st.icon || c.icon;
      fields = `<div class="field"><label for="f-dup-ico-${dupId}">Icono</label><select id="f-dup-ico-${dupId}" data-dupval="icon" data-dupid="${dupId}">${ICON_OPTIONS.map(([k, l]) => `<option value="${k}" ${curIcon === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    } else if (['goalLabel', 'progressLabel', 'progress'].includes(def.baseId)) {
      fields = '<p class="field-help">La medida objetivo se configura en Conectar datos del modelo.</p>';
    } else if (def.baseId === 'trend') {
      fields = chartPanel(dupId);
    } else {
      const currentVal = st.text !== undefined ? st.text : (def.contentKey ? c[def.contentKey] : def.label);
      fields = `<div class="field"><label for="f-dup-txt-${dupId}">Texto</label><input id="f-dup-txt-${dupId}" data-duptext="${dupId}" data-dupid="${dupId}" value="${esc(currentVal)}" placeholder="Texto del elemento…"></div>`;
    }
    return `<div class="dup-content-card"><header><span>${icon('copy', 12)} ${esc(def.label)}</span><small>Elemento duplicado</small></header>${fields}</div>`;
  }).join('');
}

export function rememberInspector() {
  const panel = $('#inspector-fields');
  if (!panel?.dataset.panelTab) return null;
  const panelTab = panel.dataset.panelTab;
  const positions = getActiveContext().inspectorPositions || inspectorPositions;
  const sections = getActiveContext().inspectorSections || inspectorSections;

  positions.set(panelTab, panel.scrollTop);
  panel.querySelectorAll('[data-section]').forEach(d => sections.set(d.dataset.section, d.open));
  const focused = panel.contains(document.activeElement) ? document.activeElement : null;
  return { tab: panelTab, focus: focused?.id, selection: focused?.selectionStart != null ? [focused.selectionStart, focused.selectionEnd] : null };
}

export function updateInspectorTabs() {
  const app = $('#app');
  const tabs = app?.querySelector('.inspector-tabs');
  if (!tabs) return;
  const tab = getTab();
  const cardSelected = getCardSelected();
  const selectedElement = getSelectedElement();
  const entries = [
    ...(cardSelected ? [['card', 'Tarjeta']] : []),
    ...(selectedElement ? [['element', 'Elemento']] : []),
    ['content', 'Contenido'],
    ['style', 'Estilo'],
    ['data', 'Datos & DAX']
  ];
  tabs.innerHTML = entries.map(([id, label]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('');
}

export function iconPickerField() {
  const c = getC();
  return `<div class="field"><label>Icono de la tarjeta</label><button class="icon-picker-launch" data-action="icons">${icon(c.icon, 24)}<span>${ICON_OPTIONS.find(x => x[0] === c.icon)?.[1] || 'Icono'}<small>${ICON_OPTIONS.length} iconos disponibles</small></span>${icon('chevron', 14)}</button></div>`;
}

export function surfaceInspector() {
  const c = getC();
  const effect = c.surfaceEffect;
  return `<div class="effect-grid" role="group" aria-label="Efecto de superficie">${SURFACE_EFFECTS.map(([id, label]) => `<button data-surface="${id}" class="effect-option ${effect === id ? 'active' : ''}" aria-pressed="${effect === id}"><span class="effect-sample effect-${id}" style="--effect-accent:${c.accent}"></span><span>${label}</span></button>`).join('')}</div>` +
    (effect !== 'solid' ? range('effectIntensity', 'Intensidad del efecto', 0, 100, '%') : '') +
    (effect === 'glass' ? range('glassOpacity', 'Opacidad del cristal', 10, 100, '%') + range('glassBlur', 'Desenfoque', 0, 40) + '<p class="field-help"><strong>Glassmorphism.</strong> El cristal deja entrever el fondo del lienzo. El desenfoque depende del contenido detrás y del soporte del visual en Power BI.</p>' : '') +
    (['glass', 'aurora', 'glow'].includes(effect) ? select('effectColorMode', 'Color del efecto', [['theme', 'Acento del tema'], ['custom', 'Personalizado']]) + (c.effectColorMode === 'custom' ? field('effectColor', 'Color del efecto', 'color') : '') : '');
}

export function appearanceSelect(key, label, value, options) {
  return `<div class="field"><label for="appearance-${key}">${label}</label><select id="appearance-${key}" data-appearance="${key}">${options.map(([id, text]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
}

export function appearanceRange(key, label, value) {
  return `<div class="field"><label for="appearance-${key}">${label}</label><div class="range-wrap"><input id="appearance-${key}" data-appearance="${key}" type="range" min="0" max="100" value="${value}"><output for="appearance-${key}">${value}%</output></div></div>`;
}

export function appearanceColor(key, label, value) {
  const c = getC();
  return `<div class="field"><label for="appearance-${key}">${label}</label><div class="element-color-row"><input id="appearance-${key}" type="color" data-appearance="${key}" value="${value}"><span>HEX</span><input id="appearance-${key}-hex" data-appearance="${key}" data-hex maxlength="7" spellcheck="false" aria-label="${label}, código hexadecimal" value="${value.toUpperCase()}"></div><div class="element-color-swatches">${['accent', 'text', 'muted', 'background', 'positive', 'warning', 'negative'].map(role => `<button data-element-color="${key}" data-role-color="${role}" title="${COLOR_ROLES.find(x => x[0] === role)?.[1] || role}: ${c[role]}" aria-label="Usar ${c[role]}" style="background:${c[role]}"></button>`).join('')}</div></div>`;
}

export function elementAppearancePanel(id) {
  const c = getC();
  const baseId = id?.replace(/_copy\d+$/, '');
  const isTrend = baseId === 'trend';
  const isProgress = baseId === 'progress';
  const elState = elementState(c, id);
  const chartKind = isTrend ? (elState.chartKind || c.chartKind) : c.chartKind;
  const trendStyle = isTrend ? (elState.trendStyle || c.trendStyle) : c.trendStyle;
  const p = appearance(c, id), spec = COLOR_SPEC[id] || COLOR_SPEC[baseId] || { role: 'text' }, data = sampleData(c), resolved = elementColor(c, id, data);
  const names = { theme: 'Seguir el tema', semantic: 'Según el resultado del KPI', custom: 'Color personalizado', linked: 'Seguir la barra de progreso' };
  let html = appearanceSelect('colorMode', isProgress ? 'Color de la barra' : isTrend ? (chartKind === 'donut' ? 'Color del anillo' : 'Color de línea y puntos') : 'Color del elemento', p.colorMode, colorModes(id).map(key => [key, names[key]]));
  html += p.colorMode === 'custom' ? appearanceColor('color', 'Color personalizado', p.color) : `<div class="appearance-source"><i style="background:${resolved}"></i><span>${p.colorMode === 'linked' ? 'Vinculado a la barra' : p.colorMode === 'semantic' ? 'Favorable, alerta o desfavorable según el KPI' : 'Se actualiza al cambiar de tema'}</span></div>`;
  if (spec.background && (!isTrend || chartKind === 'donut')) {
    html += appearanceSelect('backgroundMode', [isProgress, isTrend].some(Boolean) ? 'Fondo de la pista' : 'Fondo del elemento', p.backgroundMode, [['auto', isProgress ? 'Texto secundario del tema' : 'Seguir el color del elemento'], ['custom', 'Color personalizado'], ['none', 'Sin fondo']]);
    if (p.backgroundMode !== 'none') html += (p.backgroundMode === 'custom' ? appearanceColor('backgroundColor', 'Color de fondo', p.backgroundColor) : '') + appearanceRange('backgroundOpacity', 'Opacidad del fondo', p.backgroundOpacity);
  }
  if (isTrend && chartKind !== 'donut' && trendStyle === 'area') html += appearanceSelect('fillMode', 'Color del área', p.fillMode, [['linked', 'Seguir la línea'], ['custom', 'Color personalizado']]) + (p.fillMode === 'custom' ? appearanceColor('fillColor', 'Color del área', p.fillColor) : '');
  html += appearanceRange('opacity', 'Opacidad del elemento', p.opacity);
  if (id === 'status' || p.colorMode === 'semantic') html += `<details class="semantic-colors"><summary>Colores de estado · compartidos</summary><p class="field-help">Estos colores se comparten con los indicadores que siguen el resultado.</p>${field('positive', 'Favorable', 'color')}${id !== 'delta' ? field('warning', 'Alerta', 'color') : ''}${id === 'delta' || id === 'status' ? field('negative', 'Desfavorable', 'color') : ''}</details>`;
  return html + btn('reset-appearance', 'Restablecer apariencia', 'reset', 'button quiet appearance-reset');
}

export function editAppearance(input) {
  const selectedElement = getSelectedElement();
  const id = selectedElement;
  const key = input.dataset.appearance;
  const c = getC();
  const p = appearance(c, id);
  const data = sampleData(c);
  let value = input.value;

  if (input.dataset.hex !== undefined) {
    value = value.startsWith('#') ? value : '#' + value;
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    input.setAttribute('aria-invalid', 'false');
  }

  if (input.type === 'range') value = Number(value);
  const patch = { [key]: value };
  if (key === 'colorMode' && value === 'custom' && p.colorMode !== 'custom') patch.color = elementColor(c, id, data);
  if (key === 'backgroundMode' && value === 'custom' && p.backgroundMode !== 'custom') patch.backgroundColor = (p.backgroundMode === 'none' ? (id === 'progress' ? c.muted : elementColor(c, id, data)) : elementBackground(c, id, data).slice(0, 7));
  if (key === 'fillMode' && value === 'custom' && p.fillMode !== 'custom') patch.fillColor = trendFill(c, id);

  const ctx = getActiveContext();
  const now = Date.now();
  if (now - (ctx.lastEdit || 0) > 700 || input.tagName === 'SELECT') record();
  ctx.lastEdit = now;

  setC(sanitizeConfig(updateElement(c, id, patch)));
  persist();
  callRefreshCard();
  updateHistoryButtons();

  if (input.type === 'range' && input.nextElementSibling) input.nextElementSibling.textContent = value + '%';
  const app = $('#app');
  for (const other of (app?.querySelectorAll(`[data-appearance="${key}"]`) || [])) {
    if (other !== input) {
      other.value = String(value);
      other.setAttribute('aria-invalid', 'false');
    }
  }
}

export function cardDimensionsPanel() {
  return `<div class="field-row">${field('width', 'Ancho · px', 'number', { min: 200, max: 800 })}${field('height', 'Alto · px', 'number', { min: 200, max: 650 })}</div><p class="geometry-note">Mínimo 200 × 200 px. Los elementos visuales escalables se adaptan proporcionalmente al tamaño de la tarjeta.</p>`;
}

export function layoutPanel() {
  const c = getC();
  return `<div class="field"><label>Distribución</label><div class="layout-options">${[['stacked', 'Vertical'], ['chart-left', 'Gráfico izq.'], ['chart-right', 'Gráfico der.']].filter(([id]) => id === 'stacked' || elementAvailable(c, 'trend')).map(([id, label]) => `<button data-layout="${id}" class="${c.layout === id ? 'active' : ''}" aria-pressed="${c.layout === id}" title="Aplicar distribución: ${label}"><span class="layout-mini ${id}"><i></i><b></b></span>${label}</button>`).join('')}</div><small>Aplicar una distribución recoloca los elementos. Puedes deshacerlo.</small></div>`;
}

export function chartPanel(targetId = 'trend') {
  const c = getC();
  const isOrig = targetId === 'trend';
  const st = isOrig ? c : elementState(c, targetId);
  const mode = getMode();
  const tab = getTab();
  const pro = mode !== 'essential', adv = mode === 'advanced';
  const cKind = st.chartKind || c.chartKind;
  const tStyle = st.trendStyle || c.trendStyle;
  const tCurve = st.trendCurve || c.trendCurve;
  const aFill = st.areaFill || c.areaFill;
  const fOpacity = st.fillOpacity ?? c.fillOpacity;
  const lWidth = st.lineWidth ?? c.lineWidth;
  const tGrid = st.trendGrid || c.trendGrid;
  const dThick = st.donutThickness ?? c.donutThickness;
  const dLabel = st.donutLabel !== undefined ? st.donutLabel : c.donutLabel;
  const sMax = st.showMax !== undefined ? st.showMax : c.showMax;
  const sMin = st.showMin !== undefined ? st.showMin : c.showMin;
  const sDot = st.showDot !== undefined ? st.showDot : c.showDot;
  const sGuides = st.showMarkerGuides !== undefined ? st.showMarkerGuides : c.showMarkerGuides;
  const zBase = st.zeroBase !== undefined ? st.zeroBase : c.zeroBase;

  const dSel = (k, l, opts) => isOrig ? select(k, l, opts) : `<div class="field"><label for="f-dup-${k}-${targetId}">${l}</label><select id="f-dup-${k}-${targetId}" data-dupval="${k}" data-dupid="${targetId}">${opts.map(([v, txt]) => `<option value="${v}" ${(k === 'chartKind' ? cKind : k === 'trendStyle' ? tStyle : k === 'trendCurve' ? tCurve : k === 'areaFill' ? aFill : tGrid) === v ? 'selected' : ''}>${txt}</option>`).join('')}</select></div>`;
  const dChk = (k, l) => isOrig ? check(k, l) : `<label class="toggle-field" for="f-dup-${k}-${targetId}"><span>${l}</span><input id="f-dup-${k}-${targetId}" type="checkbox" data-dupval="${k}" data-dupid="${targetId}" ${(k === 'donutLabel' ? dLabel : k === 'showMax' ? sMax : k === 'showMin' ? sMin : k === 'showDot' ? sDot : k === 'showMarkerGuides' ? sGuides : zBase) ? 'checked' : ''}><span class="toggle-track"></span></label>`;
  const dRng = (k, l, min, max, unit = 'px', step = 1) => isOrig ? range(k, l, min, max, unit, step) : `<div class="field"><label for="f-dup-${k}-${targetId}">${l}</label><div class="range-wrap"><input id="f-dup-${k}-${targetId}" data-dupval="${k}" data-dupid="${targetId}" type="range" min="${min}" max="${max}" step="${step}" value="${k === 'donutThickness' ? dThick : lWidth}"><output for="f-dup-${k}-${targetId}">${k === 'donutThickness' ? dThick : lWidth}${unit}</output></div></div>`;
  const dPct = (k, l) => isOrig ? percentRange(k, l) : `<div class="field"><label for="f-dup-${k}-${targetId}">${l}</label><div class="range-wrap"><input id="f-dup-${k}-${targetId}" data-dupval="${k}" data-dupid="${targetId}" type="range" min="0" max="100" step="1" value="${Math.round(fOpacity * 100)}"><output for="f-dup-${k}-${targetId}">${Math.round(fOpacity * 100)}%</output></div></div>`;

  let h = dSel('chartKind', 'Visual', [['trend', 'Tendencia'], ['donut', 'Donut · avance del objetivo']]);
  if (cKind === 'donut') return h + (tab === 'style' && pro ? (isOrig ? range('trendHeight', 'Altura del gráfico', 24, 240) : '') : '') + (isOrig ? field('targetMeasure', 'Medida objetivo') : '') + dRng('donutThickness', 'Grosor del anillo', 4, 28) + dChk('donutLabel', 'Mostrar porcentaje central') + '<p class="field-help">Valor / objetivo positivo. El anillo se limita a 100 %; la etiqueta muestra el avance real.</p>';
  h += dSel('trendStyle', 'Representación', [['area', 'Línea con área'], ['line', 'Solo línea'], ['bars', 'Barras']]);
  if (tStyle !== 'bars') h += dSel('trendCurve', 'Trazado', [['smooth', 'Suave'], ['linear', 'Recto'], ['step', 'Escalonado']]);
  if (tStyle === 'area') h += dSel('areaFill', 'Relleno del área', [['gradient', 'Degradado suave'], ['solid', 'Uniforme']]) + (pro ? dPct('fillOpacity', 'Intensidad del área') : '');
  if (pro) h += (tab === 'style' && (isOrig ? range('trendHeight', 'Altura del gráfico', 24, 240) : '')) + dChk('showMax', 'Máximo y etiqueta') + dChk('showMin', 'Mínimo y etiqueta') + dChk('showDot', 'Destacar último punto');
  if (adv) h += dRng('lineWidth', 'Grosor del trazo', 1, 6, 'px', .2) + dSel('trendGrid', 'Guías de fondo', [['none', 'Sin guías'], ['horizontal', 'Líneas sutiles'], ['dots', 'Líneas de puntos']]) + dChk('showMarkerGuides', 'Guías en máximo y mínimo') + dChk('zeroBase', 'Incluir cero en la escala');
  return h + (pro ? '<p class="geometry-note">Las etiquetas necesitan al menos 100 × 56 px. En gráficos pequeños se conservan los puntos.</p>' : '');
}

export function cardInspector() {
  return `<div class="selected-object-heading"><span>${icon('square', 20)}</span><div><strong>Tarjeta</strong><small>Lienzo de tamaño fijo</small></div>${ib('deselect', 'Deseleccionar', 'close')}</div>` +
    section('01', 'Tamaño del lienzo', cardDimensionsPanel()) +
    section('02', 'Distribución', layoutPanel()) +
    section('03', 'Superficie y efectos', surfaceInspector(), false);
}

export function dataSummaryCard() {
  const c = getC();
  const pbipModel = getPbipModel();
  const rows = [];
  if (pbipModel) {
    const isLive = Boolean(pbipModel.isLiveConnection);
    const repName = getFriendlyReportName(pbipModel);
    const badgeText = isLive ? `⚡ ${pbipModel.measures.length} fx` : `${pbipModel.measures.length} fx`;
    rows.push(`<div class="data-summary-row"><span>Modelo PBIP</span><strong title="${esc(repName)}">${esc(repName)} <span class="data-summary-badge ${isLive ? 'connected-live' : ''}">${badgeText}</span></strong></div>`);
  }
  rows.push(
    `<div class="data-summary-row"><span>Medida principal</span><strong title="${esc(c.measure || 'Sin asignar')}">${c.measure ? esc(c.measure) : '<em class="data-unassigned">Sin asignar</em>'}</strong></div>`,
    `<div class="data-summary-row"><span>Nombre salida DAX</span><strong title="${esc(c.measureName || 'Sin asignar')}">${esc(c.measureName || 'Sin asignar')}</strong></div>`
  );
  if (needsDate(c)) {
    rows.push(`<div class="data-summary-row"><span>Calendario</span><strong title="${esc(c.dateTable)} [${esc(c.dateColumn)}]">${esc(c.dateTable)} [${esc(c.dateColumn)}]</strong></div>`);
    if (needsTrend(c)) {
      const granNames = { auto: 'Automática', day: 'Diaria', week: 'Semanal', month: 'Mensual' };
      rows.push(`<div class="data-summary-row"><span>Granularidad</span><strong>${granNames[c.granularity] || 'Automática'}</strong></div>`);
    }
  }
  if (needsGoal(c) || c.comparison === 'target') {
    rows.push(`<div class="data-summary-row"><span>Medida objetivo</span><strong title="${esc(c.targetMeasure || 'Sin asignar')}">${c.targetMeasure ? esc(c.targetMeasure) : '<em class="data-unassigned">Sin asignar</em>'}</strong></div>`);
  }
  if (needsCompare(c) && c.comparison === 'custom') {
    rows.push(`<div class="data-summary-row"><span>Referencia</span><strong title="${esc(c.compareMeasure || 'Sin asignar')}">${c.compareMeasure ? esc(c.compareMeasure) : '<em class="data-unassigned">Sin asignar</em>'}</strong></div>`);
  }
  const activeDupIds = Object.keys(c.elements || {}).filter(id => {
    const def = resolveElementDef(id);
    const st = elementState(c, id);
    if (!def?.isDuplicate || st.deleted || st.hidden) return false;
    if (def.baseId === 'value') return true;
    if (def.baseId === 'delta') return (st.comparison || c.comparison) === 'custom';
    if (['goalLabel', 'progressLabel', 'progress'].includes(def.baseId)) return needsGoal(c) || (st.comparison || c.comparison) === 'target';
    if (def.baseId === 'trend') return true;
    return false;
  });
  if (activeDupIds.length) {
    rows.push(`<div class="data-summary-divider"></div><div class="data-summary-subhead">Elementos duplicados (${activeDupIds.length})</div>`);
    for (const dupId of activeDupIds) {
      const def = resolveElementDef(dupId);
      const st = elementState(c, dupId);
      if (def.baseId === 'trend') {
        rows.push(`<div class="data-summary-row"><span>${esc(def.label)} (medida)</span><strong title="${esc(st.measure || c.measure || 'Hereda principal')}">${esc(st.measure || c.measure || 'Hereda principal')}</strong></div>`);
        rows.push(`<div class="data-summary-row"><span>${esc(def.label)} (fecha)</span><strong title="${esc(st.dateTable || c.dateTable || 'Calendario')} [${esc(st.dateColumn || c.dateColumn || 'Fecha')}]">${esc(st.dateTable || c.dateTable || 'Calendario')} [${esc(st.dateColumn || c.dateColumn || 'Fecha')}]</strong></div>`);
      } else if (def.baseId === 'value') {
        rows.push(`<div class="data-summary-row"><span>${esc(def.label)}</span><strong title="${esc(st.measure || c.measure || 'Hereda principal')}">${esc(st.measure || c.measure || 'Hereda principal')}</strong></div>`);
      } else if (def.baseId === 'delta') {
        rows.push(`<div class="data-summary-row"><span>${esc(def.label)} (ref.)</span><strong title="${esc(st.compareMeasure || 'Sin asignar')}">${st.compareMeasure ? esc(st.compareMeasure) : '<em class="data-unassigned">Sin asignar</em>'}</strong></div>`);
      } else if (['goalLabel', 'progressLabel', 'progress'].includes(def.baseId)) {
        rows.push(`<div class="data-summary-row"><span>${esc(def.label)} (objetivo)</span><strong title="${esc(st.targetMeasure || c.targetMeasure || 'Sin asignar')}">${(st.targetMeasure || c.targetMeasure) ? esc(st.targetMeasure || c.targetMeasure) : '<em class="data-unassigned">Sin asignar</em>'}</strong></div>`);
      }
    }
  }
  return `<div class="data-summary-card">${rows.join('')}</div>`;
}

export function elementInspector() {
  const c = getC();
  const selectedElement = getSelectedElement();
  const id = selectedElement;
  const def = resolveElementDef(id) || ELEMENTS[id];
  const p = elementState(c, id);
  const limits = SIZE_LIMITS[def.kind];
  const moveStep = getMoveStep();
  const geom = (key, label, value, min, max) => `<div class="field"><label for="el-${key}">${label}</label><input id="el-${key}" type="number" data-elprop="${key}" value="${value}" min="${min}" max="${max}" step="${moveStep}"></div>`;
  let specific = '';

  if (def.isDuplicate) {
    if (def.baseId === 'value') {
      const curFmt = p.format || c.format;
      const curCurr = p.currency || c.currency;
      const curUnit = p.unit || c.unit;
      const curDec = p.decimals ?? c.decimals;
      const curSuf = p.suffix !== undefined ? p.suffix : c.suffix;
      specific = `<div class="field"><label for="f-dup-format">Formato del valor</label><select id="f-dup-format" data-dupval="format">${formats.map(([k, l]) => `<option value="${k}" ${curFmt === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        (curFmt === 'currency' ? `<div class="field"><label for="f-dup-currency">Moneda</label><select id="f-dup-currency" data-dupval="currency">${[['EUR', 'Euro · €'], ['USD', 'Dólar · $'], ['GBP', 'Libra · £']].map(([k, l]) => `<option value="${k}" ${curCurr === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : '') +
        `<div class="field-row"><div class="field"><label for="f-dup-unit">Escala</label><select id="f-dup-unit" data-dupval="unit">${[['auto', 'Automática'], ['none', 'Sin escalar'], ['k', 'Miles'], ['m', 'Millones']].map(([k, l]) => `<option value="${k}" ${curUnit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        `<div class="field"><label for="f-dup-decimals">Decimales</label><select id="f-dup-decimals" data-dupval="decimals">${[[0, '0'], [1, '1'], [2, '2'], [3, '3']].map(([k, l]) => `<option value="${k}" ${curDec === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>` +
        `<div class="field"><label for="f-dup-suffix">Sufijo del valor</label><input id="f-dup-suffix" data-dupval="suffix" value="${esc(curSuf)}" placeholder="ej. € o %"></div>`;
    } else if (def.baseId === 'icon') {
      specific = iconPickerField();
    } else if (def.baseId === 'delta') {
      const curComp = p.comparison || c.comparison;
      const curDir = p.direction || c.direction;
      const curMode = p.deltaMode || c.deltaMode;
      specific = `<div class="field"><label for="f-dup-cmpmode">Comparar con</label><select id="f-dup-cmpmode" data-dupval="comparison" data-dupid="${id}">${comparisons.map(([k, l]) => `<option value="${k}" ${curComp === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        `<div class="field"><label for="f-dup-dir">¿Qué significa mejorar?</label><select id="f-dup-dir" data-dupval="direction">${[['up', 'Cuanto más, mejor ↑'], ['down', 'Cuanto menos, mejor ↓'], ['neutral', 'Sin valoración favorable']].map(([k, l]) => `<option value="${k}" ${curDir === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        `<div class="field"><label for="f-dup-deltamode">Mostrar diferencia</label><select id="f-dup-deltamode" data-dupval="deltaMode">${[['relative', 'Porcentaje'], ['absolute', 'Diferencia absoluta'], ['pp', 'Puntos porcentuales']].map(([k, l]) => `<option value="${k}" ${curMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    } else if (def.baseId === 'compareLabel') {
      const curComp = p.comparison || c.comparison;
      const curTxt = p.text !== undefined ? p.text : '';
      const autoLbl = comparisonLabel({ comparison: curComp });
      specific = `<div class="field"><label for="f-dup-clcmp">Comparar con</label><select id="f-dup-clcmp" data-dupval="comparison" data-dupid="${id}">${comparisons.map(([k, l]) => `<option value="${k}" ${curComp === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        `<div class="field"><label for="f-duptext">Texto de comparación</label><input id="f-duptext" data-duptext="${id}" value="${esc(curTxt)}" placeholder="${esc(autoLbl)} (automático)"></div>`;
    } else if (def.baseId === 'status') {
      const curGood = p.statusGood !== undefined ? p.statusGood : (c.statusGood || 'Favorable');
      const curWarn = p.statusWarn !== undefined ? p.statusWarn : (c.statusWarn || 'En alerta');
      const curBad = p.statusBad !== undefined ? p.statusBad : (c.statusBad || 'Desfavorable');
      const curGTh = p.goodThreshold !== undefined ? p.goodThreshold : c.goodThreshold;
      const curWTh = p.warnThreshold !== undefined ? p.warnThreshold : c.warnThreshold;
      specific = `<div class="field-row"><div class="field"><label for="f-dup-gth">Umbral favorable</label><input id="f-dup-gth" type="number" data-dupval="goodThreshold" value="${curGTh}"></div>` +
        `<div class="field"><label for="f-dup-wth">Umbral alerta</label><input id="f-dup-wth" type="number" data-dupval="warnThreshold" value="${curWTh}"></div></div>` +
        `<div class="field"><label for="f-dup-sg">Texto favorable</label><input id="f-dup-sg" data-dupval="statusGood" value="${esc(curGood)}"></div>` +
        `<div class="field"><label for="f-dup-sw">Texto alerta</label><input id="f-dup-sw" data-dupval="statusWarn" value="${esc(curWarn)}"></div>` +
        `<div class="field"><label for="f-dup-sb">Texto desfavorable</label><input id="f-dup-sb" data-dupval="statusBad" value="${esc(curBad)}"></div>`;
    } else if (['referenceLabel', 'referenceValue'].includes(def.baseId)) {
      const curComp = p.comparison || c.comparison;
      specific = `<div class="field"><label for="f-dup-rcmp">Comparar con</label><select id="f-dup-rcmp" data-dupval="comparison">${comparisons.map(([k, l]) => `<option value="${k}" ${curComp === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    } else if (['goalLabel', 'progressLabel', 'progress'].includes(def.baseId)) {
      specific = '<p class="field-help">La medida objetivo se configura en Conectar datos del modelo.</p>';
    } else if (def.baseId === 'trend') {
      specific = chartPanel(id);
    } else {
      const currentVal = p.text !== undefined ? p.text : (def.contentKey ? c[def.contentKey] : def.label);
      specific = `<div class="field"><label for="f-duptext">Texto</label><input id="f-duptext" data-duptext="${id}" value="${esc(currentVal)}" placeholder="Texto del elemento…"></div>`;
    }
  } else {
    specific = def.contentKey ? field(def.contentKey, def.label) : '';
    if (id === 'icon') specific = iconPickerField();
    if (id === 'value') {
      specific = select('format', 'Formato del valor', formats) +
        (c.format === 'currency' ? select('currency', 'Moneda', [['EUR', 'Euro · €'], ['USD', 'Dólar · $'], ['GBP', 'Libra · £']]) : '') +
        `<div class="field-row">${select('unit', 'Escala', [['auto', 'Automática'], ['none', 'Sin escalar'], ['k', 'Miles'], ['m', 'Millones']])}${select('decimals', 'Decimales', [[0, '0'], [1, '1'], [2, '2'], [3, '3']])}</div>` +
        field('suffix', 'Sufijo del valor');
    }
    if (['delta', 'referenceLabel', 'referenceValue'].includes(id)) specific = select('comparison', 'Comparar con', comparisons) + (id === 'delta' ? select('direction', '¿Qué significa mejorar?', [['up', 'Cuanto más, mejor ↑'], ['down', 'Cuanto menos, mejor ↓'], ['neutral', 'Sin valoración favorable']]) + select('deltaMode', 'Mostrar diferencia', [['relative', 'Porcentaje'], ['absolute', 'Diferencia absoluta'], ['pp', 'Puntos porcentuales']]) : '');
    if (id === 'compareLabel') {
      const curTxt = elementState(c, 'compareLabel').text || '';
      const autoLbl = comparisonLabel(c);
      specific = select('comparison', 'Comparar con', comparisons) + `<div class="field"><label for="f-complabel-text">Texto de comparación</label><input id="f-complabel-text" data-duptext="compareLabel" value="${esc(curTxt)}" placeholder="${esc(autoLbl)} (automático)"></div>`;
    }
    if (id === 'trend') specific = chartPanel();
    if (['goalLabel', 'progress', 'progressLabel'].includes(id)) specific = '<p class="field-help">La medida objetivo se configura en Conectar datos del modelo.</p>';
    if (id === 'status') specific = field('statusGood', 'Texto favorable') + field('statusWarn', 'Texto de alerta') + field('statusBad', 'Texto desfavorable') + `<div class="field-row">${field('goodThreshold', 'Umbral favorable', 'number')}${field('warnThreshold', 'Umbral alerta', 'number')}</div>`;
    if (id === 'period') specific = '<p class="field-help">El período se calcula a partir de las fechas seleccionadas en el informe.</p>';
  }

  const hidden = p.hidden || !elementEnabled(c, id);
  const sizeRange = def.isDuplicate
    ? `<div class="field"><label for="f-dupsize">${def.kind === 'text' ? 'Tamaño de texto' : def.kind === 'icon' ? 'Tamaño de icono' : 'Altura'}</label><div class="range-wrap"><input id="f-dupsize" data-dupsize="${id}" type="range" min="${limits[0]}" max="${limits[1]}" value="${elementSize(c, id)}"><output for="f-dupsize">${elementSize(c, id)}px</output></div></div>`
    : range(def.sizeKey, def.kind === 'text' ? 'Tamaño de texto' : def.kind === 'icon' ? 'Tamaño de icono' : 'Altura', ...limits);

  return `<div class="selected-object-heading"><span>${icon(def.kind === 'icon' ? (p.icon || c.icon) : def.kind === 'chart' ? 'trend' : def.kind === 'bar' ? 'signal' : 'text', 20)}</span><div><strong>${def.label}</strong><small>${p.deleted ? 'Elemento eliminado' : hidden ? 'Elemento oculto' : 'Seleccionado en el lienzo'}</small></div>${ib('deselect', 'Deseleccionar', 'close')}</div>` +
    section('01', 'Apariencia', elementAppearancePanel(id)) +
    section('02', 'Contenido del elemento', specific) +
    section('03', 'Posición y tamaño', `<div class="field-row">${geom('x', 'Desplazamiento X · px', p.x, -1000, 1000)}${geom('y', 'Desplazamiento Y · px', p.y, -1000, 1000)}</div><p class="geometry-note">Posición independiente: el tamaño no mueve otros elementos ni la tarjeta. Flechas: ${moveStep} px · Mayús: ${moveStep === 1 ? 5 : 1} px.</p>` + sizeRange + geom('width', 'Ancho del elemento · px', p.width, 0, 800) + `<p class="geometry-note">Ancho 0 = ${p.frame ? (def.kind === 'icon' ? 'tamaño del icono' : 'ancho al desplazarlo') : 'automático'}. Asa lateral: ancho; esquina: tamaño.</p>` + (p.frame ? btn('release-element', 'Volver a posición de plantilla', 'restore', 'button quiet appearance-reset') + `<p class="geometry-note">Recupera su posición y ancho de plantilla sin cambiar los demás elementos.</p>` : '')) +
    section('04', 'Visibilidad', `<div class="element-action-row">${btn(p.deleted ? 'restore-element' : 'hide-element', p.deleted ? 'Restaurar' : hidden ? 'Mostrar' : 'Ocultar', p.deleted ? 'restore' : hidden ? 'eye' : 'eyeOff', 'button secondary')}${!p.deleted ? btn('delete-element', 'Eliminar', 'trash', 'button quiet') : ''}</div><p class="field-help">Ocultar conserva el espacio. Eliminar retira el elemento. Puedes recuperarlo con Deshacer.</p>${btn('reset-element', 'Restablecer este elemento', 'reset', 'button quiet')}`);
}

export function renderInspector() {
  const remembered = rememberInspector();
  const c = getC();
  const mode = getMode();
  const tab = getTab();
  const cardSelected = getCardSelected();
  const selectedElement = getSelectedElement();
  const adv = mode === 'advanced', pro = adv;
  let h = '';

  if (tab === 'card' && cardSelected) {
    h = cardInspector();
  } else if (tab === 'element' && selectedElement) {
    h = elementInspector();
  } else if (tab === 'content') {
    h += section('01', 'Identidad', field('title', 'Título del KPI') + field('subtitle', 'Subtítulo') + (pro ? field('eyebrow', 'Etiqueta superior') : '') + select('type', 'Tipo de tarjeta', FAMILIES.filter(f => f.id !== 'all').map(f => [f.id, f.name])) + duplicateContentFields(['title', 'subtitle', 'eyebrow']));
    h += section('02', 'Valor principal', select('format', 'Formato', formats) + (c.format === 'currency' ? select('currency', 'Moneda', [['EUR', 'Euro · €'], ['USD', 'Dólar · $'], ['GBP', 'Libra · £']]) : '') + (pro ? `<div class="field-row">${select('unit', 'Escala', [['auto', 'Automática'], ['none', 'Sin escalar'], ['k', 'Miles'], ['m', 'Millones']])}${select('decimals', 'Decimales', [[0, '0'], [1, '1'], [2, '2'], [3, '3']])}</div>` : '') + (adv ? field('suffix', 'Sufijo personalizado') : '') + duplicateContentFields(['value']));
    const origCompText = elementState(c, 'compareLabel').text || '';
    const autoOrigCompLbl = comparisonLabel(c);
    const origCompField = `<div class="field"><label for="f-complabel-content-text">Texto de comparación</label><input id="f-complabel-content-text" data-duptext="compareLabel" value="${esc(origCompText)}" placeholder="${esc(autoOrigCompLbl)} (automático)"></div>`;
    h += section('03', 'Contexto y comparación', select('comparison', 'Comparar con', comparisons) + origCompField + select('direction', '¿Qué significa mejorar?', [['up', 'Cuanto más, mejor ↑'], ['down', 'Cuanto menos, mejor ↓'], ['neutral', 'Sin valoración favorable']]) + (pro ? select('deltaMode', 'Mostrar diferencia', [['relative', 'Variación relativa · %'], ['absolute', 'Diferencia absoluta'], ['pp', 'Puntos porcentuales · pp']]) : '') + duplicateContentFields(['delta', 'referenceValue', 'compareLabel', 'referenceLabel']));
    if (c.type === 'status') h += section('04', 'Reglas del semáforo', `<p class="field-help">${c.direction === 'down' ? 'Verde ≤ favorable; ámbar ≤ alerta; rojo por encima.' : 'Verde ≥ favorable; ámbar ≥ alerta; rojo por debajo.'}${c.format === 'percent' ? ' Usa 0,95 para indicar 95 %.' : ''}</p><div class="field-row">${field('goodThreshold', 'Umbral favorable', 'number')}${field('warnThreshold', 'Umbral de alerta', 'number')}</div>` + (pro ? field('statusGood', 'Texto favorable') + field('statusWarn', 'Texto en alerta') + field('statusBad', 'Texto desfavorable') : '') + duplicateContentFields(['status']));
    if (pro) h += section('05', 'Composición', check('showIcon', 'Mostrar icono') + (c.showIcon ? iconPickerField() : '') + check('showSubtitle', 'Mostrar subtítulo') + check('showComparison', 'Mostrar comparativa') + (['spark', 'executive', 'target'].includes(c.type) ? check('showTrend', 'Mostrar gráfico') : '') + (c.type === 'executive' ? check('showGoal', 'Mostrar objetivo') : '') + check('showFooter', 'Mostrar pie') + (adv ? field('footer', 'Texto del pie') : '') + duplicateContentFields(['icon', 'footer', 'goalLabel', 'progressLabel', 'progress', 'trend']), false);
  } else if (tab === 'style') {
    h += section('01', 'Paleta', `<button class="palette-launch" data-action="themes">${icon('palette', 17)}<span>Estudio de color<small>Crea, ajusta y guarda tus temas</small></span>${icon('arrow', 15)}</button><div class="theme-grid">${Object.entries(THEMES).map(([k, t]) => `<button data-theme="${k}" class="theme-option ${c.theme === k ? 'active' : ''}"><span style="background:${t.background};border-color:${t.borderColor}"><i style="background:${t.accent}"></i></span>${t.name}</button>`).join('')}</div>` + field('accent', 'Color de acento', 'color') + (pro ? `<div class="field-row">${field('background', 'Fondo', 'color')}${field('text', 'Texto', 'color')}</div>` : '') + (adv ? field('muted', 'Texto secundario', 'color') : '') + (pro ? `<div class="field-row">${field('positive', 'Favorable', 'color')}${field('negative', 'Desfavorable', 'color')}</div>` : '') + (adv ? field('warning', 'Alerta', 'color') : ''));
    h += section('02', 'Forma y tamaño', cardDimensionsPanel() + layoutPanel() + range('radius', 'Radio de esquinas', 0, 40) + (pro ? range('padding', 'Espacio interior', 12, 48) + (['solid', 'aurora'].includes(c.surfaceEffect) ? select('shadow', 'Sombra', [['none', 'Sin sombra'], ['soft', 'Suave'], ['strong', 'Profunda']]) : '') : '') + (adv ? range('borderWidth', 'Grosor del borde', 0, 4) + field('borderColor', 'Color del borde', 'color') : ''));
    h += section('03', 'Superficie y efectos', surfaceInspector());
    if (pro) h += section('04', 'Tipografía', select('font', 'Familia tipográfica', [['Segoe UI', 'Segoe UI · Power BI'], ['Arial', 'Arial · Universal'], ['Georgia', 'Georgia · Editorial']]) + range('valueSize', 'Tamaño del valor', 6, 140) + (adv ? range('titleSize', 'Tamaño del título', 6, 140) + select('fontWeight', 'Peso del valor', [[400, 'Regular'], [500, 'Medio'], [600, 'Semibold'], [700, 'Negrita'], [800, 'Extra bold']]) : '') + select('align', 'Alineación', [['left', 'Izquierda'], ['center', 'Centrada']]), false);
    if (elementAvailable(c, 'trend')) h += section('05', 'Gráfico', check('showTrend', 'Mostrar gráfico') + (c.showTrend ? chartPanel() : '') + duplicateContentFields(['trend']), false);
  } else {
    h += '<div class="data-notice">' + icon('info', 17) + '<p><strong>Vinculación con Power BI.</strong>Mapea las medidas y el calendario de tu modelo con los elementos visuales.</p></div>';
    h += section('01', 'Datos del modelo', dataSummaryCard() + btn('open-data-modal', 'Gestionar vinculación de datos', 'sliders', 'button primary full-width'));
    if (pro) h += section('02', 'Formato regional', select('locale', 'Formato de números', [['es-ES', 'Español · 1.234,5'], ['en-US', 'English · 1,234.5'], ['ca-ES', 'Català · 1.234,5']]), false);
    h += section('03', 'Datos de la vista previa', '<p class="field-help">Solo cambian la demostración visual. No se exportan al DAX.</p>' + field('sampleValue', 'Valor de ejemplo', 'number') + field('samplePrevious', 'Referencia de ejemplo', 'number') + field('sampleTarget', 'Objetivo de ejemplo', 'number') + (pro ? field('sampleSeries', 'Serie de ejemplo', 'textarea', { help: 'Valores separados por comas. Usa punto para decimales.' }) : '') + select('sampleScenario', 'Escenario', [['normal', 'Valores normales'], ['zero', 'Valor cero'], ['empty', 'Sin datos · BLANK'], ['negative', 'Valor negativo']]), false);
  }

  h += `<div class="level-hint">${icon('sliders', 15)}${mode === 'essential' ? 'Modo Esencial: configuración ágil y directa. Cambia a Avanzado para el control total al píxel.' : 'Modo Avanzado: estás al mando de cada detalle visual, tipográfico y de formato.'}</div>`;

  const panel = $('#inspector-fields');
  if (panel) {
    panel.innerHTML = h;
    panel.dataset.panelTab = tab;
    const positions = getActiveContext().inspectorPositions || inspectorPositions;
    panel.scrollTop = positions.get(tab) ?? 0;
    if (remembered?.focus && remembered.tab === tab) {
      const node = document.getElementById(remembered.focus);
      if (node) {
        node.focus({ preventScroll: true });
        if (remembered.selection && node.setSelectionRange) {
          try { node.setSelectionRange(...remembered.selection); } catch {}
        }
      }
    }
  }

  updateInspectorTabs();
  renderStatus();
}

export function renderStatus() {
  const node = $('#inspector-status');
  if (node) node.innerHTML = '';
}

export function updateHistoryButtons() {
  const app = $('#app');
  const u = app?.querySelector('[data-action="undo"]');
  const r = app?.querySelector('[data-action="redo"]');
  const undo = getUndo();
  const redo = getRedo();
  if (u) u.disabled = !undo.length;
  if (r) r.disabled = !redo.length;
}

export function syncElementControls() {
  const selectedElement = getSelectedElement();
  const id = selectedElement;
  if (!id) return;
  const c = getC();
  const p = elementState(c, id);
  const def = resolveElementDef(id) || ELEMENTS[id];
  const key = def?.sizeKey;
  const app = $('#app');

  app?.querySelectorAll('[data-elprop]').forEach(input => {
    if (document.activeElement !== input) input.value = p[input.dataset.elprop];
  });

  if (key) {
    app?.querySelectorAll(`[data-key="${key}"]`).forEach(input => {
      if (document.activeElement !== input) {
        input.value = c[key];
        const output = input.parentElement?.querySelector('output');
        if (output) output.textContent = c[key] + 'px';
      }
    });
  }

  app?.querySelectorAll(`[data-dupsize="${id}"]`).forEach(input => {
    if (document.activeElement !== input) {
      input.value = elementSize(c, id);
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = elementSize(c, id) + 'px';
    }
  });
}

export function syncCardControls() {
  const c = getC();
  const app = $('#app');
  for (const key of ['width', 'height']) {
    app?.querySelectorAll(`[data-key="${key}"]`).forEach(input => {
      if (document.activeElement !== input) input.value = c[key];
    });
  }
  const node = $('#dimensions');
  if (node) node.innerHTML = `${icon('square', 13)} ${c.width} × ${c.height} px`;
}

export function commitNumber(input) {
  const c = getC();
  const selectedElement = getSelectedElement();
  const key = input.dataset.key;
  const prop = input.dataset.elprop;
  const previous = key ? c[key] : elementState(c, selectedElement)[prop];

  if (input.value.trim() === '' || !Number.isFinite(Number(input.value))) {
    input.value = previous;
    return;
  }

  const value = Number(input.value);
  let next;
  if (key === 'width' || key === 'height') {
    next = resizeCard(c, key === 'width' ? value : c.width, key === 'height' ? value : c.height);
  } else if (key) {
    next = { ...c, [key]: value };
  } else {
    const state = elementState(c, selectedElement);
    next = ['x', 'y'].includes(prop)
      ? moveElement(c, selectedElement, prop === 'x' ? value - state.x : 0, prop === 'y' ? value - state.y : 0, 1, callMeasureElementFrame(selectedElement))
      : updateElement(c, selectedElement, { [prop]: value });
  }

  const safe = sanitizeConfig(next);
  const resolved = key ? safe[key] : elementState(safe, selectedElement)[prop];

  if (JSON.stringify(safe) !== JSON.stringify(c)) {
    record();
    setC(safe);
    persist();
    callRefreshCard();
    syncCardControls();
    updateHistoryButtons();
  }

  input.value = resolved;
  if (resolved !== value) toast(`Valor ajustado a ${resolved} px, dentro del rango permitido.`);
}
