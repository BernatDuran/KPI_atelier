import { discoverLivePbi, fetchLivePbiModel, initLivePbiStream } from './pbi-client.mjs';
import { getPbipModel, setPbipModel, toast } from './state.mjs';
import { beginModelRequest } from './model-session.mjs';

let previousCleanup = null;

/** One stream for both External Tool launches and ordinary browser launches. */
export async function initLiveConnection(render) {
  if (typeof window === 'undefined' || !window.location || typeof fetch !== 'function') return;
  previousCleanup?.();
  const request = beginModelRequest();
  let closeStream = null;
  let closed = false;
  const dispose = () => { closed = true; closeStream?.(); closeStream = null; };
  previousCleanup = dispose;
  window.addEventListener('pagehide', dispose, { once: true });
  const markUnavailable = () => {
    const current = getPbipModel();
    if (!closed && current?.isLiveConnection) {
      setPbipModel({ ...current, isLiveConnection: false }, false);
      render();
      toast('No se pudo comprobar la conexión con Power BI. Reconecta el informe para continuar.');
    }
  };
  const params = new URLSearchParams(window.location.search || '');
  try {
    let server = params.get('server');
    let database = params.get('database') || '';
    if (!server) {
      const instances = await discoverLivePbi({ signal: request.signal });
      if (closed || !request.isCurrent()) return;
      if (instances.length === 1) { server = instances[0].server; database = instances[0].database || ''; }
    }
    if (server) {
      const catalog = await fetchLivePbiModel(server, database, { signal: request.signal });
      if (closed || !request.commit(catalog, true)) return;
      render();
      toast(`Power BI conectado · ${catalog.measures.length} medidas disponibles.`);
    }
  } catch (error) {
    if (!closed && request.isCurrent() && params.has('server')) toast(`No se pudo conectar al informe: ${error.message}`);
  } finally {
    request.finish();
    if (!closed) closeStream = initLivePbiStream(instances => {
      const current = getPbipModel();
      if (current?.isLiveConnection && !instances.some(instance => instance.server === current.server)) {
        setPbipModel({ ...current, isLiveConnection: false }, false);
        render();
        toast('Power BI se ha desconectado. Reconecta el informe para aplicar una medida.');
      }
    }, markUnavailable);
  }
}
