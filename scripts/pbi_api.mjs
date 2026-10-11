import { runBridge, shutdownBridgeDaemon } from './pbi_transport.mjs';
import { HttpError, isAllowedHost, isAllowedOrigin, localServer, readBody, sendJson, textField, validateMeasure } from './pbi_http.mjs';
export { runBridge, shutdownBridgeDaemon, isAllowedOrigin };

// Factory keeps HTTP tests independent of PowerShell and owns the SSE lifecycle.
/** @param {{bridge?: (args: string[]) => Promise<any>, pollMs?: number}} [options] */
export function createPbiApi({ bridge = runBridge, pollMs = 4000 } = {}) {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  let timer = null, polling = null;
  function emit(client, payload) {
    if (client.destroyed || client.writableEnded) { clients.delete(client); return; }
    try {
      if (!client.write(`data: ${JSON.stringify(payload)}\n\n`)) { client.end(); clients.delete(client); }
    } catch { clients.delete(client); client.destroy(); }
  }
  function poll() {
    if (polling) return polling;
    polling = bridge(['-Action','discover']).then(result => {
      for (const client of clients) emit(client, {type:'instances',instances:result.instances || []});
    }).catch(() => {
      for (const client of clients) emit(client, {type:'bridge-error',error:'No se pudo actualizar la conexión con Power BI.'});
    }).finally(() => {
      polling = null;
      if (clients.size) timer = setTimeout(() => { timer = null; poll(); }, pollMs);
    });
    return polling;
  }
  function shutdown() { clearTimeout(timer); timer = null; for (const client of clients) client.end(); clients.clear(); }
  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {URL} parsedUrl */
  async function handle(req, res, parsedUrl) {
    const { pathname, searchParams } = parsedUrl;
    const routes = {'/api/pbi/events':'GET','/api/pbi/discover':'GET','/api/pbi/status':'GET','/api/pbi/model':'GET','/api/pbi/measure':'POST'};
    if (!(pathname in routes)) { sendJson(res,404,{success:false,error:'Ruta API no encontrada.'}); return true; }
    if (!isAllowedHost(req.headers.host, req.socket?.localPort) || !isAllowedOrigin(req.headers.origin, req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site') {
      sendJson(res,403,{success:false,error:'Origen no autorizado.'}); return true;
    }
    if (req.method !== routes[pathname]) { res.setHeader('Allow',routes[pathname]); sendJson(res,405,{success:false,error:'Método no permitido.'}); return true; }
    try {
      if (pathname === '/api/pbi/events') {
        if (clients.size >= 16) throw new HttpError(429,'Demasiadas conexiones de seguimiento abiertas.');
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'});
        res.write(': stream-connected\n\n'); clients.add(res);
        res.on('close',() => { clients.delete(res); if (!clients.size) { clearTimeout(timer); timer = null; } });
        // A new connection must never receive a stale cached list that could mark a
        // newly opened model disconnected before its first fresh discovery.
        clearTimeout(timer); timer = null; poll();
      } else if (pathname === '/api/pbi/discover') sendJson(res,200,await bridge(['-Action','discover']));
      else if (pathname === '/api/pbi/status' || pathname === '/api/pbi/model') {
        const server = localServer(searchParams.get('server') || '');
        const database = textField(searchParams.get('database') || '', 'database',512);
        const args = ['-Action',pathname.endsWith('/model') ? 'schema' : 'status'];
        if (server) args.push('-Server',server);
        if (database) args.push('-Database',database);
        sendJson(res,200,await bridge(args));
      } else {
        const body = validateMeasure(await readBody(req));
        const b64 = value => Buffer.from(value,'utf8').toString('base64');
        const args = ['-Action','inject-measure','-Server',body.server,'-Database',body.database,'-TableNameBase64',b64(body.tableName),'-MeasureNameBase64',b64(body.measureName),'-ExpressionBase64',b64(body.daxExpression),'-ExpectedState',body.expectedExpression === null ? 'absent' : 'present'];
        if (body.expectedExpression !== null) args.push('-ExpectedExpressionBase64',b64(body.expectedExpression));
        if (body.formatString) args.push('-FormatString',body.formatString);
        if (body.configAnnotation) args.push('-ConfigBase64',b64(body.configAnnotation));
        sendJson(res,200,await bridge(args));
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err.code === 'CONFLICT' ? 409 : err.code === 'BRIDGE_TIMEOUT' ? 504 : err.code === 'BRIDGE_BUSY' ? 503 : 502;
      sendJson(res,status,{success:false,error:err.message || 'Error de conexión Power BI.',code:err.code || 'INVALID_REQUEST',outcomeUnknown:Boolean(err.outcomeUnknown)});
    }
    return true;
  }
  return { handle, shutdown };
}
const api = createPbiApi();
export const handlePbiApi = api.handle;
export const shutdownPbiApi = api.shutdown;
