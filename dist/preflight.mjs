import { checks, needsDate, needsGoal, needsCompare } from './model.mjs';
import { resolveElementDef, elementState } from './elements.mjs';
import { isNumericLiteral } from './dax.mjs';

const normalized = value => String(value || '').trim().toLocaleLowerCase('es');
const bareMeasure = value => String(value || '').trim().replace(/^\[|\]$/g, '').replaceAll(']]', ']');

export function measureDestination(c, model) {
  const existing = (model?.measures || []).find(m => normalized(m.name) === normalized(bareMeasure(c.measureName)));
  const tables = model?.tables || [];
  const table = existing?.table || tables.find(t => normalized(t) === normalized(c.targetTable)) ||
    model?.measures?.find(m => m.table)?.table ||
    tables.find(t => /^_?m(easure|edida)s?$/i.test(t)) ||
    tables.find(t => /^_?(kpi|metric)/i.test(t)) || tables[0] || '_Measures';
  return { existing, table };
}

// The same catalog checks are used by the review and the write action.
export function reviewMeasure(c, model) {
  const references = [];
  const measures = new Map((model?.measures || []).map(m => [normalized(m.name), m]));
  const dateTables = new Map((model?.dateTables || []).map(t => [normalized(t.name), t]));
  const tables = new Set((model?.tables || []).map(normalized));
  const fields = {};
  const issues = checks(c).filter(x => x.level === 'error' || x.level === 'warning');
  const addMeasure = (label, value, field, numeric = false) => {
    const raw = String(value ?? '').trim();
    const constant = numeric && raw !== '' && isNumericLiteral(raw) && Number.isFinite(Number(raw));
    const found = measures.get(normalized(bareMeasure(raw)));
    const status = !raw ? 'error' : constant ? 'constant' : !model ? 'unknown' : found ? 'ok' : 'error';
    const reference = { label, value: raw || 'Sin configurar', field, table: found?.table || '', status, empty: !raw };
    references.push(reference);
    fields[field] = reference;
  };
  const addDate = (label, table, column, field) => {
    table = String(table || '').trim();
    column = String(column || '').trim();
    const columnField = field === 'dateTable' ? 'dateColumn' : field.replace(/__dateTable$/, '__dateColumn');
    const dateTable = dateTables.get(normalized(table));
    const tableExists = dateTable || tables.has(normalized(table));
    const validColumn = dateTable?.dateColumns?.some(col => normalized(col) === normalized(column));
    const status = !table || !column ? 'error' : !model ? 'unknown' : !tableExists ? 'error' :
      dateTable ? validColumn ? 'ok' : 'error' : 'unknown';
    references.push({ label, value: table || column ? `'${table || 'Sin tabla'}'[${column || 'Sin columna'}]` : 'Sin configurar', field, table: '', status, empty: !table || !column });
    fields[field] = { status: !table ? 'error' : !model ? 'unknown' : !tableExists ? 'error' : dateTable ? 'ok' : 'unknown', empty: !table, value: table };
    fields[columnField] = { status: !column ? 'error' : !model ? 'unknown' : dateTable ? validColumn ? 'ok' : 'error' : tableExists ? 'unknown' : 'error', empty: !column, value: column };
  };

  addMeasure('Medida principal', c.measure, 'measure');
  if (needsGoal(c) || (needsCompare(c) && c.comparison === 'target')) addMeasure('Objetivo', c.targetMeasure, 'targetMeasure', true);
  if (needsCompare(c) && c.comparison === 'custom') addMeasure('Comparación', c.compareMeasure, 'compareMeasure');
  if (needsDate(c)) addDate('Calendario · columna de fecha', c.dateTable, c.dateColumn, 'dateTable');

  for (const id of Object.keys(c.elements || {})) {
    const def = resolveElementDef(id);
    const st = elementState(c, id);
    if (!def?.isDuplicate || st.deleted) continue;
    if (['value', 'trend', 'delta', 'referenceValue'].includes(def.baseId) || def.baseId === 'status' && st.measure?.trim()) {
      addMeasure(def.label, st.measure, ['trend','delta'].includes(def.baseId) ? `${id}__measure` : id);
    }
    if (['goalLabel', 'progressLabel', 'progress'].includes(def.baseId) || def.baseId === 'delta' && (st.comparison || c.comparison) === 'target') {
      addMeasure(`Objetivo · ${def.label}`, st.targetMeasure, id, true);
    }
    if (def.baseId === 'delta' && (st.comparison || c.comparison) === 'custom') {
      addMeasure(`Comparación · ${def.label}`, st.compareMeasure, id);
    }
    if (def.baseId === 'trend' && (st.chartKind || c.chartKind) !== 'donut') {
      addDate(`Calendario · ${def.label}`, st.dateTable, st.dateColumn, `${id}__dateTable`);
    }
  }

  const missing = references.filter(r => r.status === 'error').map(r => ({
    type: r.label, detail: r.empty ? 'Falta configurar esta referencia.' : `${r.value} no se encuentra en el modelo conectado.`, field: r.field
  }));
  const unverified = references.filter(r => r.status === 'unknown');
  const { existing, table } = measureDestination(c, model);
  const errors = issues.filter(x => x.level === 'error');
  fields.measureName = { status: errors.some(x => x.field === 'measureName') ? 'error' : 'ok', empty: !String(c.measureName || '').trim(), value: c.measureName };
  return { references, fields, issues, missing, unverified, existing, table,
    valid: errors.length === 0 && missing.length === 0 && unverified.length === 0 };
}
