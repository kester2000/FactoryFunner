import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { multiplayerHandler, createRoomService } from './multiplayer.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const port = Number(process.env.PORT || 4173);
const roomService = createRoomService();
const handleMultiplayer = multiplayerHandler(roomService);
setInterval(()=>roomService.tick(),500).unref();
http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    if(url.pathname === '/api/multiplayer') {await handleMultiplayer(req,res); return;}
    const path = decodeURIComponent(url.pathname);
    if (path.includes('..') || !(/^\/(?:$|index.html$|src\/|assets\/game\/|assets\/cover.png$|sw.js$|manifest.webmanifest$|icon.svg$)/.test(path))) { res.writeHead(404).end(); return; }
    const file = resolve(root, '.' + (path==='/'?'/index.html':path));
    if (!file.startsWith(root.endsWith(sep)?root:root+sep) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}).end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port,'0.0.0.0',()=>console.log(`Factory Funner: http://localhost:${port} (LAN: use this computer's IP)`));
