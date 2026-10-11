import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, TEMPLATES, sanitizeConfig } from '../dist/model.mjs';
import { reviewMeasure, measureDestination } from '../dist/preflight.mjs';

const model = {
  modelName: 'Ventas', tables: ['Medidas', 'Calendario', 'Otro calendario'],
  measures: [{ name: 'Ventas €', table: 'Medidas' }, { name: 'Objetivo', table: 'Medidas' }, { name: 'Anterior', table: 'Medidas' }],
  dateTables: [{ name: 'Calendario', dateColumns: ['Fecha'] }, { name: 'Otro calendario', dateColumns: ['Día'] }]
};
const config = patch => sanitizeConfig({ ...BASE, measure: '[Ventas €]', measureName: 'KPI_Ventas', targetMeasure: '100', dateTable: 'Calendario', dateColumn: 'Fecha', ...patch });

test('Review resolves references, numeric targets and the same destination used for creation', () => {
  const result = reviewMeasure(config(), model);
  assert.equal(result.valid, true);
  assert.equal(result.table, 'Medidas');
  assert.equal(result.references.find(r => r.field === 'measure').table, 'Medidas');
  assert.equal(result.references.find(r => r.field === 'targetMeasure').status, 'constant');
  assert.equal(result.references.find(r => r.field === 'dateTable').status, 'ok');
  assert.equal(reviewMeasure(config({ targetMeasure: '1e3' }), model).valid, true);
});

test('Overwrite preserves the existing table even when a different target table is configured', () => {
  const connected = { ...model, measures: [...model.measures, { name: 'KPI_VENTAS', table: 'Destino existente' }] };
  assert.equal(measureDestination({ ...config(), targetTable: 'Calendario' }, connected).table, 'Destino existente');
  assert.equal(measureDestination({ ...config(), targetTable: 'Calendario' }, model).table, 'Calendario');
});

test('Missing measures, mismatched date columns and circular names block review', () => {
  assert.equal(reviewMeasure(config({ measure: 'No existe' }), model).valid, false);
  const wrongDate = reviewMeasure(config({ dateColumn: 'Fecha ausente' }), model);
  assert.equal(wrongDate.missing.find(r => r.field === 'dateTable').type, 'Calendario · columna de fecha');
  assert.equal(reviewMeasure(config({ measureName: 'Ventas €' }), model).valid, false);
  assert.equal(reviewMeasure(config({ comparison: 'custom', compareMeasure: 'No existe' }), model).valid, false);
});

test('Review includes independent duplicate chart dates and measures and duplicate objectives', () => {
  const c = config({ elements: {
    trend_copy1: { measure: 'Anterior', dateTable: 'Otro calendario', dateColumn: 'Día' },
    progress_copy1: { targetMeasure: 'Objetivo ausente' }
  } });
  const result = reviewMeasure(c, model);
  assert.ok(result.references.some(r => r.field === 'trend_copy1__dateTable' && r.value === "'Otro calendario'[Día]" && r.status === 'ok'));
  assert.ok(result.missing.some(r => r.field === 'progress_copy1'));
  assert.equal(reviewMeasure(config({ elements: { trend_copy1: { dateTable: 'Otro calendario', dateColumn: 'Fecha' } } }), model).valid, false);
  assert.equal(reviewMeasure(config({ elements: { trend_copy1: { deleted: true, measure: 'No existe' } } }), model).valid, true);
});

test('Review does not claim verification without a catalog or verified date metadata', () => {
  const offline = reviewMeasure(config(), null);
  assert.equal(offline.valid, false);
  assert.ok(offline.references.some(r => r.status === 'unknown'));
  const incomplete = reviewMeasure(config(), { ...model, dateTables: [] });
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.unverified.some(r => r.field === 'dateTable'));
});

test('A simple card does not acquire unused calendar, target or comparison requirements', () => {
  const simple = sanitizeConfig({ ...TEMPLATES.find(t => t.id === 'essential-paper').config, comparison: 'none', measure: 'Ventas €', measureName: 'KPI_Simple' });
  const result = reviewMeasure(simple, { ...model, dateTables: [] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.references.map(r => r.field), ['measure']);
});

test('Empty duplicate bindings are visible errors and never inherit the configured main references', () => {
  const c = config({ elements: { value_copy1: {}, trend_copy1: {}, delta_copy1: { comparison: 'custom' }, progress_copy1: {} } });
  const before = JSON.stringify(c);
  const result = reviewMeasure(c, model);
  for (const field of ['value_copy1','trend_copy1__measure','trend_copy1__dateTable','trend_copy1__dateColumn','delta_copy1__measure','delta_copy1','progress_copy1']) {
    assert.equal(result.fields[field].status, 'error', field);
    assert.equal(result.fields[field].empty, true, field);
  }
  assert.ok(result.references.some(r => r.field === 'value_copy1' && r.value === 'Sin configurar' && r.status === 'error'));
  assert.ok(result.issues.every(i => !i.text.includes('se calculará con')));
  assert.equal(result.valid, false);
  assert.equal(JSON.stringify(c), before);
});

test('Each duplicate field verifies its own catalog entry, including its date column and numeric target', () => {
  const c = config({ elements: { value_copy1: { measure: 'No existe' }, trend_copy1: { measure: 'Anterior', dateTable: 'Otro calendario', dateColumn: 'Fecha' }, progress_copy1: { targetMeasure: '0' } } });
  let result = reviewMeasure(c, model);
  assert.equal(result.fields.value_copy1.status, 'error');
  assert.equal(result.fields.trend_copy1__dateTable.status, 'ok');
  assert.equal(result.fields.trend_copy1__dateColumn.status, 'error');
  assert.equal(result.fields.progress_copy1.status, 'constant');
  c.elements.value_copy1.measure = 'Anterior';
  c.elements.trend_copy1.dateColumn = 'Día';
  result = reviewMeasure(c, model);
  assert.equal(result.valid, true);
});


test('Review checks an explicit copied status measure and accepts inherited main values',()=>{
 const custom=config({type:'status',elements:{status_copy1:{measure:'No existe'}}});
 assert.equal(reviewMeasure(custom,model).valid,false);
 assert.ok(reviewMeasure(custom,model).missing.some(x=>x.field==='status_copy1'));
 assert.equal(reviewMeasure(config({type:'status',elements:{status_copy1:{}}}),model).valid,true);
});


test('Large catalogs resolve every copied binding with a single indexed review', t => {
  const catalog={modelName:'Large model',tables:['Medidas','Calendario'],measures:Array.from({length:10000},(_,i)=>({name:`Metric ${i}`,table:'Medidas'})),dateTables:[{name:'Calendario',dateColumns:['Fecha']}]};
  const elements=Object.fromEntries(Array.from({length:100},(_,i)=>[`value_copy${i+1}`,{measure:`Metric ${9900+i}`}]));
  const card=config({measure:'Metric 9999',targetMeasure:'100',comparison:'none',elements});
  const start=performance.now();
  const review=reviewMeasure(card,catalog);
  const elapsed=performance.now()-start;
  assert.equal(review.valid,true);assert.equal(review.missing.length,0);
  for(let i=1;i<=100;i++)assert.equal(review.fields[`value_copy${i}`].status,'ok');
  t.diagnostic(`10,000 measures + 100 copies reviewed in ${elapsed.toFixed(1)} ms (observed; no machine-dependent timing assertion).`);
});
