import { validateModelCatalog } from './schema.mjs';

/** Bounded requests with explicit mutation uncertainty; callers must not auto-retry writes. */
export async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const mutation = options.method === 'POST';
  try {
    const response = await fetch(getApiBase() + path, { cache: 'no-store', ...options, signal: controller.signal });
    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw Object.assign(new Error(data.error || 'Error HTTP ' + response.status), {
        status: response.status, code: data.code, outcomeUnknown: Boolean(data.outcomeUnknown)
      });
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('Power BI ha tardado demasiado en responder. Actualiza el estado antes de continuar.', { cause: error }), { name: 'AbortError', outcomeUnknown: mutation });
    if (error.status === undefined && mutation) error.outcomeUnknown = true;
    throw error;
  } finally { clearTimeout(timer); }
}

/**
 * Determines API base URL for bridge communication.
 * Browser requests must use the local app server (file:// is intentionally rejected).
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
  const json = await apiRequest('/api/pbi/discover');
  return json.instances || [];
}

/**
 * Checks connection status to a local Power BI Desktop instance.
 * @param {string} [server]
 * @returns {Promise<{connected: boolean, server: string, serverName: string, databases: Array<{name: string, id: string}>}>}
 */
export async function fetchLivePbiStatus(server = '') {
  return apiRequest('/api/pbi/status' + (server ? '?server=' + encodeURIComponent(server) : ''));
}

/**
 * Connects to live Power BI Desktop and builds a full model catalog.
 * @param {string} server
 * @param {string} [database]
 * @returns {Promise<{modelName: string, reportName?: string, isLiveConnection: boolean, server: string, database: string, databaseId: string, tables: string[], measures: Array<{name: string, table: string, expression?: string, configAnnotation?: any}>, dateTables: Array<{name: string, dateColumns: string[], isMarkedDateTable: boolean, primaryDateColumn: string|null, isLikelyCalendar: boolean}>}>}
 */
export async function fetchLivePbiModel(server, database = '') {
  const data = await apiRequest('/api/pbi/model?server=' + encodeURIComponent(server) + (database ? '&database=' + encodeURIComponent(database) : ''));

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

  const catalog = {
    modelName: data.modelName || data.reportName || data.database || 'Power BI Desktop',
    reportName: data.reportName || data.modelName || '',
    isLiveConnection: true,
    server: data.server,
    database: data.database,
    databaseId: data.databaseId || data.database,
    tables,
    measures,
    dateTables
  };
  const validation = validateModelCatalog(catalog);
  if (!validation.valid) throw new Error("El catálogo recibido no es válido: " + validation.errors.join("; "));
  return catalog;
}

/**
 * Injects or updates a DAX measure directly in Power BI Desktop via the bridge.
 * @param {any} payload
 * @returns {Promise<{success: boolean, measureName: string, tableName: string, isNew: boolean}>}
 */
export async function injectMeasureToLivePbi(payload) {
  return apiRequest('/api/pbi/measure', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
}

/**
 * Connects to the real-time Server-Sent Events stream from the local bridge.
 * Dispatches live updates whenever Power BI Desktop instances appear or disappear.
 * @param {(instances: Array<{pid: number, port: number, server: string, reportName?: string, database?: string}>) => void} onInstancesChange
 * @returns {(() => void) | null} Cleanup function to close the stream
 */
export function initLivePbiStream(onInstancesChange, onUnavailable = () => {}) {
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return null;
  try {
    const es = new EventSource(`${getApiBase()}/api/pbi/events`);
    let outageTimer = null;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        clearTimeout(outageTimer);
        outageTimer = null;
        if (data.type === 'instances' && typeof onInstancesChange === 'function') {
          onInstancesChange(data.instances || []);
        } else if (data.type === 'bridge-error') onUnavailable();
      } catch {}
    };
    // EventSource reconnects automatically. Avoid flickering the connection status
    // during a brief stream reconnect, but invalidate a sustained outage.
    es.onerror = () => { if (!outageTimer) outageTimer = setTimeout(onUnavailable, 10000); };
    return () => {
      clearTimeout(outageTimer);
      try { es.close(); } catch {}
    };
  } catch {
    return null;
  }
}
