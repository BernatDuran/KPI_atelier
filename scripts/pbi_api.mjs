// scripts/pbi_api.mjs
// Handles REST API calls between KPI Atelier frontend and local Power BI Desktop
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bridgeScript = fileURLToPath(new URL('./pbi_bridge.ps1', import.meta.url));

export function runBridge(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', bridgeScript,
      ...args
    ]);

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
  });
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload, 'utf8'),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

export async function handlePbiApi(req, res, parsedUrl) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return true;
  }

  const { pathname, searchParams } = parsedUrl;

  try {
    if (pathname === '/api/pbi/discover') {
      const result = await runBridge(['-Action', 'discover']);
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/pbi/status') {
      const server = searchParams.get('server') || '';
      const args = ['-Action', 'status'];
      if (server) args.push('-Server', server);
      const result = await runBridge(args);
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/pbi/model') {
      const server = searchParams.get('server') || '';
      const database = searchParams.get('database') || '';
      const args = ['-Action', 'schema'];
      if (server) args.push('-Server', server);
      if (database) args.push('-Database', database);
      const result = await runBridge(args);
      sendJson(res, 200, result);
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
        });
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
      sendJson(res, 200, result);
      return true;
    }

    return false;
  } catch (err) {
    sendJson(res, 500, {
      success: false,
      error: err.message || 'Error interno en Power BI Bridge'
    });
    return true;
  }
}
