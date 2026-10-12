import { ELEMENTS, elementState, resolveElementDef, layerOrder, MAX_DUPLICATES, MAX_DUPLICATES_PER_TYPE, linkedElements,usesGoalBinding,goalBinding,usesValueBinding,valueBinding } from './elements.mjs';
import { elementFrame } from './layout.mjs';

/** Capture content and styles independently of the current canvas selection. */
export function copyElementData(config, id, measuredFrame = null) {
  const state = elementState(config, id);
  const def = resolveElementDef(id) || ELEMENTS[id];
  if (!def) return null;
  const baseId = def.baseId || id;
  const properties = keys => Object.fromEntries(keys.map(key => [key, state[key] ?? config[key]]));
  return {
    id, baseId, state: structuredClone({ ...state,...(usesValueBinding(config,id)&&baseId!=='goalLabel'?{measure:valueBinding(config,id).measure}:{}),...(usesGoalBinding(config,id)?{targetMeasure:goalBinding(config,id).measure}:{}), frame: state.frame || measuredFrame || elementFrame(config, id) }), label: def.label || id,
    text: state.text?.trim() ? state.text : (def.contentKey ? config[def.contentKey] : undefined),
    icon: state.icon || config.icon,
    valProps: baseId === 'value' ? properties(['format', 'currency', 'unit', 'decimals', 'suffix', 'measure']) : {},
    deltaProps: baseId === 'delta' ? properties(['deltaMode', 'compareMeasure', 'comparison', 'direction']) : {},
    trendProps: baseId === 'trend' ? properties([
      'chartKind', 'trendStyle', 'trendCurve', 'areaFill', 'fillOpacity', 'lineWidth',
      'showMax', 'showMin', 'showDot', 'showMarkerGuides', 'zeroBase', 'trendGrid',
      'donutThickness', 'donutLabel', 'granularity'
    ]) : {}
  };
}

/** Produce one immutable paste transaction, retaining layer order and limits. */
export function pasteElementData(config, items, measureFrame = (_id) => null) {
  const activeCopies = Object.keys(config.elements || {}).filter(id => id.includes('_copy') && !config.elements[id].deleted);
  if (activeCopies.length + items.length > MAX_DUPLICATES) {
    return { config, ids: [], notices: ['Límite de duplicados alcanzado (máximo 8 copias en la tarjeta).'] };
  }
  let next = config;
  const ids = [], notices = [];
  for (const item of items) {
    const def = resolveElementDef(item.baseId) || ELEMENTS[item.baseId];
    if (!def) continue;
    const copies = Object.keys(next.elements || {}).filter(id => id.startsWith(item.baseId + '_copy') && !next.elements[id].deleted);
    if (copies.length >= MAX_DUPLICATES_PER_TYPE) {
      notices.push(`Límite alcanzado: máximo 2 copias para ${def.label}.`);
      continue;
    }
    let index = 1;
    while (next.elements?.[`${item.baseId}_copy${index}`] && !next.elements[`${item.baseId}_copy${index}`].deleted) index++;
    const id = `${item.baseId}_copy${index}`;
    resolveElementDef(id);
    const frame = item.state?.frame || measureFrame(item.id) || { left: 24, top: 24, width: 120, height: 24 };
    const state = {
      ...structuredClone(item.state), ...item.valProps, ...item.deltaProps, ...item.trendProps,
      x: 0, y: 0, hidden: false, deleted: false,
      frame: { ...frame, left: Math.min(next.width - 60, frame.left + (item.state.x || 0) + 16), top: Math.min(next.height - 40, frame.top + (item.state.y || 0) + 16) },
      ...(item.text !== undefined ? { text: item.text } : {}),
      ...(item.icon ? { icon: item.icon } : {})
    };
    if (item.baseId === 'trend') { delete state.dateTable; delete state.dateColumn; }
    next = { ...next, elements: { ...next.elements, [id]: state }, layerOrder: [id, ...layerOrder(next).filter(key => key !== id)] };
    ids.push(id);
  }
  return { config: ids.length?{...next,elements:linkedElements(next)}:config, ids, notices };
}
