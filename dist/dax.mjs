import {chartGeometry,trendSVG,markerSVG,emptyTrend,hash} from './charts.mjs';
import {elementColor,trendFill,appearance} from './appearance.mjs';
import {needsDate,needsTrend,needsGoal,needsCompare,checks} from './model.mjs';
import {elementEnabled,elementState,elementSize,resolveElementDef} from './elements.mjs';
import {cardHTML,tokenData,esc} from './cards.mjs';

export const quote = s => '"' + String(s).replaceAll('"', '""') + '"';
export const measureRef = s => {
 let v = String(s).trim();
 if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).replaceAll(']]', ']');
 return '[' + v.replaceAll(']', ']]') + ']';
};
export const isNumericLiteral = s => {
 if (typeof s === 'number') return Number.isFinite(s);
 if (typeof s !== 'string') return false;
 const t = s.trim();
 return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t) && Number.isFinite(Number(t));
};

export const targetRef = s => {
 if (!s && s !== 0) return 'BLANK ()';
 const trimmed = String(s).trim();
 if (isNumericLiteral(trimmed)) return String(Number(trimmed));
 return measureRef(trimmed);
};

export const tableRef = s => "'" + String(s).replaceAll("'", "''") + "'";
const colRef = s => '[' + String(s).replaceAll(']', ']]') + ']';

export function compileHTML(html) {
 const parts = html.split(/(@@[a-zA-Z0-9_]+@@)/g).filter(Boolean);
 return parts.map(p => /^@@[a-zA-Z0-9_]+@@$/.test(p) ? '__' + p.slice(2, -2) : quote(p)).join(' &\n    ');
}

function formatted(v, c) {
 const decimals = c.decimals > 0 ? '.' + '0'.repeat(c.decimals) : '';
 const pattern = c.format === 'percent' ? '0' + decimals + '%' : '#,0' + decimals;
 const divisor = c.format === 'percent' ? '1' : c.unit === 'auto'
  ? `SWITCH ( TRUE (), ABS ( ${v} ) >= 1000000, 1000000, ABS ( ${v} ) >= 1000, 1000, 1 )`
  : c.unit === 'm' ? '1000000' : c.unit === 'k' ? '1000' : '1';
 const unit = c.format === 'percent' || c.unit === 'none' ? '""'
  : c.unit === 'm' ? '" M"' : c.unit === 'k' ? '" mil"'
  : `SWITCH ( TRUE (), ABS ( ${v} ) >= 1000000, " M", ABS ( ${v} ) >= 1000, " mil", "" )`;
 const suffix = esc((c.format === 'currency' ? ' ' + ({EUR: '€', USD: '$', GBP: '£'}[c.currency]) : '') + (c.suffix ? ' ' + c.suffix : ''));
 return `IF ( ISBLANK ( ${v} ), "—", FORMAT ( DIVIDE ( ${v}, ${divisor} ), ${quote(pattern)}, __Cfg_Locale ) & ${unit} & ${quote(suffix)} )`;
}


function periodDAX(table, date, m, suffix = '') {
 let code = `// ============================================================================\n` +
   `// 2. PERÍODO: FILTROS DE CALENDARIO O ÚLTIMOS 12 MESES MÓVILES CON DATOS (FASE A)\n` +
   `// ============================================================================\n` +
   `VAR __HasCalendarFilter${suffix} = ISFILTERED ( ${table} )\n` +
   `VAR __LastDataDate${suffix} = IF (\n` +
   `    NOT __HasCalendarFilter${suffix},\n` +
   `    MAXX (\n` +
   `        CALCULATETABLE (\n` +
   `            LASTNONBLANK ( ${date}, ${m} ),\n` +
   `            REMOVEFILTERS ( ${table} )\n` +
   `        ),\n` +
   `        ${date}\n` +
   `    )\n` +
   `)\n` +
   `VAR __DefaultStart${suffix} = IF ( NOT ISBLANK ( __LastDataDate${suffix} ), EDATE ( __LastDataDate${suffix}, -12 ) + 1 )\n` +
   `VAR __Dates${suffix} = CALCULATETABLE (\n` +
   `    VALUES ( ${date} ),\n` +
   `    KEEPFILTERS (\n` +
   `        FILTER (\n` +
   `            ALL ( ${date} ),\n` +
   `            NOT ISBLANK ( ${date} )\n` +
   `                && (\n` +
   `                    __HasCalendarFilter${suffix}\n` +
   `                        || (\n` +
   `                            NOT ISBLANK ( __LastDataDate${suffix} )\n` +
   `                                && ${date} >= __DefaultStart${suffix}\n` +
   `                                && ${date} <= __LastDataDate${suffix}\n` +
   `                        )\n` +
   `                )\n` +
   `        )\n` +
   `    )\n` +
   `)\n` +
   `VAR __DateCount${suffix} = COUNTROWS ( __Dates${suffix} )\n` +
   `VAR __HasDates${suffix} = __DateCount${suffix} > 0\n` +
   `VAR __Start${suffix} = MINX ( __Dates${suffix}, ${date} )\n` +
   `VAR __End${suffix} = MAXX ( __Dates${suffix}, ${date} )\n` +
   `VAR __Span${suffix} = IF ( __HasDates${suffix}, INT ( __End${suffix} - __Start${suffix} ) + 1 )\n` +
   `VAR __IsDiscontinuous${suffix} = __HasDates${suffix} && __DateCount${suffix} <> __Span${suffix}\n` +
   `// El valor actual se evalúa sobre el mismo conjunto de fechas exactas que la tendencia.\n` +
   `VAR __Current${suffix} = IF ( __HasDates${suffix}, CALCULATE ( ${m}, REMOVEFILTERS ( ${table} ), TREATAS ( __Dates${suffix}, ${date} ) ) )\n`;
 return code;
}

export function generateDAX(c, { allowIncomplete = false } = {}) {
 const errors = checks(c).filter(x => x.level === 'error');
 if (errors.length && !allowIncomplete) throw new Error(errors.map(x => x.text).join('\n'));

 const m = measureRef(c.measure);
 const dateNeeded = needsDate(c);
 const table = dateNeeded ? tableRef(c.dateTable) : "''";
 const date = dateNeeded ? `${table}${colRef(c.dateColumn)}` : "''";
 const target = needsGoal(c) || (needsCompare(c) && c.comparison === 'target');
 const hasStatus = c.type === 'status' || (elementEnabled(c, 'status') && !elementState(c, 'status').deleted);
 const rawName = c.measureName.trim();
 const isSimpleIdent = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(rawName);
 const daxHeaderName = isSimpleIdent ? rawName : measureRef(rawName);

 let code = `${daxHeaderName} =\n` +
  `// ============================================================================\n` +
  `// KPI Atelier · HTML Content Secure · HTML + SVG sin recursos externos\n` +
  `// Medida lista para Power BI Desktop (visual HTML Content / HTML Viewer)\n` +
  `// ============================================================================\n` +
  `//\n` +
  `// 1. CONFIGURACIÓN Y PARÁMETROS EDITABLES EN POWER BI\n` +
  `// Modifica los valores de estas variables para personalizar la tarjeta:\n` +
  `// ============================================================================\n` +
  `VAR __Cfg_Locale = "${c.locale}"                   // Idioma/formato regional de números y fechas\n` +
  `VAR __Cfg_ColorText = "${c.text}"                  // Color principal de texto y valores\n` +
  `VAR __Cfg_ColorMuted = "${c.muted}"                // Color secundario, etiquetas y neutro\n` +
  `VAR __Cfg_ColorAccent = "${c.accent}"              // Color de acento y tendencia\n` +
  `VAR __Cfg_ColorGood = "${c.positive}"              // Color de estado favorable / positivo\n` +
  `VAR __Cfg_ColorWarn = "${c.warning}"               // Color de aviso / intermedio\n` +
  `VAR __Cfg_ColorBad = "${c.negative}"               // Color desfavorable / negativo\n` +
  `${c.direction === 'neutral' ? '' : `VAR __Cfg_HigherIsBetter = ${c.direction === 'down' ? 'FALSE ()' : 'TRUE ()'}       // TRUE: subir es bueno; FALSE: bajar es bueno\n`}` +
  `${hasStatus ? `VAR __Cfg_GoodThreshold = ${c.goodThreshold}           // Umbral favorable\nVAR __Cfg_WarnThreshold = ${c.warnThreshold}           // Umbral advertencia\n` : ''}` +
  `// Referencias del modelo utilizadas en esta medida:\n` +
  `// - Medida de negocio principal: ${m}\n` +
  `${dateNeeded ? `// - Tabla calendario: ${table}\n// - Columna de fechas: ${date}\n` : ''}` +
  `${target ? `// - Medida u objetivo: ${targetRef(c.targetMeasure)}\n` : ''}` +
  `${needsCompare(c) && c.comparison === 'custom' ? `// - Medida de referencia: ${measureRef(c.compareMeasure)}\n` : ''}` +
  Object.keys(c.elements || {}).filter(k => k.includes('_copy') && !c.elements[k].deleted).map(dupId => {
   const def = resolveElementDef(dupId);
   const st = elementState(c, dupId);
   if (def?.baseId === 'trend') return `// - Gráfico en ${def?.label || dupId}: medida ${st.measure?.trim() ? measureRef(st.measure) : 'Sin configurar'}, calendario ${tableRef(st.dateTable || '')}[${st.dateColumn || 'Sin configurar'}]\n`;
   if (def?.baseId === 'value' || (st.measure && st.measure.trim())) return `// - Medida en ${def?.label || dupId}: ${st.measure?.trim() ? measureRef(st.measure) : 'Sin configurar'}\n`;
   if (def?.baseId === 'delta' && st.compareMeasure?.trim()) return `// - Medida de referencia en ${def?.label || dupId}: ${measureRef(st.compareMeasure)}\n`;
   return '';
  }).join('') + `\n`;

 if (dateNeeded) {
  code += periodDAX(table, date, m);
 } else {
  code += `VAR __Current = ${m}\n` +
   `VAR __HasDates = FALSE ()\n` +
   `VAR __IsDiscontinuous = FALSE ()\n`;
 }

 // Measures share the exact calendar window; literal objectives remain constants.
 const inPeriod = expr => dateNeeded && expr !== 'BLANK ()' && !isNumericLiteral(expr) ? `IF ( __HasDates, CALCULATE ( ${expr}, REMOVEFILTERS ( ${table} ), TREATAS ( __Dates, ${date} ) ) )` : expr;
 code += `VAR __Target = ${target ? inPeriod(targetRef(c.targetMeasure)) : 'BLANK ()'}\n`;

 if (needsCompare(c) && ['yoy', 'mom'].includes(c.comparison)) {
  code += `// ============================================================================\n` +
   `// 3. COMPARATIVA TEMPORAL (${c.comparison.toUpperCase()})\n` +
   `// ============================================================================\n` +
   `// Desplaza las fechas seleccionadas ${c.comparison === 'yoy' ? 12 : 1} meses con EDATE.\n` +
   `// Bisiestos (ej. 29/02/2012 -> 28/02/2011) se tratan como conjunto único.\n` +
   `VAR __ShiftedDates = DISTINCT ( SELECTCOLUMNS ( __Dates, "__ShiftedDate", EDATE ( ${date}, ${c.comparison === 'yoy' ? -12 : -1} ) ) )\n` +
   `VAR __AvailablePriorDates = SELECTCOLUMNS ( CALCULATETABLE ( VALUES ( ${date} ), REMOVEFILTERS ( ${table} ) ), "__ShiftedDate", ${date} )\n` +
   `VAR __PriorDateCount = COUNTROWS ( INTERSECT ( __ShiftedDates, __AvailablePriorDates ) )\n` +
   `VAR __ComparableDates = __HasDates && __PriorDateCount = COUNTROWS ( __ShiftedDates )\n` +
   `VAR __Reference = IF ( __ComparableDates, CALCULATE ( ${m}, REMOVEFILTERS ( ${table} ), TREATAS ( __ShiftedDates, ${date} ) ) )\n`;
 } else if (needsCompare(c) && c.comparison === 'previous') {
  code += `// ============================================================================\n` +
   `// 3. COMPARATIVA CON PERÍODO ANTERIOR\n` +
   `// ============================================================================\n` +
   `VAR __CalendarDates = CALCULATETABLE ( VALUES ( ${date} ), REMOVEFILTERS ( ${table} ) )\n` +
   `VAR __PreviousDates = FILTER ( __CalendarDates, ${date} >= __Start - __Span && ${date} < __Start )\n` +
   `VAR __ComparableDates = __HasDates && NOT __IsDiscontinuous && COUNTROWS ( __PreviousDates ) = __Span\n` +
   `VAR __Reference = IF ( __ComparableDates, CALCULATE ( ${m}, REMOVEFILTERS ( ${table} ), TREATAS ( __PreviousDates, ${date} ) ) )\n`;
 } else {
  code += `VAR __Reference = ${needsCompare(c) ? c.comparison === 'target' ? '__Target' : c.comparison === 'custom' ? inPeriod(measureRef(c.compareMeasure)) : 'BLANK ()' : 'BLANK ()'}\n`;
 }

 code += `VAR __Difference = IF ( NOT ISBLANK ( __Current ) && NOT ISBLANK ( __Reference ), __Current - __Reference )\n` +
  `VAR __Relative = DIVIDE ( __Difference, ABS ( __Reference ) )\n` +
  `VAR __value = ${formatted('__Current', c)}\n` +
  `VAR __previous = ${formatted('__Reference', c)}\n` +
  `VAR __targettext = ${formatted('__Target', c)}\n` +
  `VAR __delta = ${c.deltaMode === 'absolute' ? `IF ( ISBLANK ( __Difference ), "—", IF ( __Difference > 0, "+", "" ) & ${formatted('__Difference', c)} )` : c.deltaMode === 'pp' ? `IF ( ISBLANK ( __Difference ), "—", FORMAT ( __Difference * 100, "+0.0;-0.0;0.0", __Cfg_Locale ) & " pp" )` : `IF ( ISBLANK ( __Relative ), "—", FORMAT ( __Relative, "+0.0%;-0.0%;0.0%", __Cfg_Locale ) )`}\n` +
  `VAR __arrow = SWITCH ( TRUE (), ISBLANK ( __Difference ) || __Difference = 0, "—", __Difference > 0, "↗", "↘" )\n` +
  `VAR __deltaColor = ${c.direction === 'neutral' ? '__Cfg_ColorMuted' : `SWITCH ( TRUE (), ISBLANK ( __Difference ) || __Difference = 0, __Cfg_ColorMuted, ( __Difference > 0 ) = __Cfg_HigherIsBetter, __Cfg_ColorGood, __Cfg_ColorBad )`}\n` +
  `VAR __GoalRatio = IF ( __Target > 0 && NOT ISBLANK ( __Current ), DIVIDE ( __Current, __Target ) )\n` +
  `VAR __progress = IF ( ISBLANK ( __GoalRatio ), "—", FORMAT ( __GoalRatio, "0%", __Cfg_Locale ) )\n` +
  `VAR __progressWidth = FORMAT ( IF ( ISBLANK ( __GoalRatio ), 0, MAX ( 0, MIN ( 100, __GoalRatio * 100 ) ) ), "0.00", "en-US" )\n` +
  `VAR __goalColor = IF ( ISBLANK ( __GoalRatio ), __Cfg_ColorMuted, ${c.direction === 'neutral' ? '__Cfg_ColorAccent' : `IF ( ( __Current >= __Target ) = __Cfg_HigherIsBetter, __Cfg_ColorGood, __Cfg_ColorWarn )`} )\n`;

 if (hasStatus) {
  code += `VAR __StatusCode = SWITCH ( TRUE (), ISBLANK ( __Current ), 0, __Current ${c.direction === 'down' ? '<=' : '>='} __Cfg_GoodThreshold, 3, __Current ${c.direction === 'down' ? '<=' : '>='} __Cfg_WarnThreshold, 2, 1 )\n` +
   `VAR __status = SWITCH ( __StatusCode, 3, ${quote(esc(c.statusGood))}, 2, ${quote(esc(c.statusWarn))}, 1, ${quote(esc(c.statusBad))}, "Sin datos" )\n` +
   `VAR __statusColor = SWITCH ( __StatusCode, 3, __Cfg_ColorGood, 2, __Cfg_ColorWarn, 1, __Cfg_ColorBad, __Cfg_ColorMuted )\n` +
   `VAR __statusGoodOpacity = IF ( __StatusCode = 3, "1", "0.2" )\n` +
   `VAR __statusWarnOpacity = IF ( __StatusCode = 2, "1", "0.2" )\n` +
   `VAR __statusBadOpacity = IF ( __StatusCode = 1, "1", "0.2" )\n`;
 } else {
  code += `VAR __StatusCode = 0\nVAR __status = "Sin datos"\nVAR __statusColor = __Cfg_ColorMuted\nVAR __statusGoodOpacity = "0.2"\nVAR __statusWarnOpacity = "0.2"\nVAR __statusBadOpacity = "0.2"\n`;
 }

 code += `VAR __period = ${dateNeeded ? `IF ( NOT __HasDates, "Sin período", FORMAT ( __Start, "dd/MM/yy" ) & " – " & FORMAT ( __End, "dd/MM/yy" ) & IF ( __IsDiscontinuous, " *", "" ) )` : '"Período seleccionado"'}\n`;

 if (needsTrend(c)) {
  code += trendDAX(c);
 } else {
  code += `VAR __trend = ""\nVAR __footer = ${quote(esc(c.footer || 'Rendimiento del período'))}\n`;
 }

 const dupIds = Object.keys(c.elements || {}).filter(k => k.includes('_copy') && !c.elements[k].deleted);
 const duplicateGoal = (id, current, objective, conf) =>
  `VAR __Target_${id} = ${objective}\n` +
  `VAR __val_${id} = ${formatted(`__Target_${id}`, conf)}\n` +
  `VAR __GoalRatio_${id} = IF ( __Target_${id} > 0 && NOT ISBLANK ( ${current} ), DIVIDE ( ${current}, __Target_${id} ) )\n` +
  `VAR __progress_${id} = IF ( ISBLANK ( __GoalRatio_${id} ), "—", FORMAT ( __GoalRatio_${id}, "0%", __Cfg_Locale ) )\n` +
  `VAR __progressWidth_${id} = FORMAT ( MIN ( 1, MAX ( 0, COALESCE ( __GoalRatio_${id}, 0 ) ) ) * 100, "0.0", "en-US" )\n`;
 for (const dupId of dupIds) {
  const def = resolveElementDef(dupId);
  if (!def) continue;
  const dupState = elementState(c, dupId);
  if (def.baseId === 'trend') {
   const dupKind = dupState.chartKind || c.chartKind;
   if (dupKind !== 'donut' && needsDate(c)) {
    code += trendDAX(c, dupId);
   } else {
    const metric = dupState.measure?.trim() ? measureRef(dupState.measure) : 'BLANK ()';
    code += `VAR __Cur_${dupId} = ${inPeriod(metric)}\n`;
    code += duplicateGoal(dupId, `__Cur_${dupId}`, c.targetMeasure?.trim() ? inPeriod(targetRef(c.targetMeasure)) : 'BLANK ()', c);
    code += `VAR __trend_${dupId} = ""\n`;
   }
  } else if (def.baseId === 'status') {
   const current = dupState.measure?.trim() ? inPeriod(measureRef(dupState.measure)) : '__Current';
   const direction = dupState.direction || c.direction;
   const op = direction === 'down' ? '<=' : '>=';
   code += `VAR __StatusValue_${dupId} = ${current}\n` +
    `VAR __StatusCode_${dupId} = SWITCH ( TRUE (), ISBLANK ( __StatusValue_${dupId} ), 0, __StatusValue_${dupId} ${op} ${dupState.goodThreshold ?? c.goodThreshold}, 3, __StatusValue_${dupId} ${op} ${dupState.warnThreshold ?? c.warnThreshold}, 2, 1 )\n` +
    `VAR __status_${dupId} = SWITCH ( __StatusCode_${dupId}, 3, ${quote(esc(dupState.statusGood ?? c.statusGood))}, 2, ${quote(esc(dupState.statusWarn ?? c.statusWarn))}, 1, ${quote(esc(dupState.statusBad ?? c.statusBad))}, "Sin datos" )\n` +
    `VAR __statusColor_${dupId} = SWITCH ( __StatusCode_${dupId}, 3, __Cfg_ColorGood, 2, __Cfg_ColorWarn, 1, __Cfg_ColorBad, __Cfg_ColorMuted )\n`;
   for (const [name, value] of [['Good', 3], ['Warn', 2], ['Bad', 1]]) code += `VAR __status${name}Opacity_${dupId} = IF ( __StatusCode_${dupId} = ${value}, "1", "0.2" )\n`;
  } else if (def.baseId === 'value') {
   const dupMeasure = dupState.measure?.trim() ? measureRef(dupState.measure) : 'BLANK ()';
   const isSameAsMainMeasure = Boolean(dupState.measure?.trim()) && dupState.measure.trim().toLowerCase() === c.measure.trim().toLowerCase();
   const dupConf = {
    ...c,
    format: dupState.format || c.format,
    decimals: dupState.decimals ?? c.decimals,
    unit: dupState.unit || c.unit,
    currency: dupState.currency || c.currency,
    suffix: dupState.suffix !== undefined ? dupState.suffix : c.suffix
   };
   const isSameFormat = (dupState.format || c.format) === c.format &&
    (dupState.decimals ?? c.decimals) === c.decimals &&
    (dupState.unit || c.unit) === c.unit &&
    (dupState.currency || c.currency) === c.currency &&
    (dupState.suffix !== undefined ? dupState.suffix : c.suffix) === c.suffix;

   if (isSameAsMainMeasure && isSameFormat) {
    code += `VAR __val_${dupId} = __value\n`;
   } else if (isSameAsMainMeasure) {
    code += `VAR __val_${dupId} = ${formatted('__Current', dupConf)}\n`;
   } else {
    if (dateNeeded) {
     code += `VAR __Cur_${dupId} = IF ( __HasDates, CALCULATE ( ${dupMeasure}, REMOVEFILTERS ( ${table} ), TREATAS ( __Dates, ${date} ) ) )\n`;
     code += `VAR __val_${dupId} = ${formatted(`__Cur_${dupId}`, dupConf)}\n`;
    } else {
     code += `VAR __val_${dupId} = ${formatted(dupMeasure, dupConf)}\n`;
    }
   }
  } else if (def.baseId === 'delta') {
   const targetMetric = dupState.measure?.trim() || '';
   const dupMetricRef = targetMetric ? measureRef(targetMetric) : 'BLANK ()';
   const isSameMetricAsMain = targetMetric.toLowerCase() === c.measure.trim().toLowerCase();
   const dupComp = dupState.comparison || c.comparison;
   const dupMode = dupState.deltaMode || c.deltaMode;
   const dupDir = dupState.direction || c.direction;

   let curExpr;
   if (isSameMetricAsMain) {
    curExpr = '__Current';
   } else {
    if (dateNeeded) {
     code += `VAR __Cur_${dupId} = IF ( __HasDates, CALCULATE ( ${dupMetricRef}, REMOVEFILTERS ( ${table} ), TREATAS ( __Dates, ${date} ) ) )\n`;
    } else {
     code += `VAR __Cur_${dupId} = ${dupMetricRef}\n`;
    }
    curExpr = `__Cur_${dupId}`;
   }

   let refExpr = 'BLANK ()';
   if (dupComp === 'none') {
    refExpr = 'BLANK ()';
   } else if (['yoy', 'mom'].includes(dupComp)) {
    if (isSameMetricAsMain && c.comparison === dupComp && needsCompare(c)) {
     refExpr = '__Reference';
    } else if (c.comparison === dupComp && needsCompare(c)) {
     code += `VAR __Ref_${dupId} = IF ( __ComparableDates, CALCULATE ( ${dupMetricRef}, REMOVEFILTERS ( ${table} ), TREATAS ( __ShiftedDates, ${date} ) ) )\n`;
     refExpr = `__Ref_${dupId}`;
    } else if (dateNeeded) {
     const months = dupComp === 'yoy' ? -12 : -1;
     code += `VAR __ShiftedDates_${dupId} = DISTINCT ( SELECTCOLUMNS ( __Dates, "__ShiftedDate", EDATE ( ${date}, ${months} ) ) )\n` +
      `VAR __PriorDates_${dupId} = SELECTCOLUMNS ( CALCULATETABLE ( VALUES ( ${date} ), REMOVEFILTERS ( ${table} ) ), "__ShiftedDate", ${date} )\n` +
      `VAR __ComparableDates_${dupId} = __HasDates && COUNTROWS ( INTERSECT ( __ShiftedDates_${dupId}, __PriorDates_${dupId} ) ) = COUNTROWS ( __ShiftedDates_${dupId} )\n` +
      `VAR __Ref_${dupId} = IF ( __ComparableDates_${dupId}, CALCULATE ( ${dupMetricRef}, REMOVEFILTERS ( ${table} ), TREATAS ( __ShiftedDates_${dupId}, ${date} ) ) )\n`;
     refExpr = `__Ref_${dupId}`;
    }
   } else if (dupComp === 'previous') {
    if (isSameMetricAsMain && c.comparison === 'previous' && needsCompare(c)) {
     refExpr = '__Reference';
    } else if (c.comparison === 'previous' && needsCompare(c)) {
     code += `VAR __Ref_${dupId} = IF ( __ComparableDates, CALCULATE ( ${dupMetricRef}, REMOVEFILTERS ( ${table} ), TREATAS ( __PreviousDates, ${date} ) ) )\n`;
     refExpr = `__Ref_${dupId}`;
    } else if (dateNeeded) {
     code += `VAR __CalendarDates_${dupId} = CALCULATETABLE ( VALUES ( ${date} ), REMOVEFILTERS ( ${table} ) )\n` +
      `VAR __PreviousDates_${dupId} = FILTER ( __CalendarDates_${dupId}, ${date} >= __Start - __Span && ${date} < __Start )\n` +
      `VAR __ComparableDates_${dupId} = __HasDates && NOT __IsDiscontinuous && COUNTROWS ( __PreviousDates_${dupId} ) = __Span\n` +
      `VAR __Ref_${dupId} = IF ( __ComparableDates_${dupId}, CALCULATE ( ${dupMetricRef}, REMOVEFILTERS ( ${table} ), TREATAS ( __PreviousDates_${dupId}, ${date} ) ) )\n`;
     refExpr = `__Ref_${dupId}`;
    }
   } else if (dupComp === 'target') {
    if (dupState.targetMeasure && dupState.targetMeasure.trim()) {
     refExpr = inPeriod(targetRef(dupState.targetMeasure.trim()));
    } else {
     refExpr = 'BLANK ()';
    }
   } else if (dupComp === 'custom') {
    if (dupState.compareMeasure && dupState.compareMeasure.trim()) {
     refExpr = inPeriod(measureRef(dupState.compareMeasure.trim()));
    } else {
     refExpr = 'BLANK ()';
    }
   }

   const sameReference = !['target','custom'].includes(dupComp) || String(dupComp === 'target' ? dupState.targetMeasure : dupState.compareMeasure).trim().toLowerCase() === String(dupComp === 'target' ? c.targetMeasure : c.compareMeasure).trim().toLowerCase();
   const isIdenticalToMainDelta = isSameMetricAsMain && sameReference && dupComp === c.comparison && dupMode === c.deltaMode && dupDir === c.direction && needsCompare(c);
   if (isIdenticalToMainDelta) {
    code += `VAR __Diff_${dupId} = __Difference\n` +
     `VAR __Rel_${dupId} = __Relative\n` +
     `VAR __arrow_${dupId} = __arrow\n` +
     `VAR __delta_${dupId} = __delta\n` +
     `VAR __deltaColor_${dupId} = __deltaColor\n`;
   } else {
    code += `VAR __Diff_${dupId} = IF ( NOT ISBLANK ( ${curExpr} ) && NOT ISBLANK ( ${refExpr} ), ${curExpr} - ${refExpr} )\n` +
     `VAR __Rel_${dupId} = DIVIDE ( __Diff_${dupId}, ABS ( ${refExpr} ) )\n`;

    const dupConf = {
     ...c,
     format: dupState.format || c.format,
     decimals: dupState.decimals ?? c.decimals,
     unit: dupState.unit || c.unit,
     currency: dupState.currency || c.currency
    };
    let deltaExpr;
    if (dupComp === 'none') {
     deltaExpr = `"—"`;
    } else if (dupMode === 'absolute') {
     deltaExpr = `IF ( ISBLANK ( __Diff_${dupId} ), "—", IF ( __Diff_${dupId} > 0, "+", "" ) & ${formatted(`__Diff_${dupId}`, dupConf)} )`;
    } else if (dupMode === 'pp') {
     deltaExpr = `IF ( ISBLANK ( __Diff_${dupId} ), "—", FORMAT ( __Diff_${dupId} * 100, "+0.0;-0.0;0.0", __Cfg_Locale ) & " pp" )`;
    } else {
     deltaExpr = `IF ( ISBLANK ( __Rel_${dupId} ), "—", FORMAT ( __Rel_${dupId}, "+0.0%;-0.0%;0.0%", __Cfg_Locale ) )`;
    }
    code += `VAR __delta_${dupId} = ${deltaExpr}\n`;

    code += `VAR __arrow_${dupId} = ${dupComp === 'none' ? `"—"` : `SWITCH ( TRUE (), ISBLANK ( __Diff_${dupId} ) || __Diff_${dupId} = 0, "—", __Diff_${dupId} > 0, "↗", "↘" )`}\n`;

    let colorExpr;
    if (dupComp === 'none' || dupDir === 'neutral') {
     colorExpr = `__Cfg_ColorMuted`;
    } else {
     const higherIsBetter = dupDir === 'down' ? 'FALSE ()' : 'TRUE ()';
     colorExpr = `SWITCH ( TRUE (), ISBLANK ( __Diff_${dupId} ) || __Diff_${dupId} = 0, __Cfg_ColorMuted, ( __Diff_${dupId} > 0 ) = ${higherIsBetter}, __Cfg_ColorGood, __Cfg_ColorBad )`;
    }
    code += `VAR __deltaColor_${dupId} = ${colorExpr}\n`;
   }
  } else if (def.baseId === 'referenceValue') {
   const dupRef = dupState.measure?.trim() ? measureRef(dupState.measure) : 'BLANK ()';
   code += `VAR __val_${dupId} = ${formatted(inPeriod(dupRef), c)}\n`;
  } else if (['goalLabel','progressLabel','progress'].includes(def.baseId)) {
   code += duplicateGoal(dupId, '__Current', dupState.targetMeasure?.trim() ? inPeriod(targetRef(dupState.targetMeasure)) : 'BLANK ()', { ...c, ...dupState });
  } else if (dupState.measure && dupState.measure.trim()) {
   code += `VAR __val_${dupId} = ${formatted(measureRef(dupState.measure), c)}\n`;
  }
 }

 const compiledReturn = compileHTML(cardHTML(c, tokenData(c)));
 const returnRefs = new Set([...compiledReturn.matchAll(/\b(__[a-zA-Z0-9_]+)\b/g)].map(m => m[1]));
 const declaredSoFar = new Set([...code.matchAll(/\bVAR\s+(__[a-zA-Z0-9_]+)\s*=/g)].map(m => m[1]));
 const missingInReturn = Array.from(returnRefs).filter(v => !declaredSoFar.has(v));
 if (missingInReturn.length > 0) {
  code += `// Variables de protección para evitar errores de compilación en Power BI:\n`;
  for (const mv of missingInReturn) {
   code += `VAR ${mv} = ""\n`;
  }
 }

 code += `RETURN\n    ${compiledReturn}\n`;
 return code;
}

function trendDAX(c, elementId = 'trend') {
 const isOrig = elementId === 'trend';
 const st = isOrig ? c : elementState(c, elementId);
 if (!isOrig && (!st.measure?.trim() || !st.dateTable?.trim() || !st.dateColumn?.trim())) return `// ${elementId}: referencias sin configurar\nVAR __trend_${elementId} = ""\n`;
 const dupHeight = isOrig ? c.trendHeight : elementSize(c, elementId);
 const effC = { ...c, ...st, trendHeight: dupHeight };
 const g = chartGeometry(effC, elementId);
 const fmt = v => `FORMAT ( ${v}, "0.000", "en-US" )`;
 const customTrendColor = appearance(effC, elementId).colorMode === 'custom';
 const color = customTrendColor ? elementColor(effC, elementId) : '__Cfg_ColorAccent';
 const table = tableRef(st.dateTable || '');
 const date = `${table}${colRef(st.dateColumn || '')}`;
 const m = st.measure?.trim() ? measureRef(st.measure) : 'BLANK ()';
 const pfx = isOrig ? '' : `_${elementId}`;
 const bucket = d => `SWITCH ( __Granularity${pfx}, 1, ${d}, 2, ${d} - WEEKDAY ( ${d}, 2 ) + 1, DATE ( YEAR ( ${d} ), MONTH ( ${d} ), 1 ) )`;
 const maxPts = effC.maxPoints || 24;

 let code = (isOrig ? '' : periodDAX(table, date, m, pfx)) + `// ============================================================================\n` +
  `// ${isOrig ? '4. SERIE TEMPORAL Y COORDENADAS SVG (FASE B)' : `SERIE TEMPORAL: ${elementId.toUpperCase()}`}\n` +
  `// ============================================================================\n` +
  `// Granularidad: diaria (<=24 días), semanal (<=161 días), mensual (>161 días).\n` +
  `// Ventana acotada a un máximo de ${maxPts} períodos antes de evaluar la medida.\n` +
  `VAR __Granularity${pfx} = ${effC.granularity === 'auto' ? `SWITCH ( TRUE (), __Span${pfx} <= 24, 1, __Span${pfx} <= 161, 2, 3 )` : effC.granularity === 'day' ? '1' : effC.granularity === 'week' ? '2' : '3'}\n` +
  `VAR __LastBucket${pfx} = IF ( __HasDates${pfx}, SWITCH ( __Granularity${pfx}, 1, __End${pfx}, 2, __End${pfx} - WEEKDAY ( __End${pfx}, 2 ) + 1, DATE ( YEAR ( __End${pfx} ), MONTH ( __End${pfx} ), 1 ) ) )\n` +
  `VAR __WindowStart${pfx} = IF ( __HasDates${pfx}, SWITCH ( __Granularity${pfx}, 1, __LastBucket${pfx} - ${maxPts - 1}, 2, __LastBucket${pfx} - ${maxPts - 1} * 7, EDATE ( __LastBucket${pfx}, -${maxPts - 1} ) ) )\n` +
  `VAR __TrendClipped${pfx} = __HasDates${pfx} && __Start${pfx} < __WindowStart${pfx}\n` +
  `VAR __DateGroups${pfx} = SELECTCOLUMNS (\n` +
  `    FILTER ( __Dates${pfx}, __HasDates${pfx} && ${date} >= __WindowStart${pfx} ),\n` +
  `    "__Date", ${date},\n` +
  `    "__Bucket", ${bucket(date)}\n` +
  `)\n` +
  `VAR __RecentBuckets${pfx} = DISTINCT ( SELECTCOLUMNS ( __DateGroups${pfx}, "__Bucket", [__Bucket] ) )\n` +
  `VAR __BucketCount${pfx} = COUNTROWS ( __RecentBuckets${pfx} )\n` +
  `VAR __RawSeries${pfx} = ADDCOLUMNS (\n` +
  `    __RecentBuckets${pfx},\n` +
  `    "__YValue",\n` +
  `        VAR __SelectedBucket = [__Bucket]\n` +
  `        VAR __GroupDates = SELECTCOLUMNS ( FILTER ( __DateGroups${pfx}, [__Bucket] = __SelectedBucket ), "__Date", [__Date] )\n` +
  `        RETURN CALCULATE ( ${m}, REMOVEFILTERS ( ${table} ), TREATAS ( __GroupDates, ${date} ) )\n` +
  `)\n` +
  `VAR __SeriesIndexed${pfx} = ADDCOLUMNS (\n` +
  `    __RawSeries${pfx},\n` +
  `    "__Idx",\n` +
  `        VAR __B = [__Bucket]\n` +
  `        RETURN RANKX ( __RecentBuckets${pfx}, [__Bucket], __B, ASC, DENSE )\n` +
  `)\n` +
  `VAR __ValidSeries${pfx} = FILTER ( __SeriesIndexed${pfx}, NOT ISBLANK ( [__YValue] ) )\n` +
  `VAR __Series${pfx} = __ValidSeries${pfx}\n` +
  `VAR __N${pfx} = COUNTROWS ( __ValidSeries${pfx} )\n` +
  `VAR __Min${pfx} = ${effC.zeroBase ? `MIN ( 0, MINX ( __ValidSeries${pfx}, [__YValue] ) )` : `MINX ( __ValidSeries${pfx}, [__YValue] )`}\n` +
  `VAR __Max${pfx} = ${effC.zeroBase ? `MAX ( 0, MAXX ( __ValidSeries${pfx}, [__YValue] ) )` : `MAXX ( __ValidSeries${pfx}, [__YValue] )`}\n` +
  `VAR __Range${pfx} = __Max${pfx} - __Min${pfx}\n` +
  `VAR __Coordinates${pfx} = ADDCOLUMNS (\n` +
  `    __ValidSeries${pfx},\n` +
  `    "__X", IF ( __BucketCount${pfx} = 1, ${g.width / 2}, ${g.left} + DIVIDE ( [__Idx] - 1, __BucketCount${pfx} - 1, 0 ) * ${g.spanX} ),\n` +
  `    "__Y", IF ( __Range${pfx} = 0, ${(g.top + g.bottom) / 2}, ${g.bottom} - DIVIDE ( [__YValue] - __Min${pfx}, __Range${pfx}, 0 ) * ${g.spanY} )\n` +
  `)\n` +
  `// Coordenadas SVG: tres decimales explícitos y punto decimal.\n` +
  `VAR __chartFirst${pfx} = ${fmt(`MINX ( __Coordinates${pfx}, [__X] )`)}\n` +
  `VAR __chartLast${pfx} = ${fmt(`MAXX ( __Coordinates${pfx}, [__X] )`)}\n` +
  `VAR __ChartSegments${pfx} = ADDCOLUMNS (\n` +
  `    __Coordinates${pfx},\n` +
  `    "__Segment",\n` +
  `        VAR __Idx = [__Idx]\n` +
  `        VAR __B = [__Bucket]\n` +
  `        VAR __Prev = FILTER ( __Coordinates${pfx}, [__Idx] = __Idx - 1 )\n` +
  `        VAR __PrevBucket = MAXX ( __Prev, [__Bucket] )\n` +
  `        VAR __Adjacent = NOT ISEMPTY ( __Prev ) && SWITCH ( __Granularity${pfx}, 1, __B = __PrevBucket + 1, 2, __B = __PrevBucket + 7, __B = EDATE ( __PrevBucket, 1 ) )\n` +
  `        VAR __px = [__X]\n` +
  `        VAR __py = [__Y]\n` +
  `        VAR __prevX = MAXX ( __Prev, [__X] )\n` +
  `        VAR __prevY = MAXX ( __Prev, [__Y] )\n` +
  `        VAR __midX = ( __prevX + __px ) / 2\n` +
  `        RETURN IF (\n` +
  `            NOT __Adjacent,\n` +
  `            "M" & FORMAT ( __px, "0.000", "en-US" ) & "," & FORMAT ( __py, "0.000", "en-US" ),\n` +
  `            ${effC.trendCurve === 'smooth'
    ? `"C" & FORMAT ( __midX, "0.000", "en-US" ) & "," & FORMAT ( __prevY, "0.000", "en-US" ) & " " & FORMAT ( __midX, "0.000", "en-US" ) & "," & FORMAT ( __py, "0.000", "en-US" ) & " " & FORMAT ( __px, "0.000", "en-US" ) & "," & FORMAT ( __py, "0.000", "en-US" )`
    : effC.trendCurve === 'step'
    ? `"H" & FORMAT ( __midX, "0.000", "en-US" ) & "V" & FORMAT ( __py, "0.000", "en-US" ) & "H" & FORMAT ( __px, "0.000", "en-US" )`
    : `"L" & FORMAT ( __px, "0.000", "en-US" ) & "," & FORMAT ( __py, "0.000", "en-US" )`}\n` +
  `        )\n` +
  `)\n` +
  `VAR __chartPath${pfx} = CONCATENATEX ( __ChartSegments${pfx}, [__Segment], " ", [__Bucket], ASC )\n` +
  `VAR __HasGaps${pfx} = __N${pfx} <> __BucketCount${pfx} || CONTAINSSTRING ( __chartPath${pfx}, " M" )\n` +
  `VAR __Baseline${pfx} = ${effC.zeroBase ? `IF ( __Range${pfx} = 0, ${g.bottom}, MAX ( ${g.top}, MIN ( ${g.bottom}, ${g.bottom} - DIVIDE ( 0 - __Min${pfx}, __Range${pfx}, 0 ) * ${g.spanY} ) ) )` : g.bottom}\n` +
  `VAR __BarWidth${pfx} = MAX ( 1, MIN ( 8, DIVIDE ( ${g.spanX * 0.65}, __BucketCount${pfx}, 1 ) ) )\n` +
  `VAR __chartBars${pfx} = CONCATENATEX ( __Coordinates${pfx},\n` +
  `    VAR __barX = [__X] - __BarWidth${pfx} / 2\n` +
  `    VAR __barY = MIN ( [__Y], __Baseline${pfx} )\n` +
  `    VAR __barH = MAX ( 1, ABS ( [__Y] - __Baseline${pfx} ) )\n` +
  `    RETURN "<rect x='" & FORMAT ( __barX, "0.000", "en-US" ) & "' y='" & FORMAT ( __barY, "0.000", "en-US" ) & "' width='" & FORMAT ( __BarWidth${pfx}, "0.000", "en-US" ) & "' height='" & FORMAT ( __barH, "0.000", "en-US" ) & "' rx='1.5' fill='" & ${customTrendColor ? quote(color) : color} & "'/>",\n` +
  `    "", [__Bucket], ASC )\n` +
  `VAR __MaxPoint${pfx} = TOPN ( 1, __Coordinates${pfx}, [__YValue], DESC, [__Bucket], ASC )\n` +
  `VAR __MinPoint${pfx} = TOPN ( 1, __Coordinates${pfx}, [__YValue], ASC, [__Bucket], ASC )\n` +
  `VAR __LastPoint${pfx} = TOPN ( 1, __Coordinates${pfx}, [__Bucket], DESC )\n`;

 const annotation = (kind, tbl) => {
  const svg = markerSVG(effC, kind, {x: '@@markX@@', y: '@@markY@@', label: kind === 'last' ? '' : '@@markLabel@@', anchor: '@@markAnchor@@', labelY: kind === 'max' ? 12 : g.height - 4}, elementId);
  return `CONCATENATEX ( ${tbl}, VAR __markX = ${fmt('[__X]')} VAR __markY = ${fmt('[__Y]')} VAR __markLabel = ${quote(kind === 'max' ? 'Máx. ' : 'Mín. ')} & ${formatted('[__YValue]', effC)} VAR __markAnchor = IF ( [__X] < ${g.width * 0.3}, "start", IF ( [__X] > ${g.width * 0.7}, "end", "middle" ) ) RETURN ${compileHTML(svg)}, "" )`;
 };

 const max = effC.showMax ? annotation('max', `__MaxPoint${pfx}`) : '""';
 const min = effC.showMin ? `IF ( MINX ( __Coordinates${pfx}, [__YValue] ) <> MAXX ( __Coordinates${pfx}, [__YValue] ), ${annotation('min', `FILTER ( __MinPoint${pfx}, [__Bucket] <> MAXX ( __MaxPoint${pfx}, [__Bucket] ) )`)}, "" )` : '""';
 const dotConditions = [`__N${pfx} > 0`];
 if (effC.showMax) dotConditions.push(`MAXX ( __LastPoint${pfx}, [__X] ) <> MAXX ( __MaxPoint${pfx}, [__X] )`);
 if (effC.showMin) dotConditions.push(`MAXX ( __LastPoint${pfx}, [__X] ) <> MAXX ( __MinPoint${pfx}, [__X] )`);
 if (!effC.showDot) dotConditions.push(`__N${pfx} = 1`);
 code += `VAR __chartAnnotations${pfx} = ${max} & ${min} & IF ( ${dotConditions.join(' && ')}, ${annotation('last', `__LastPoint${pfx}`)}, "" )\n`;

 const areaId = 'kpi-area-' + hash(JSON.stringify([trendFill(effC, elementId), effC.fillOpacity, g, elementId]));
 const areaFillSvg = effC.areaFill === 'gradient' ? `url(#${areaId})` : trendFill(effC, elementId);
 code += `VAR __chartArea${pfx} = ${effC.trendStyle === 'area' ? `IF ( __N${pfx} > 1 && NOT ( __HasGaps${pfx} ) && __Min${pfx} >= 0, "<path d=""" & __chartPath${pfx} & " L" & __chartLast${pfx} & ",${g.bottom} L" & __chartFirst${pfx} & ",${g.bottom} Z"" fill=""${areaFillSvg}"" opacity=""${effC.areaFill === 'gradient' ? 1 : effC.fillOpacity}""/>", "" )` : '""'}\n`;

 const svg = trendSVG(effC, {path: `@@chartPath${pfx}@@`, first: `@@chartFirst${pfx}@@`, last: `@@chartLast${pfx}@@`, bars: `@@chartBars${pfx}@@`, annotations: `@@chartAnnotations${pfx}@@`, area: `@@chartArea${pfx}@@`}, elementId);
 const compiledSvg = compileHTML(svg)
  .replaceAll(`@@chartPath${pfx}@@`, `" & __chartPath${pfx} & "`)
  .replaceAll(`@@chartFirst${pfx}@@`, `" & __chartFirst${pfx} & "`)
  .replaceAll(`@@chartLast${pfx}@@`, `" & __chartLast${pfx} & "`)
  .replaceAll(`@@chartBars${pfx}@@`, `" & __chartBars${pfx} & "`)
  .replaceAll(`@@chartAnnotations${pfx}@@`, `" & __chartAnnotations${pfx} & "`)
  .replaceAll(`@@chartArea${pfx}@@`, `" & __chartArea${pfx} & "`);

 if (isOrig) {
  code += `VAR __trend = IF ( __N = 0, ${quote(emptyTrend(c, 'trend'))}, ${compiledSvg} )\n`;
  code += `VAR __footer = SWITCH (\n` +
   `    TRUE (),\n` +
   `    __TrendClipped && __Granularity = 1, "Últimos " & ${maxPts} & " días",\n` +
   `    __TrendClipped && __Granularity = 2, "Últimas " & ${maxPts} & " sem.",\n` +
   `    __TrendClipped, "Últimos " & ${maxPts} & " meses",\n` +
   `    __IsDiscontinuous, "Fechas discontinuas",\n` +
   `    ${quote(esc(c.footer || 'Rendimiento del período'))}\n` +
   `)\n`;
 } else {
  code += `VAR __trend_${elementId} = IF ( __N${pfx} = 0, ${quote(emptyTrend(effC, elementId))}, ${compiledSvg} )\n`;
 }

 return code;
}

export function generateDAXBody(c) {
 const dax = generateDAX(c);
 // generateDAX always emits the complete (possibly bracketed) name on its first line.
 return dax.slice(dax.indexOf('\n') + 1).trim();
}

export function validateDAX(daxCode) {
 let clean = '', paren = 0, malformed = false;
 for (let i = 0; i < daxCode.length; i++) {
  const ch = daxCode[i];
  if (ch === '/' && daxCode[i + 1] === '/') {
   while (i < daxCode.length && daxCode[i] !== '\n') i++;
   continue;
  }
  if (ch === '/' && daxCode[i + 1] === '*') {
   i += 2;
   while (i < daxCode.length && !(daxCode[i] === '*' && daxCode[i + 1] === '/')) i++;
   i++;
   continue;
  }
  if (ch === '"' || ch === "'" || ch === '[') {
   const end = ch === '[' ? ']' : ch;
   let closed = false;
   for (i++; i < daxCode.length; i++) {
    if (daxCode[i] === end) {
     if (daxCode[i + 1] === end) { i++; continue; }
     closed = true;
     break;
    }
   }
   if (!closed) malformed = true;
   clean += ' ';
   continue;
  }
  if (ch === '(') paren++;
  if (ch === ')') { paren--; if (paren < 0) malformed = true; }
  clean += ch;
 }

 const declared = new Set([...clean.matchAll(/\bVAR\s+(__[a-zA-Z0-9_]+)/g)].map(x => x[1]));
 const refs = [...clean.matchAll(/\b(__[a-zA-Z0-9_]+)\b/g)].map(x => x[1]);
 const undeclared = [];
 for (const v of refs) {
  if (!declared.has(v) && !undeclared.includes(v)) undeclared.push(v);
 }

 const hasMarkdownEscapes = /\\(\*|_|#|\[|\]|<|>|`)/.test(daxCode);
 const hasBackticks = /`/.test(daxCode);

 return {
  valid: !malformed && undeclared.length === 0 && paren === 0 && !hasMarkdownEscapes && !hasBackticks,
  declared: Array.from(declared),
  referenced: Array.from(new Set(refs)),
  undeclared,
  balancedParentheses: paren === 0,
  hasMarkdownEscapes,
  hasBackticks
 };
}

