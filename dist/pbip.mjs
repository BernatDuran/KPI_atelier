/**
 * KPI Atelier - PBIP & Semantic Model Parser
 * Reads and analyzes Power BI Enhanced Report Format (PBIP) definition files:
 * - TMDL (Tabular Model Definition Language): definition/tables/*.tmdl
 * - TMSL / BIM (Tabular Model Scripting Language): model.bim
 * 100% private, client-side, zero network requests.
 */

/**
 * Checks if a table name is likely a dedicated calendar/date dimension.
 * @param {string} name
 * @returns {boolean}
 */
export function isLikelyCalendarTable(name) {
  if (!name) return false;
  const clean = String(name).trim();
  return (
    /^(dim_?date|dim_?calendario|calendar|calendario|dates?|fechas?|dim_?tiempo)/i.test(clean) ||
    /(calendar|calendario|dimdate)/i.test(clean)
  );
}

/**
 * Sorts date tables with hierarchical prioritization:
 * 1. Explicitly marked date tables in Power BI (dataCategory: Time).
 * 2. Likely calendar tables matching known date dimension naming conventions.
 * 3. Other tables containing dateTime columns, sorted alphabetically.
 * 
 * @param {Array<{name: string, dateColumns: string[], isMarkedDateTable?: boolean, isLikelyCalendar?: boolean}>} list
 * @returns {Array}
 */
export function sortDateTables(list) {
  return list.sort((a, b) => {
    const aMarked = Boolean(a.isMarkedDateTable);
    const bMarked = Boolean(b.isMarkedDateTable);
    if (aMarked && !bMarked) return -1;
    if (!aMarked && bMarked) return 1;

    const aLikely = isLikelyCalendarTable(a.name);
    const bLikely = isLikelyCalendarTable(b.name);
    if (aLikely && !bLikely) return -1;
    if (!aLikely && bLikely) return 1;

    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  });
}

/**
 * Parses a single TMDL file content.
 * Extracts the table name, measures and columns (identifying date/dateTime types,
 * dataCategory: Time at table level, and isKey at column level).
 * 
 * @param {string} content - Raw TMDL string.
 * @param {string} [defaultTableName=''] - Fallback table name (e.g. from file name).
 * @returns {{table: string, isMarkedDateTable: boolean, primaryDateColumn: string|null, measures: Array<{name: string, table: string}>, columns: Array<{name: string, dataType: string, isKey?: boolean}>, dateColumns: string[]}}
 */
export function parseTmdl(content, defaultTableName = '') {
  let tableName = defaultTableName;
  let isMarkedDateTable = false;
  let primaryDateColumn = null;
  const measures = [];
  const columns = [];
  const dateColumns = [];

  if (typeof content !== 'string') {
    return { table: tableName, isMarkedDateTable, primaryDateColumn, measures, columns, dateColumns };
  }

  const lines = content.split(/\r?\n/);
  let currentCol = null;

  const commitCol = () => {
    if (currentCol) {
      columns.push(currentCol);
      const dt = (currentCol.dataType || '').toLowerCase();
      if (dt === 'datetime' || dt === 'date') {
        dateColumns.push(currentCol.name);
        if (currentCol.isKey) {
          primaryDateColumn = currentCol.name;
        }
      }
      currentCol = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Check for table declaration: table 'Nombre' or table Nombre
    const tableMatch = line.match(/^\s*table\s+(?:'((?:[^']|'')*)'|([^\s\r\n]+))/);
    if (tableMatch) {
      commitCol();
      tableName = (tableMatch[1] ? tableMatch[1].replace(/''/g, "'") : tableMatch[2]).trim();
      continue;
    }

    // Check for table-level dataCategory: Time (marking official Date table)
    if (currentCol === null && /^\s*dataCategory:\s*Time\b/i.test(line)) {
      isMarkedDateTable = true;
      continue;
    }

    // Check for measure declaration: measure 'Nombre' = ... or measure Nombre = ...
    const measureMatch = line.match(/^\s*measure\s+(?:'((?:[^']|'')*)'|([^\s=\r\n]+))\s*=/);
    if (measureMatch) {
      commitCol();
      const mName = (measureMatch[1] ? measureMatch[1].replace(/''/g, "'") : measureMatch[2]).trim();
      measures.push({ name: mName, table: tableName });
      continue;
    }

    // Check for column declaration: column 'Nombre' or column Nombre
    const colMatch = line.match(/^\s*column\s+(?:'((?:[^']|'')*)'|([^\s\r\n]+))/);
    if (colMatch) {
      commitCol();
      const cName = (colMatch[1] ? colMatch[1].replace(/''/g, "'") : colMatch[2]).trim();
      currentCol = { name: cName, dataType: '', isKey: false };
      continue;
    }

    // Check for properties under current column
    if (currentCol) {
      const dtMatch = line.match(/^\s*dataType:\s*(\w+)/i);
      if (dtMatch) {
        currentCol.dataType = dtMatch[1];
      }
      if (/^\s*isKey\b/i.test(line)) {
        currentCol.isKey = true;
      }
    }
  }
  commitCol();

  // If a primary key date column was found, make sure it is at the front of dateColumns
  if (primaryDateColumn && dateColumns.includes(primaryDateColumn)) {
    const remaining = dateColumns.filter(c => c !== primaryDateColumn);
    dateColumns.length = 0;
    dateColumns.push(primaryDateColumn, ...remaining);
  }

  // Ensure all measures have table name set
  measures.forEach(m => {
    if (!m.table) m.table = tableName;
  });

  return {
    table: tableName,
    isMarkedDateTable,
    primaryDateColumn,
    measures,
    columns,
    dateColumns
  };
}

/**
 * Builds a unified model catalog from multiple parsed TMDL table results.
 * 
 * @param {{modelName?: string, parsedTables: Array<{table: string, isMarkedDateTable?: boolean, primaryDateColumn?: string, measures: Array, dateColumns: string[]}>}} options
 * @returns {{modelName: string, tables: string[], measures: Array<{name: string, table: string}>, dateTables: Array<{name: string, dateColumns: string[], isMarkedDateTable: boolean, primaryDateColumn: string|null, isLikelyCalendar: boolean}>}}
 */
export function buildModelCatalog({ modelName = 'PBIP Model', parsedTables = [] }) {
  const tables = [];
  const measures = [];
  const dateTables = [];

  for (const pt of parsedTables) {
    if (!pt || !pt.table) continue;
    tables.push(pt.table);
    if (Array.isArray(pt.measures)) {
      for (const m of pt.measures) {
        measures.push({ name: m.name, table: pt.table });
      }
    }
    if (Array.isArray(pt.dateColumns) && pt.dateColumns.length > 0) {
      const cols = pt.primaryDateColumn && pt.dateColumns.includes(pt.primaryDateColumn)
        ? [pt.primaryDateColumn, ...pt.dateColumns.filter(c => c !== pt.primaryDateColumn)]
        : [...pt.dateColumns];

      dateTables.push({
        name: pt.table,
        dateColumns: cols,
        isMarkedDateTable: Boolean(pt.isMarkedDateTable),
        primaryDateColumn: pt.primaryDateColumn || null,
        isLikelyCalendar: Boolean(pt.isMarkedDateTable) || isLikelyCalendarTable(pt.table)
      });
    }
  }

  tables.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  measures.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  sortDateTables(dateTables);

  return {
    modelName,
    tables,
    measures,
    dateTables
  };
}

/**
 * Parses a TMSL JSON string (model.bim).
 * 
 * @param {string|object} input - Raw JSON string or parsed JSON object.
 * @param {string} [defaultModelName='SemanticModel']
 * @returns {{modelName: string, tables: string[], measures: Array<{name: string, table: string}>, dateTables: Array<{name: string, dateColumns: string[], isMarkedDateTable: boolean, primaryDateColumn: string|null, isLikelyCalendar: boolean}>}}
 */
export function parseBim(input, defaultModelName = 'SemanticModel') {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('El archivo BIM debe contener un objeto de modelo.');
  const model = data.model || data;
  if (!Array.isArray(model.tables)) throw new Error('El archivo BIM no contiene una colección de tablas válida.');
  const modelName = data.name || model.name || defaultModelName;
  const tables = [];
  const measures = [];
  const dateTables = [];

  const rawTables = model.tables || [];
  for (const t of rawTables) {
    const tableName = t.name || 'SinNombre';
    tables.push(tableName);
    const isMarkedDateTable = String(t.dataCategory || '').toLowerCase() === 'time';
    let primaryDateColumn = null;

    if (Array.isArray(t.measures)) {
      for (const m of t.measures) {
        if (m && m.name) {
          measures.push({ name: m.name, table: tableName });
        }
      }
    }

    const dateCols = [];
    if (Array.isArray(t.columns)) {
      for (const c of t.columns) {
        const dt = (c.dataType || '').toLowerCase();
        if (dt === 'datetime' || dt === 'date') {
          dateCols.push(c.name);
          if (c.isKey === true) {
            primaryDateColumn = c.name;
          }
        }
      }
    }

    if (dateCols.length > 0) {
      const cols = primaryDateColumn && dateCols.includes(primaryDateColumn)
        ? [primaryDateColumn, ...dateCols.filter(c => c !== primaryDateColumn)]
        : dateCols;

      dateTables.push({
        name: tableName,
        dateColumns: cols,
        isMarkedDateTable,
        primaryDateColumn,
        isLikelyCalendar: isMarkedDateTable || isLikelyCalendarTable(tableName)
      });
    }
  }

  tables.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  measures.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  sortDateTables(dateTables);

  return {
    modelName,
    tables,
    measures,
    dateTables
  };
}

/**
 * Cleans a model folder name (e.g. "Ventas.SemanticModel" -> "Ventas").
 * @param {string} rawName
 * @returns {string}
 */
function cleanModelName(rawName) {
  if (!rawName) return 'PBIP Model';
  return rawName.replace(/\.(SemanticModel|pbip|Report)$/i, '');
}

// Conservative browser resource budgets; all reads stay local and are cancellable.
export const PBIP_LIMITS = Object.freeze({ maxEntries: 10000, maxFiles: 1000, maxDepth: 16, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024 });
const checkScan = signal => { if (signal?.aborted) throw new DOMException('Lectura cancelada.', 'AbortError'); };
const modelFile = name => /\.tmdl$/i.test(name) || /^model\.bim$/i.test(name);
const modelRoot = path => {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  const semantic = parts.findIndex(p => /\.SemanticModel$/i.test(p));
  if (semantic >= 0) return parts.slice(0, semantic + 1).join('/');
  const definition = parts.findIndex(p => p.toLowerCase() === 'definition');
  return (definition >= 0 ? parts.slice(0, definition) : parts.slice(0, -1)).join('/');
};

async function readModelFiles(files, fallbackName, {signal = undefined} = {}) {
  checkScan(signal);
  if (!files.length) throw new Error('No se encontraron archivos de modelo (*.tmdl o model.bim).');
  if (files.length > PBIP_LIMITS.maxFiles) throw new Error('La carpeta contiene demasiados archivos de modelo. Selecciona una sola carpeta SemanticModel.');
  const roots = new Set(files.map(f => modelRoot(f.path)));
  if (roots.size !== 1) throw new Error('La carpeta contiene varios modelos. Selecciona la carpeta SemanticModel del modelo que quieres utilizar.');
  const root = [...roots][0];
  const modelName = cleanModelName(root.split('/').pop() || fallbackName);
  const parsedTables = [];
  let totalBytes = 0, bimContent = null;
  for (const entry of files) {
    checkScan(signal);
    const file = await entry.getFile();
    if (file.size > PBIP_LIMITS.maxFileBytes) throw new Error(`El archivo ${entry.name} supera el límite de 10 MB.`);
    const content = await file.text();
    checkScan(signal);
    const bytes = new TextEncoder().encode(content).byteLength;
    totalBytes += bytes;
    if (bytes > PBIP_LIMITS.maxFileBytes || totalBytes > PBIP_LIMITS.maxTotalBytes) throw new Error('El modelo supera el límite de lectura local (10 MB por archivo, 50 MB en total).');
    if (/\.tmdl$/i.test(entry.name)) {
      // database.tmdl, model.tmdl, relationships and expressions are not tables.
      if (/^\s*table\s+/m.test(content)) parsedTables.push(parseTmdl(content, entry.name.replace(/\.tmdl$/i, '')));
    } else bimContent = content;
  }
  if (parsedTables.length) return buildModelCatalog({modelName, parsedTables});
  if (bimContent) return parseBim(bimContent, modelName);
  throw new Error('El modelo seleccionado no contiene tablas TMDL ni un model.bim válido.');
}

/** Read one semantic model through the directory picker. */
export async function scanDirectoryHandle(dirHandle, options = {}) {
  const files = [];
  let entries = 0;
  async function traverse(handle, path, depth) {
    checkScan(options.signal);
    if (depth > PBIP_LIMITS.maxDepth) throw new Error('La carpeta es demasiado profunda. Selecciona directamente SemanticModel.');
    for await (const entry of handle.values()) {
      checkScan(options.signal);
      if (++entries > PBIP_LIMITS.maxEntries) throw new Error('La carpeta contiene demasiados archivos. Selecciona directamente SemanticModel.');
      if (entry.kind === 'file' && modelFile(entry.name)) files.push({name: entry.name, path: `${path}/${entry.name}`, getFile: () => entry.getFile()});
      else if (entry.kind === 'directory' && !entry.name.startsWith('.') && entry.name !== 'node_modules') await traverse(entry, `${path}/${entry.name}`, depth + 1);
    }
  }
  await traverse(dirHandle, dirHandle.name, 0);
  return readModelFiles(files, dirHandle.name, options);
}

/** Same parser and resource limits for the webkitdirectory fallback. */
export async function scanFileList(fileList, options = {}) {
  checkScan(options.signal);
  if (fileList.length > PBIP_LIMITS.maxEntries) throw new Error('La carpeta contiene demasiados archivos. Selecciona directamente SemanticModel.');
  const files = [];
  for (const file of Array.from(fileList)) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.replaceAll('\\', '/').split('/');
    if (parts.some(p => p.startsWith('.') || p === 'node_modules')) continue;
    if (parts.length > PBIP_LIMITS.maxDepth + 2) throw new Error('La carpeta es demasiado profunda. Selecciona directamente SemanticModel.');
    if (modelFile(file.name)) files.push({name:file.name, path, getFile:async () => file});
  }
  return readModelFiles(files, 'PBIP Model', options);
}

export {getApiBase, discoverLivePbi, fetchLivePbiStatus, fetchLivePbiModel, injectMeasureToLivePbi, initLivePbiStream} from './pbi-client.mjs';
