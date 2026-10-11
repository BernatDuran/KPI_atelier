import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from '../dist/model.mjs';
import { directBindingFields, directBindingElements, bindingRevealOffset } from '../dist/bindings.mjs';

test('Visual bindings distinguish direct calculation inputs from decorative and downstream content', () => {
  const c = { ...BASE, comparison: 'yoy', chartKind: 'trend' };
  assert.deepEqual(directBindingFields(c, 'value'), ['measure']);
  assert.deepEqual(directBindingFields(c, 'title'), ['measureName']);
  assert.deepEqual(directBindingFields(c, 'delta'), ['measure', 'dateTable', 'dateColumn']);
  assert.deepEqual(directBindingFields(c, 'goalLabel'), ['targetMeasure']);
  assert.deepEqual(directBindingFields(c, 'progress'), ['measure', 'targetMeasure']);
  assert.deepEqual(directBindingFields(c, 'trend'), ['measure', 'dateTable', 'dateColumn', 'granularity']);
  for (const id of ['icon', 'eyebrow', 'subtitle', 'footer', 'compareLabel', 'referenceLabel']) {
    assert.deepEqual(directBindingFields(c, id), [], id);
  }
  const dates = directBindingElements(c, 'dateTable');
  assert.ok(dates.includes('delta') && dates.includes('period') && dates.includes('trend'));
  assert.ok(!dates.includes('value') && !dates.includes('progress') && !dates.includes('icon'));
});

test('Custom references, targets and donut charts only link to their own calculation inputs', () => {
  assert.deepEqual(directBindingFields({ ...BASE, comparison: 'custom' }, 'delta'), ['measure', 'compareMeasure']);
  assert.deepEqual(directBindingFields({ ...BASE, comparison: 'target' }, 'delta'), ['measure', 'targetMeasure']);
  assert.deepEqual(directBindingFields({ ...BASE, comparison: 'none' }, 'delta'), []);
  assert.deepEqual(directBindingFields({ ...BASE, chartKind: 'donut' }, 'trend'), ['measure', 'targetMeasure']);
  assert.deepEqual(directBindingFields({ ...BASE, comparison: 'custom' }, 'referenceValue'), ['compareMeasure']);
});

test('Independent copies always use their own fields without inheriting empty assignments', () => {
  const c = { ...BASE, elements: {
    value_copy1: { measure: 'Margen' },
    delta_copy1: { comparison: 'custom', compareMeasure: 'Margen anterior' },
    trend_copy1: { measure: 'Unidades', dateTable: 'Calendario comercial', dateColumn: 'Día' },
    value_copy2: {}, trend_copy2: {}, value_copy3: { hidden: true }, value_copy4: { deleted: true }
  } };
  assert.deepEqual(directBindingFields(c, 'value_copy1'), ['value_copy1']);
  assert.deepEqual(directBindingFields(c, 'delta_copy1'), ['delta_copy1__measure', 'delta_copy1']);
  assert.deepEqual(directBindingFields(c, 'trend_copy1'), ['trend_copy1__measure', 'trend_copy1__dateTable', 'trend_copy1__dateColumn', 'granularity']);
  assert.deepEqual(directBindingFields(c, 'value_copy2'), ['value_copy2']);
  assert.ok(!directBindingElements(c, 'measure').includes('value_copy1'));
  assert.ok(!directBindingElements(c, 'dateColumn').includes('trend_copy2'));
  assert.ok(!directBindingElements(c, 'dateColumn').includes('trend_copy1'));
  assert.deepEqual(directBindingFields(c, 'value_copy3'), []);
  assert.deepEqual(directBindingFields(c, 'value_copy4'), []);
});

test('Automatic reveal leaves visible fields still and moves only enough within the scroll boundaries', () => {
  const viewport = { top: 100, bottom: 500 };
  assert.equal(bindingRevealOffset({ top: 120, bottom: 450 }, viewport, 200, 800), 200);
  assert.equal(bindingRevealOffset({ top: 520, bottom: 590 }, viewport, 200, 800), 300);
  assert.equal(bindingRevealOffset({ top: 40, bottom: 90 }, viewport, 200, 800), 130);
  assert.equal(bindingRevealOffset({ top: -200, bottom: -100 }, viewport, 0, 800), 0);
  assert.equal(bindingRevealOffset({ top: 1000, bottom: 1200 }, viewport, 700, 800), 800);
});
