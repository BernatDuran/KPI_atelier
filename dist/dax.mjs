import {chartGeometry,trendSVG,markerSVG,emptyTrend,hash} from './charts.mjs';
import {elementColor,trendFill,appearance} from './appearance.mjs';
import {needsDate,needsTrend,needsGoal,needsCompare,checks} from './model.mjs';
import {elementEnabled,elementState,resolveElementDef} from './elements.mjs';
import {cardHTML,tokenData,esc} from './cards.mjs';

export const quote = s => '"' + String(s).replaceAll('"', '""') + '"';
export const measureRef = s => {
 let v = String(s).trim();
 if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).replaceAll(']]', ']');
 return '[' + v.replaceAll(']', ']]') + ']';
};
export const isNumericLiteral = s => {
 if (typeof s === 'number') return true;
 if (typeof s !== 'string') return false;
 const t = s.trim();
 return t !== '' && !isNaN(Number(t)) && !/^[\[\]]/.test(t);
};

export const targetRef = s => {
 if (!s && s !== 0) return 'BLANK ()';
 const trimmed = String(s).trim();
 if (isNumericLiteral(trimmed)) return trimmed;
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

export function generateDAX(c) {
 const errors = checks(c).filter(x => x.level === 'error');
 if (errors.length) throw new Error(errors.map(x => x.text).join('\n'));

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
   if (def?.baseId === 'value' || st.measure?.trim()) return `// - Medida en ${def?.label || dupId}: ${st.measure && st.measure.trim() ? measureRef(st.measure) : m}\n`;
   if (def?.baseId === 'delta' && st.compareMeasure?.trim()) return `// - Medida de referencia en ${def?.label || dupId}: ${measureRef(st.compareMeasure)}\n`;
   return '';
  }).join('') + `\n`;

 if (dateNeeded) {
  code += `// ============================================================================\n` +
   `// 2. PERÍODO: FILTROS DE CALENDARIO O ÚLTIMOS 12 MESES MÓVILES CON DATOS (FASE A)\n` +
   `// ============================================================================\n` +
   `VAR __HasCalendarFilter = ISFILTERED ( ${table} )\n` +
   `VAR __LastDataDate = IF (\n` +
   `    NOT __HasCalendarFilter,\n` +
   `    MAXX (\n` +
   `        CALCULATETABLE (\n` +
   `            LASTNONBLANK ( ${date}, ${m} ),\n` +
   `            REMOVEFILTERS ( ${table} )\n` +
   `        ),\n` +
   `        ${date}\n` +
   `    )\n` +
   `)\n` +
   `VAR __DefaultStart = IF ( NOT ISBLANK ( __LastDataDate ), EDATE ( __LastDataDate, -12 ) + 1 )\n` +
   `VAR __Dates = CALCULATETABLE (\n` +
   `    VALUES ( ${date} ),\n` +
   `    KEEPFILTERS (\n` +
   `        FILTER (\n` +
   `            ALL ( ${date} ),\n` +
   `            NOT ISBLANK ( ${date} )\n` +
   `                && (\n` +
   `                    __HasCalendarFilter\n` +
   `                        || (\n` +
   `                            NOT ISBLANK ( __LastDataDate )\n` +
   `                                && ${date} >= __DefaultStart\n` +
   `                                && ${date} <= __LastDataDate\n` +
   `                        )\n` +
   `                )\n` +
   `        )\n` +
   `    )\n` +
   `)\n` +
   `VAR __DateCount = COUNTROWS ( __Dates )\n` +
   `VAR __HasDates = __DateCount > 0\n` +
   `VAR __Start = MINX ( __Dates, ${date} )\n` +
   `VAR __End = MAXX ( __Dates, ${date} )\n` +
   `VAR __Span = IF ( __HasDates, INT ( __End - __Start ) + 1 )\n` +
   `VAR __IsDiscontinuous = __HasDates && __DateCount <> __Span\n` +
   `// El valor actual se evalúa sobre el mismo conjunto de fechas exactas que la tendencia.\n` +
   `VAR __Current = IF ( __HasDates, CALCULATE ( ${m}, REMOVEFILTERS ( ${table} ), TREATAS ( __Dates, ${date} ) ) )\n`;
 } else {
  code += `VAR __Current = ${m}\n` +
   `VAR __HasDates = FALSE ()\n` +
   `VAR __IsDiscontinuous = FALSE ()\n`;
 }

 code += `VAR __Target = ${target ? targetRef(c.targetMeasure) : 'BLANK ()'}\n`;

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
   `VAR __ComparableDates = __HasDates && COUNTROWS ( __PreviousDates ) > 0\n` +
   `VAR __Reference = IF ( __ComparableDates, CALCULATE ( ${m}, REMOVEFILTERS ( ${table} ), TREATAS ( __PreviousDates, ${date} ) ) )\n`;
 } else {
  code += `VAR __Reference = ${needsCompare(c) ? c.comparison === 'target' ? '__Target' : c.comparison === 'custom' ? measureRef(c.compareMeasure) : 'BLANK ()' : 'BLANK ()'}\n`;
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
 for (const dupId of dupIds) {
  const def = resolveElementDef(dupId);
  if (!def) continue;
  const dupState = elementState(c, dupId);
  if (def.baseId === 'value') {
   const dupMeasure = dupState.measure && dupState.measure.trim() ? measureRef(dupState.measure) : m;
   const dupConf = {
    ...c,
    format: dupState.format || c.format,
    decimals: dupState.decimals ?? c.decimals,
    unit: dupState.unit || c.unit,
    currency: dupState.currency || c.currency,
    suffix: dupState.suffix !== undefined ? dupState.suffix : c.suffix
   };
   code += `VAR __val_${dupId} = ${formatted(dupMeasure, dupConf)}\n`;
  } else if (def.baseId === 'delta') {
   const dupCompare = dupState.compareMeasure && dupState.compareMeasure.trim() ? measureRef(dupState.compareMeasure) : '__Reference';
   const dupMode = dupState.deltaMode || c.deltaMode;
   code += `VAR __Diff_${dupId} = IF ( NOT ISBLANK ( __Current ) && NOT ISBLANK ( ${dupCompare} ), __Current - ${dupCompare} )\n` +
    `VAR __Rel_${dupId} = DIVIDE ( __Diff_${dupId}, ABS ( ${dupCompare} ) )\n` +
    `VAR __delta_${dupId} = ${dupMode === 'absolute' ? `IF ( ISBLANK ( __Diff_${dupId} ), "—", IF ( __Diff_${dupId} > 0, "+", "" ) & ${formatted(`__Diff_${dupId}`, c)} )` : dupMode === 'pp' ? `IF ( ISBLANK ( __Diff_${dupId} ), "—", FORMAT ( __Diff_${dupId} * 100, "+0.0;-0.0;0.0", __Cfg_Locale ) & " pp" )` : `IF ( ISBLANK ( __Rel_${dupId} ), "—", FORMAT ( __Rel_${dupId}, "+0.0%;-0.0%;0.0%", __Cfg_Locale ) )`}\n`;
  } else if (def.baseId === 'referenceValue') {
   const dupRef = dupState.measure && dupState.measure.trim() ? measureRef(dupState.measure) : (dupState.compareMeasure && dupState.compareMeasure.trim() ? measureRef(dupState.compareMeasure) : '__Reference');
   code += `VAR __val_${dupId} = ${formatted(dupRef, c)}\n`;
  } else if (dupState.measure && dupState.measure.trim()) {
   code += `VAR __val_${dupId} = ${formatted(measureRef(dupState.measure), c)}\n`;
  }
 }

 code += `RETURN\n    ${compileHTML(cardHTML(c, tokenData(c)))}\n`;
 return code;
}

function trendDAX(c) {
 const g = chartGeometry(c);
 const fmt = v => `FORMAT ( ${v}, "0.000", "en-US" )`;
 const customTrendColor = appearance(c, 'trend').colorMode === 'custom';
 const color = customTrendColor ? elementColor(c, 'trend') : '__Cfg_ColorAccent';
 const table = tableRef(c.dateTable);
 const date = `${table}${colRef(c.dateColumn)}`;
 const m = measureRef(c.measure);
 const bucket = d => `SWITCH ( __Granularity, 1, ${d}, 2, ${d} - WEEKDAY ( ${d}, 2 ) + 1, DATE ( YEAR ( ${d} ), MONTH ( ${d} ), 1 ) )`;
 const maxPts = c.maxPoints || 24;

 let code = `// ============================================================================\n` +
  `// 4. SERIE TEMPORAL Y COORDENADAS SVG (FASE B)\n` +
  `// ============================================================================\n` +
  `// Granularidad: diaria (<=24 días), semanal (<=161 días), mensual (>161 días).\n` +
  `// Ventana acotada a un máximo de ${maxPts} períodos antes de evaluar la medida.\n` +
  `VAR __Granularity = ${c.granularity === 'auto' ? 'SWITCH ( TRUE (), __Span <= 24, 1, __Span <= 161, 2, 3 )' : c.granularity === 'day' ? '1' : c.granularity === 'week' ? '2' : '3'}\n` +
  `VAR __LastBucket = IF ( __HasDates, SWITCH ( __Granularity, 1, __End, 2, __End - WEEKDAY ( __End, 2 ) + 1, DATE ( YEAR ( __End ), MONTH ( __End ), 1 ) ) )\n` +
  `VAR __WindowStart = IF ( __HasDates, SWITCH ( __Granularity, 1, __LastBucket - ${maxPts - 1}, 2, __LastBucket - ${maxPts - 1} * 7, EDATE ( __LastBucket, -${maxPts - 1} ) ) )\n` +
  `VAR __TrendClipped = __HasDates && __Start < __WindowStart\n` +
  `VAR __DateGroups = SELECTCOLUMNS (\n` +
  `    FILTER ( __Dates, __HasDates && ${date} >= __WindowStart ),\n` +
  `    "__Date", ${date},\n` +
  `    "__Bucket", ${bucket(date)}\n` +
  `)\n` +
  `VAR __RecentBuckets = DISTINCT ( SELECTCOLUMNS ( __DateGroups, "__Bucket", [__Bucket] ) )\n` +
  `VAR __BucketCount = COUNTROWS ( __RecentBuckets )\n` +
  `VAR __RawSeries = ADDCOLUMNS (\n` +
  `    __RecentBuckets,\n` +
  `    "__YValue",\n` +
  `        VAR __SelectedBucket = [__Bucket]\n` +
  `        VAR __GroupDates = SELECTCOLUMNS ( FILTER ( __DateGroups, [__Bucket] = __SelectedBucket ), "__Date", [__Date] )\n` +
  `        RETURN CALCULATE ( ${m}, REMOVEFILTERS ( ${table} ), TREATAS ( __GroupDates, ${date} ) )\n` +
  `)\n` +
  `VAR __SeriesIndexed = ADDCOLUMNS (\n` +
  `    __RawSeries,\n` +
  `    "__Idx",\n` +
  `        VAR __B = [__Bucket]\n` +
  `        RETURN RANKX ( __RecentBuckets, [__Bucket], __B, ASC, DENSE )\n` +
  `)\n` +
  `VAR __ValidSeries = FILTER ( __SeriesIndexed, NOT ISBLANK ( [__YValue] ) )\n` +
  `VAR __Series = __ValidSeries\n` +
  `VAR __N = COUNTROWS ( __ValidSeries )\n` +
  `VAR __Min = ${c.zeroBase ? 'MIN ( 0, MINX ( __ValidSeries, [__YValue] ) )' : 'MINX ( __ValidSeries, [__YValue] )'}\n` +
  `VAR __Max = ${c.zeroBase ? 'MAX ( 0, MAXX ( __ValidSeries, [__YValue] ) )' : 'MAXX ( __ValidSeries, [__YValue] )'}\n` +
  `VAR __Range = __Max - __Min\n` +
  `VAR __Coordinates = ADDCOLUMNS (\n` +
  `    __ValidSeries,\n` +
  `    "__X", IF ( __BucketCount = 1, ${g.width / 2}, ${g.left} + DIVIDE ( [__Idx] - 1, __BucketCount - 1, 0 ) * ${g.spanX} ),\n` +
  `    "__Y", IF ( __Range = 0, ${(g.top + g.bottom) / 2}, ${g.bottom} - DIVIDE ( [__YValue] - __Min, __Range, 0 ) * ${g.spanY} )\n` +
  `)\n` +
  `// Coordenadas SVG: tres decimales explícitos y punto decimal.\n` +
  `VAR __chartFirst = ${fmt('MINX ( __Coordinates, [__X] )')}\n` +
  `VAR __chartLast = ${fmt('MAXX ( __Coordinates, [__X] )')}\n` +
  `VAR __ChartSegments = ADDCOLUMNS (\n` +
  `    __Coordinates,\n` +
  `    "__Segment",\n` +
  `        VAR __Idx = [__Idx]\n` +
  `        VAR __B = [__Bucket]\n` +
  `        VAR __Prev = FILTER ( __Coordinates, [__Idx] = __Idx - 1 )\n` +
  `        VAR __PrevBucket = MAXX ( __Prev, [__Bucket] )\n` +
  `        VAR __Adjacent = NOT ISEMPTY ( __Prev ) && SWITCH ( __Granularity, 1, __B = __PrevBucket + 1, 2, __B = __PrevBucket + 7, __B = EDATE ( __PrevBucket, 1 ) )\n` +
  `        VAR __px = [__X]\n` +
  `        VAR __py = [__Y]\n` +
  `        VAR __prevX = MAXX ( __Prev, [__X] )\n` +
  `        VAR __prevY = MAXX ( __Prev, [__Y] )\n` +
  `        VAR __midX = ( __prevX + __px ) / 2\n` +
  `        RETURN IF (\n` +
  `            NOT __Adjacent,\n` +
  `            "M" & FORMAT ( __px, "0.000", "en-US" ) & "," & FORMAT ( __py, "0.000", "en-US" ),\n` +
  `            ${c.trendCurve === 'smooth'
    ? `"C" & FORMAT ( __midX, "0.000", "en-US" ) & "," & FORMAT ( __prevY, "0.000", "en-US" ) & " " & FORMAT ( __midX, "0.000", "en-US" ) & "," & FORMAT ( __py, "0.000", "en-US" ) & " " & FORMAT ( __px, "0.000", "en-US" ) & "," & FORMAT ( __py, "0.000", "en-US" )`
    : c.trendCurve === 'step'
    ? `"H" & FORMAT ( __midX, "0.000", "en-US" ) & "V" & FORMAT ( __py, "0.000", "en-US" ) & "H" & FORMAT ( __px, "0.000", "en-US" )`
    : `"L" & FORMAT ( __px, "0.000", "en-US" ) & "," & FORMAT ( __py, "0.000", "en-US" )`}\n` +
  `        )\n` +
  `)\n` +
  `VAR __chartPath = CONCATENATEX ( __ChartSegments, [__Segment], " ", [__Bucket], ASC )\n` +
  `VAR __HasGaps = __N <> __BucketCount || CONTAINSSTRING ( __chartPath, " M" )\n` +
  `VAR __Baseline = ${c.zeroBase ? `IF ( __Range = 0, ${g.bottom}, MAX ( ${g.top}, MIN ( ${g.bottom}, ${g.bottom} - DIVIDE ( 0 - __Min, __Range, 0 ) * ${g.spanY} ) ) )` : g.bottom}\n` +
  `VAR __BarWidth = MAX ( 1, MIN ( 8, DIVIDE ( ${g.spanX * 0.65}, __BucketCount, 1 ) ) )\n` +
  `VAR __chartBars = CONCATENATEX ( __Coordinates,\n` +
  `    VAR __barX = [__X] - __BarWidth / 2\n` +
  `    VAR __barY = MIN ( [__Y], __Baseline )\n` +
  `    VAR __barH = MAX ( 1, ABS ( [__Y] - __Baseline ) )\n` +
  `    RETURN "<rect x='" & FORMAT ( __barX, "0.000", "en-US" ) & "' y='" & FORMAT ( __barY, "0.000", "en-US" ) & "' width='" & FORMAT ( __BarWidth, "0.000", "en-US" ) & "' height='" & FORMAT ( __barH, "0.000", "en-US" ) & "' rx='1.5' fill='" & ${customTrendColor ? quote(color) : color} & "'/>",\n` +
  `    "", [__Bucket], ASC )\n` +
  `VAR __MaxPoint = TOPN ( 1, __Coordinates, [__YValue], DESC, [__Bucket], ASC )\n` +
  `VAR __MinPoint = TOPN ( 1, __Coordinates, [__YValue], ASC, [__Bucket], ASC )\n` +
  `VAR __LastPoint = TOPN ( 1, __Coordinates, [__Bucket], DESC )\n`;

 const annotation = (kind, table) => {
  const svg = markerSVG(c, kind, {x: '@@markX@@', y: '@@markY@@', label: kind === 'last' ? '' : '@@markLabel@@', anchor: '@@markAnchor@@', labelY: kind === 'max' ? 12 : g.height - 4});
  return `CONCATENATEX ( ${table}, VAR __markX = ${fmt('[__X]')} VAR __markY = ${fmt('[__Y]')} VAR __markLabel = ${quote(kind === 'max' ? 'Máx. ' : 'Mín. ')} & ${formatted('[__YValue]', c)} VAR __markAnchor = IF ( [__X] < ${g.width * 0.3}, "start", IF ( [__X] > ${g.width * 0.7}, "end", "middle" ) ) RETURN ${compileHTML(svg)}, "" )`;
 };

 const max = c.showMax ? annotation('max', '__MaxPoint') : '""';
 const min = c.showMin ? `IF ( MINX ( __Coordinates, [__YValue] ) <> MAXX ( __Coordinates, [__YValue] ), ${annotation('min', `FILTER ( __MinPoint, [__Bucket] <> MAXX ( __MaxPoint, [__Bucket] ) )`)}, "" )` : '""';
 const dotConditions = ['__N > 0'];
 if (c.showMax) dotConditions.push('MAXX ( __LastPoint, [__X] ) <> MAXX ( __MaxPoint, [__X] )');
 if (c.showMin) dotConditions.push('MAXX ( __LastPoint, [__X] ) <> MAXX ( __MinPoint, [__X] )');
 if (!c.showDot) dotConditions.push('__N = 1');
 code += `VAR __chartAnnotations = ${max} & ${min} & IF ( ${dotConditions.join(' && ')}, ${annotation('last', '__LastPoint')}, "" )\n`;

 const areaId = 'kpi-area-' + hash(JSON.stringify([trendFill(c), c.fillOpacity, g]));
 const areaFillSvg = c.areaFill === 'gradient' ? `url(#${areaId})` : trendFill(c);
 code += `VAR __chartArea = ${c.trendStyle === 'area' ? `IF ( __N > 1 && NOT ( __HasGaps ) && __Min >= 0, "<path d=""" & __chartPath & " L" & __chartLast & ",${g.bottom} L" & __chartFirst & ",${g.bottom} Z"" fill=""${areaFillSvg}"" opacity=""${c.fillOpacity}""/>", "" )` : '""'}\n`;

 const svg = trendSVG(c, {path: '@@chartPath@@', first: '@@chartFirst@@', last: '@@chartLast@@', bars: '@@chartBars@@', annotations: '@@chartAnnotations@@', area: '@@chartArea@@'});
 code += `VAR __trend = IF ( __N = 0, ${quote(emptyTrend(c))}, ${compileHTML(svg)} )\n`;

 code += `VAR __footer = SWITCH (\n` +
  `    TRUE (),\n` +
  `    __TrendClipped && __Granularity = 1, "Últimos " & ${maxPts} & " días",\n` +
  `    __TrendClipped && __Granularity = 2, "Últimas " & ${maxPts} & " sem.",\n` +
  `    __TrendClipped, "Últimos " & ${maxPts} & " meses",\n` +
  `    __IsDiscontinuous, "Fechas discontinuas",\n` +
  `    ${quote(esc(c.footer || 'Rendimiento del período'))}\n` +
  `)\n`;

 return code;
}

export function generateDAXBody(c) {
 const dax = generateDAX(c);
 return dax.replace(/^\s*[\p{L}\p{N}_ ]+\s*=\s*/u, '').trim();
}
