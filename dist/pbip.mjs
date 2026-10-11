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
  const model = data.model || data;
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

/**
 * Scans a FileSystemDirectoryHandle (File System Access API) recursively for TMDL or BIM files.
 * 
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<{modelName: string, tables: string[], measures: Array<{name: string, table: string}>, dateTables: Array<{name: string, dateColumns: string[], isMarkedDateTable: boolean, primaryDateColumn: string|null, isLikelyCalendar: boolean}>}>}
 */
export async function scanDirectoryHandle(dirHandle) {
  const tmdlFiles = [];
  let bimContent = null;
  const modelName = cleanModelName(dirHandle.name);

  async function traverse(handle, path = '') {
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') {
        if (entry.name.endsWith('.tmdl')) {
          const file = await entry.getFile();
          const text = await file.text();
          tmdlFiles.push({ name: entry.name, path: `${path}/${entry.name}`, content: text });
        } else if (entry.name.toLowerCase() === 'model.bim' && !bimContent) {
          const file = await entry.getFile();
          const text = await file.text();
          bimContent = text;
        }
      } else if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await traverse(entry, `${path}/${entry.name}`);
        }
      }
    }
  }

  await traverse(dirHandle);

  if (tmdlFiles.length > 0) {
    const parsedTables = tmdlFiles.map(f => {
      const defaultName = f.name.replace(/\.tmdl$/i, '');
      return parseTmdl(f.content, defaultName);
    });
    return buildModelCatalog({ modelName, parsedTables });
  }

  if (bimContent) {
    return parseBim(bimContent, modelName);
  }

  throw new Error('No se encontraron archivos de modelo (*.tmdl o model.bim) en la carpeta seleccionada.');
}

/**
 * Scans a FileList from <input type="file" webkitdirectory> fallback.
 * 
 * @param {FileList|Array<File>} fileList
 * @returns {Promise<{modelName: string, tables: string[], measures: Array<{name: string, table: string}>, dateTables: Array<{name: string, dateColumns: string[], isMarkedDateTable: boolean, primaryDateColumn: string|null, isLikelyCalendar: boolean}>}>}
 */
export async function scanFileList(fileList) {
  const tmdlFiles = [];
  let bimContent = null;
  let modelName = 'PBIP Model';

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const relPath = file.webkitRelativePath || file.name;
    const parts = relPath.split('/');
    if (parts.length > 1 && modelName === 'PBIP Model') {
      modelName = cleanModelName(parts[0]);
    }

    if (file.name.endsWith('.tmdl')) {
      const text = await file.text();
      tmdlFiles.push({ name: file.name, path: relPath, content: text });
    } else if (file.name.toLowerCase() === 'model.bim' && !bimContent) {
      const text = await file.text();
      bimContent = text;
    }
  }

  if (tmdlFiles.length > 0) {
    const parsedTables = tmdlFiles.map(f => {
      const defaultName = f.name.replace(/\.tmdl$/i, '');
      return parseTmdl(f.content, defaultName);
    });
    return buildModelCatalog({ modelName, parsedTables });
  }

  if (bimContent) {
    return parseBim(bimContent, modelName);
  }

  throw new Error('No se encontraron archivos de modelo (*.tmdl o model.bim) en los archivos seleccionados.');
}

/**
 * Determines API base URL for bridge communication.
 * Allows transparent operation when running from http server or file:// protocol.
 */
export function getApiBase() {
  if (typeof window !== 'undefined' && window.location && window.location.protocol && window.location.protocol.startsWith('http')) {
    return '';
  }
  return 'http://127.0.0.1:8080';
}

/**
 * Discovers active local Power BI Desktop instances via the bridge server.
 * @returns {Promise<Array<{pid: number, port: number, server: string, reportName?: string, database?: string}>>}
 */
export async function discoverLivePbi() {
  const res = await fetch(`${getApiBase()}/api/pbi/discover`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.instances || [];
}

/**
 * Checks connection status to a local Power BI Desktop instance.
 * @param {string} [server]
 * @returns {Promise<{connected: boolean, server: string, serverName: string, databases: Array<{name: string, id: string}>}>}
 */
export async function fetchLivePbiStatus(server = '') {
  const base = getApiBase();
  const url = server ? `${base}/api/pbi/status?server=${encodeURIComponent(server)}` : `${base}/api/pbi/status`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * Connects to live Power BI Desktop and builds a full model catalog.
 * @param {string} server
 * @param {string} [database]
 * @returns {Promise<{modelName: string, reportName?: string, isLiveConnection: boolean, server: string, database: string, tables: string[], measures: Array<{name: string, table: string, expression?: string, configAnnotation?: any}>, dateTables: Array<{name: string, dateColumns: string[], isMarkedDateTable: boolean, primaryDateColumn: string|null, isLikelyCalendar: boolean}>}>}
 */
export async function fetchLivePbiModel(server, database = '') {
  const url = `${getApiBase()}/api/pbi/model?server=${encodeURIComponent(server)}${database ? `&database=${encodeURIComponent(database)}` : ''}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();

  const allTables = (data.tables || []).map(t => (typeof t === 'string' ? t : t.name)).filter(Boolean);
  const userTables = (data.tables || [])
    .filter(t => !t.isAutoDate && !t.isHidden && !String(t.name || t).startsWith('LocalDateTable_') && !String(t.name || t).startsWith('DateTableTemplate_'))
    .map(t => (typeof t === 'string' ? t : t.name))
    .filter(Boolean);
  const tables = userTables.length > 0 ? userTables : allTables;
  const measures = (data.measures || []).map(m => {
    let cfg = null;
    if (m.configAnnotation) {
      try {
        cfg = typeof m.configAnnotation === 'string' ? JSON.parse(m.configAnnotation) : m.configAnnotation;
      } catch {}
    }
    return {
      name: m.name,
      table: m.table,
      expression: m.expression || '',
      formatString: m.formatString || '',
      configAnnotation: cfg
    };
  });

  const dateTables = (data.detectedDateTables || []).map(dt => ({
    name: dt.table,
    dateColumns: dt.dateColumns || [],
    isMarkedDateTable: Boolean(dt.isOfficialMarked),
    primaryDateColumn: dt.suggestedColumn || (dt.dateColumns?.[0] || null),
    isLikelyCalendar: dt.tier <= 2
  }));

  return {
    modelName: data.modelName || data.reportName || data.database || 'Power BI Desktop',
    reportName: data.reportName || data.modelName || '',
    isLiveConnection: true,
    server: data.server,
    database: data.database,
    tables,
    measures,
    dateTables
  };
}

/**
 * Injects or updates a DAX measure directly in Power BI Desktop via the bridge.
 * @param {any} payload
 * @returns {Promise<{success: boolean, measureName: string, tableName: string, isNew: boolean}>}
 */
export async function injectMeasureToLivePbi({ server, database, tableName = '', measureName, daxExpression, formatString = '', configAnnotation = null }) {
  const res = await fetch(`${getApiBase()}/api/pbi/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server,
      database,
      tableName,
      measureName,
      daxExpression,
      formatString,
      configAnnotation
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * Connects to the real-time Server-Sent Events stream from the local bridge.
 * Dispatches live updates whenever Power BI Desktop instances appear or disappear.
 * @param {(instances: Array<{pid: number, port: number, server: string, reportName?: string, database?: string}>) => void} onInstancesChange
 * @returns {(() => void) | null} Cleanup function to close the stream
 */
export function initLivePbiStream(onInstancesChange) {
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return null;
  try {
    const es = new EventSource(`${getApiBase()}/api/pbi/events`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'instances' && typeof onInstancesChange === 'function') {
          onInstancesChange(data.instances || []);
        }
      } catch {}
    };
    return () => {
      try { es.close(); } catch {}
    };
  } catch {
    return null;
  }
}

