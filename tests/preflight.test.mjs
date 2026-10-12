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

test('Destination selection persists, prefers measure tables and rejects missing explicit targets', () => {
  const selected = config({targetTable:'Otro calendario'});
  assert.equal(selected.targetTable,'Otro calendario');
  assert.equal(reviewMeasure(selected,model).table,'Otro calendario');
  const missing=reviewMeasure(config({targetTable:'Deleted table'}),model);
  assert.equal(missing.valid,false);
  assert.equal(missing.table,'Deleted table');
  assert.equal(missing.fields.targetTable.status,'error');
  assert.ok(missing.issues.some(i=>i.field==='targetTable'));
  const catalog={...model,tables:['Fact','_Measures','Calendario'],measures:[{name:'Ventas €',table:'Fact'}]};
  assert.equal(measureDestination(config(),catalog).table,'_Measures');
  assert.equal(measureDestination(config(),catalog).automatic,true);
});

test('Inactive copied bindings cannot block a simple card review', () => {
  const c=config({type:'basic',comparison:'none',showGoal:false,showTrend:false,showComparison:false,
    elements:{trend_copy1:{measure:'Missing',dateTable:'Missing',dateColumn:'Missing'},delta_copy1:{comparison:'target',targetMeasure:'Missing'}}});
  const review=reviewMeasure(c,model);
  assert.equal(review.valid,true);
  assert.deepEqual(review.references.map(r=>r.field),['measure']);
});

test('Missing measures, mismatched date columns and circular names block review', () => {
  assert.equal(reviewMeasure(config({ measure: 'No existe' }), model).valid, false);
  const wrongDate = reviewMeasure(config({ dateColumn: 'Fecha ausente' }), model);
  assert.equal(wrongDate.missing.find(r => r.field === 'dateTable').type, 'Calendario · columna de fecha');
  assert.equal(reviewMeasure(config({ measureName: 'Ventas €' }), model).valid, false);
  assert.equal(reviewMeasure(config({ comparison: 'custom', compareMeasure: 'No existe' }), model).valid, false);
});

test('Review includes independent measures and objectives with one shared calendar', () => {
  const c = config({ elements: {
    trend_copy1: { measure: 'Anterior', dateTable: 'Otro calendario', dateColumn: 'Día' },
    progress_copy1: { targetMeasure: 'Objetivo ausente' }
  } });
  const result = reviewMeasure(c, model);
  assert.deepEqual(result.references.filter(r => r.field.includes('dateTable')).map(r=>r.value), ["'Calendario'[Fecha]"]);
  assert.equal(result.fields.trend_copy1__measure.status,'ok');
  assert.equal(result.fields.progress_copy1,undefined);
  assert.equal(result.fields.progress_copy1__targetMeasure.status,'error');
  assert.equal(result.valid,false);
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
  for (const field of ['value_copy1','delta_copy1']) {
    assert.equal(result.fields[field].status, 'error', field);
    assert.equal(result.fields[field].empty, true, field);
  }
  assert.ok(result.references.some(r => r.field === 'value_copy1' && r.value === 'Sin configurar' && r.status === 'error'));
  assert.ok(result.issues.every(i => !i.text.includes('se calculará con')));
  assert.equal(result.valid, false);
  assert.equal(JSON.stringify(c), before);
});

test('Copies verify their own measures and objectives while date validation uses the main fields', () => {
  const c = config({ elements: { value_copy1: { measure: 'No existe' }, trend_copy1: { measure: 'Anterior', dateTable: 'Otro calendario', dateColumn: 'Fecha' }, progress_copy1: { targetMeasure: '0' } } });
  let result = reviewMeasure(c, model);
  assert.equal(result.fields.value_copy1.status, 'error');
  assert.equal(result.fields.dateTable.status, 'ok');
  assert.equal(result.fields.dateColumn.status, 'ok');
  assert.equal(result.fields.trend_copy1__dateColumn, undefined);
  assert.equal(result.fields.progress_copy1,undefined);
  assert.equal(result.fields.targetMeasure.status,'constant');
  c.elements.value_copy1.measure = 'Anterior';
  result = reviewMeasure(c, model);
  assert.equal(result.valid, true);
  c.dateColumn='No existe';
  assert.equal(reviewMeasure(c,model).valid,false);
  assert.equal(reviewMeasure(c,model).fields.dateColumn.status,'error');
});


test('Review checks an explicit copied status measure and rejects an unconfigured orphan',()=>{
 const custom=config({type:'status',elements:{status_copy1:{measure:'No existe'}}});
 assert.equal(reviewMeasure(custom,model).valid,false);
 assert.ok(reviewMeasure(custom,model).missing.some(x=>x.field==='status_copy1__measure'));
 assert.equal(reviewMeasure(config({type:'status',elements:{status_copy1:{}}}),model).valid,false);
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

test('A linked variation or goal never validates obsolete assignments and blocks on its value owner',()=>{
 const c=config({elements:{value_copy1:{measure:'Anterior'},delta_copy1:{measure:'No existe',comparison:'target',targetMeasure:'Anterior'},goalLabel_copy1:{targetMeasure:'100'},progress_copy1:{}}});
 let review=reviewMeasure(c,model);
 assert.equal(review.valid,true);
 assert.deepEqual(review.references.map(r=>r.field),['measure','targetMeasure','dateTable','value_copy1','goalLabel_copy1__targetMeasure']);
 c.elements.value_copy1.measure='';
 review=reviewMeasure(c,model);
 assert.equal(review.valid,false);
 assert.deepEqual(review.missing.map(r=>r.field),['value_copy1']);
 c.elements.value_copy1.measure='Anterior';c.targetMeasure='No existe';
 assert.deepEqual(reviewMeasure(c,model).missing.map(r=>r.field),['targetMeasure']);
});
