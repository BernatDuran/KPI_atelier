import { getC, getPbipModel, setPbipModel, getFriendlyReportName, toast } from './state.mjs';
import { discoverLivePbi, fetchLivePbiModel, injectMeasureToLivePbi } from './pbi-client.mjs';
import { generateDAX } from './dax.mjs';
import { reviewMeasure } from './preflight.mjs';
import { chooseLiveInstanceModal, openMeasureReviewModal, showInjectConfirmModal, showInjectSuccessModal, showInjectErrorModal } from './modals.mjs';

let writing = false;

/** Refresh and review before every write; never replay a write after a transport error. */
export async function applyLiveMeasure(config = structuredClone(getC()), approved = undefined) {
  if (writing) return;
  writing = true;
  let model = getPbipModel();
  try {
    if (!model?.isLiveConnection) {
      const instances = await discoverLivePbi();
      if (!instances.length) throw new Error('Abre el informe en Power BI Desktop y vuelve a conectar.');
      if (instances.length > 1) { chooseLiveInstanceModal(instances); return; }
      model = await fetchLivePbiModel(instances[0].server, instances[0].database || '');
    }
    toast('Comprobando el modelo y las referencias…');
    const fresh = await fetchLivePbiModel(model.server, model.databaseId || model.database || '');
    const database = fresh.databaseId || fresh.database;
    if (model.databaseId ? database !== model.databaseId : model.database && fresh.database !== model.database) throw new Error('El modelo ha cambiado. Vuelve a conectar el informe.');
    setPbipModel(fresh, false);
    const review = reviewMeasure(config, fresh);
    if (!review.valid) {
      await openMeasureReviewModal();
      toast('Corrige las referencias pendientes antes de aplicar la medida.');
      return;
    }
    const existing = review.existing;
    const expectedExpression = existing?.expression ?? null;
    const approvalMatches = approved && approved.server === fresh.server && approved.database === database &&
      approved.table === review.table && approved.expression === expectedExpression;
    if (existing && !approvalMatches) {
      const approval = { server: fresh.server, database, table: review.table, expression: expectedExpression };
      showInjectConfirmModal([], existing, () => applyLiveMeasure(config, approval));
      return;
    }
    const measureName = config.measureName.trim().replace(/^\[|\]$/g, '');
    const dax = generateDAX(config);
    const expressionStart = dax.indexOf('=');
    if (expressionStart < 0) throw new Error('No se pudo generar la expresión DAX.');
    toast(existing ? 'Actualizando la medida en Power BI Desktop…' : 'Creando la medida en Power BI Desktop…');
    const result = await injectMeasureToLivePbi({
      server: fresh.server, database, tableName: review.table,
      measureName, daxExpression: '\r\n' + dax.slice(expressionStart + 1).trimStart(),
      expectedExpression, formatString: '', configAnnotation: config
    });
    showInjectSuccessModal({ measureName: result.measureName, tableName: result.tableName,
      reportName: getFriendlyReportName(fresh), isNew: result.isNew });
    // Refresh metadata only; a failed refresh never repeats the successful mutation.
    fetchLivePbiModel(fresh.server, database).then(catalog => setPbipModel(catalog, false))
      .catch(() => toast('Medida guardada. Actualiza el catálogo para consultar su estado.'));
  } catch (error) {
    showInjectErrorModal({ error, measureName: config.measureName,
      reportName: getFriendlyReportName(model), onRetry: () => applyLiveMeasure(config) });
  } finally {
    writing = false;
  }
}
