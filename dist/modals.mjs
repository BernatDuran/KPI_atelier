/**
 * KPI Atelier - Submódulo Modales y Asistentes de Configuración (dist/modals.mjs)
 * Gestiona los diálogos modales (HTML dialog lifecycle), Data Binding Studio,
 * Theme Studio con espacio de color HSV, Icon Picker vectorial y diálogos de exportación DAX.
 */

import { icon, esc, cardHTML } from './cards.mjs';
import {
  checks, isValidMeasureName, getCircularConflict, needsDate,
  needsTrend, needsGoal, needsCompare, THEMES, sanitizeConfig
} from './model.mjs';
import { resolveElementDef, elementState, updateElement } from './elements.mjs';
import { COLOR_ROLES, paletteFrom, hexToHSV, hsvToHex, contrastRatio } from './colors.mjs';
import { clamp } from './elements.mjs';
import { ICON_OPTIONS } from './icons.mjs';
import { generateDAX } from './dax.mjs';
import { fetchLivePbiModel } from './pbip.mjs';
import { reviewMeasure, measureDestination } from './preflight.mjs';
import { directBindingFields, directBindingElements, bindingRevealOffset } from './bindings.mjs';
import {
  $, btn, ib, getC, setC, persist, toast, getPbipModel, setPbipModel,
  getFriendlyReportName, customThemes, getPaletteDraft, setPaletteDraft,
  getColorRole, setColorRole, getColorHSV, setColorHSV,
  getColorPointer, setColorPointer, getActiveContext, setConfig,
  getLastPbiSyncTime, formatSyncTimestamp
} from './state.mjs';

let lastFocus = null;
let pendingInjectAction = null;
let modalDismiss = null;
let modalRevision = 0;
let pendingExportAction = null;
export function setPendingInjectAction(fn) { pendingInjectAction = fn; }
export function getPendingInjectAction() { return pendingInjectAction; }
export function clearPendingInjectAction() { pendingInjectAction = null; }

function callRefreshCard() {
  const ctx = getActiveContext();
  if (typeof ctx.refreshCard === 'function') ctx.refreshCard();
}
function callRenderStatus() {
  const ctx = getActiveContext();
  if (typeof ctx.renderStatus === 'function') ctx.renderStatus();
}
function callFitThumbs() {
  const ctx = getActiveContext();
  if (typeof ctx.fitThumbs === 'function') ctx.fitThumbs();
}

// ----------------------------------------------------
// Ciclo de Vida de Modales Genéricos
// ----------------------------------------------------
export function openModal(title, subtitle, body, footer = '', cl = '', onDismiss = null) {
  const modal = $('#modal');
  if (!modal) return;
  cancelBindingReveal();
  modalRevision++;
  modalDismiss = onDismiss;
  if (!modal.open) lastFocus = document.activeElement;
  modal.className = cl;
  modal.innerHTML = `<div class="modal-heading"><div><span class="overline">KPI ATELIER</span><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${ib('close-modal', 'Cerrar', 'close')}</div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}`;
  if (!modal.open) modal.showModal();
}

export function closeModal() {
  cancelBindingReveal();
  const returnTo = modalDismiss;
  modalDismiss = null;
  modalRevision++;
  const ctx = getActiveContext();
  ctx.pendingNavigation = null;
  const t = $('#toast');
  if (t && document.body?.appendChild && t.parentElement !== document.body) {
    document.body.appendChild(t);
  }
  const modal = $('#modal');
  if (modal?.close) modal.close();
  if (returnTo) { returnTo(); return; }
  lastFocus?.focus();
}

// ----------------------------------------------------
// Exportación y Validación
// ----------------------------------------------------
export const filename = () => getC().measureName.trim().replace(/[^\p{L}\p{N}_-]/gu, '_') || 'kpi-atelier';

export function requestExport(action, conf = getC()) {
  const review = reviewMeasure(conf, getPbipModel());
  const errors = review.issues.filter(x => x.level === 'error');
  if (!errors.length && !review.missing.length && !review.unverified.length) return action();
  const modal = $('#modal');
  const previous = modal?.open ? { html: modal.innerHTML, className: modal.className, dismiss: modalDismiss } : null;
  const restore = () => {
    pendingExportAction = null;
    if (!previous) return;
    modalRevision++;
    modal.className = previous.className;
    modal.innerHTML = previous.html;
    modalDismiss = previous.dismiss;
    if (!modal.open) modal.showModal();
  };
  pendingExportAction = action;
  const pending = review.references.filter(r => r.status === 'error' || r.status === 'unknown');
  openModal('Exportar con referencias pendientes', 'Revisa estos datos antes de descargar el archivo.',
    `<p class="export-warning-note">Hay campos vacíos, referencias no encontradas o datos sin comprobar. Puedes exportar igualmente; corrígelos antes de aplicar la medida en Power BI.</p>
    <div class="measure-review-references">${pending.map(r => `<div class="measure-review-reference ${r.status}"><div><span>${esc(r.label)}</span><strong>${esc(r.value)}</strong></div><span class="measure-review-ref-status">${r.empty ? 'Sin configurar' : r.status === 'error' ? 'No encontrada' : 'Sin comprobar'}</span></div>`).join('')}</div>
    ${errors.length ? `<div class="measure-review-issues">${errors.map(x => `<p class="error">${icon('info',12)}<span>${esc(x.text)}</span></p>`).join('')}</div>` : ''}`,
    btn('close-modal', 'Cancelar', null, 'button secondary') + btn('confirm-export-anyway', 'Exportar igualmente', 'download', 'button primary'),
    'export-warning-modal', restore);
}

export function confirmExport() {
  const action = pendingExportAction;
  if (!action) return;
  closeModal();
  return action();
}

export function download(name, text, type, conf = getC()) {
  return requestExport(() => downloadFile(name, text, type), conf);
}

function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Archivo preparado para descargar.');
}

export function downloadJSON(conf = getC(), name = filename()) {
  download(name + '.json', JSON.stringify({ schema: 'kpi-atelier', version: 1, config: conf }, null, 2), 'application/json', conf);
}

export function copyDax() {
  const c = structuredClone(getC());
  return requestExport(() => copyDaxText(c), c);
}

async function copyDaxText(c) {
  const dax = generateDAX(c, { allowIncomplete: true });
  try {
    await navigator.clipboard.writeText(dax);
    toast('DAX copiado. Ya puedes pegarlo en Power BI.');
  } catch {
    const t = document.createElement('textarea');
    t.value = dax;
    $('#modal')?.append(t);
    t.select();
    const ok = document.execCommand?.('copy');
    t.remove();
    toast(ok ? 'DAX copiado.' : 'No se pudo copiar. Descarga el archivo .dax.');
  }
}

export function exportModal() {
  const c = getC();
  const pbipModel = getPbipModel();
  const dax = generateDAX(c, { allowIncomplete: true });
  const isLive = Boolean(pbipModel?.isLiveConnection);
  const alreadyExists = isLive && Boolean(measureDestination(c, pbipModel).existing);
  const ready = reviewMeasure(c, pbipModel).valid;
  const bannerText = !ready ? 'Vista DAX · Hay referencias pendientes de configurar o comprobar' : isLive ? `Conectado a '${getFriendlyReportName(pbipModel)}' · Referencias verificadas` : 'Medida DAX lista · Compatible con HTML Content Secure en Power BI';
  const injectBtn = isLive ? `<button class="button primary btn-inject" data-action="inject-live-measure" ${ready ? '' : 'disabled title="Corrige las referencias pendientes en Conectar datos"'}>${icon('sparkles', 14)}<span>${alreadyExists ? 'Sobrescribir en Power BI' : 'Crear en Power BI'}</span></button>` : '';

  openModal(
    'Tu diseño. Tu medida DAX.',
    'Copia, pega y deja que tus datos hagan el resto.',
    `<div class="export-top-actions">${btn('open-data-modal', 'Conectar datos del modelo', 'chevronLeft', 'button quiet export-back')}${btn('pbi-infographic', '¿Cómo usar en Power BI?', 'book', 'button quiet btn-pbi-guide')}</div><div class="export-banner ${isLive ? 'is-live' : ''}">${icon(isLive ? 'sparkles' : 'code', 15)}<span>${esc(bannerText)}</span></div><div class="code-bar"><span>${icon('code', 15)} ${esc(c.measureName)}.dax</span><div class="code-bar-actions"><span>${dax.split('\n').length} líneas</span>${btn('copy-dax', 'Copiar DAX', 'copy', 'code-copy')}</div></div><pre class="dax-code" tabindex="0"><code>${esc(dax)}</code></pre><div class="export-notice">${icon('info', 16)}<p>${isLive ? 'Comprueba los datos y crea la medida en tu informe conectado. También puedes copiar el código o descargarlo.' : 'En Power BI Desktop, añade el visual HTML Content Secure y arrastra esta medida al campo de valores.'}</p></div>`,
    `<div class="export-other">${btn('download-json', 'Configuración JSON', 'download', 'button quiet export-download')}${btn('download-html', 'Vista HTML', 'download', 'button quiet export-download')}${btn('download-dax', '.dax', 'download', 'button quiet export-download', 'title="Descargar medida DAX"')}</div><div class="export-main">${btn('review-live-measure', 'Comprobar datos', 'check', 'button secondary')}${injectBtn}</div>`,
    'export-modal'
  );
}

function renderMeasureReview(c, model, connection, error = '') {
  const review = reviewMeasure(c, model);
  const isLive = Boolean(model?.isLiveConnection);
  const connected = connection === 'connected';
  const ready = connected && review.valid;
  const status = connection === 'loading' ? 'Comprobando conexión…' : connected ? 'Conexión verificada' :
    connection === 'error' ? 'Conexión no disponible' : model ? 'Modelo PBIP · Sin conexión en vivo' : 'Sin modelo conectado';
  const row = (label, value) => `<div class="measure-review-row"><dt>${label}</dt><dd>${esc(value || '—')}</dd></div>`;
  const labels = { ok: 'Encontrada', error: 'No encontrada', unknown: 'Sin comprobar', constant: 'Valor fijo' };
  const body = `<div class="measure-review-status ${connected ? 'is-connected' : connection === 'error' ? 'has-error' : ''}" role="status">${connection === 'loading' ? '<span class="loading-spinner"></span>' : icon(connected ? 'check' : 'info', 15)}<span>${status}</span></div>
    ${error ? `<p class="measure-review-error">${esc(error)}</p>` : ''}
    <section class="measure-review-section"><h3>Conexión</h3><dl>
      ${row('Informe', model ? getFriendlyReportName(model) : 'Sin vincular')}
      ${row('Modelo', model?.modelName)}
      ${row(isLive ? 'Servidor' : 'Origen', isLive ? model.server : model ? 'Carpeta PBIP' : 'Sin conexión')}
    </dl></section>
    <section class="measure-review-section"><h3>Medida y referencias</h3><dl>
      ${row('Nombre de la medida', c.measureName)}
      ${row('Acción', review.existing ? 'Sobrescribir medida existente' : 'Crear nueva medida')}
      ${row('Tabla de destino', model ? review.table : 'Se determinará al conectar')}
    </dl><div class="measure-review-references">${review.references.map(r => `<div class="measure-review-reference ${r.status}"><div><span>${esc(r.label)}</span><strong>${esc(r.value)}</strong>${r.table ? `<small>Tabla ${esc(r.table)}</small>` : ''}</div><span class="measure-review-ref-status">${icon(r.status === 'ok' || r.status === 'constant' ? 'check' : 'info', 12)}${r.empty ? 'Sin configurar' : labels[r.status]}</span></div>`).join('')}</div></section>
    <section class="measure-review-section"><h3>Tarjeta</h3><dl>${row('Título', c.title)}${row('Dimensiones', `${c.width} × ${c.height} px`)}</dl></section>
    ${review.issues.length ? `<div class="measure-review-issues">${review.issues.map(x => `<p class="${x.level}">${icon('info', 12)}<span>${esc(x.text)}</span></p>`).join('')}</div>` : ''}
    <p class="measure-review-note">Comprueba conexión, configuración y referencias. Los valores y las relaciones se validan al usar la medida en Power BI.</p>`;
  openModal('Comprobar antes de aplicar', 'Revisa el destino y los datos de tu tarjeta.', body,
    `<div class="measure-review-back">${btn('back-to-export', 'Volver al DAX', 'chevronLeft', 'button secondary')}${btn('open-data-modal', 'Editar datos', 'sliders', 'button quiet')}</div>${isLive ? btn('inject-live-measure', review.existing ? 'Sobrescribir en Power BI' : 'Crear en Power BI', 'sparkles', 'button primary btn-inject', ready ? '' : 'disabled') : ''}`,
    'measure-review-modal', exportModal);
  return modalRevision;
}

export async function openMeasureReviewModal() {
  const c = structuredClone(getC());
  const model = getPbipModel();
  const isLive = Boolean(model?.isLiveConnection && model.server);
  const revision = renderMeasureReview(c, model, isLive ? 'loading' : 'offline');
  if (!isLive) return;
  try {
    const catalog = await fetchLivePbiModel(model.server, model.database || '');
    if (model.database && catalog.database !== model.database) throw new Error('El modelo conectado ha cambiado. Vuelve a conectar el informe.');
    if (modalRevision !== revision || !$('#modal')?.open) return;
    setPbipModel(catalog, false);
    renderMeasureReview(c, catalog, 'connected');
  } catch (err) {
    if (modalRevision === revision && $('#modal')?.open) renderMeasureReview(c, model, 'error', err.message || 'No se pudo comprobar el modelo.');
  }
}

export function shortcutsModal() {
  const sections = [
    {
      title: 'Lienzo y Visualización',
      shortcuts: [
        { desc: 'Zoom óptimo a tarjeta', keys: 'Ctrl + 1' },
        { desc: 'Ajustar al 100% escala', keys: 'Ctrl + 0' },
        { desc: 'Colapsar barra lateral', keys: 'Ctrl + B' },
        { desc: 'Navegar elementos lienzo', keys: 'Tab / Shift+Tab' },
      ]
    },
    {
      title: 'Edición y Selección',
      shortcuts: [
        { desc: 'Mover elemento (1 px)', keys: 'Flechas' },
        { desc: 'Mover rápido (10 px)', keys: 'Shift + Flechas' },
        { desc: 'Ajustar tamaño', keys: '+ / −', hint: 'con elemento seleccionado' },
        { desc: 'Copiar / Pegar elemento', keys: 'Ctrl + C / V' },
        { desc: 'Eliminar elemento', keys: 'Supr / Backspace' },
        { desc: 'Deseleccionar / Cancelar', keys: 'Esc' },
      ]
    },
    {
      title: 'Historial y Productividad',
      shortcuts: [
        { desc: 'Deshacer última acción', keys: 'Ctrl + Z' },
        { desc: 'Rehacer acción', keys: 'Ctrl + Y' },
        { desc: 'Guardar diseño / DAX', keys: 'Ctrl + S' },
        { desc: 'Mostrar este menú', keys: '?' },
      ]
    }
  ];

  const formatSingleCombo = combo => {
    const trimmed = combo.trim();
    if (trimmed === '+') return '<kbd class="shortcut-key">+</kbd>';
    if (trimmed.includes('+')) {
      return trimmed.split('+').map(k => `<kbd class="shortcut-key">${k.trim()}</kbd>`).join('<span class="shortcut-plus">+</span>');
    }
    return `<kbd class="shortcut-key">${trimmed}</kbd>`;
  };

  const formatKeys = keys => {
    if (keys.includes(' / ')) {
      return keys.split(' / ').map(combo => formatSingleCombo(combo)).join('<span class="shortcut-slash">/</span>');
    }
    return formatSingleCombo(keys);
  };

  openModal(
    'Atajos de Teclado',
    'Accesos directos para agilizar tu flujo de trabajo en el lienzo y la aplicación:',
    `<div class="shortcuts-modal-content">
      <div class="shortcuts-sr-audit" style="display:none;" aria-hidden="true">
        <span>Lienzo y Visualización</span>
        <span>Edición y Selección</span>
        <span>Historial y Productividad</span>
      </div>
      <div class="shortcuts-clean-grid">
        ${sections.flatMap(sec => sec.shortcuts).map(s => `
          <div class="shortcut-clean-row" ${s.hint ? 'title="Selecciona un elemento en el lienzo y pulsa + para agrandarlo o − para reducirlo"' : ''}>
            <span class="shortcut-desc">${s.desc}${s.hint ? ` <small class="shortcut-hint">(${s.hint}: + agranda, − reduce)</small>` : ''}</span>
            <span class="shortcut-keys">${formatKeys(s.keys)}</span>
          </div>
        `).join('')}
      </div>
    </div>`,
    btn('close-modal', 'Entendido', null, 'button primary'),
    'shortcuts-modal'
  );
}

export function pbiInfographicModal() {
  const c = getC();
  openModal(
    '¿Cómo usar esta medida en Power BI?',
    'Guía paso a paso para renderizar tu tarjeta con fidelidad pixel-perfect en Power BI Desktop.',
    `<div class="pbi-infographic-container">
      <div class="pbi-infographic-step">
        <div class="step-badge">1</div>
        <div class="step-body">
          <div class="step-title">Obtén el visual HTML Content Secure</div>
          <p class="step-desc">En Power BI Desktop, haz clic en el menú <strong>(...)</strong> del panel de visualizaciones &gt; <em>Obtener más objetos visuales</em>. Busca <strong>HTML Content</strong> o <strong>HTML Content (lite)</strong> de <em>Daniel Marsh-Patrick</em> (visual certificado oficial y 100% gratuito).</p>
        </div>
      </div>
      <div class="pbi-infographic-step">
        <div class="step-badge">2</div>
        <div class="step-body">
          <div class="step-title">Crea la medida DAX en tu modelo</div>
          <p class="step-desc">Usa el botón <strong>Crear en Power BI</strong> (si estás conectado en vivo) o haz clic en <strong>Copiar DAX</strong> y crea una <em>Nueva medida</em> en tu tabla de medidas con el código generado.</p>
        </div>
      </div>
      <div class="pbi-infographic-step">
        <div class="step-badge">3</div>
        <div class="step-body">
          <div class="step-title">Asigna la medida al campo 'Values'</div>
          <p class="step-desc">Inserta el visual HTML Content en tu lienzo de informe y arrastra tu nueva medida <code>${esc(c.measureName)}</code> al campo <strong>Values</strong> (Valores). El diseño se renderizará de inmediato con datos en vivo.</p>
        </div>
      </div>
      <div class="pbi-infographic-step">
        <div class="step-badge">4</div>
        <div class="step-body">
          <div class="step-title">Ajuste de dimensiones exactas</div>
          <p class="step-desc">En el panel de formato del visual &gt; <em>General &gt; Propiedades</em>: establece el tamaño en exactamente <strong>${c.width} px</strong> de ancho por <strong>${c.height} px</strong> de alto, y en <em>Objeto visual &gt; Relleno</em> configura <strong>Padding: 0 px</strong> para eliminar márgenes residuales.</p>
        </div>
      </div>
    </div>`,
    `<div class="pbi-infographic-actions">
      ${btn('back-to-export', 'Volver a exportar DAX', 'arrow', 'button primary')}
    </div>`,
    'infographic-modal'
  );
}

export function validationModal() {
  const c = getC();
  openModal(
    'Revisión de tu tarjeta',
    'Un último vistazo antes de llevarla a Power BI.',
    `<div class="check-list">${checks(c).map(x => `<div class="check-item ${x.level}">${icon(x.level === 'error' ? 'close' : x.level === 'warning' ? 'info' : 'check', 17)}<span>${esc(x.text)}</span>${(x.level === 'error' || x.level === 'warning') && x.field ? `<button type="button" class="check-fix-btn" data-action="fix-check-issue" data-field="${esc(x.field)}" title="Ir a corregir este campo"><span>Corregir</span>${icon('arrow', 11)}</button>` : ''}</div>`).join('')}</div><div class="export-notice"><p>Esta revisión comprueba la configuración, no ejecuta consultas contra tu modelo.</p></div>`,
    btn('close-modal', 'Seguir editando', null, 'button primary')
  );
}

export function chooseLiveInstanceModal(instances) {
  const modal = $('#modal');
  const returnTo = modal?.className === 'binding-modal' ? openDataBindingModal :
    modal?.className === 'export-modal' ? exportModal : null;
  const rows = instances.map(inst => {
    const report = inst.reportName || inst.modelName || 'Power BI Desktop';
    return `<div class="pbi-instance-card">
      <div class="pbi-instance-info">
        <strong>📊 ${esc(report)}</strong>
      </div>
      <button type="button" class="button primary btn-select-instance" data-action="select-live-instance" data-server="${esc(inst.server)}" data-db="${esc(inst.database || '')}" data-report="${esc(report)}">
        ${icon('sparkles', 13)} Conectar informe
      </button>
    </div>`;
  }).join('');

  openModal(
    'Seleccionar informe de Power BI Desktop',
    `Se han detectado ${instances.length} informes abiertos en Power BI Desktop. Elige cuál vincular:`,
    `<div class="pbi-instances-list">${rows}</div>`,
    btn('close-modal', 'Cancelar', null, 'button secondary'),
    'instance-modal',
    returnTo
  );
}

export function showInjectConfirmModal(missingRefs, existingMeasure, onConfirm) {
  pendingInjectAction = onConfirm;
  const c = getC();
  let body = '';
  if (missingRefs && missingRefs.length > 0) {
    body += `
      <div class="inject-confirm-alert warning">
        <div class="inject-confirm-icon">${icon('info', 18)}</div>
        <div>
          <strong>Medidas no encontradas en el modelo</strong>
          <p>Las siguientes medidas referenciadas no se detectaron en tu informe de Power BI Desktop conectado:</p>
          <ul class="inject-missing-list">
            ${missingRefs.map(m => `<li>${esc(m)}</li>`).join('')}
          </ul>
          <small>Si estas medidas se crean dinámicamente o se crearán luego, puedes continuar.</small>
        </div>
      </div>`;
  }
  if (existingMeasure) {
    body += `
      <div class="inject-confirm-alert info">
        <div class="inject-confirm-icon">${icon('sparkles', 18)}</div>
        <div>
          <strong>La medida ya existe en tu modelo</strong>
          <p>La medida <code>${esc(c.measureName)}</code> ya existe en la tabla <strong>${esc(existingMeasure.table)}</strong> de Power BI Desktop.</p>
          <p>¿Confirmas que deseas sobrescribir su fórmula DAX conservando el resto del modelo intacto?</p>
        </div>
      </div>`;
  }

  openModal(
    existingMeasure ? 'Confirmar sobrescritura en Power BI' : 'Confirmar creación en Power BI',
    'Comprueba los siguientes avisos antes de aplicar los cambios en tu informe abierto.',
    body,
    btn('cancel-inject-confirm', 'Cancelar', null, 'button secondary') +
    `<button type="button" class="button primary" data-action="proceed-inject-measure">
      ${icon('sparkles', 14)} <span>${existingMeasure ? 'Sobrescribir en Power BI' : 'Crear en Power BI'}</span>
    </button>`,
    'inject-confirm-modal'
  );
}

export function showInjectSuccessModal({ measureName, tableName, reportName, isNew = true }) {
  const c = getC();
  const title = isNew ? '¡Medida creada con éxito en Power BI!' : '¡Medida sobrescrita con éxito en Power BI!';
  const desc = 'Tu medida DAX ya está sincronizada y lista para visualizar en tu modelo abierto.';
  const body = `
    <div class="inject-success-card">
      <div class="inject-success-header">
        <div class="inject-success-badge-icon">${icon('check', 20)}</div>
        <div class="inject-success-header-info">
          <div class="inject-success-name"><code>[${esc(measureName)}]</code></div>
          <div class="inject-success-status">${isNew ? 'Medida creada y registrada en el modelo' : 'Medida actualizada correctamente'}</div>
        </div>
      </div>
      <div class="inject-success-grid">
        <div class="inject-meta-item">
          <span class="inject-meta-label">Tabla destino</span>
          <span class="inject-meta-val">${icon('folder', 13)} ${esc(tableName)}</span>
        </div>
        <div class="inject-meta-item">
          <span class="inject-meta-label">Informe conectado</span>
          <span class="inject-meta-val">${icon('monitor', 13)} ${esc(reportName || 'Power BI Desktop')}</span>
        </div>
        <div class="inject-meta-item">
          <span class="inject-meta-label">Dimensiones tarjeta</span>
          <span class="inject-meta-val">${icon('square', 13)} ${c.width} × ${c.height} px</span>
        </div>
        <div class="inject-meta-item">
          <span class="inject-meta-label">Estado en memoria</span>
          <span class="inject-meta-val text-success">${icon('sparkles', 13)} En memoria activa</span>
        </div>
      </div>
      <div class="inject-success-next-steps">
        <div class="next-steps-title">${icon('info', 14)} Pasos para visualizar en tu informe de Power BI:</div>
        <ol class="next-steps-list">
          <li>En Power BI Desktop, inserta el visual certificado <strong>HTML Content Secure</strong>.</li>
          <li>Arrastra tu medida <code>[${esc(measureName)}]</code> al campo <strong>Values</strong> (Valores).</li>
          <li>Ajusta el tamaño del visual a <strong>${c.width} × ${c.height} px</strong> y desactiva el relleno predeterminado.</li>
        </ol>
      </div>
    </div>
  `;
  const footer = `
    <div class="inject-success-footer-actions">
      <button type="button" class="button quiet" data-action="pbi-infographic">
        ${icon('sparkles', 14)} <span>¿Cómo usar en Power BI?</span>
      </button>
      <button type="button" class="button secondary" data-action="back-to-export">
        ${icon('code', 14)} <span>Ver código DAX</span>
      </button>
      <button type="button" class="button primary" data-action="close-modal">
        ${icon('check', 14)} <span>Listo, volver al diseño</span>
      </button>
    </div>
  `;
  openModal(title, desc, body, footer, 'inject-success-modal');
}

export function showInjectErrorModal({ error, measureName, reportName, onRetry }) {
  if (typeof onRetry === 'function') setPendingInjectAction(onRetry);
  const c = getC();
  const rawMsg = (error && (error.message || error)) || 'Error desconocido';
  let friendlyMsg = rawMsg;
  const isConn = /conexión|connection|denegó|refused|failed|fetch|connect|no se puede establecer/i.test(rawMsg);
  
  if (isConn) {
    friendlyMsg = 'No se pudo comunicar con Power BI Desktop en la dirección local. Puede que se haya cerrado el archivo, reiniciado la sesión o cambiado el puerto del motor Analysis Services.';
  } else if (/dependencia circular|circular dependency/i.test(rawMsg)) {
    friendlyMsg = `Se detectó una dependencia circular en DAX: la medida '${c.measureName}' no puede referenciarse a sí misma. Cambia el nombre de salida en KPI Atelier para continuar.`;
  }

  const title = 'No se pudo sincronizar con Power BI';
  const desc = 'Se ha producido un problema al intentar escribir la medida en tu informe abierto.';
  const body = `
    <div class="inject-error-card">
      <div class="inject-confirm-alert error">
        <div class="inject-confirm-icon">${icon('alertTriangle', 20)}</div>
        <div class="inject-error-text">
          <strong>${esc(friendlyMsg)}</strong>
          ${rawMsg !== friendlyMsg ? `<p class="inject-error-detail"><small>${esc(rawMsg)}</small></p>` : ''}
        </div>
      </div>
      <div class="inject-error-help">
        <p><strong>Comprobaciones sugeridas:</strong></p>
        <ul style="margin:6px 0 0;padding-left:18px;">
          <li>Asegúrate de que <strong>Power BI Desktop</strong> está abierto en este equipo con tu informe.</li>
          <li>Si tienes más de un informe abierto, pulsa <em>Reconectar informe</em> para elegir el informe destino.</li>
          <li>También puedes copiar el código DAX o descargarlo en archivo <code>.dax</code> para pegarlo manualmente.</li>
        </ul>
      </div>
    </div>
  `;
  const footer = `
    <div class="inject-error-footer-actions">
      <button type="button" class="button quiet" data-action="copy-dax">
        ${icon('copy', 14)} <span>Copiar DAX manual</span>
      </button>
      <button type="button" class="button secondary" data-action="connect-live-pbi">
        ${icon('sparkles', 14)} <span>Reconectar informe</span>
      </button>
      <button type="button" class="button primary" data-action="proceed-inject-measure">
        ${icon('sparkles', 14)} <span>Reintentar inyección</span>
      </button>
    </div>
  `;
  openModal(title, desc, body, footer, 'inject-error-modal');
}

export function guide() {
  const c = getC();
  openModal(
    'Del diseño a Power BI',
    'Tu primera tarjeta, en cuatro pasos.',
    `<div class="guide-grid"><article><b>01</b><h3>Encuentra tu tarjeta y afina la estructura</h3><p>Explora las plantillas curadas organizadas en familias temáticas. El modo <strong>Esencial</strong> se enfoca en métricas y estilo directo; el modo <strong>Avanzado</strong> desbloquea control tipográfico, pesos y bordes al píxel. Puedes redimensionar la tarjeta o sus elementos con los puntos de arrastre de esquina, o duplicar elementos con <kbd>Ctrl+C</kbd> y <kbd>Ctrl+V</kbd>.</p></article><article><b>02</b><h3>Conecta datos de tu modelo Power BI</h3><p>Vincula tus medidas reales desde <strong>Conectar datos</strong>. La app se conecta en tiempo real a tu sesión abierta de <strong>Power BI Desktop</strong> (localhost) o mediante carpetas PBIP/Fabric. Detecta automáticamente tablas calendario oficiales marcadas con <em>isKey</em> o <em>dataCategory: Time</em>.</p></article><article><b>03</b><h3>Genera e inyecta la medida DAX</h3><p>Pulsa <strong>Crear en Power BI</strong> para escribir la medida directamente en la memoria de tu informe abierto con un solo clic. Si lo prefieres, copia el código DAX optimizado o descárgalo en archivo <code>.dax</code>.</p></article><article><b>04</b><h3>Renderiza con HTML Content Secure</h3><p>En Power BI Desktop, agrega el visual certificado <strong>HTML Content Secure</strong> (disponible en AppSource). Arrastra tu nueva medida al campo <em>Values</em> del visual, ajusta el ancho y alto del contenedor al tamaño diseñado (ej. ${c.width} × ${c.height} px) y desactiva el relleno predeterminado.</p></article></div>`,
    btn('close-modal', 'Empezar a diseñar', 'arrow', 'button primary'),
    'guide-modal'
  );
}

// ----------------------------------------------------
// Icon Picker
// ----------------------------------------------------
export function openIconPicker() {
  openModal(
    'Un símbolo para cada historia.',
    `${ICON_OPTIONS.length} iconos vectoriales para dar contexto a tu KPI.`,
    `<label class="search-box icon-search">${icon('search', 16)}<input id="icon-search" type="search" placeholder="Busca: ventas, tiempo, personas…" aria-label="Buscar iconos"></label><div id="icon-grid" class="icon-grid">${iconGrid('')}</div>`,
    btn('close-modal', 'Cerrar', null, 'button secondary'),
    'icon-modal'
  );
}

export function iconGrid(query) {
  const c = getC();
  const selectedElement = getActiveContext().selectedElement;
  const activeIcon = (selectedElement && elementState(c, selectedElement).icon) || c.icon;
  return ICON_OPTIONS.filter(x => x.join(' ').toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))).map(([id, label, group]) => `<button data-pick-icon="${id}" class="${activeIcon === id ? 'active' : ''}" title="${label} · ${group}">${icon(id, 25)}<span>${label}</span></button>`).join('') || '<p class="field-help">No hay iconos con ese nombre.</p>';
}

// ----------------------------------------------------
// Theme Studio
// ----------------------------------------------------
export function themeTile(id, name, colors, custom = false) {
  return `<button ${custom ? 'data-draft-custom' : 'data-draft-theme'}="${id}" class="studio-theme-tile"><span class="theme-strip">${['background', 'accent', 'text', 'positive'].map(key => `<i style="background:${colors[key]}"></i>`).join('')}</span><span>${esc(name)}</span>${icon('chevron', 12)}</button>`;
}

export function openThemeStudio() {
  const c = getC();
  const draft = paletteFrom(c);
  setPaletteDraft(draft);
  setColorRole('accent');
  setColorHSV(hexToHSV(draft.accent));

  openModal(
    'El color también cuenta tu historia.',
    'Explora una paleta, afina los matices y hazla tuya.',
    `<div class="theme-studio"><aside class="theme-library"><h3>Paletas curadas <span>${Object.keys(THEMES).length}</span></h3>${Object.entries(THEMES).map(([id, t]) => themeTile(id, t.name, t)).join('')}<div class="custom-theme-heading"><h3>Tus temas</h3></div><div id="custom-theme-list">${customThemes.length ? customThemes.map(t => `<div class="custom-theme-row">${themeTile(t.id, t.name, t.colors, true)}<button data-delete-theme="${t.id}" title="Eliminar tema guardado" aria-label="Eliminar tema ${esc(t.name)}">${icon('trash', 13)}</button></div>`).join('') : '<p class="geometry-note">Guarda tu primera paleta para reutilizarla.</p>'}</div></aside><section class="color-workbench"><h3>Ajusta un color</h3><div class="color-roles">${COLOR_ROLES.map(([key, label]) => `<button data-color-role="${key}" class="${key === 'accent' ? 'active' : ''}"><i style="background:${draft[key]}"></i><span>${label}</span></button>`).join('')}</div><div class="color-map-label"><strong id="active-color-label">Acento</strong><span>Saturación · luminosidad</span></div><div id="color-map" class="color-map" tabindex="0" role="slider" aria-label="Mapa de color. Flechas izquierda y derecha: saturación. Arriba y abajo: luminosidad." aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(getColorHSV().s * 100)}"><span id="color-map-cursor"></span></div><label class="hue-label" for="color-hue">Matiz <span id="hue-value"></span></label><input id="color-hue" class="hue-slider" type="range" min="0" max="360" step="1" value="${Math.round(getColorHSV().h)}"><div class="color-hex-row"><span id="active-color-preview"></span><label for="color-hex">HEX</label><input id="color-hex" maxlength="7" value="${draft.accent.toUpperCase()}" spellcheck="false" aria-label="Código hexadecimal"><span id="hex-error" role="status"></span></div><div class="quick-colors">${['#ffffff', '#17272b', '#c3ec83', '#477568', '#8771bb', '#bd8144', '#527bdd', '#bd758b', '#3d9596', '#b8664d', '#c0b2ee', '#000000'].map(color => `<button data-quick-color="${color}" style="background:${color}" title="${color}" aria-label="Usar ${color}"></button>`).join('')}</div><p class="geometry-note">Arrastra sobre el mapa o usa las flechas. Mayús ajusta de 5 en 5.</p></section><section class="palette-preview-column"><h3>Así se verá tu tarjeta</h3><div id="palette-preview" class="palette-preview"></div><div id="palette-contrast" class="palette-contrast"></div><label class="save-label" for="theme-name">Nombre para tu paleta</label><input id="theme-name" class="save-input" maxlength="40" value="${esc(c.customThemeName || 'Mi paleta')}"><p class="geometry-note">Tus paletas se guardan en este navegador. Los colores también viajan con el JSON de cada tarjeta.</p></section></div>`,
    btn('close-modal', 'Cancelar', null, 'button quiet') + btn('save-theme', 'Guardar y aplicar', 'save', 'button secondary') + btn('apply-theme', 'Aplicar paleta', 'check', 'button primary'),
    'theme-modal'
  );
  updateColorStudio();
}

export function updateColorStudio() {
  const map = $('#color-map');
  const paletteDraft = getPaletteDraft();
  const colorRole = getColorRole();
  const colorHSV = getColorHSV();
  const c = getC();
  if (!map || !paletteDraft || !colorHSV) return;

  $('#hex-error').textContent = '';
  $('#color-hex')?.setAttribute('aria-invalid', 'false');
  const color = paletteDraft[colorRole];
  map.style.backgroundColor = hsvToHex(colorHSV.h, 1, 1);
  map.setAttribute('aria-valuenow', String(Math.round(colorHSV.s * 100)));
  map.setAttribute('aria-valuetext', `${Math.round(colorHSV.s * 100)} % saturación, ${Math.round(colorHSV.v * 100)} % luminosidad`);

  const cursor = $('#color-map-cursor');
  if (cursor) cursor.style.cssText = `left:${colorHSV.s * 100}%;top:${(1 - colorHSV.v) * 100}%;background:${color};`;

  const hueInput = $('#color-hue');
  if (hueInput) hueInput.value = colorHSV.h;
  const hueVal = $('#hue-value');
  if (hueVal) hueVal.textContent = Math.round(colorHSV.h) + '°';

  const hexInput = $('#color-hex');
  if (hexInput && document.activeElement !== hexInput) hexInput.value = color.toUpperCase();

  const previewDot = $('#active-color-preview');
  if (previewDot) previewDot.style.background = color;

  const roleLabel = $('#active-color-label');
  if (roleLabel) roleLabel.textContent = COLOR_ROLES.find(r => r[0] === colorRole)?.[1] || colorRole;

  document.querySelectorAll('[data-color-role]').forEach(button => {
    button.classList.toggle('active', button.dataset.colorRole === colorRole);
    button.setAttribute('aria-pressed', String(button.dataset.colorRole === colorRole));
    const dot = button.querySelector('i');
    if (dot) dot.style.background = paletteDraft[button.dataset.colorRole];
  });

  const palPrev = $('#palette-preview');
  if (palPrev) {
    palPrev.innerHTML = `<div class="mini-viewport" data-base-width="${c.width}"><div class="mini-inner" style="width:${c.width}px">${cardHTML({ ...c, ...paletteDraft })}</div></div>`;
    callFitThumbs();
  }

  const main = contrastRatio(paletteDraft.text, paletteDraft.background);
  const secondary = contrastRatio(paletteDraft.muted, paletteDraft.background);
  const contrastEl = $('#palette-contrast');
  if (contrastEl) {
    contrastEl.innerHTML = `<div class="${main < 4.5 ? 'low' : ''}">${icon(main < 4.5 ? 'info' : 'check', 13)}<span>Texto principal</span><b>${main.toFixed(1)}:1</b></div><div class="${secondary < 4.5 ? 'low' : ''}">${icon(secondary < 4.5 ? 'info' : 'check', 13)}<span>Texto secundario</span><b>${secondary.toFixed(1)}:1</b></div><small>${main < 4.5 || secondary < 4.5 ? 'Puedes mejorar la legibilidad separando más el color del texto y el fondo.' : 'Buena separación entre texto y fondo.'}</small>`;
  }
}

export function colorFromPointer(e) {
  const map = $('#color-map');
  if (!map) return;
  const r = map.getBoundingClientRect();
  const colorHSV = getColorHSV();
  const paletteDraft = getPaletteDraft();
  const colorRole = getColorRole();

  colorHSV.s = clamp((e.clientX - r.left) / r.width, 0, 1);
  colorHSV.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
  paletteDraft[colorRole] = hsvToHex(colorHSV.h, colorHSV.s, colorHSV.v);
  updateColorStudio();
}

// ----------------------------------------------------
// Data Binding Studio
// ----------------------------------------------------
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

  if (key.endsWith('__dateTable') || key === 'dateTable') {
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
  if (key.endsWith('__dateColumn') || key === 'dateColumn') {
    const targetDupId = key.includes('__') ? key.split('__')[0] : null;
    const targetDateTable = targetDupId ? elementState(c, targetDupId).dateTable : c.dateTable;
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
  const hasExactSelected = filtered.some(o => o.value.toLowerCase() === currentVal);
  return filtered.map((opt, idx) => {
    const isSelected = hasExactSelected ? (opt.value.toLowerCase() === currentVal) : (idx === 0 && Boolean(q));
    return `<button type="button" class="binding-dropdown-item ${isSelected ? 'is-selected' : ''}" data-action="select-binding-item" data-field="${key}" data-value="${esc(opt.value)}">
      <span class="binding-dropdown-label">${esc(opt.label)}</span>
      <span class="binding-dropdown-meta">${esc(opt.desc)}</span>
    </button>`;
  }).join('');
}

export function closeAllBindingDropdowns() {
  document.querySelectorAll('.binding-dropdown-menu.is-open').forEach(menu => {
    menu.classList.remove('is-open');
    const toggle = menu.parentElement?.querySelector('.binding-dropdown-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.classList.remove('is-open');
    }
    menu.parentElement?.querySelector('.binding-input')?.setAttribute('aria-expanded', 'false');
  });
}

export function openBindingDropdown(key, toggleOpen = false) {
  const menu = document.getElementById(`dropdown-menu-${key}`);
  if (!menu) return;
  const isOpen = menu.classList.contains('is-open');
  if (isOpen && !toggleOpen) return;
  closeAllBindingDropdowns();
  if (isOpen) return;
  menu.innerHTML = renderBindingDropdown(key, '');
  menu.classList.add('is-open');
  const toggle = menu.parentElement?.querySelector('.binding-dropdown-toggle');
  toggle?.setAttribute('aria-expanded', 'true');
  toggle?.classList.add('is-open');
  menu.parentElement?.querySelector('.binding-input')?.setAttribute('aria-expanded', 'true');
}

export function applyBindingFieldValue(key, val) {
  let c = getC();

  if (key.includes('__')) {
    const [dupId, prop] = key.split('__');
    c = updateElement(c, dupId, { [prop]: val });
  } else if (key.includes('_copy')) {
    const def = resolveElementDef(key);
    const prop = def?.baseId === 'delta' ? (elementState(c, key).comparison || c.comparison) === 'target' ? 'targetMeasure' : 'compareMeasure' : ['goalLabel', 'progressLabel', 'progress'].includes(def?.baseId) ? 'targetMeasure' : 'measure';
    c = updateElement(c, key, { [prop]: val });
  } else if (key === 'targetMeasure') {
    c._targetCustomized = true;
    c = sanitizeConfig({ ...c, targetMeasure: val });
  } else if (key === 'dateTable') {
    c._dateCustomized = true;
    c = sanitizeConfig({ ...c, dateTable: val });
  } else if (key === 'measureName') {
    const stripped = val.replace(/^kpi[_\s]+/i, '').replace(/_+/g, ' ').trim();
    const autoTitle = stripped || val.trim();
    const patch = { measureName: val };
    if (autoTitle && autoTitle.toLowerCase() !== 'kpi') patch.title = autoTitle;
    c = sanitizeConfig({ ...c, ...patch });
  } else if (key === 'measure') {
    c._measureBound = Boolean(val.trim());
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
    c = sanitizeConfig({ ...c, ...patch });
  } else {
    c = sanitizeConfig({ ...c, [key]: val });
  }

  setC(c);
  persist();

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

  updateBindingFieldStatus(key);
  if (key === 'measure') updateBindingFieldStatus('measureName');
  if (key === 'dateTable') updateBindingFieldStatus('dateColumn');
  updateBindingModalStatus();
  callRefreshCard();
  callRenderStatus();
}

export function openDataBindingModal(focusKey = null) {
  bindingHoverContext = null;
  bindingFocusContext = null;
  cancelBindingReveal();
  let c = getC();
  const pbipModel = getPbipModel();
  const DUMMY_TARGETS = ['Objetivo EBITDA', 'Objetivo Pedidos', 'Objetivo Ventas', 'Objetivo'];
  if (!c._targetCustomized && DUMMY_TARGETS.includes(c.targetMeasure?.trim())) {
    c.targetMeasure = '';
    setC(c);
    persist();
  }
  if (!c._measureBound) {
    c.measure = '';
    setC(c);
    persist();
  }

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
        <input type="file" id="pbip-folder-input" webkitdirectory directory hidden>
        ${pbipModel ? `<button type="button" class="pbip-btn danger" data-action="disconnect-pbip" title="Desconectar modelo actual">${icon('close', 13)} Desconectar</button>` : ''}
      </div>
    </div>
    ${roundtripHTML}
  </div>`;

  let datalistsHTML = '';
  if (pbipModel) {
    const measureOptions = (pbipModel.measures || []).map(m => `<option value="${esc(m.name)}">${esc(m.table)}</option>`).join('');
    const dateTableOptions = (pbipModel.dateTables || []).map(dt => {
      const dateCount = dt.dateColumns?.length || 0;
      const tag = dt.isMarkedDateTable ? '⭐ Fecha oficial' : dt.isLikelyCalendar ? 'Calendario sugerido' : `${dt.name} (${dateCount} col${dateCount === 1 ? '' : 's'} fecha)`;
      return `<option value="${esc(dt.name)}">${tag}</option>`;
    }).join('');
    const curDt = (pbipModel.dateTables || []).find(dt => dt.name.toLowerCase() === (c.dateTable || '').trim().toLowerCase());
    const candidateDateCols = curDt ? curDt.dateColumns : Array.from(new Set((pbipModel.dateTables || []).flatMap(dt => dt.dateColumns)));
    const dateColOptions = candidateDateCols.map(col => {
      const isKey = curDt && curDt.primaryDateColumn === col;
      const tag = isKey ? '⭐ Columna clave (isKey)' : curDt ? esc(curDt.name) : 'Columna fecha';
      return `<option value="${esc(col)}">${tag}</option>`;
    }).join('');
    datalistsHTML = `<datalist id="dl-pbip-measures">${measureOptions}</datalist><datalist id="dl-pbip-date-tables">${dateTableOptions}</datalist><datalist id="dl-pbip-date-columns">${dateColOptions}</datalist>`;
  }

  const fieldMarkup = (key, label, iconChar, helpText, badgeText) => {
    const val = c[key] || '';
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
    const hasDropdown = Boolean(pbipModel && ['measure', 'targetMeasure', 'compareMeasure', 'dateTable', 'dateColumn'].includes(key));
    const markedTable = (pbipModel?.dateTables || []).find(dt => dt.isMarkedDateTable);
    const defaultTable = markedTable || (pbipModel?.dateTables || [])[0];
    const ph = key === 'measure' ? (pbipModel?.measures?.[0]?.name || 'Total Ventas') :
      key === 'dateTable' ? (defaultTable?.name || 'Calendario') :
      key === 'dateColumn' ? (defaultTable?.primaryDateColumn || defaultTable?.dateColumns?.[0] || 'Fecha') :
      key === 'measureName' ? 'MiMedidaDAX' :
      key === 'targetMeasure' ? 'Medida o número (ej. 0)' :
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
          <input id="f-bind-${key}" class="binding-input" data-bind-key="${key}" type="text" value="${esc(val)}" placeholder="Ejemplo: ${esc(ph)}" spellcheck="false" autocomplete="off">
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
  let fieldsHTML = `<div class="binding-fields-column">${nameHTML}<div class="binding-fields-card">`;
  fieldsHTML += `
    <div class="binding-section-head"><span>fx</span>Medida principal<small>Obligatorio</small></div>
    ${fieldMarkup('measure', 'Medida de negocio (existente)', 'fx', '', 'Valor principal')}`;

  if (needsDate(c)) {
    fieldsHTML += `
      <div class="binding-section-divider"></div>
      <div class="binding-section-head"><span>📅</span>Calendario y fechas<small>Requerido por tendencia / comparativa</small></div>
      ${fieldMarkup('dateTable', 'Tabla de fechas / Calendario', '田', '', 'Evolución')}
      ${fieldMarkup('dateColumn', 'Columna de fecha única', '▦', '', 'Período')}
      <div class="field" data-binding-field="granularity"><label for="f-bind-granularity">Granularidad de tendencia</label><select id="f-bind-granularity" data-key="granularity"><option value="auto" ${c.granularity === 'auto' ? 'selected' : ''}>Automática</option><option value="day" ${c.granularity === 'day' ? 'selected' : ''}>Diaria</option><option value="week" ${c.granularity === 'week' ? 'selected' : ''}>Semanal</option><option value="month" ${c.granularity === 'month' ? 'selected' : ''}>Mensual</option></select><small>Auto: ≤31 días → diaria; ≤120 → semanal; resto → mensual.</small></div>`;
  }

  if (needsGoal(c) || (needsCompare(c) && c.comparison === 'target')) {
    fieldsHTML += `
      <div class="binding-section-divider"></div>
      <div class="binding-section-head"><span>🎯</span>Objetivo comercial<small>Requerido</small></div>
      ${fieldMarkup('targetMeasure', 'Medida de objetivo', 'fx', '', 'Progreso')}`;
  }

  if (needsCompare(c) && c.comparison === 'custom') {
    fieldsHTML += `
      <div class="binding-section-divider"></div>
      <div class="binding-section-head"><span>↔</span>Comparativa personalizada<small>Requerido</small></div>
      ${fieldMarkup('compareMeasure', 'Medida de comparación', 'fx', '', 'Variación')}`;
  }

  const activeDupIds = Object.keys(c.elements || {}).filter(id => {
    const def = resolveElementDef(id);
    const st = elementState(c, id);
    if (!def?.isDuplicate || st.deleted) return false;
    if (['value', 'referenceValue', 'delta', 'goalLabel', 'progressLabel', 'progress'].includes(def.baseId)) return true;
    if (def.baseId === 'trend') return true;
    return false;
  });

  if (activeDupIds.length) {
    fieldsHTML += `
      <div class="binding-section-divider"></div>
      <div class="binding-section-head"><span>📑</span>Elementos duplicados vinculables<small>${activeDupIds.length} activo${activeDupIds.length > 1 ? 's' : ''}</small></div>`;
    for (const dupId of activeDupIds) {
      const def = resolveElementDef(dupId);
      const st = elementState(c, dupId);
      const dupEntries = def.baseId === 'trend' ? [
        { prop: 'measure', label: `Medida de ${def.label}`, ph: pbipModel?.measures?.[0]?.name || 'Medida numérica', val: st.measure || '', iconChar: 'fx', fieldKey: `${dupId}__measure` },
        ...((st.chartKind || c.chartKind) !== 'donut' ? [
          { prop: 'dateTable', label: `Tabla de fechas (${def.label})`, ph: 'Calendario', val: st.dateTable || '', iconChar: '田', fieldKey: `${dupId}__dateTable` },
          { prop: 'dateColumn', label: `Columna de fecha (${def.label})`, ph: 'Fecha', val: st.dateColumn || '', iconChar: '▦', fieldKey: `${dupId}__dateColumn` }
        ] : [])
      ] : def.baseId === 'delta' ? [
        { prop: 'measure', label: `Medida de ${def.label}`, ph: 'Selecciona su medida propia', val: st.measure || '', iconChar: 'fx', fieldKey: `${dupId}__measure` },
        ...((st.comparison || c.comparison) === 'custom' ? [{ prop: 'compareMeasure', label: `Comparación de ${def.label}`, ph: 'Medida de comparación', val: st.compareMeasure || '', iconChar: 'fx', fieldKey: dupId }] : []),
        ...((st.comparison || c.comparison) === 'target' ? [{ prop: 'targetMeasure', label: `Objetivo de ${def.label}`, ph: 'Medida o número', val: st.targetMeasure || '', iconChar: 'fx', fieldKey: dupId }] : [])
      ] : [
        {
          prop: ['value','referenceValue'].includes(def.baseId) ? 'measure' : ['goalLabel', 'progressLabel', 'progress'].includes(def.baseId) ? 'targetMeasure' : 'text',
          label: ['value','referenceValue'].includes(def.baseId) ? `Medida de ${def.label}` : `Objetivo de ${def.label}`,
          ph: def.baseId === 'value' ? (pbipModel?.measures?.[0]?.name || 'Medida numérica') : def.baseId === 'delta' ? (pbipModel?.measures?.[0]?.name || 'Medida de comparación') : ['goalLabel', 'progressLabel', 'progress'].includes(def.baseId) ? '[Objetivo] o número' : def.baseId === 'icon' ? (st.icon || c.icon || 'icono') : def.label,
          val: ['value','referenceValue'].includes(def.baseId) ? (st.measure || '') : (st.targetMeasure || ''),
          iconChar: ['value', 'delta'].includes(def.baseId) ? 'fx' : ['goalLabel', 'progressLabel', 'progress'].includes(def.baseId) ? '🎯' : def.baseId === 'icon' ? '★' : 'T',
          fieldKey: dupId
        }
      ];
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
                <input id="f-bind-${entry.fieldKey}" class="binding-input" data-bind-dup="${dupId}" data-bind-dupprop="${entry.prop}" data-bind-field-key="${entry.fieldKey}" type="text" value="${esc(entry.val)}" placeholder="Ejemplo: ${esc(entry.ph)}" spellcheck="false" autocomplete="off">
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

  const body = `<div class="binding-modal-wrapper">${pbipCardHTML}<div class="binding-studio">${previewHTML}${fieldsHTML}</div>${datalistsHTML}</div>`;
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
