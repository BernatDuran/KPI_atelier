// HTTP boundary shared by the local server and Power BI API.
import { validateImportedJSON } from '../dist/schema.mjs';
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) { super(message); this.status = status; }
}
/** @param {unknown} host @param {number} port */
export function isAllowedHost(host, port) {
  return typeof host === 'string' && [`127.0.0.1:${port}`, `localhost:${port}`].includes(host.toLowerCase());
}
/** @param {string|undefined} origin @param {string|undefined} host */
export function isAllowedOrigin(origin, host) {
  if (!origin) return true; // CLI and same-origin GET requests may omit Origin.
  if (origin === 'null' || !host) return false;
  return origin === `http://${host}`;
}
/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} data */
export function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Content-Length':Buffer.byteLength(payload), 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(payload);
}
/** @param {import('node:http').IncomingMessage} req */
export async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Se requiere Content-Type application/json.');
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) { req.resume(); throw new HttpError(413, 'La solicitud supera el límite de 2 MB.'); }
  const chunks = await new Promise((resolve, reject) => {
    let size = 0, oversized = false;
    const parts = [];
    req.on('data', chunk => {
      if (oversized) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { oversized = true; parts.length = 0; reject(new HttpError(413, 'La solicitud supera el límite de 2 MB.')); }
      else parts.push(chunk);
    });
    req.on('end', () => { if (!oversized) resolve(parts); });
    req.on('error', reject);
    req.on('aborted', () => reject(new HttpError(400, 'Solicitud interrumpida.')));
  });
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La solicitud debe ser un objeto JSON.');
  return body;
}
/** @param {unknown} value @param {string} name @param {number} max @param {boolean} [required] */
export function textField(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || value.includes('\0')) throw new HttpError(400, `Parámetro inválido: ${name}.`);
  return value;
}
/** @param {unknown} value @param {boolean} [required] */
export function localServer(value, required = false) {
  const server = textField(value, 'server', 64, required);
  if (!server && !required) return '';
  const match = /^(localhost|127\.0\.0\.1|\[::1\]):([0-9]{1,5})$/i.exec(server);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new HttpError(400, 'El servidor debe ser una instancia local con puerto válido.');
  return server;
}
/** @param {Record<string, unknown>} body */
export function validateMeasure(body) {
  const validated = {
    server: localServer(body.server, true),
    database: textField(body.database, 'database', 512, true),
    tableName: textField(body.tableName, 'tableName', 512, true),
    measureName: textField(body.measureName, 'measureName', 512, true),
    daxExpression: textField(body.daxExpression, 'daxExpression', 1024 * 1024, true),
    formatString: textField(body.formatString, 'formatString', 4096),
    expectedExpression: null,
    configAnnotation: '',
  };
  if (!Object.hasOwn(body, 'expectedExpression')) throw new HttpError(400, 'Revisa el destino antes de guardar (expectedExpression requerido).');
  validated.expectedExpression = body.expectedExpression === null ? null : textField(body.expectedExpression, 'expectedExpression', 1024 * 1024, true);
  if (body.configAnnotation !== undefined && body.configAnnotation !== null) {
    if (typeof body.configAnnotation !== 'string' && (typeof body.configAnnotation !== 'object' || Array.isArray(body.configAnnotation))) throw new HttpError(400, 'Configuración inválida.');
    validated.configAnnotation = typeof body.configAnnotation === 'string' ? body.configAnnotation : JSON.stringify(body.configAnnotation);
    if (validated.configAnnotation.length > 512 * 1024) throw new HttpError(413, 'La configuración supera el límite de 512 KB.');
    const config = validateImportedJSON(validated.configAnnotation);
    if (!config.valid) throw new HttpError(400, `Configuración inválida: ${config.errors.slice(0, 3).join(' ')}`);
  }
  return validated;
}
