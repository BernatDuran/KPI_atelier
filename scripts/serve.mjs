// Local development server supplied with the source export. No dependencies.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import { handlePbiApi, shutdownBridgeDaemon, shutdownPbiApi } from './pbi_api.mjs';
import { isAllowedHost } from './pbi_http.mjs';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const port=Number(process.argv[2]||8080);
if(!Number.isInteger(port)||port<1024||port>65535){console.error('Indica un puerto entre 1024 y 65535.');process.exit(1);}
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};

const server=http.createServer(async(req,res)=>{
 const fail=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(message);};

 if(!isAllowedHost(req.headers.host,port)){fail(403,'Host no autorizado');return;}
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

 let parsedUrl;
 try{parsedUrl=new URL(req.url,`http://${req.headers.host||'127.0.0.1'}`);}catch{fail(400,'URL inválida');return;}

 if(parsedUrl.pathname==='/api/health'){
  if(req.method!=='GET'){res.setHeader('Allow','GET');fail(405,'Método no permitido');return;}
  const payload=JSON.stringify({app:'kpi-atelier',version,protocol:1});
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(payload);return;
 }

 if(parsedUrl.pathname.startsWith('/api/pbi/')){
  try {
   const handled = await handlePbiApi(req, res, parsedUrl);
   if(handled) return;
  } catch (apiErr) {
   fail(500, 'Error en API: ' + (apiErr.message || apiErr));
   return;
  }
 }

 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');fail(405,'Método no permitido');return;}
 let pathname;
 try{pathname=decodeURIComponent(parsedUrl.pathname);}catch{fail(400,'URL inválida');return;}
 if(pathname.split(/[\\/]/).some(part=>part.startsWith('.'))||pathname.includes('\0')){fail(403,'Ruta no permitida');return;}
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root)){fail(403,'Ruta no permitida');return;}
 try{
  if(!(await stat(file)).isFile()){fail(404,'Archivo no encontrado');return;}
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(err){fail(err.code==='ENOENT'||err.code==='ENOTDIR'?404:500,'No se pudo abrir el archivo');}
});
server.on('error',err=>{console.error('code' in err && err.code==='EADDRINUSE'?`Puerto ${port} ocupado. Prueba: node scripts/serve.mjs ${port+1}`:err.message);process.exitCode=1;});
server.headersTimeout=10000;
server.requestTimeout=15000;
function shutdown(){shutdownPbiApi();shutdownBridgeDaemon();server.close();server.closeAllConnections();}
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);
process.once('exit',shutdownBridgeDaemon);
server.listen(port,'127.0.0.1',()=>console.log(`KPI Atelier: http://127.0.0.1:${port}\nCtrl+C para detener. Guarda este mismo puerto para conservar acceso a tus diseños locales.`));
