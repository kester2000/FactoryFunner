import {createRoomService} from './room-service.mjs';
export {createRoomService} from './room-service.mjs';
export {submitLayout} from './multiplayer-layout.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};

export function multiplayerHandler(service = createRoomService()) {
  return async (req, res) => {
    const send = (status, body) => res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}).end(JSON.stringify(body));
    if(req.method !== 'POST') {send(405, {error:'请使用 POST'}); return;}
    try {
      if(req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {send(403, {error:'不允许跨站请求'}); return;}
      let body = '', length = 0;
      for await(const chunk of req) {
        length += chunk.length;
        if(length > 65536) {send(413, {error:'请求过大'}); return;}
        body += chunk;
      }
      let input;
      try {input = JSON.parse(body);} catch {fail('JSON 格式无效');}
      send(200, service(input));
    } catch(error) {send(error.status || 400, {error:error.message || '请求失败'});}
  };
}
