import { getC, getPbipModel, getFriendlyReportName, toast } from './state.mjs';
import { discoverLivePbi, fetchLivePbiModel, injectMeasureToLivePbi } from './pbi-client.mjs';
import { beginModelRequest, matchesModelTarget } from './model-session.mjs';
import { generateDAX } from './dax.mjs';
import { reviewMeasure } from './preflight.mjs';
import { chooseLiveInstanceModal, openMeasureReviewModal, showInjectConfirmModal, showInjectSuccessModal, showInjectErrorModal } from './modals.mjs';

let writing = false;

/**
 * Refresh and review before every write; never replay a write after a transport error.
 * @param {import('./types.d.ts').CardConfig} [config]
 * @param {import('./types.d.ts').MeasureWriteApproval} [approved]
 * @param {import('./types.d.ts').MeasureWriteTarget} [requiredTarget]
 */
export async function applyLiveMeasure(config = structuredClone(getC()), approved = undefined, requiredTarget = undefined) {
  if (writing) return;
  config = structuredClone(config);
  if (requiredTarget && !matchesModelTarget(getPbipModel(), requiredTarget)) {
    showWriteError(new Error('Selecciona el informe original antes de revisar o reintentar esta operación.'), config, requiredTarget);
    return;
  }
  writing = true;
  const request = beginModelRequest();
  let model = getPbipModel();
  /** @type {import('./types.d.ts').MeasureWriteTarget | undefined} */
  let target = requiredTarget;
  let submitted = false;
  try {
    if (!model?.isLiveConnection) {
      const instances = await discoverLivePbi({ signal: request.signal });
      if (!request.isCurrent()) return;
      if (!instances.length) throw new Error('Abre el informe en Power BI Desktop y vuelve a conectar.');
      if (instances.length > 1) { chooseLiveInstanceModal(instances); return; }
      model = await fetchLivePbiModel(instances[0].server, instances[0].database || '', { signal: request.signal });
      if (!request.isCurrent()) return;
    }
    toast('Comprobando el modelo y las referencias…');
    const fresh = await fetchLivePbiModel(model.server, model.databaseId || model.database || '', { signal: request.signal });
    if (!request.isCurrent()) return;
    const database = fresh.databaseId || fresh.database;
    if (model.databaseId ? database !== model.databaseId : model.database && fresh.database !== model.database) throw new Error('El modelo ha cambiado. Vuelve a conectar el informe.');
    if (!request.commit(fresh, false)) return;
    const review = reviewMeasure(config, fresh);
    if (!review.valid) {
      await openMeasureReviewModal(config, () => applyLiveMeasure(config, undefined, requiredTarget));
      toast('Corrige las referencias pendientes antes de aplicar la medida.');
      return;
    }
    const existing = review.existing;
    const expectedExpression = existing?.expression ?? null;
    if (requiredTarget && (fresh.server !== requiredTarget.server || database !== requiredTarget.database || review.table !== requiredTarget.tableName)) {
      throw new Error('El destino original de la operación ha cambiado. Revisa el informe y la tabla antes de volver a aplicar la medida.');
    }
    if (approved && (approved.server !== fresh.server || approved.database !== database || approved.table !== review.table || !existing)) {
      throw new Error('El destino revisado ha cambiado. Vuelve a comprobar la medida antes de aplicarla.');
    }
    const approvalMatches = approved && approved.server === fresh.server && approved.database === database &&
      approved.table === review.table && approved.expression === expectedExpression;
    if (existing && !approvalMatches) {
      const approval = { server: fresh.server, database, table: review.table, expression: expectedExpression };
      showInjectConfirmModal([], existing, () => applyLiveMeasure(config, approval, requiredTarget), config);
      return;
    }
    const measureName = config.measureName.trim().replace(/^\[|\]$/g, '');
    const dax = generateDAX(config);
    const expressionStart = dax.indexOf('=');
    if (expressionStart < 0) throw new Error('No se pudo generar la expresión DAX.');
    target = Object.freeze({ server: fresh.server, database, tableName: review.table,
      measureName, reportName: getFriendlyReportName(fresh) });
    toast(existing ? 'Actualizando la medida en Power BI Desktop…' : 'Creando la medida en Power BI Desktop…');
    // Selection cancellation applies to reads. A submitted mutation must still
    // report its outcome, because changing views cannot undo a bridge write.
    submitted = true;
    const result = await injectMeasureToLivePbi({
      server: fresh.server, database, tableName: review.table,
      measureName, daxExpression: '\r\n' + dax.slice(expressionStart + 1).trimStart(),
      expectedExpression, formatString: '', configAnnotation: config
    });
    showInjectSuccessModal({ measureName: result.measureName, tableName: result.tableName,
      reportName: target.reportName, isNew: result.isNew, target, config,
      targetChanged: !matchesModelTarget(getPbipModel(), target) });
    toast(`Medida ${result.isNew ? 'creada' : 'actualizada'} en ${target.reportName} (${target.server}).`);
    // Refresh metadata only; a failed refresh never repeats the successful mutation.
    fetchLivePbiModel(fresh.server, database, { signal: request.signal }).then(catalog => request.commit(catalog, false))
      .catch(() => { if (request.isCurrent()) toast('Medida guardada. Actualiza el catálogo para consultar su estado.'); });
  } catch (error) {
    if (!submitted && !request.isCurrent()) return;
    if (target) showWriteError(error, config, target);
    else showInjectErrorModal({ error, measureName: config.measureName,
      reportName: getFriendlyReportName(model), onRetry: () => applyLiveMeasure(config) });
  } finally {
    writing = false;
    request.finish();
  }
}

/** @param {import('./types.d.ts').BridgeApiError} error @param {import('./types.d.ts').CardConfig} config @param {import('./types.d.ts').MeasureWriteTarget} target */
function showWriteError(error, config, target) {
  const reviewOriginal = () => {
    if (!matchesModelTarget(getPbipModel(), target)) { showWriteError(error, config, target); return; }
    return openMeasureReviewModal(config, () => applyLiveMeasure(config, undefined, target));
  };
  showInjectErrorModal({ error, measureName: target.measureName, reportName: target.reportName,
    target, config, targetChanged: !matchesModelTarget(getPbipModel(), target),
    onRetry: () => applyLiveMeasure(config, undefined, target), onReview: reviewOriginal });
  toast(`${error.outcomeUnknown ? 'Resultado sin confirmar' : 'No se completó la operación'} en ${target.reportName} (${target.server}). Revisa el destino original.`);
}
