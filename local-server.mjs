import http from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { handleApi } from './server/api.js';
import { localDatabase } from './server/local-db.js';
const root=dirname(fileURLToPath(import.meta.url)),dataDir=process.env.OQU_DATA_DIR||join(root,'.local-data'),publicDir=join(root,'public');mkdirSync(dataDir,{recursive:true});
const secretFile=join(dataDir,'secrets.json');if(!existsSync(secretFile))writeFileSync(secretFile,JSON.stringify({AUTH_SECRET:randomBytes(48).toString('hex'),SETUP_CODE:'OQU-'+randomBytes(12).toString('hex')}),{mode:0o600});
const stored=JSON.parse(readFileSync(secretFile,'utf8'));const env={DB:localDatabase(join(dataDir,'school.sqlite'),join(root,'drizzle')),AUTH_SECRET:process.env.AUTH_SECRET||stored.AUTH_SECRET,SETUP_CODE:process.env.SETUP_CODE||stored.SETUP_CODE};
const port=Number(process.env.PORT||5500);const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{try{const host=req.headers.host;if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(host)){res.writeHead(403);res.end();return;}const url=new URL(req.url,`http://${host}`);if(url.pathname.startsWith('/api/')){
 const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});const response=await handleApi(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 const path=url.pathname==='/'?'/planner.html':decodeURIComponent(url.pathname),file=resolve(publicDir,'.'+path);if(!file.startsWith(publicDir+sep)){res.writeHead(403);res.end();return;}const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','x-content-type-options':'nosniff'});res.end(bytes);
 }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end('Oqu: request failed');}}).listen(port,'127.0.0.1',()=>{console.log(`Oqu: http://localhost:${port}`);console.log(`Бірінші әкімшіге тіркелу коды / First admin setup code: ${env.SETUP_CODE}`);console.log('Keep this code private. Data is saved in .local-data; Ctrl+C stops the server.');});
