import { ELEMENT_IDS, resolveElementDef, elementState } from './elements.mjs';

const temporalComparisons = ['yoy', 'mom', 'previous'];

// Direct configuration links, deliberately excluding downstream filter effects
// and decorative content. The reverse lookup uses exactly the same links.
export function directBindingFields(c, id) {
  const def = resolveElementDef(id);
  const st = elementState(c, id);
  if (!def || st.deleted || st.hidden) return [];
  const base = def.baseId || id;
  const duplicate = Boolean(def.isDuplicate);
  const comparison = duplicate ? st.comparison || c.comparison : c.comparison;
  const chartKind = duplicate ? st.chartKind || c.chartKind : c.chartKind;
  const own = prop => duplicate ? base === 'trend' ? `${id}__${prop}` : id : prop;
  const metric = duplicate && ['value','referenceValue','trend','delta'].includes(base) ? [base === 'delta' ? `${id}__measure` : own('measure')] : ['measure'];
  const dates = duplicate && base === 'trend' ? ['dateTable', 'dateColumn'].flatMap(prop =>
    [own(prop)]) : ['dateTable', 'dateColumn'];

  const reference = comparison === 'target' ? [duplicate ? own('targetMeasure') : 'targetMeasure'] :
    comparison === 'custom' ? [duplicate ? own('compareMeasure') : 'compareMeasure'] :
    temporalComparisons.includes(comparison) ? dates : [];
  const target = duplicate ? [own('targetMeasure')] : ['targetMeasure'];
  let fields = [];
  if (base === 'title' && !duplicate) fields = ['measureName'];
  if (base === 'value' || base === 'status') fields = metric;
  if (base === 'delta' && comparison !== 'none') fields = [...metric, ...reference];
  if (base === 'referenceValue') fields = duplicate ? metric : temporalComparisons.includes(comparison) ? [...metric, ...reference] : reference;
  if (base === 'period' && !duplicate) fields = dates;
  if (base === 'goalLabel') fields = target;
  if (base === 'progress' || base === 'progressLabel') fields = [...metric, ...target];
  if (base === 'trend') fields = chartKind === 'donut' ? [...metric, 'targetMeasure'] : [...metric, ...dates, ...(!duplicate || !st.granularity ? ['granularity'] : [])];
  return [...new Set(fields)];
}

export function directBindingElements(c, key) {
  return [...new Set([...ELEMENT_IDS, ...Object.keys(c.elements || {})])]
    .filter(id => directBindingFields(c, id).includes(key));
}

// Minimal movement to reveal a field or adjacent field group, with breathing room.
export function bindingRevealOffset(bounds, viewport, current, maximum) {
  const top = viewport.top + 10;
  const bottom = viewport.bottom - 10;
  const delta = bounds.top < top ? bounds.top - top : bounds.bottom > bottom ?
    bounds.bottom - bottom : 0;
  return Math.max(0, Math.min(maximum, current + delta));
}
