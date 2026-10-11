import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeScript = fileURLToPath(new URL('./pbi_bridge.ps1', import.meta.url));
const WRITES = new Set(['inject-measure', 'delete-measure']);
export class BridgeError extends Error {
  constructor(message, code = 'BRIDGE_UNAVAILABLE', outcomeUnknown = false) {
    super(message); this.code = code; this.outcomeUnknown = outcomeUnknown;
  }
}

// Requests are serialized and correlated. Never retry an uncertain model write.
export function createBridgeTransport({ spawnProcess = spawn, startupMs = 15000, operationMs = 30000, maxPending = 16 } = {}) {
  let child = null, starting = null, rejectStart = null, active = null, serial = Promise.resolve(), pending = 0, sequence = 0, generation = 0, closed = false;
  function stop(error = new BridgeError('Conexión Power BI cerrada.')) {
    generation++;
    const previous = child; child = null;
    rejectStart?.(error); rejectStart = null; starting = null;
    if (active) {
      const current = active; active = null; clearTimeout(current.timer);
      current.reject(new BridgeError(error.message, error.code, current.isWrite));
    }
    if (previous) { previous.stdin.destroy(); previous.kill(); }
  }
  function start() {
    if (starting) return starting;
    if (child) return Promise.resolve(child);
    starting = new Promise((resolve, reject) => {
      let current;
      try { current = spawnProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bridgeScript, '-Interactive'], { stdio:['pipe','pipe','pipe'], windowsHide:true }); }
      catch (err) { reject(err); return; }
      child = current;
      let ready = false;
      const timer = setTimeout(() => stop(new BridgeError('Power BI no respondió al iniciar.', 'BRIDGE_TIMEOUT')), startupMs);
      rejectStart = err => { clearTimeout(timer); reject(err); };
      current.stdout.setEncoding('utf8'); current.stderr.setEncoding('utf8');
      current.stderr.on('data', () => {});
      current.stdin.on('error', err => { if (child === current) stop(new BridgeError(err.message)); });
      const lines = readline.createInterface({ input:current.stdout, terminal:false });
      lines.on('line', line => {
        if (child !== current || !line.trim()) return;
        let data;
        try { data = JSON.parse(line); } catch { stop(new BridgeError('Respuesta inválida de Power BI.', 'BRIDGE_PROTOCOL')); return; }
        if (!ready) {
          if (data.ready !== true) { stop(new BridgeError('Inicio inválido de Power BI.', 'BRIDGE_PROTOCOL')); return; }
          ready = true; clearTimeout(timer); rejectStart = null; starting = null; resolve(current); return;
        }
        if (!active || data.requestId !== active.id) { stop(new BridgeError('Respuesta Power BI fuera de secuencia.', 'BRIDGE_PROTOCOL')); return; }
        const request = active; active = null; clearTimeout(request.timer);
        if (data.success === false) request.reject(new BridgeError(data.error || 'Power BI rechazó la operación.', data.code || 'BRIDGE_REJECTED', Boolean(data.outcomeUnknown)));
        else { delete data.requestId; request.resolve(data); }
      });
      current.on('error', err => { if (child === current) stop(new BridgeError(err.message)); });
      current.on('close', () => { lines.close(); if (child === current) stop(new BridgeError('El proceso Power BI se cerró antes de completar la operación.')); });
    });
    starting.catch(() => { starting = null; });
    return starting;
  }
  function request(payload) {
    if (closed) return Promise.reject(new BridgeError('Conexión Power BI cerrada.'));
    if (pending >= maxPending) return Promise.reject(new BridgeError('Power BI está ocupado. Espera a que finalice la operación.', 'BRIDGE_BUSY'));
    const queuedGeneration = generation, queuedAt = Date.now();
    pending++;
    const work = serial.then(async () => {
      if (closed || queuedGeneration !== generation) throw new BridgeError('La conexión se interrumpió antes de enviar la operación.');
      if (Date.now() - queuedAt >= operationMs) throw new BridgeError('Power BI está ocupado. Vuelve a intentarlo.', 'BRIDGE_BUSY');
      const process = await start();
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => stop(new BridgeError('Power BI ha superado el tiempo de espera. Comprueba el modelo antes de volver a guardar.', 'BRIDGE_TIMEOUT')), operationMs);
        active = { id, resolve, reject, timer, isWrite:WRITES.has(payload.action) };
        try {
          process.stdin.write(JSON.stringify({ ...payload, requestId:id }) + '\n', err => { if (err && active?.id === id) stop(new BridgeError(err.message)); });
        } catch (err) { stop(new BridgeError(err.message)); }
      });
    });
    serial = work.catch(() => {});
    return work.finally(() => { pending--; });
  }
  return { request, shutdown() { closed = true; stop(); } };
}

const transport = createBridgeTransport();
/** @param {string[]} args @returns {Promise<any>} */
export function runBridge(args) {
  const request = {};
  for (let i = 0; i < args.length; i += 2) { const key = args[i].slice(1); request[key[0].toLowerCase() + key.slice(1)] = args[i + 1]; }
  return transport.request(request);
}
export function shutdownBridgeDaemon() { transport.shutdown(); }
