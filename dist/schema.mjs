/**
 * KPI Atelier - Schema Validator & Data Contracts Runtime
 * Provides schema validation, type guards, bounds enforcement,
 * and JSON import contract verification for CardConfig and sub-entities.
 */

import {BASE, LIMITS, ENUMS, THEMES,STRING_LIMITS,sanitizeConfig} from './model.mjs';
import {resolveElementDef,ELEMENT_IDS,SIZE_LIMITS,MAX_DUPLICATES,MAX_DUPLICATES_PER_TYPE,usesValueBinding,valueBinding,goalBinding,usesGoalBinding,unsupportedCopyDataProperties} from './elements.mjs';
import {colorModes} from './appearance.mjs';

export const MAX_CONFIG_BYTES=512000;

export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Validates whether a given string is a valid 6-character hex color (#RRGGBB).
 * @param {any} color
 * @returns {boolean}
 */
export function isValidHexColor(color) {
  return typeof color === 'string' && HEX_COLOR_REGEX.test(color);
}

/**
 * Metadata definition describing the schema of CardConfig fields.
 */
export const CONFIG_SCHEMA = {
  // String enums
  type: { type: 'enum', values: ENUMS.type, required: true },
  layout: { type: 'enum', values: ENUMS.layout, required: true },
  chartKind: { type: 'enum', values: ENUMS.chartKind, required: true },
  trendCurve: { type: 'enum', values: ENUMS.trendCurve, required: true },
  areaFill: { type: 'enum', values: ENUMS.areaFill, required: true },
  trendGrid: { type: 'enum', values: ENUMS.trendGrid, required: true },
  trendStyle: { type: 'enum', values: ENUMS.trendStyle, required: true },
  surfaceEffect: { type: 'enum', values: ENUMS.surfaceEffect, required: true },
  effectColorMode: { type: 'enum', values: ENUMS.effectColorMode, required: true },
  format: { type: 'enum', values: ENUMS.format, required: true },
  currency: { type: 'enum', values: ENUMS.currency, required: true },
  unit: { type: 'enum', values: ENUMS.unit, required: true },
  locale: { type: 'enum', values: ENUMS.locale, required: true },
  direction: { type: 'enum', values: ENUMS.direction, required: true },
  comparison: { type: 'enum', values: ENUMS.comparison, required: true },
  deltaMode: { type: 'enum', values: ENUMS.deltaMode, required: true },
  shadow: { type: 'enum', values: ENUMS.shadow, required: true },
  font: { type: 'enum', values: ENUMS.font, required: true },
  align: { type: 'enum', values: ENUMS.align, required: true },
  granularity: { type: 'enum', values: ENUMS.granularity, required: true },
  sampleScenario: { type: 'enum', values: ENUMS.sampleScenario, required: true },

  // Hex colors
  accent: { type: 'color', required: true },
  positive: { type: 'color', required: true },
  negative: { type: 'color', required: true },
  warning: { type: 'color', required: true },
  background: { type: 'color', required: true },
  text: { type: 'color', required: true },
  muted: { type: 'color', required: true },
  borderColor: { type: 'color', required: true },
  effectColor: { type: 'color', required: true },

  // Numbers with limits
  geometryVersion: { type: 'number', min: 1, max: 2, integer: true },
  width: { type: 'number', min: 200, max: 800, integer: true },
  height: { type: 'number', min: 200, max: 650, integer: true },
  radius: { type: 'number', min: 0, max: 40, integer: true },
  padding: { type: 'number', min: 12, max: 48, integer: true },
  borderWidth: { type: 'number', min: 0, max: 4, integer: true },
  decimals: { type: 'number', min: 0, max: 3, integer: true },
  valueSize: { type: 'number', min: 24, max: 80, integer: true },
  titleSize: { type: 'number', min: 10, max: 24, integer: true },
  fontWeight: { type: 'number', min: 400, max: 800, integer: true },
  trendHeight: { type: 'number', min: 40, max: 150, integer: true },
  lineWidth: { type: 'number', min: 1, max: 6 },
  fillOpacity: { type: 'number', min: 0, max: 1 },
  maxPoints: { type: 'number', min: 6, max: 90, integer: true },
  donutThickness: { type: 'number', min: 4, max: 28, integer: true },
  effectIntensity: { type: 'number', min: 0, max: 100, integer: true },
  glassOpacity: { type: 'number', min: 10, max: 100, integer: true },
  glassBlur: { type: 'number', min: 0, max: 40, integer: true },

  // Booleans
  showIcon: { type: 'boolean' },
  showSubtitle: { type: 'boolean' },
  showComparison: { type: 'boolean' },
  showTrend: { type: 'boolean' },
  showGoal: { type: 'boolean' },
  showFooter: { type: 'boolean' },
  showMin: { type: 'boolean' },
  showMax: { type: 'boolean' },
  showDot: { type: 'boolean' },
  showMarkerGuides: { type: 'boolean' },
  zeroBase: { type: 'boolean' },
  donutLabel: { type: 'boolean' },

  // Strings with max length
  id: { type: 'string', maxLength: 100, required: true },
  title: { type: 'string', maxLength: 160 },
  subtitle: { type: 'string', maxLength: 160 },
  eyebrow: { type: 'string', maxLength: 160 },
  footer: { type: 'string', maxLength: 160 },
  measure: { type: 'string', maxLength: 120 },
  measureName: { type: 'string', maxLength: 120 },
  targetTable: { type: 'string', maxLength: 512 },
  dateTable: { type: 'string', maxLength: 120 },
  dateColumn: { type: 'string', maxLength: 120 },
  targetMeasure: { type: 'string', maxLength: 120 },
  compareMeasure: { type: 'string', maxLength: 120 },
  suffix: { type: 'string', maxLength: 40 },
  statusGood: { type: 'string', maxLength: 80 },
  statusWarn: { type: 'string', maxLength: 80 },
  statusBad: { type: 'string', maxLength: 80 },
  sampleSeries: { type: 'string', maxLength: 2000 }
};

// Derive all numeric bounds from the same contract used by the editor sanitizer.
const integerFields = new Set(['geometryVersion', 'width', 'height', 'decimals', 'maxPoints']);
for (const [key, bounds] of Object.entries(LIMITS)) CONFIG_SCHEMA[key] = {type:'number', min:bounds[0], max:bounds[1], integer:integerFields.has(key)};
for(const [key,maxLength] of Object.entries(STRING_LIMITS))CONFIG_SCHEMA[key]={...CONFIG_SCHEMA[key],maxLength};
for (const [key, value] of Object.entries(BASE)) {
  if (CONFIG_SCHEMA[key] || ['elements', 'layerOrder'].includes(key)) continue;
  CONFIG_SCHEMA[key] = ENUMS[key] ? {type:'enum', values:ENUMS[key]} : typeof value === 'number' ? {type:'number', min:-1e15, max:1e15} : {type:typeof value};
}

/**
 * Validates an individual element customization payload against schema contracts.
 * @param {string} id
 * @param {any} el
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateElementCustomization(id, el) {
  const errors = [];
  const warnings = [];

  if (!el || typeof el !== 'object' || Array.isArray(el)) {
    return { valid: false, errors: [`Element ${id} must be an object`], warnings };
  }

  const def = resolveElementDef(id);
  if (!def) {
    warnings.push(`Element identifier '${id}' is not in standard catalog or duplicate format`);
  }
  const ignored=unsupportedCopyDataProperties(id,el);
  if(ignored.length)warnings.push(`La copia '${id}' es decorativa; se retirarán sus propiedades de datos (${ignored.join(', ')}), conservando texto, icono y apariencia.`);

  // Bounds check
  for (const coord of ['x', 'y']) {
    if (coord in el) {
      const v = Number(el[coord]);
      if (typeof el[coord] !== 'number' || !Number.isFinite(v) || v < -1000 || v > 1000) {
        errors.push(`Element ${id}.${coord} must be a number between -1000 and 1000`);
      }
    }
  }

  if ('width' in el) {
    const w = Number(el.width);
    if (typeof el.width !== 'number' || !Number.isFinite(w) || w < 0 || w > 800) {
      errors.push(`Element ${id}.width must be a number between 0 and 800`);
    }
  }

  if ('size' in el) {
    const s = Number(el.size);
    const [min,max]=SIZE_LIMITS[def?.kind]||[6,240];
    if (typeof el.size !== 'number' || !Number.isFinite(s) || s < min || s > max) {
      errors.push(`Element ${id}.size must be a number between ${min} and ${max}`);
    }
  }

  // Hex colors in appearance
  for (const colKey of ['color', 'backgroundColor', 'fillColor']) {
    if (colKey in el && el[colKey] && !isValidHexColor(el[colKey])) {
      errors.push(`Element ${id}.${colKey} must be a valid hex color string`);
    }
  }

  for (const [key, min, max] of [['opacity',0,100],['backgroundOpacity',0,100],['fillOpacity',0,1],['lineWidth',1,6],['decimals',0,3],['donutThickness',4,28]]) {
    if (key in el && (typeof el[key] !== 'number' || !Number.isFinite(el[key]) || el[key] < Number(min) || el[key] > Number(max) || key === 'decimals' && !Number.isInteger(el[key]))) errors.push(`Element ${id}.${key} is outside its numeric contract`);
  }
  for (const key of ['hidden','deleted','showMin','showMax','showDot','showMarkerGuides','zeroBase','donutLabel']) if (key in el && typeof el[key] !== 'boolean') errors.push(`Element ${id}.${key} must be boolean`);
  // Geometry uses left/top/width/height, including fractional pixel positions.
  if ('frame' in el && el.frame !== null) {
    if (!el.frame || typeof el.frame !== 'object' || Array.isArray(el.frame)) errors.push(`Element ${id}.frame must be an object`);
    else for (const k of ['left', 'top', 'width', 'height']) {
      const v = el.frame[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || (['width','height'].includes(k) && v < 0)) errors.push(`Element ${id}.frame.${k} must be a finite ${['width','height'].includes(k)?'non-negative ':''}number`);
    }
  }
  for (const key of ['measure','dateTable','dateColumn','targetMeasure','compareMeasure','statusGood','statusWarn','statusBad','text']) if (key in el && typeof el[key] !== 'string') errors.push(`Element ${id}.${key} must be a string`);
  for (const key of ['goodThreshold','warnThreshold']) if (key in el && (typeof el[key] !== 'number' || !Number.isFinite(el[key]))) errors.push(`Element ${id}.${key} must be finite`);
  for (const key of ['comparison','direction','format','unit','currency','deltaMode','chartKind','trendStyle','trendCurve','areaFill','granularity','trendGrid']) if (key in el && !ENUMS[key].includes(el[key])) errors.push(`Element ${id}.${key} is invalid`);
  for (const [key, values] of Object.entries({colorMode:colorModes(id),backgroundMode:['auto','custom','none'],fillMode:['linked','custom']})) if (key in el && !values.includes(el[key])) errors.push(`Element ${id}.${key} is invalid`);
  for (const key of ['suffix','icon']) if (key in el && typeof el[key] !== 'string') errors.push(`Element ${id}.${key} must be a string`);

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates a complete card configuration object.
 * @param {any} raw
 * @param {{ strictUnknown?: boolean, requireAll?: boolean }} [options]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], data?: import('./types.d.ts').CardConfig }}
 */
export function validateCardConfig(raw, options = {}) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Configuration must be a non-null object'], warnings };
  }

  // Legacy geometry detection
  if (raw.geometryVersion === 1 || raw.geometryVersion === undefined) {
    warnings.push('Distribución antigua (versión 1): se adaptará a la geometría actual al abrir el diseño.');
  }

  // Check defined properties
  for (const [key, rule] of Object.entries(CONFIG_SCHEMA)) {
    const val = raw[key];
    if (val === undefined) {
      if (options.requireAll && rule.required) {
        errors.push(`Missing required field: '${key}'`);
      }
      continue;
    }

    switch (rule.type) {
      case 'enum':
        if (!rule.values.includes(val)) {
          errors.push(`Invalid enum value for '${key}': received '${val}', expected one of [${rule.values.join(', ')}]`);
        }
        break;

      case 'color':
        if (!isValidHexColor(val)) {
          errors.push(`Invalid hex color for '${key}': received '${val}', expected format #RRGGBB`);
        }
        break;

      case 'number': {
        const num = Number(val);
        if (typeof val !== 'number' || !Number.isFinite(num)) {
          errors.push(`Field '${key}' must be a finite number: received '${val}'`);
        } else {
          if (rule.integer && !Number.isInteger(num)) errors.push(`Field '${key}' must be an integer`);
          if (rule.min !== undefined && num < rule.min) {
            errors.push(`Field '${key}' is below minimum ${rule.min}: received ${num}`);
          }
          if (rule.max !== undefined && num > rule.max) {
            errors.push(`Field '${key}' is above maximum ${rule.max}: received ${num}`);
          }
        }
        break;
      }

      case 'boolean':
        if (typeof val !== 'boolean') {
          errors.push(`Field '${key}' expected boolean, received ${typeof val}`);
        }
        break;

      case 'string':
        if (typeof val !== 'string') {
          errors.push(`Field '${key}' must be a string, received ${typeof val}`);
        } else if (rule.maxLength && val.length > rule.maxLength) {
          warnings.push(`Se recortará '${key}' a ${rule.maxLength} caracteres (contiene ${val.length}).`);
        }
        break;
    }
  }

  // Check unknown properties if strict mode is enabled
  if (options.strictUnknown) {
    const knownKeys = new Set([...Object.keys(BASE), '_measureBound', '_targetCustomized', '_dateCustomized']);
    for (const k of Object.keys(raw)) {
      if (!knownKeys.has(k)) {
        warnings.push(`Se ignorará la propiedad no compatible '${k}'.`);
      }
    }
  }

  // Validate elements map
  if (raw.elements !== undefined) {
    if (typeof raw.elements !== 'object' || Array.isArray(raw.elements) || raw.elements === null) {
      errors.push("'elements' must be a valid key-value map");
    } else {
      const copies=Object.entries(raw.elements).filter(([id])=>resolveElementDef(id)?.isDuplicate);
      if(copies.length>ELEMENT_IDS.length*MAX_DUPLICATES_PER_TYPE)errors.push('Too many stored duplicate elements');
      const active=copies.filter(([,el])=>el?.deleted!==true);
      if(active.length>MAX_DUPLICATES)errors.push(`A card supports at most ${MAX_DUPLICATES} active copies`);
      const counts=new Map();
      for(const [id] of active){const base=resolveElementDef(id).baseId;counts.set(base,(counts.get(base)||0)+1);}
      for(const [base,count] of counts)if(count>MAX_DUPLICATES_PER_TYPE)errors.push(`Element ${base} supports at most ${MAX_DUPLICATES_PER_TYPE} active copies`);
      for (const [elId, elData] of Object.entries(raw.elements)) {
        const res = validateElementCustomization(elId, elData);
        if (!res.valid) {
          errors.push(...res.errors);
        }
        warnings.push(...res.warnings);
      }
    }
  }

  // Validate layerOrder
  if (raw.layerOrder !== undefined) {
    if (!Array.isArray(raw.layerOrder)) {
      errors.push("'layerOrder' must be an array of element IDs");
    } else {
      for (const item of raw.layerOrder) {
        if (typeof item !== 'string' || !item.trim()) {
          errors.push(`Invalid entry in layerOrder: '${item}'`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    data: errors.length === 0 ? raw : undefined
  };
}

/**
 * Validates and safely parses an imported JSON configuration string or object payload.
 * Validates configuration shape before the editor normalizes legacy values.
 * @param {string | object} rawInput
 * @param {{ strictUnknown?: boolean }} [options]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], config?: import('./types.d.ts').CardConfig, metadata?: object }}
 */
export function validateImportedJSON(rawInput, options = {}) {
  let parsed;
  if (typeof rawInput === 'string') {
    if(new TextEncoder().encode(rawInput).byteLength>MAX_CONFIG_BYTES)return {valid:false,errors:['Configuration exceeds the 512 KB import limit'],warnings:[]};
    try {
      parsed = JSON.parse(rawInput);
    } catch (e) {
      return {
        valid: false,
        errors: [`Invalid JSON payload: ${e.message}`],
        warnings: []
      };
    }
  } else if (rawInput && typeof rawInput === 'object') {
    parsed = rawInput;
  } else {
    return {
      valid: false,
      errors: ['Input must be a valid JSON string or JavaScript object'],
      warnings: []
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {valid:false, errors:['Configuration must be an object'], warnings:[]};
  if ('config' in parsed && (!parsed.config || typeof parsed.config !== 'object' || Array.isArray(parsed.config))) return {valid:false, errors:['Configuration envelope must contain an object config'], warnings:[]};
  // Inspect payload wrapper structure (supports either raw CardConfig or { version, config, ... } envelope)
  let targetConfig = parsed;
  let metadata = {};

  if (parsed.config && typeof parsed.config === 'object' && !Array.isArray(parsed.config)) {
    targetConfig = parsed.config;
    metadata = {
      app: parsed.app,
      version: parsed.version,
      timestamp: parsed.timestamp,
      exportedAt: parsed.exportedAt
    };
  }

  if (!Object.keys(targetConfig).some(key => Object.hasOwn(BASE, key))) return {valid:false, errors:['Payload does not contain card configuration fields'], warnings:[]};
  const result = validateCardConfig(targetConfig, {...options,strictUnknown:options.strictUnknown??true});
  const config=result.valid?sanitizeConfig(targetConfig):undefined;
  const warnings=[...result.warnings];
  if(config)warnings.push(...normalizationWarnings(targetConfig,config));

  return {
    valid: result.valid,
    errors: result.errors,
    warnings: [...new Set(warnings)],
    config,
    metadata
  };
}

// Describe every accepted input value that normalization changes or removes.
// Added defaults and the completed layer order are ordinary compatibility, not lost input.
function normalizationWarnings(raw,config){
 const warnings=[];
 const changed=(path,before,after)=>{
  if(JSON.stringify(before)===JSON.stringify(after))return;
  if(typeof before==='string'&&typeof after==='string'&&before.length>after.length&&before.startsWith(after))warnings.push(`Se recortará '${path}' de ${before.length} a ${after.length} caracteres.`);
  else warnings.push(after===undefined?`Se ignorará '${path}', que no forma parte de la configuración actual.`:`Se normalizará '${path}' para ajustarlo al contrato actual.`);
 };
 for(const [key,value] of Object.entries(raw)){
  if(key==='elements'||key==='layerOrder'||key==='geometryVersion'||!Object.hasOwn(BASE,key))continue;
  if(typeof value==='string'&&STRING_LIMITS[key]&&value.length>STRING_LIMITS[key])continue;
  changed(key,value,config[key]);
 }
 for(const [id,state] of Object.entries(raw.elements||{})){
  const def=resolveElementDef(id),normalized=config.elements[id];
  if(!def||!state||typeof state!=='object')continue;
  if(def.isDuplicate&&def.baseId==='trend'&&('dateTable' in state||'dateColumn' in state)){
   warnings.push(`El gráfico '${id}' usará el calendario compartido '${config.dateTable}[${config.dateColumn}]'; se retirarán sus referencias de calendario antiguas.`);
  }
  const associated=def.isDuplicate&&usesValueBinding(config,id);
  const ignored=unsupportedCopyDataProperties(id,state);
  if(associated&&'measure' in state&&normalized?.measure===undefined){const source=valueBinding(config,id);warnings.push(`'${id}' usará el valor asociado '${source.measure||'Sin configurar'}' (${source.id}); se retirará su medida antigua '${String(state.measure).slice(0,120)}'.`);}
  if(associated&&usesGoalBinding(config,id)&&'targetMeasure' in state&&state.targetMeasure!==normalized?.targetMeasure){const goal=goalBinding(config,id);warnings.push(`'${id}' usará el objetivo de su grupo '${goal.measure||'Sin configurar'}' (${goal.id}); la asignación se conserva en un único campo por copia.`);}
  for(const [key,value] of Object.entries(state)){
   if(def.isDuplicate&&def.baseId==='trend'&&['dateTable','dateColumn'].includes(key))continue;
   if(associated&&key==='measure'&&normalized?.measure===undefined)continue;
   if(associated&&usesGoalBinding(config,id)&&key==='targetMeasure')continue;
   if(ignored.includes(key))continue;
   changed(`elements.${id}.${key}`,value,normalized?.[key]);
  }
 }
 return warnings;
}

/**
 * Type guard function checking if a value conforms to the minimum shape of a CardConfig.
 * @param {any} value
 * @returns {value is import('./types.d.ts').CardConfig}
 */
export function isCardConfig(value) {
  if (!value || typeof value !== 'object') return false;
  return typeof value.id === 'string' &&
    typeof value.measure === 'string' &&
    typeof value.title === 'string' &&
    typeof value.type === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number';
}

/** Validate catalogs before using local cache or external bridge responses. */
export function validateModelCatalog(value) {
  const errors = [];
  const name = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 512;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {valid:false, errors:['Model catalog must be an object']};
  if (!name(value.modelName)) errors.push('modelName must be a non-empty string');
  if (!Array.isArray(value.tables) || !value.tables.every(name)) errors.push('tables must contain table names');
  if (!Array.isArray(value.measures) || !value.measures.every(m => m && name(m.name) && name(m.table))) errors.push('measures must contain name and table');
  if (!Array.isArray(value.dateTables) || !value.dateTables.every(t => t && name(t.name) && Array.isArray(t.dateColumns) && t.dateColumns.every(name))) errors.push('dateTables must contain named date columns');
  return {valid:errors.length === 0, errors};
}

/** Return an isolated catalog with known metadata only; invalid caches are discarded. */
export function sanitizeModelCatalog(raw) {
  if (!validateModelCatalog(raw).valid) return null;
  return {
    modelName: raw.modelName,
    reportName: typeof raw.reportName === 'string' ? raw.reportName : '',
    server: typeof raw.server === 'string' ? raw.server : '',
    database: typeof raw.database === 'string' ? raw.database : '',
    databaseId: typeof raw.databaseId === 'string' ? raw.databaseId : '',
    isLiveConnection: raw.isLiveConnection === true,
    tables: [...raw.tables],
    measures: raw.measures.map(m => {
      const annotation=m.configAnnotation?validateImportedJSON(m.configAnnotation):null;
      const retained=Array.isArray(m.configWarnings)?m.configWarnings.filter(w=>typeof w==='string').slice(0,50).map(w=>w.slice(0,1000)):[];
      return {name:m.name,table:m.table,expression:typeof m.expression==='string'?m.expression:'',formatString:typeof m.formatString==='string'?m.formatString:'',configAnnotation:annotation?.valid?structuredClone(annotation.config):null,configWarnings:annotation?.valid?[...new Set([...retained,...annotation.warnings])].slice(0,50):[]};
    }),
    dateTables: raw.dateTables.map(t => ({name:t.name, dateColumns:[...t.dateColumns], isMarkedDateTable:t.isMarkedDateTable === true, primaryDateColumn:t.dateColumns.includes(t.primaryDateColumn) ? t.primaryDateColumn : t.dateColumns[0] || null, isLikelyCalendar:t.isLikelyCalendar === true}))
  };
}
