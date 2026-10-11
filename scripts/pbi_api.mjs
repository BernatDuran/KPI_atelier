// scripts/pbi_api.mjs
// Handles REST API calls between KPI Atelier frontend and local Power BI Desktop
// Incorporates persistent IPC child process (<25ms) and strict local-only CORS protection.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeScript = fileURLToPath(new URL('./pbi_bridge.ps1', import.meta.url));

// ----------------------------------------------------
// Persistent PowerShell IPC Daemon
// ----------------------------------------------------
let bridgeDaemon = null;
let daemonRl = null;
let daemonStarting = null;
const daemonQueue = [];

function startDaemon() {
  if (daemonStarting) return daemonStarting;
  if (bridgeDaemon && !bridgeDaemon.killed) return Promise.resolve(bridgeDaemon);

  daemonStarting = new Promise((resolve, reject) => {
    try {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', bridgeScript,
        '-Interactive'
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      const rl = readline.createInterface({ input: child.stdout, terminal: false });
      let ready = false;

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (!ready) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.ready) {
              ready = true;
              bridgeDaemon = child;
              daemonRl = rl;
              daemonStarting = null;
              resolve(child);
              return;
            }
          } catch {}
        }

        const nextReq = daemonQueue.shift();
        if (nextReq) {
          try {
            const data = JSON.parse(trimmed);
            if (data.success === false && data.error) {
              const err = new Error(data.error);
              err.isBridgeError = true;
              nextReq.reject(err);
            } else {
              nextReq.resolve(data);
            }
          } catch (e) {
            nextReq.reject(new Error('Formato JSON inválido recibido del bridge daemon: ' + trimmed));
          }
        }
      });

      child.on('close', (code) => {
        bridgeDaemon = null;
        daemonRl = null;
        daemonStarting = null;
        while (daemonQueue.length > 0) {
          const req = daemonQueue.shift();
          req.reject(new Error(`Daemon de PowerShell cerrado inesperadamente con código ${code}`));
        }
      });

      child.on('error', (err) => {
        bridgeDaemon = null;
        daemonRl = null;
        daemonStarting = null;
        reject(err);
      });
    } catch (err) {
      daemonStarting = null;
      reject(err);
    }
  });

  return daemonStarting;
}

export function shutdownBridgeDaemon() {
  if (bridgeDaemon && !bridgeDaemon.killed) {
    try {
      bridgeDaemon.stdin.end();
      bridgeDaemon.kill();
    } catch {}
    bridgeDaemon = null;
    daemonRl = null;
  }
}

if (typeof process !== 'undefined') {
  process.on('exit', shutdownBridgeDaemon);
  process.on('SIGINT', () => { shutdownBridgeDaemon(); process.exit(0); });
  process.on('SIGTERM', () => { shutdownBridgeDaemon(); process.exit(0); });
}

function parseArgsToRequest(args) {
  const req = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const val = args[i + 1];
    if (typeof key === 'string' && key.startsWith('-')) {
      const cleanKey = key.slice(1);
      const prop = cleanKey.charAt(0).toLowerCase() + cleanKey.slice(1);
      req[prop] = val;
      i++;
    }
  }
  return req;
}

export async function runBridge(args) {
  const reqObj = parseArgsToRequest(args);
  try {
    const daemon = await startDaemon();
    return await new Promise((resolve, reject) => {
      daemonQueue.push({ resolve, reject });
      daemon.stdin.write(JSON.stringify(reqObj) + '\n');
    });
  } catch (err) {
    if (err.isBridgeError) {
      throw err;
    }
    // Graceful fallback to one-shot process execution with stdin if daemon is unavailable
    return runBridgeOneShot(args);
  }
}

function runBridgeOneShot(args) {
  const reqObj = parseArgsToRequest(args);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', bridgeScript,
      '-FromStdin'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', code => {
      const trimmed = stdout.trim();
      if (code !== 0) {
        try {
          const errObj = JSON.parse(trimmed || '{}');
          reject(new Error(errObj.error || stderr || `PowerShell exited with code ${code}`));
        } catch {
          reject(new Error(stderr || trimmed || `PowerShell exited with code ${code}`));
        }
      } else {
        try {
          resolve(JSON.parse(trimmed));
        } catch (e) {
          reject(new Error('Formato JSON inválido recibido del bridge: ' + trimmed));
        }
      }
    });

    child.on('error', err => reject(err));

    child.stdin.write(JSON.stringify(reqObj));
    child.stdin.end();
  });
}

// ----------------------------------------------------
// CORS & Local Network Security
// ----------------------------------------------------
export function isAllowedOrigin(origin) {
  if (!origin || origin === 'null') return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    return (host === 'localhost' || host === '127.0.0.1' || host === '::1');
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, data, req = null) {
  const payload = JSON.stringify(data);
  const origin = req?.headers?.origin;
  const allowOrigin = (origin === 'null') ? '*' : (isAllowedOrigin(origin) && origin ? origin : 'http://127.0.0.1:8080');

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload, 'utf8'),
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ----------------------------------------------------
// Server-Sent Events (SSE) Watcher
// ----------------------------------------------------
const sseClients = new Set();
let sseWatcherTimer = null;
let lastKnownInstancesJson = '';

function broadcastSse(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function startSseWatcher() {
  if (sseWatcherTimer) return;
  sseWatcherTimer = setInterval(async () => {
    if (sseClients.size === 0) {
      clearInterval(sseWatcherTimer);
      sseWatcherTimer = null;
      return;
    }
    try {
      const result = await runBridge(['-Action', 'discover']);
      const currentJson = JSON.stringify(result.instances || []);
      if (currentJson !== lastKnownInstancesJson) {
        lastKnownInstancesJson = currentJson;
        broadcastSse({ type: 'instances', instances: result.instances || [] });
      }
    } catch {}
  }, 4000);
}

export async function handlePbiApi(req, res, parsedUrl) {
  const origin = req.headers.origin;

  if (origin && !isAllowedOrigin(origin)) {
    sendJson(res, 403, {
      success: false,
      error: 'Acceso rechazado: Origen no autorizado por la política de seguridad local.'
    }, req);
    return true;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': (origin === 'null') ? '*' : (isAllowedOrigin(origin) && origin ? origin : 'http://127.0.0.1:8080'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    });
    res.end();
    return true;
  }

  const { pathname, searchParams } = parsedUrl;

  try {
    if (pathname === '/api/pbi/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': (origin === 'null') ? '*' : (isAllowedOrigin(origin) && origin ? origin : 'http://127.0.0.1:8080'),
        'Vary': 'Origin'
      });
      res.write(': stream-connected\n\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });

      startSseWatcher();

      runBridge(['-Action', 'discover'])
        .then(result => {
          lastKnownInstancesJson = JSON.stringify(result.instances || []);
          res.write(`data: ${JSON.stringify({ type: 'instances', instances: result.instances || [] })}\n\n`);
        })
        .catch(() => {});

      return true;
    }

    if (pathname === '/api/pbi/discover') {
      const result = await runBridge(['-Action', 'discover']);
      sendJson(res, 200, result, req);
      return true;
    }

    if (pathname === '/api/pbi/status') {
      const server = searchParams.get('server') || '';
      const args = ['-Action', 'status'];
      if (server) args.push('-Server', server);
      const result = await runBridge(args);
      sendJson(res, 200, result, req);
      return true;
    }

    if (pathname === '/api/pbi/model') {
      const server = searchParams.get('server') || '';
      const database = searchParams.get('database') || '';
      const args = ['-Action', 'schema'];
      if (server) args.push('-Server', server);
      if (database) args.push('-Database', database);
      const result = await runBridge(args);
      sendJson(res, 200, result, req);
      return true;
    }

    if (pathname === '/api/pbi/measure' && req.method === 'POST') {
      const body = await readBody(req);
      const {
        server,
        database,
        tableName = '_Measures',
        measureName,
        daxExpression,
        formatString = '',
        configAnnotation = null
      } = body;

      if (!server || !measureName || !daxExpression) {
        sendJson(res, 400, {
          success: false,
          error: 'Parámetros requeridos: server, measureName, daxExpression'
        }, req);
        return true;
      }

      const exprBase64 = Buffer.from(daxExpression, 'utf8').toString('base64');
      const tableBase64 = Buffer.from(tableName, 'utf8').toString('base64');
      const measureBase64 = Buffer.from(measureName, 'utf8').toString('base64');
      const args = [
        '-Action', 'inject-measure',
        '-Server', server,
        '-TableNameBase64', tableBase64,
        '-MeasureNameBase64', measureBase64,
        '-ExpressionBase64', exprBase64
      ];

      if (database) args.push('-Database', database);
      if (formatString) args.push('-FormatString', formatString);

      if (configAnnotation) {
        const configStr = typeof configAnnotation === 'string'
          ? configAnnotation
          : JSON.stringify(configAnnotation);
        const configBase64 = Buffer.from(configStr, 'utf8').toString('base64');
        args.push('-ConfigBase64', configBase64);
      }

      const result = await runBridge(args);
      sendJson(res, 200, result, req);
      return true;
    }

    return false;
  } catch (err) {
    sendJson(res, 500, {
      success: false,
      error: err.message || 'Error interno en Power BI Bridge'
    }, req);
    return true;
  }
}
