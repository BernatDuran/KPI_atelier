import { cancelBindingReveal, openDataBindingModal } from './binding-ui.mjs';
/**
 * KPI Atelier - Submódulo Modales y Asistentes de Configuración (dist/modals.mjs)
 * Gestiona los diálogos modales (HTML dialog lifecycle), Data Binding Studio,
 * Theme Studio con espacio de color HSV, Icon Picker vectorial y diálogos de exportación DAX.
 */

import { icon, esc } from './cards.mjs';
import { checks } from './model.mjs';
import { generateDAX } from './dax.mjs';
import { fetchLivePbiModel } from './pbip.mjs';
import { beginModelRequest } from './model-session.mjs';
import { reviewMeasure, measureDestination } from './preflight.mjs';
import { collectCurrentDesignDiagnostics } from './design-diagnostics.mjs';
import { $, btn, ib, getC, toast, getPbipModel, setPbipModel, getFriendlyReportName, getActiveContext } from './state.mjs';

let lastFocus = null;
let pendingInjectAction = null;
let modalDismiss = null;
let modalRevision = 0;
let pendingExportAction = null;
let pendingWriteReviewAction = null;
export function setPendingWriteReviewAction(action) { pendingWriteReviewAction = action; }
export function getPendingWriteReviewAction() { return pendingWriteReviewAction; }
export function clearPendingWriteReviewAction() { pendingWriteReviewAction = null; }
export function getModalRevision() { return modalRevision; }
// Dialog contents are replaced often; the live notification must keep its
// identity, timer and text across those replacements.
function replaceModalContents(modal, html) {
  const notification = $('#toast');
  if (notification && modal.contains?.(notification)) document.body.appendChild(notification);
  modal.innerHTML = html;
  if (notification && modal.appendChild) modal.appendChild(notification);
}
export function setPendingInjectAction(fn) { pendingInjectAction = fn; }
export function getPendingInjectAction() { return pendingInjectAction; }
export function clearPendingInjectAction() { pendingInjectAction = null; }

// ----------------------------------------------------
// Ciclo de Vida de Modales Genéricos
// ----------------------------------------------------
export function openModal(title, subtitle, body, footer = '', cl = '', onDismiss = null) {
  clearPendingWriteReviewAction();
  clearPendingInjectAction();
  const modal = $('#modal');
  if (!modal) return;
  cancelBindingReveal();
  modalRevision++;
  modalDismiss = onDismiss;
  if (!modal.open) lastFocus = document.activeElement;
  modal.className = cl;
  modal.setAttribute('aria-labelledby', 'modal-title');
  replaceModalContents(modal, `<div class="modal-heading"><div><span class="overline">KPI ATELIER</span><h2 id="modal-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${ib('close-modal', 'Cerrar', 'close')}</div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}`);
  if (!modal.open) modal.showModal();
}

export function closeModal() {
  clearPendingWriteReviewAction();
  clearPendingInjectAction();
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

export function requestExport(action, conf = getC(), verifyReferences = true) {
  const review = verifyReferences ? reviewMeasure(conf, getPbipModel()) : { issues: [], missing: [], unverified: [], references: [] };
  const diagnostics = JSON.stringify(conf) === JSON.stringify(getC()) ? collectCurrentDesignDiagnostics(conf) : [];
  const errors = review.issues.filter(x => x.level === 'error');
  if (!errors.length && !review.missing.length && !review.unverified.length && !diagnostics.length) return action();
  const modal = $('#modal');
  const notification = $('#toast');
  if (notification && modal?.contains?.(notification)) document.body.appendChild(notification);
  const previous = modal?.open ? { html: modal.innerHTML, className: modal.className, dismiss: modalDismiss } : null;
  const restore = () => {
    pendingExportAction = null;
    if (!previous) return;
    modalRevision++;
    modal.className = previous.className;
    replaceModalContents(modal, previous.html);
    modalDismiss = previous.dismiss;
    if (!modal.open) modal.showModal();
  };
  pendingExportAction = action;
  const pending = review.references.filter(r => r.status === 'error' || r.status === 'unknown');
  openModal(diagnostics.length ? 'Revisa el diseño antes de exportar' : 'Exportar con referencias pendientes', 'Revisa estos avisos antes de descargar el archivo.',
    `${diagnostics.length ? `<div class="export-warning-note"><strong>Avisos de legibilidad en la vista previa</strong><ul>${diagnostics.map(x => `<li>${esc(x.message)}</li>`).join('')}</ul><p>El resultado puede variar con los datos reales. Ajusta el diseño o exporta igualmente.</p></div>` : ''}
    ${errors.length || review.missing.length || review.unverified.length ? '<p class="export-warning-note">Hay campos vacíos, referencias no encontradas o datos sin comprobar. Puedes exportar igualmente; corrígelos antes de aplicar la medida en Power BI.</p>' : ''}
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
  // Backups and simulated HTML do not depend on a connected semantic model.
  if (type === 'application/json') return downloadFile(name, text, type);
  if (type.startsWith('text/html')) return requestExport(() => downloadFile(name, text, type), conf, false);
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
  const diagnostics = collectCurrentDesignDiagnostics(c);
  const ready = reviewMeasure(c, pbipModel).valid;
  const bannerText = !ready ? 'Vista DAX · Hay referencias pendientes de configurar o comprobar' : isLive ? `Conectado a '${getFriendlyReportName(pbipModel)}' · Referencias verificadas` : 'Medida DAX lista · Compatible con HTML Content Secure en Power BI';
  const injectBtn = isLive ? `<button class="button primary btn-inject" data-action="inject-live-measure" ${ready ? '' : 'disabled title="Corrige las referencias pendientes en Conectar datos"'}>${icon('sparkles', 14)}<span>${alreadyExists ? 'Sobrescribir en Power BI' : 'Crear en Power BI'}</span></button>` : '';

  openModal(
    'Tu diseño. Tu medida DAX.',
    'Copia, pega y deja que tus datos hagan el resto.',
    `${diagnostics.length ? `<div class="export-warning-note"><strong>Avisos de legibilidad</strong><ul>${diagnostics.map(x => `<li>${esc(x.message)}</li>`).join('' )}</ul></div>` : ''}<div class="export-top-actions">${btn('open-data-modal', 'Conectar datos del modelo', 'chevronLeft', 'button quiet export-back')}${btn('pbi-infographic', '¿Cómo usar en Power BI?', 'book', 'button quiet btn-pbi-guide')}</div><div class="export-banner ${isLive ? 'is-live' : ''}">${icon(isLive ? 'sparkles' : 'code', 15)}<span>${esc(bannerText)}</span></div><div class="code-bar"><span>${icon('code', 15)} ${esc(c.measureName)}.dax</span><div class="code-bar-actions"><span>${dax.split('\n').length} líneas</span>${btn('copy-dax', 'Copiar DAX', 'copy', 'code-copy')}</div></div><pre class="dax-code" tabindex="0"><code>${esc(dax)}</code></pre><div class="export-notice">${icon('info', 16)}<p>${isLive ? 'Comprueba los datos y crea la medida en tu informe conectado. También puedes copiar el código o descargarlo.' : 'En Power BI Desktop, añade el visual HTML Content Secure y arrastra esta medida al campo de valores.'}</p></div>`,
    `<div class="export-other">${btn('download-json', 'Configuración JSON', 'download', 'button quiet export-download')}${btn('download-html', 'Vista HTML', 'download', 'button quiet export-download')}${btn('download-dax', '.dax', 'download', 'button quiet export-download', 'title="Descargar medida DAX"')}</div><div class="export-main">${btn('review-live-measure', 'Comprobar datos', 'check', 'button secondary')}${injectBtn}</div>`,
    'export-modal'
  );
}

function renderMeasureReview(c, model, connection, error = '', onApply = null) {
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
    `<div class="measure-review-back">${btn('back-to-export', 'Volver al DAX', 'chevronLeft', 'button secondary')}${btn('open-data-modal', 'Editar datos', 'sliders', 'button quiet')}</div>${isLive ? btn(onApply ? 'proceed-inject-measure' : 'inject-live-measure', review.existing ? 'Sobrescribir en Power BI' : 'Crear en Power BI', 'sparkles', 'button primary btn-inject', ready ? '' : 'disabled') : ''}`,
    'measure-review-modal', exportModal);
  if (onApply) setPendingInjectAction(onApply);
  return modalRevision;
}

/** @param {import('./types.d.ts').CardConfig} [config] @param {(() => Promise<void> | void) | null} [onApply] */
export async function openMeasureReviewModal(config = getC(), onApply = null) {
  const c = structuredClone(config);
  const model = getPbipModel();
  const isLive = Boolean(model?.isLiveConnection && model.server);
  const revision = renderMeasureReview(c, model, isLive ? 'loading' : 'offline', '', onApply);
  if (!isLive) return;
  const request = beginModelRequest();
  try {
    const catalog = await fetchLivePbiModel(model.server, model.databaseId || model.database || '', { signal: request.signal });
    if (model.database && catalog.database !== model.database) throw new Error('El modelo conectado ha cambiado. Vuelve a conectar el informe.');
    if (modalRevision !== revision || !$('#modal')?.open) return;
    if (!request.commit(catalog, false)) return;
    renderMeasureReview(c, catalog, 'connected', '', onApply);
  } catch (err) {
    if (request.isCurrent() && modalRevision === revision && $('#modal')?.open) renderMeasureReview(c, model, 'error', err.message || 'No se pudo comprobar el modelo.', onApply);
  } finally { request.finish(); }
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
        { desc: 'Mover según paso seleccionado (1 o 5 px)', keys: 'Flechas' },
        { desc: 'Alternar paso de movimiento (5 o 1 px)', keys: 'Shift + Flechas' },
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
        { desc: 'Rehacer acción', keys: 'Ctrl + Y / Ctrl + Shift + Z' },
        { desc: 'Guardar diseño', keys: 'Ctrl + S' },
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
    'Configura el visual y comprueba el resultado con los datos de tu informe en Power BI Desktop.',
    `<div class="pbi-infographic-container">
      <div class="pbi-infographic-step">
        <div class="step-badge">1</div>
        <div class="step-body">
          <div class="step-title">Obtén el visual HTML Content Secure</div>
          <p class="step-desc">En Power BI Desktop, abre <em>Obtener más objetos visuales</em> y busca <strong>HTML Content Secure</strong> de <em>Daniel Marsh-Patrick</em>. Es la edición certificada, llamada <strong>HTML Content (lite)</strong> antes de la versión 2.0. HTML Content Regular es un visual distinto. <a href="https://html-content.com/docs/visual-editions" target="_blank" rel="noopener noreferrer">Consultar las ediciones</a>.</p>
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
          <p class="step-desc">Inserta HTML Content Secure y arrastra <code>${esc(c.measureName)}</code> al campo <strong>Values</strong> (Valores). La vista previa de Atelier usa datos simulados; la conexión verifica referencias del modelo. Comprueba aquí los valores reales y los filtros de tu informe.</p>
        </div>
      </div>
      <div class="pbi-infographic-step">
        <div class="step-badge">4</div>
        <div class="step-body">
          <div class="step-title">Ajuste de dimensiones exactas</div>
          <p class="step-desc">Establece <strong>${c.width} × ${c.height} px</strong> y el relleno del visual en <strong>0 px</strong>. Comprueba tipografía, recorte y SVG en tu versión instalada. Si falta contenido en Secure 2.0, consulta <em>Diagnostics &gt; Sanitizer</em> y las <a href="https://html-content.com/docs/sanitization" target="_blank" rel="noopener noreferrer">reglas de filtrado</a>.</p>
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

export function showInjectConfirmModal(missingRefs, existingMeasure, onConfirm, config = getC()) {
  const c = config;
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
  setPendingInjectAction(onConfirm);
}

/** @param {{ measureName: string, tableName: string, reportName: string, isNew?: boolean, target?: import('./types.d.ts').MeasureWriteTarget, config?: import('./types.d.ts').CardConfig, targetChanged?: boolean }} options */
export function showInjectSuccessModal({ measureName, tableName, reportName, isNew = true, target, config, targetChanged = false }) {
  clearPendingWriteReviewAction();
  const c = config || getC();
  const title = isNew ? '¡Medida creada con éxito en Power BI!' : '¡Medida sobrescrita con éxito en Power BI!';
  const desc = targetChanged ? 'La operación terminó en el informe original. El modelo seleccionado actualmente se conserva.' : 'La configuración enviada está guardada y lista para visualizar en el informe de destino.';
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
          <span class="inject-meta-label">Informe de destino</span>
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
      ${target ? `<p class="field-help">Destino de esta operación: ${esc(target.server)} · Modelo ${esc(target.database)} · Tabla ${esc(target.tableName)}</p>` : ''}
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
        ${icon('code', 14)} <span>DAX del diseño abierto</span>
      </button>
      <button type="button" class="button primary" data-action="close-modal">
        ${icon('check', 14)} <span>Listo, volver al diseño</span>
      </button>
    </div>
  `;
  openModal(title, desc, body, footer, 'inject-success-modal');
}

/** @param {{ error: import('./types.d.ts').BridgeApiError, measureName: string, reportName: string, onRetry?: () => Promise<void> | void, onReview?: () => Promise<void> | void, target?: import('./types.d.ts').MeasureWriteTarget, config?: import('./types.d.ts').CardConfig, targetChanged?: boolean }} options */
export function showInjectErrorModal({ error, measureName, reportName, onRetry, onReview, target, config, targetChanged = false }) {
  clearPendingInjectAction();
  clearPendingWriteReviewAction();
  const c = config || getC();
  const rawMsg = String((error && (error.message || error)) || 'Error desconocido');
  let friendlyMsg = rawMsg;
  const isConn = /conexión|connection|denegó|refused|failed|fetch|connect|no se puede establecer/i.test(rawMsg);
  
  if (error?.outcomeUnknown) {
    friendlyMsg = 'Power BI no confirmó el resultado. La medida podría haberse guardado. Actualiza el modelo y revisa su contenido antes de decidir si deseas volver a aplicarla.';
  } else if (error?.code === 'CONFLICT') {
    friendlyMsg = 'La medida cambió desde la última revisión. Actualiza el modelo para revisar la versión actual antes de sobrescribirla.';
  } else if (isConn) {
    friendlyMsg = 'No se pudo comunicar con Power BI Desktop en la dirección local. Puede que se haya cerrado el archivo, reiniciado la sesión o cambiado el puerto del motor Analysis Services.';
  } else if (/dependencia circular|circular dependency/i.test(rawMsg)) {
    friendlyMsg = `Se detectó una dependencia circular en DAX: la medida '${c.measureName}' no puede referenciarse a sí misma. Cambia el nombre de salida en KPI Atelier para continuar.`;
  }

  const title = 'No se pudo sincronizar con Power BI';
  const desc = targetChanged ? 'Este resultado corresponde al informe original de la operación. El modelo seleccionado actualmente se conserva.' : 'Se ha producido un problema al intentar escribir la medida en el informe de destino.';
  const body = `
    <div class="inject-error-card">
      <div class="inject-confirm-alert error">
        <div class="inject-confirm-icon">${icon('alertTriangle', 20)}</div>
        <div class="inject-error-text">
          <strong>${esc(friendlyMsg)}</strong>
          ${rawMsg !== friendlyMsg ? `<p class="inject-error-detail"><small>${esc(rawMsg)}</small></p>` : ''}
          ${error?.code ? `<p class="inject-error-detail"><small>Código: ${esc(error.code)}${error?.requestId ? ` · Referencia: ${esc(error.requestId)}` : ''}</small></p>` : ''}
          ${error?.diagnostic ? `<details><summary>Detalle técnico</summary><pre>${esc(error.diagnostic)}</pre></details>` : ''}
        </div>
      </div>
      ${target ? `<section class="measure-review-section"><h3>Destino de la operación</h3><p>Informe: ${esc(reportName || 'Power BI Desktop')}<br>Servidor: ${esc(target.server)}<br>Modelo: ${esc(target.database)}<br>Tabla: ${esc(target.tableName)}<br>Medida: ${esc(measureName)}</p>${targetChanged ? '<p class="measure-review-error">Selecciona este informe original antes de actualizar, revisar o reintentar. Ninguna acción se enviará al modelo seleccionado ahora.</p>' : ''}</section>` : ''}
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
      <button type="button" class="button primary" data-action="${error?.outcomeUnknown || error?.code === 'CONFLICT' ? 'review-live-measure' : 'proceed-inject-measure'}" ${targetChanged ? 'disabled' : ''}>
        ${icon('sparkles', 14)} <span>${error?.outcomeUnknown || error?.code === 'CONFLICT' ? 'Actualizar y revisar' : 'Reintentar inyección'}</span>
      </button>
    </div>
  `;
  openModal(title, desc, body, footer, 'inject-error-modal');
  if (!error?.outcomeUnknown && typeof onRetry === 'function') setPendingInjectAction(onRetry);
  if (typeof onReview === 'function') setPendingWriteReviewAction(onReview);
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
export { openIconPicker, iconGrid, themeTile, openThemeStudio, updateColorStudio, colorFromPointer } from './studio-ui.mjs';

// ----------------------------------------------------
// Data Binding Studio
// ----------------------------------------------------
export { FIELD_TO_ELEMENTS, ELEMENT_TO_FIELD, getBindingElements, getBindingFieldsForElement, cancelBindingReveal, revealBindingFields, highlightBindingContext, highlightBindingElements, updateBindingFieldStatus, updateBindingModalStatus, updateBindableElements, fitBindingCard, getBindingFieldOptions, renderBindingDropdown, closeAllBindingDropdowns, openBindingDropdown, applyBindingFieldValue, openDataBindingModal } from './binding-ui.mjs';
