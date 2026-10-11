/**
 * KPI Atelier - Schema Validator & Data Contracts Runtime
 * Provides schema validation, type guards, bounds enforcement,
 * and JSON import contract verification for CardConfig and sub-entities.
 */

import {BASE, LIMITS, ENUMS, THEMES} from './model.mjs';
import {ELEMENTS, ELEMENT_IDS, DEFAULT_LAYER_ORDER, resolveElementDef} from './elements.mjs';

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

  // Bounds check
  for (const coord of ['x', 'y']) {
    if (coord in el) {
      const v = Number(el[coord]);
      if (!Number.isFinite(v) || v < -1000 || v > 1000) {
        errors.push(`Element ${id}.${coord} must be a number between -1000 and 1000`);
      }
    }
  }

  if ('width' in el) {
    const w = Number(el.width);
    if (!Number.isFinite(w) || w < 0 || w > 800) {
      errors.push(`Element ${id}.width must be a number between 0 and 800`);
    }
  }

  if ('size' in el) {
    const s = Number(el.size);
    if (!Number.isFinite(s) || s < 6 || s > 240) {
      errors.push(`Element ${id}.size must be a number between 6 and 240`);
    }
  }

  // Hex colors in appearance
  for (const colKey of ['color', 'backgroundColor', 'fillColor']) {
    if (colKey in el && el[colKey] && !isValidHexColor(el[colKey])) {
      errors.push(`Element ${id}.${colKey} must be a valid hex color string`);
    }
  }

  // Frame check
  if ('frame' in el && el.frame) {
    if (typeof el.frame !== 'object') {
      errors.push(`Element ${id}.frame must be an object`);
    } else {
      for (const k of ['x', 'y', 'w', 'h']) {
        if (k in el.frame && !Number.isFinite(Number(el.frame[k]))) {
          errors.push(`Element ${id}.frame.${k} must be finite`);
        }
      }
    }
  }

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
  if (raw.geometryVersion === 1) {
    warnings.push('Legacy geometry version 1 detected. Layout will migrate to version 2 standards.');
  }

  // Check defined properties
  for (const [key, rule] of Object.entries(CONFIG_SCHEMA)) {
    const val = raw[key];
    if (val === undefined || val === null) {
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
        if (!Number.isFinite(num)) {
          errors.push(`Field '${key}' must be a finite number: received '${val}'`);
        } else {
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
          warnings.push(`Field '${key}' expected boolean, received ${typeof val}`);
        }
        break;

      case 'string':
        if (typeof val !== 'string') {
          errors.push(`Field '${key}' must be a string, received ${typeof val}`);
        } else if (rule.maxLength && val.length > rule.maxLength) {
          warnings.push(`Field '${key}' exceeds max length ${rule.maxLength} (length: ${val.length})`);
        }
        break;
    }
  }

  // Check unknown properties if strict mode is enabled
  if (options.strictUnknown) {
    const knownKeys = new Set([...Object.keys(BASE), '_measureBound', '_targetCustomized', '_dateCustomized']);
    for (const k of Object.keys(raw)) {
      if (!knownKeys.has(k)) {
        warnings.push(`Unknown property detected: '${k}'`);
      }
    }
  }

  // Validate elements map
  if (raw.elements !== undefined) {
    if (typeof raw.elements !== 'object' || Array.isArray(raw.elements) || raw.elements === null) {
      errors.push("'elements' must be a valid key-value map");
    } else {
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
 * Serves as an impenetrable contract barrier against malformed or malicious imported files.
 * @param {string | object} rawInput
 * @param {{ strictUnknown?: boolean }} [options]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], config?: import('./types.d.ts').CardConfig, metadata?: object }}
 */
export function validateImportedJSON(rawInput, options = {}) {
  let parsed;
  if (typeof rawInput === 'string') {
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

  const result = validateCardConfig(targetConfig, options);

  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    config: result.data,
    metadata
  };
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
