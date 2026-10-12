import { icon, esc, cardHTML } from './cards.mjs';
import { checks, isValidMeasureName, getCircularConflict, needsDate, needsGoal, needsMainGoal, needsCompare, sanitizeConfig } from './model.mjs';
import { resolveElementDef, elementState, updateElement, usesValueBinding,activeDuplicateIds,usesGoalBinding,goalBinding,requiresOwnValueBinding } from './elements.mjs';
import { reviewMeasure, measureDestination } from './preflight.mjs';
import { directBindingFields, directBindingElements, bindingRevealOffset } from './bindings.mjs';
import { btn, getC, setC, persist, recordEdit, getPbipModel, getFriendlyReportName, getActiveContext, getLastPbiSyncTime, formatSyncTimestamp } from './state.mjs';
import { openModal } from './modals.mjs';
const callRefreshCard = () => getActiveContext().refreshCard?.();
const callRenderStatus = () => getActiveContext().renderStatus?.();

export const FIELD_TO_ELEMENTS = {
  measure: ['value'],
  measureName: ['title'],
  dateTable: ['period', 'trend'],
  dateColumn: ['period', 'trend'],
  targetMeasure: ['goalLabel', 'progressLabel', 'progress'],
  compareMeasure: ['delta', 'referenceValue']
};

export const ELEMENT_TO_FIELD = {
  value: 'measure',
  title: 'measureName',
  period: 'dateColumn',
  trend: 'dateTable',
  goalLabel: 'targetMeasure',
  progressLabel: 'targetMeasure',
  progress: 'targetMeasure',
  delta: 'compareMeasure',
  referenceValue: 'compareMeasure'
};

export function getBindingElements(key) {
  return directBindingElements(getC(), key);
}

export function getBindingFieldsForElement(id) {
  const available = new Set(Array.from(document.querySelectorAll('[data-binding-field]')).map(el => el.dataset.bindingField));
  return directBindingFields(getC(), id).filter(key => available.has(key));
}

let bindingHoverContext = null;
let bindingFocusContext = null;
let bindingRevealTimer;
let bindingRevealRevision = 0;
let bindingRevealSignature = '';

export function cancelBindingReveal() {
  clearTimeout(bindingRevealTimer);
  bindingRevealRevision++;
  bindingRevealSignature = '';
}

// Hover never transfers focus, and moving through child nodes does not restart it.
export function revealBindingFields(keys, elementId) {
  const fields = Array.from(document.querySelectorAll('[data-binding-field]'));
  const ownKeys = keys.filter(key => key === elementId || key.startsWith(elementId + '__'));
  const targets = (ownKeys.length ? ownKeys : keys).map(key => fields.find(el => el.dataset.bindingField === key)).filter(Boolean);
  if (!targets.length) return;
  const column = targets[0].closest('.binding-fields-column');
  const body = targets[0].closest('.modal-body');
  const scroller = column?.scrollHeight > column?.clientHeight + 1 ? column : body;
  if (!scroller?.getBoundingClientRect || scroller.scrollHeight <= scroller.clientHeight + 1) return;
  const rect = scroller.getBoundingClientRect();
  const bodyRect = body?.getBoundingClientRect() || rect;
  const viewport = { top: Math.max(rect.top, bodyRect.top), bottom: Math.min(rect.bottom, bodyRect.bottom) };
  const bounds = targets.map(el => el.getBoundingClientRect());
  let group = { top: Math.min(...bounds.map(b => b.top)), bottom: Math.max(...bounds.map(b => b.bottom)) };
  if (group.bottom - group.top > viewport.bottom - viewport.top - 20) {
    group = bounds.find(b => b.top < viewport.top + 10 || b.bottom > viewport.bottom - 10) || bounds[0];
  }
  const start = scroller.scrollTop;
  const end = bindingRevealOffset(group, viewport, start, scroller.scrollHeight - scroller.clientHeight);
  if (Math.abs(end - start) < 1) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof requestAnimationFrame !== 'function') {
    scroller.scrollTop = end;
    return;
  }
  const revision = bindingRevealRevision;
  let began;
  const step = now => {
    if (revision !== bindingRevealRevision || !scroller.isConnected) return;
    began ??= now;
    const t = Math.min(1, (now - began) / 180);
    scroller.scrollTop = start + (end - start) * (1 - (1 - t) ** 3);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderBindingHighlight() {
  const context = bindingHoverContext ?? bindingFocusContext;
  const activeKeys = context?.element ? getBindingFieldsForElement(context.element) : context?.keys || [];
  // Visual → fields keeps that visual alone; field → visuals uses direct links.
  const activeElements = new Set(context?.element ? activeKeys.length ? [context.element] : [] : activeKeys.flatMap(getBindingElements));
  document.querySelectorAll('#binding-card-inner [data-element]').forEach(el => {
    el.classList.toggle('binding-highlight', activeElements.has(el.dataset.element));
  });
  document.querySelectorAll('[data-binding-field]').forEach(el => {
    el.classList.toggle('is-binding-highlight', activeKeys.includes(el.dataset.bindingField));
  });
}

export function highlightBindingContext(context, source = 'hover') {
  if (source === 'focus') bindingFocusContext = context;
  else {
    bindingHoverContext = context;
    const signature = context?.element ? context.element + ':' + context.keys.join('|') : '';
    if (signature !== bindingRevealSignature) {
      cancelBindingReveal();
      bindingRevealSignature = signature;
      if (signature && context.keys.length) {
        const revision = bindingRevealRevision;
        bindingRevealTimer = setTimeout(() => {
          if (revision === bindingRevealRevision) revealBindingFields(getBindingFieldsForElement(context.element), context.element);
        }, 90);
      }
    }
  }
  renderBindingHighlight();
}

export function highlightBindingElements(key, active) {
  highlightBindingContext(active ? { keys: [key] } : null, 'focus');
}

export function updateBindingFieldStatus(key, review = reviewMeasure(getC(), getPbipModel())) {
  const c = getC();
  const circ = key === 'measureName' ? getCircularConflict(c) : null;
  const result = review.fields[key];
  const isErr = result?.status === 'error';
  const unverified = result?.status === 'unknown';
  const wrap = document.querySelector(`[data-binding-field="${key}"] .binding-input-wrap`);
  const iconEl = document.getElementById(`status-icon-${key}`);
  const helpEl = document.getElementById(`help-${key}`);
  if (wrap) {
    wrap.classList.toggle('is-invalid', isErr);
    wrap.classList.toggle('is-unverified', unverified);
  }
  document.getElementById(`f-bind-${key}`)?.setAttribute('aria-invalid', String(isErr));
  if (iconEl) {
    iconEl.className = 'binding-input-status ' + (isErr ? 'invalid' : unverified ? 'unverified' : result ? 'valid' : 'optional');
    iconEl.innerHTML = icon(isErr ? 'close' : unverified || !result ? 'info' : 'check', 14);
  }
  if (helpEl) {
    helpEl.classList.toggle('error', isErr);
    if (circ) {
      helpEl.textContent = `⚠️ No puede coincidir con ${circ.type} (dependencia circular)`;
      helpEl.style.display = '';
      helpEl.classList.remove('is-hidden');
    } else if (isErr) {
      helpEl.textContent = key === 'measureName' ? 'Introduce un nombre de medida DAX válido.' : result.empty ? 'Este campo es obligatorio. Selecciona una referencia propia.' : 'No se encuentra en el modelo conectado.';
      helpEl.style.display = '';
      helpEl.classList.remove('is-hidden');
    } else if (unverified) {
      helpEl.textContent = 'Sin comprobar: conecta el modelo para validar esta referencia.';
      helpEl.style.display = '';
      helpEl.classList.remove('is-hidden');
    } else {
      const defHelp = helpEl.dataset.defaultHelp || '';
      if (defHelp) {
        helpEl.textContent = defHelp;
        helpEl.style.display = '';
        helpEl.classList.remove('is-hidden');
      } else {
        helpEl.textContent = '';
        helpEl.style.display = 'none';
        helpEl.classList.add('is-hidden');
      }
    }
  }
}

export function updateBindingModalStatus() {
  const statusEl = document.getElementById('binding-modal-status');
  if (!statusEl) return;
  const review = reviewMeasure(getC(), getPbipModel());
  document.querySelectorAll('[data-binding-field]').forEach(el => updateBindingFieldStatus(el.dataset.bindingField, review));
  const destination = measureDestination(getC(), getPbipModel());
  const destinationInput = /** @type {HTMLInputElement} */ (document.getElementById('f-bind-targetTable'));
  const destinationHelp = document.getElementById('help-targetTable');
  if (destinationInput) {
    destinationInput.disabled = false;
    destinationInput.readOnly = Boolean(destination.existing);
    destinationInput.value = destination.existing ? destination.table : getC().targetTable;
    destinationInput.placeholder = destination.automatic && destination.table ? `Automática: ${destination.table}` : 'Automática';
    destinationInput.setAttribute('aria-invalid', String(Boolean(destination.error)));
    destinationInput.closest('[data-binding-field]')?.querySelectorAll('button').forEach(button => { button.disabled = Boolean(destination.existing)&&button.classList.contains('binding-clear-btn'); });
  }
  if (destinationHelp) {
    destinationHelp.textContent = destination.error || (destination.existing ? `La medida existente se actualizará en ${destination.table}; su tabla se conserva.` : destination.automatic ? `Destino automático: ${destination.table || 'pendiente de conectar el modelo'}. Puedes elegir otra tabla.` : `Destino elegido: ${destination.table}. Se comprobará de nuevo antes de escribir.`);
    destinationHelp.classList.toggle('error', Boolean(destination.error));
    destinationHelp.classList.remove('is-hidden');
    destinationHelp.style.display = '';
  }
  const pending = new Set([...review.missing, ...review.unverified, ...review.issues.filter(x => x.level === 'error')].map(x => x.field || x.text)).size;
  statusEl.className = 'binding-status-bar ' + (review.missing.length || review.issues.some(x => x.level === 'error') ? 'has-error' : '');
  statusEl.innerHTML = `${icon(pending ? 'info' : 'check', 15)}<span>${pending ? `${pending} referencia${pending > 1 ? 's' : ''} pendiente${pending > 1 ? 's' : ''} de configurar o comprobar` : 'Referencias verificadas · Lista para generar DAX'}</span>`;
}

export function updateBindableElements() {
  const inner = document.getElementById('binding-card-inner');
  if (!inner) return;
  inner.querySelectorAll('[data-element]').forEach(el => {
    const id = el.dataset.element;
    const isBindable = getBindingFieldsForElement(id).length > 0;
    el.classList.toggle('is-bindable', isBindable);
    if (isBindable) {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `Configurar ${resolveElementDef(id)?.label || id}`);
    } else {
      el.classList.remove('binding-highlight');
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      el.removeAttribute('aria-label');
    }
  });
}

export function fitBindingCard() {
  updateBindableElements();
  renderBindingHighlight();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      const wrap = document.querySelector('.binding-card-wrap');
      const inner = document.getElementById('binding-card-inner');
      const c = getC();
      if (!wrap || !inner) return;
      const available = Math.max(220, wrap.clientWidth - 20);
      const factor = Math.min(1, available / c.width);
      inner.style.transform = `scale(${factor})`;
      if (inner.firstElementChild) wrap.style.height = (inner.firstElementChild.offsetHeight * factor + 24) + 'px';
      updateBindableElements();
    });
  }
}

export function getBindingFieldOptions(key) {
  const pbipModel = getPbipModel();
  const c = getC();
  if (!pbipModel) return [];
  if (key === 'targetTable') {
    const destination=measureDestination(getC(),pbipModel);
    if(destination.existing)return [{value:destination.table,label:destination.table,desc:'Tabla actual · Se conserva al sobrescribir'}];
    return (pbipModel.tables || []).map(table => ({ value: table, label: table, desc: 'Tabla de destino' }));
  }

  if (key === 'dateTable') {
    return (pbipModel.dateTables || []).map(dt => {
      const dateCount = dt.dateColumns?.length || 0;
      const desc = dt.isMarkedDateTable ? '⭐ Fecha oficial' : dt.isLikelyCalendar ? 'Calendario sugerido' : `${dateCount} col${dateCount === 1 ? '' : 's'} fecha`;
      return {
        value: dt.name,
        label: dt.name,
        desc
      };
    });
  }
  if (key === 'dateColumn') {
    const targetDateTable = c.dateTable;
    const curDt = (pbipModel.dateTables || []).find(dt => dt.name.toLowerCase() === (targetDateTable || '').trim().toLowerCase());
    const candidateDateCols = curDt ? curDt.dateColumns : Array.from(new Set((pbipModel.dateTables || []).flatMap(dt => dt.dateColumns)));
    return candidateDateCols.map(col => {
      const isKey = curDt && curDt.primaryDateColumn === col;
      return {
        value: col,
        label: col,
        desc: isKey ? '⭐ Columna clave (isKey)' : curDt ? curDt.name : 'Columna fecha'
      };
    });
  }
  if (['measure', 'targetMeasure', 'compareMeasure'].includes(key) || key.includes('_copy') || key.endsWith('__measure')) {
    return (pbipModel.measures || []).map(m => ({ value: m.name, label: m.name, desc: m.table || 'Medida' }));
  }
  return [];
}

export function renderBindingDropdown(key, filterText = '') {
  const options = getBindingFieldOptions(key);
  const [dupId, subProp] = key.includes('__') ? key.split('__') : [key, null];
  const def = resolveElementDef(dupId);
  const c = getC();
  let currentVal = '';

  if (subProp) {
    currentVal = (elementState(c, dupId)[subProp] || '').trim().toLowerCase();
  } else if (def?.isDuplicate) {
    const st = elementState(c, dupId);
    const prop = def.baseId === 'delta' ? (st.comparison || c.comparison) === 'target' ? 'targetMeasure' : 'compareMeasure' : ['goalLabel', 'progressLabel', 'progress'].includes(def.baseId) ? 'targetMeasure' : 'measure';
    currentVal = (st[prop] || '').trim().toLowerCase();
  } else {
    currentVal = (c[key] || '').trim().toLowerCase();
  }

  const q = (filterText || '').trim().toLowerCase();
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q) || o.desc.toLowerCase().includes(q)) : options;
  if (!filtered.length) {
    return `<div class="binding-dropdown-empty">No se encontraron opciones${filterText ? ` para "${esc(filterText)}"` : ''}</div>`;
  }
  // Keep large semantic models responsive; search still covers the full catalog.
  const visible = filtered.slice(0, 100);
  const hasExactSelected = visible.some(o => o.value.toLowerCase() === currentVal);
  return visible.map((opt, idx) => {
    const isSelected = hasExactSelected ? (opt.value.toLowerCase() === currentVal) : (idx === 0 && Boolean(q));
    return `<button type="button" role="option" tabindex="-1" id="binding-option-${key}-${idx}" aria-selected="${isSelected}" class="binding-dropdown-item ${isSelected ? 'is-selected' : ''}" data-action="select-binding-item" data-field="${key}" data-value="${esc(opt.value)}">
      <span class="binding-dropdown-label">${esc(opt.label)}</span>
      <span class="binding-dropdown-meta">${esc(opt.desc)}</span>
    </button>`;
  }).join('') + (filtered.length > visible.length ? `<div class="binding-dropdown-empty">${filtered.length} coincidencias · Escribe para afinar la búsqueda.</div>` : '');
}

export function closeAllBindingDropdowns() {
  document.querySelectorAll('.binding-dropdown-menu.is-open').forEach(menu => {
    menu.classList.remove('is-open');
    const toggle = menu.parentElement?.querySelector('.binding-dropdown-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.classList.remove('is-open');
    }
    const input = menu.parentElement?.querySelector('.binding-input');
    input?.setAttribute('aria-expanded', 'false');
    input?.removeAttribute('aria-activedescendant');
  });
}

export function selectBindingOption(menu, index) {
  const options = Array.from(menu.querySelectorAll('[role="option"]'));
  const active = options[index];
  options.forEach((option, position) => {
    option.classList.toggle('is-selected', position === index);
    option.setAttribute('aria-selected', String(position === index));
  });
  const input = menu.parentElement?.querySelector('.binding-input');
  if (active) {
    input?.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  } else input?.removeAttribute('aria-activedescendant');
}

export function openBindingDropdown(key, toggleOpen = false, filterText = '') {
  const menu = document.getElementById(`dropdown-menu-${key}`);
  if (!menu) return;
  if(document.getElementById(`f-bind-${key}`)?.disabled)return;
  const isOpen = menu.classList.contains('is-open');
  if (isOpen && !toggleOpen) return;
  closeAllBindingDropdowns();
  if (isOpen) return;
  menu.innerHTML = renderBindingDropdown(key, filterText);
  menu.classList.add('is-open');
  const toggle = menu.parentElement?.querySelector('.binding-dropdown-toggle');
  toggle?.setAttribute('aria-expanded', 'true');
  toggle?.classList.add('is-open');
  const input = menu.parentElement?.querySelector('.binding-input');
  input?.setAttribute('aria-expanded', 'true');
  const items = Array.from(menu.querySelectorAll('[role="option"]'));
  selectBindingOption(menu, items.findIndex(item => item.getAttribute('aria-selected') === 'true'));
  if (toggleOpen) input?.focus();
}

export function applyBindingFieldValue(key, val) {
  const before = getC();
  if(key==='targetTable'&&measureDestination(before,getPbipModel()).existing)return;
  let c = structuredClone(before);
  if (key.includes('__')) {
    const [dupId, prop] = key.split('__');
    c = updateElement(c, dupId, { [prop]: val });
  } else if (key.includes('_copy')) {
    const def = resolveElementDef(key);
    const prop = def?.baseId === 'delta' ? (elementState(c, key).comparison || c.comparison) === 'target' ? 'targetMeasure' : 'compareMeasure' : ['goalLabel', 'progressLabel', 'progress'].includes(def?.baseId) ? 'targetMeasure' : 'measure';
    c = updateElement(c, key, { [prop]: val });
  } else {
    if (key === 'targetMeasure') c._targetCustomized = true;
    if (key === 'dateTable' || key === 'dateColumn') c._dateCustomized = true;
    if (key === 'measure') c._measureBound = Boolean(val.trim());
    c = sanitizeConfig({ ...c, [key]: val,...(key==='measureName'?{title:val}:{}) });
  }
  if (JSON.stringify(c) !== JSON.stringify(before)) {
    recordEdit('binding:' + key);
    setC(c);
    persist();
  }

  const input = document.getElementById(`f-bind-${key}`);
  if (input) input.value = val;
  const clearBtn = document.querySelector(`[data-action="clear-bind-field"][data-field="${key}"]`);
  if (clearBtn) clearBtn.classList.toggle('is-visible', Boolean(val));
  const clearDupBtn = document.querySelector(`[data-action="clear-bind-dup"][data-dup="${key}"]`);
  if (clearDupBtn) clearDupBtn.classList.toggle('is-visible', Boolean(val));

  const inner = document.getElementById('binding-card-inner');
  if (inner) {
    inner.innerHTML = cardHTML(c, undefined, true);
    fitBindingCard();
  }

  updateBindingModalStatus();
  callRefreshCard();
  if(key==='measureName')getActiveContext().renderInspector?.();
  callRenderStatus();
}

export function openDataBindingModal(focusKey = null) {
  bindingHoverContext = null;
  bindingFocusContext = null;
  cancelBindingReveal();
  let c = getC();
  const pbipModel = getPbipModel();
  const isLive = Boolean(pbipModel?.isLiveConnection);
  const roundtripMeasures = (pbipModel?.measures || []).filter(m => m.configAnnotation);
  const roundtripHTML = roundtripMeasures.length ? `
    <details class="binding-saved-subbar">
      <summary class="binding-saved-title">${icon('sparkles', 13)} <span>Tarjetas guardadas en tu modelo (${roundtripMeasures.length})</span>${icon('chevron', 12)}</summary>
      <div class="binding-saved-grid">
        ${roundtripMeasures.map(rm => `
          <div class="binding-saved-item">
            <span><strong>${esc(rm.name)}</strong> <small>(${esc(rm.table)})</small></span>
            <button type="button" class="binding-saved-btn" data-action="load-roundtrip-measure" data-measure="${esc(rm.name)}">Cargar en lienzo</button>
          </div>`).join('')}
      </div>
    </details>` : '';

  const pbipCardHTML = `
  <div class="binding-model-card ${pbipModel ? 'is-connected' + (isLive ? ' is-live' : '') : ''}">
    <div class="pbip-bar ${pbipModel ? 'is-connected' + (isLive ? ' is-live' : '') : ''}">
      <div class="pbip-bar-info">
        ${pbipModel ? (
          isLive ? `
            <span class="pbip-badge connected-live">⚡ En Vivo</span>
            <div class="pbip-bar-text">
              <div class="pbip-bar-title">${esc(getFriendlyReportName(pbipModel))}</div>
              <div class="pbip-bar-subtitle">${pbipModel.measures.length} medidas vinculables · ${pbipModel.dateTables.length} tablas con fecha</div>
            </div>
          ` : `
            <span class="pbip-badge connected">${icon('check', 11)} Conectado</span>
            <div class="pbip-bar-text">
              <div class="pbip-bar-title">${esc(getFriendlyReportName(pbipModel))}</div>
              <div class="pbip-bar-subtitle">${pbipModel.measures.length} medidas detectadas · ${pbipModel.dateTables.length} tablas con fecha</div>
            </div>
          `
        ) : `
          <span class="pbip-badge not-connected">${icon('database', 11)} Sin vincular</span>
          <div class="pbip-bar-text">
            <div class="pbip-bar-title">Conectar modelo de Power BI</div>
            <div class="pbip-bar-subtitle">Power BI Desktop abierto (localhost) o carpeta de proyecto PBIP.</div>
          </div>
        `}
      </div>
      <div class="pbip-actions">
        <button type="button" class="pbip-btn ${isLive ? 'secondary' : 'primary'}" data-action="${isLive ? 'refresh-live-pbi' : 'connect-live-pbi'}" title="${isLive ? 'Recargar modelo desde Power BI Desktop' : 'Detectar y conectar con Power BI Desktop abierto en localhost'}">
          ${icon('sparkles', 13)} ${isLive ? 'Recargar Desktop' : 'Power BI (localhost)'}
        </button>
        ${isLive ? `<button type="button" class="pbip-btn secondary" data-action="connect-live-pbi" title="Buscar o alternar informes abiertos en Power BI Desktop">${icon('sparkles', 13)} Cambiar informe…</button>` : ''}
        <button type="button" class="pbip-btn secondary" data-action="connect-pbip" title="Seleccionar carpeta local PBIP / Fabric">
          ${icon('folder', 13)} ${pbipModel && !isLive ? 'Cambiar PBIP…' : 'Carpeta PBIP…'}
        </button>
        ${pbipModel ? `<button type="button" class="pbip-btn danger" data-action="disconnect-pbip" title="Desconectar modelo actual">${icon('close', 13)} Desconectar</button>` : ''}
      </div>
    </div>
    ${roundtripHTML}
  </div>`;

  const fieldMarkup = (key, label, iconChar, helpText, badgeText, configuredValue = undefined) => {
    const val = configuredValue ?? c[key] ?? '';
    const isErr = Boolean(
      (key === 'measure' && !c.measure.trim()) ||
      (key === 'measureName' && !isValidMeasureName(c.measureName)) ||
      (key === 'dateTable' && needsDate(c) && !c.dateTable.trim()) ||
      (key === 'dateColumn' && needsDate(c) && !c.dateColumn.trim()) ||
      (key === 'targetMeasure' && (needsGoal(c) || (needsCompare(c) && c.comparison === 'target')) && !c.targetMeasure.trim()) ||
      (key === 'compareMeasure' && needsCompare(c) && c.comparison === 'custom' && !c.compareMeasure.trim())
    );
    const statusIcon = isErr ? icon('close', 14) : val ? icon('check', 14) : icon('info', 13);
    const statusCl = isErr ? 'invalid' : val ? 'valid' : 'optional';
    const hasDropdown = Boolean(pbipModel && (['measure', 'targetMeasure', 'compareMeasure', 'dateTable', 'dateColumn', 'targetTable'].includes(key)||key.endsWith('__targetMeasure')));
    const markedTable = (pbipModel?.dateTables || []).find(dt => dt.isMarkedDateTable);
    const defaultTable = markedTable || (pbipModel?.dateTables || [])[0];
    const ph = key === 'measure' ? (pbipModel?.measures?.[0]?.name || 'Total Ventas') :
      key === 'dateTable' ? (defaultTable?.name || 'Calendario') :
      key === 'dateColumn' ? (defaultTable?.primaryDateColumn || defaultTable?.dateColumns?.[0] || 'Fecha') :
      key === 'measureName' ? 'MiMedidaDAX' :
      key === 'targetMeasure'||key.endsWith('__targetMeasure') ? 'Medida o número (ej. 0)' :
      'Valor';
    const curDt = (pbipModel?.dateTables || []).find(dt => dt.name.toLowerCase() === (c.dateTable || '').trim().toLowerCase());
    const quickBadge = pbipModel && (key === 'measure' || key === 'dateTable' || key === 'dateColumn') ?
      `<span class="pbip-quick-chip" title="Autocompletado activo">${
        key === 'measure' ? `${pbipModel.measures.length} medidas` :
        key === 'dateTable' ? (markedTable ? '⭐ Oficial' : `${pbipModel.dateTables.length} tablas fecha`) :
        (curDt?.primaryDateColumn ? '⭐ isKey' : 'auto')
      }</span>` : '';

    return `<div class="binding-field" data-binding-field="${key}">
      <label class="binding-field-label" for="f-bind-${key}">
        <span>${label}</span>
        <div class="binding-badges-wrap">
          ${quickBadge}
          ${badgeText ? `<span class="target-element-badge">${badgeText}</span>` : ''}
        </div>
      </label>
      <div class="binding-dropdown-wrap ${hasDropdown ? 'has-dropdown' : ''}">
        <div class="binding-input-wrap ${isErr ? 'is-invalid' : ''}">
          <span class="binding-input-icon">${iconChar}</span>
          <input id="f-bind-${key}" class="binding-input" data-bind-key="${key}" aria-describedby="help-${key}" ${hasDropdown ? `role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="dropdown-menu-${key}" aria-expanded="false"` : ''} type="text" value="${esc(val)}" placeholder="Ejemplo: ${esc(ph)}" spellcheck="false" autocomplete="off">
          <button type="button" class="binding-clear-btn ${val ? 'is-visible' : ''}" data-action="clear-bind-field" data-field="${key}" title="Borrar selección" aria-label="Borrar selección">${icon('eraser', 13)}</button>
          ${hasDropdown ? `<button type="button" class="binding-dropdown-toggle" data-action="toggle-bind-dropdown" data-field="${key}" title="Ver todas las opciones" aria-label="Ver todas las opciones" aria-expanded="false">${icon('chevronDown', 12)}</button>` : ''}
          <span class="binding-input-status ${statusCl}" id="status-icon-${key}">${statusIcon}</span>
        </div>
        ${hasDropdown ? `<div class="binding-dropdown-menu" id="dropdown-menu-${key}" role="listbox" aria-label="Opciones para ${esc(label)}"></div>` : ''}
      </div>
      <small class="binding-field-help ${isErr ? 'error' : ''} ${helpText || isErr ? '' : 'is-hidden'}" id="help-${key}" data-default-help="${esc(helpText || '')}" ${helpText || isErr ? '' : 'style="display:none;"'}>${isErr ? 'Este campo es obligatorio para la tarjeta actual' : (helpText || '')}</small>
    </div>`;
  };

  const nameInvalid = !isValidMeasureName(c.measureName);
  const nameHTML = `<div class="binding-measure-heading" data-binding-field="measureName">
    <label for="f-bind-measureName">Nombre de la medida DAX resultante</label>
    <div class="binding-input-wrap binding-name-input-wrap ${nameInvalid ? 'is-invalid' : ''}">
      <input id="f-bind-measureName" class="binding-input" data-bind-key="measureName" type="text" value="${esc(c.measureName)}" placeholder="MiMedidaDAX" spellcheck="false" autocomplete="off" aria-describedby="help-measureName">
      <button type="button" class="binding-clear-btn ${c.measureName ? 'is-visible' : ''}" data-action="clear-bind-field" data-field="measureName" title="Borrar nombre" aria-label="Borrar nombre">${icon('eraser', 13)}</button>
      <span class="binding-input-status ${nameInvalid ? 'invalid' : 'valid'}" id="status-icon-measureName">${icon(nameInvalid ? 'close' : 'check', 14)}</span>
    </div>
    <small class="binding-field-help ${nameInvalid ? 'error' : 'is-hidden'}" id="help-measureName" data-default-help="" ${nameInvalid ? '' : 'style="display:none;"'}>${nameInvalid ? 'Introduce un nombre válido para la medida' : ''}</small>
  </div>`;
  let fieldsHTML = `<div class="binding-fields-column">${nameHTML}${fieldMarkup('targetTable', 'Tabla de destino de la medida', '田', 'Opcional: si la dejas vacía se propondrá una tabla en la revisión antes de crear la medida.', 'Destino')}<div class="binding-fields-card">`;
  fieldsHTML += `
    <div class="binding-section-head"><span>fx</span>Medida principal<small>Obligatorio</small></div>
    ${fieldMarkup('measure', 'Medida de negocio (existente)', 'fx', '', 'Valor principal')}`;

  if (needsDate(c)) {
    fieldsHTML += `
      <div class="binding-section-divider"></div>
      <div class="binding-section-head"><span>📅</span>Calendario compartido<small>Todos los gráficos y comparativas temporales</small></div>
      ${fieldMarkup('dateTable', 'Tabla de fechas / Calendario', '田', '', 'Evolución')}
      ${fieldMarkup('dateColumn', 'Columna de fecha única', '▦', '', 'Período')}
      <div class="field" data-binding-field="granularity"><label for="f-bind-granularity">Granularidad de tendencia</label><select id="f-bind-granularity" data-key="granularity"><option value="auto" ${c.granularity === 'auto' ? 'selected' : ''}>Automática</option><option value="day" ${c.granularity === 'day' ? 'selected' : ''}>Diaria</option><option value="week" ${c.granularity === 'week' ? 'selected' : ''}>Semanal</option><option value="month" ${c.granularity === 'month' ? 'selected' : ''}>Mensual</option></select><small>Auto: ≤24 días → diaria; ≤161 → semanal; resto → mensual.</small></div>`;
  }

  if (needsMainGoal(c)) {
    fieldsHTML += `
      <div class="binding-section-divider"></div>
      <div class="binding-section-head"><span>🎯</span>Objetivo principal<small>Avance y comparativas de objetivo</small></div>
      ${fieldMarkup('targetMeasure', 'Medida de objetivo', 'fx', '', 'Progreso')}`;
  }

  if (needsCompare(c) && c.comparison === 'custom') {
    fieldsHTML += `
      <div class="binding-section-divider"></div>
      <div class="binding-section-head"><span>↔</span>Comparativa personalizada<small>Requerido</small></div>
      ${fieldMarkup('compareMeasure', 'Medida de comparación', 'fx', '', 'Variación')}`;
  }

  const boundCopies=activeDuplicateIds(c);
  if(boundCopies.some(id=>usesValueBinding(c,id)))fieldsHTML+=`<p class="binding-calendar-note">Los elementos vinculados usan el valor de su misma copia cuando existe. Sin ese valor, configura su medida independiente. Los gráficos comparten el calendario y cada grupo de copia comparte su objetivo.</p>`;
  const activeDupIds = boundCopies.filter(id => {
    const def = resolveElementDef(id);
    const st = elementState(c, id);
    if (!def?.isDuplicate || st.deleted) return false;
    if (['value', 'referenceValue'].includes(def.baseId)) return true;
    if(requiresOwnValueBinding(c,id))return true;
    if (def.baseId === 'delta') return (st.comparison || c.comparison) === 'custom';
    return false;
  });

  if (activeDupIds.length) {
    fieldsHTML += `
      <div class="binding-section-divider"></div>
      <div class="binding-section-head"><span>📑</span>Elementos duplicados vinculables<small>${activeDupIds.length} activo${activeDupIds.length > 1 ? 's' : ''}</small></div>`;
    if(activeDupIds.some(id=>resolveElementDef(id).baseId==='trend'&&(elementState(c,id).chartKind||c.chartKind)!=='donut')) fieldsHTML += `<p class="binding-calendar-note">Los gráficos duplicados usan la tabla y columna del calendario compartido.</p>`;
    for (const dupId of activeDupIds) {
      const def = resolveElementDef(dupId);
      const st = elementState(c, dupId);
      const dupEntries=[];
      if(['value','referenceValue'].includes(def.baseId)||requiresOwnValueBinding(c,dupId))dupEntries.push({prop:'measure',label:`Medida de ${def.label}`,ph:pbipModel?.measures?.[0]?.name||'Medida numérica',val:st.measure||'',iconChar:'fx',fieldKey:requiresOwnValueBinding(c,dupId)?`${dupId}__measure`:dupId});
      if(def.baseId==='delta'&&(st.comparison||c.comparison)==='custom')dupEntries.push({prop:'compareMeasure',label:`Comparación de ${def.label}`,ph:'Medida de comparación',val:st.compareMeasure||'',iconChar:'fx',fieldKey:dupId});
      for (const entry of dupEntries) {
        const hasDropdown = Boolean(pbipModel && ['measure', 'compareMeasure', 'targetMeasure', 'dateTable', 'dateColumn'].includes(entry.prop));
        const quickBadge = pbipModel && hasDropdown ? `<span class="pbip-quick-chip" title="Autocompletado activo">${['dateTable', 'dateColumn'].includes(entry.prop) ? (entry.prop === 'dateTable' ? 'Calendario' : 'Fecha') : `${pbipModel.measures.length} medidas`}</span>` : '';
        fieldsHTML += `
          <div class="binding-field" data-binding-field="${entry.fieldKey}">
            <label class="binding-field-label" for="f-bind-${entry.fieldKey}">
              <span>${entry.label}</span>
              <div class="binding-badges-wrap">
                ${quickBadge}
                <span class="target-element-badge">Copia independiente</span>
              </div>
            </label>
            <div class="binding-dropdown-wrap ${hasDropdown ? 'has-dropdown' : ''}">
              <div class="binding-input-wrap">
                <span class="binding-input-icon">${entry.iconChar}</span>
                <input id="f-bind-${entry.fieldKey}" class="binding-input" data-bind-dup="${dupId}" data-bind-dupprop="${entry.prop}" data-bind-field-key="${entry.fieldKey}" aria-describedby="help-${entry.fieldKey}" ${hasDropdown ? `role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="dropdown-menu-${entry.fieldKey}" aria-expanded="false"` : ''} type="text" value="${esc(entry.val)}" placeholder="Ejemplo: ${esc(entry.ph)}" spellcheck="false" autocomplete="off">
                <button type="button" class="binding-clear-btn ${entry.val ? 'is-visible' : ''}" data-action="clear-bind-dup" data-dup="${dupId}" data-prop="${entry.prop}" data-field="${entry.fieldKey}" title="Borrar selección" aria-label="Borrar selección">${icon('eraser', 13)}</button>
                ${hasDropdown ? `<button type="button" class="binding-dropdown-toggle" data-action="toggle-bind-dropdown" data-field="${entry.fieldKey}" title="Ver todas las opciones" aria-label="Ver todas las opciones" aria-expanded="false">${icon('chevronDown', 12)}</button>` : ''}
                <span class="binding-input-status" id="status-icon-${entry.fieldKey}">${icon('info', 13)}</span>
              </div>
              ${hasDropdown ? `<div class="binding-dropdown-menu" id="dropdown-menu-${entry.fieldKey}" role="listbox" aria-label="Opciones para ${esc(entry.label)}"></div>` : ''}
            </div>
            <small class="binding-field-help is-hidden" id="help-${entry.fieldKey}" data-default-help="" style="display:none;"></small>
          </div>`;
      }
    }
  }
  const goals=new Map();
  for(const id of boundCopies.filter(id=>usesGoalBinding(c,id))){const goal=goalBinding(c,id);goals.set(goal.field,{...goal,number:id.match(/_copy(\d+)$/)?.[1]});}
  if(goals.size){
    fieldsHTML+=`<div class="binding-section-divider"></div><div class="binding-section-head"><span>🎯</span>Objetivos de las copias<small>Uno por grupo</small></div>`;
    for(const goal of goals.values())fieldsHTML+=fieldMarkup(goal.field,`Medida de objetivo (Copia ${goal.number})`,'fx','Etiqueta, avance y comparativa de objetivo de esta copia.',`Copia ${goal.number}`,goal.measure);
  }
  fieldsHTML += `</div></div>`;

  const previewHTML = `<div class="binding-preview-column">
    <div class="binding-preview-header">
      <span>MAPEO VISUAL</span>
      <span class="binding-preview-badge">Tarjeta interactiva</span>
    </div>
    <div class="binding-card-wrap">
      <div class="binding-card-inner" id="binding-card-inner" style="width:${c.width}px">
        ${cardHTML(c, undefined, true)}
      </div>
    </div>
    <div class="binding-preview-hint">
      ${icon('cursor', 13)}
      <span>Sitúa el cursor sobre un elemento para ver sus campos vinculados. Haz clic para editarlos.</span>
    </div>
  </div>`;

  const body = `<div class="binding-modal-wrapper">${pbipCardHTML}<div class="binding-studio">${previewHTML}${fieldsHTML}</div></div>`;
  const errors = checks(c).filter(x => x.level === 'error');
  const statusHTML = `<div class="binding-status-bar ${errors.length ? 'has-error' : ''}" id="binding-modal-status">
    ${icon(errors.length ? 'info' : 'check', 15)}
    <span>${errors.length ? `${errors.length} campo${errors.length > 1 ? 's' : ''} pendiente${errors.length > 1 ? 's' : ''} de configurar` : 'Configuración completa · Lista para exportar DAX'}</span>
  </div>`;
  const actionsFooter = `<div class="binding-modal-actions">${btn('close-modal', 'Aceptar', 'check', 'button secondary')}${btn('export', 'Generar medida DAX', 'code', 'button primary', 'title="Exportar DAX"')}</div>`;

  const lastSync = getLastPbiSyncTime();
  const syncFormatted = lastSync ? formatSyncTimestamp(lastSync) : '';
  const syncSubtitle = syncFormatted ? `<span class="binding-sync-timestamp">${icon('refresh', 11)} Última sincronización: ${syncFormatted}</span>` : (pbipModel ? `<span class="binding-sync-timestamp">${icon('refresh', 11)} Conectado al modelo local</span>` : '<span class="binding-sync-timestamp">Sin sincronizar con Power BI</span>');
  openModal('Conectar datos del modelo', syncSubtitle, body, `${statusHTML}${actionsFooter}`, 'binding-modal');

  fitBindingCard();

  updateBindingModalStatus();

  if (focusKey) {
    const targetInput = document.getElementById(`f-bind-${focusKey}`);
    if (targetInput) setTimeout(() => { targetInput.focus(); if (targetInput.select) targetInput.select(); }, 50);
  }
}
