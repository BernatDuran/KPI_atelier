// Local development server supplied with the source export. No dependencies.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import { handlePbiApi } from './pbi_api.mjs';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const port=Number(process.argv[2]||8080);
if(!Number.isInteger(port)||port<1024||port>65535){console.error('Indica un puerto entre 1024 y 65535.');process.exit(1);}
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};

const server=http.createServer(async(req,res)=>{
 const fail=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(message);};

 let parsedUrl;
 try{parsedUrl=new URL(req.url,`http://${req.headers.host||'127.0.0.1'}`);}catch{fail(400,'URL inválida');return;}

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
server.on('error',err=>{console.error(err.code==='EADDRINUSE'?`Puerto ${port} ocupado. Prueba: node scripts/serve.mjs ${port+1}`:err.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`KPI Atelier: http://127.0.0.1:${port}\nCtrl+C para detener. Guarda este mismo puerto para conservar acceso a tus diseños locales.`));
