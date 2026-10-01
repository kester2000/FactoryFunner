import {createRequire} from 'node:module';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {createRoomService,multiplayerHandler} from '../multiplayer.mjs';
import {clone,place,machine,neighbor,validate} from '../src/engine.js';
import {playableBoard} from '../src/boards.js';
const require=createRequire(import.meta.url);
let pw;try{pw=require('playwright');}catch{pw=require('C:/Users/87736/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
let now=0;
const service=createRoomService({now:()=>now,revealDelay:0,inactiveMs:1e9,disconnectMs:1e9});
const api=multiplayerHandler(service),root=resolve('.');
const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/multiplayer'){await api(req,res);return;}
  try{const path=new URL(req.url,'http://localhost').pathname;if(path.includes('..'))throw Error();
    const file=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!file.startsWith(root))throw Error();
    res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[extname(file)]||'application/json'}).end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await pw.chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const a=await desktop.newPage(),b=await mobile.newPage(),c=await (await browser.newContext()).newPage(),errors=[];
  for(const page of [a,b,c])page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await mkdir('test-results',{recursive:true});
  await a.goto(url);await a.locator('#mp-create').waitFor();assert.equal(await a.locator('main').isVisible(),false);
  await a.locator('#mp-create').click();await a.locator('#mp-sit').click();
  await a.locator('#mp-sit-confirm').click();await a.waitForFunction(()=>document.getElementById('toast').textContent.includes('名称'));
  await a.locator('#mp-name').fill('工厂甲');await a.locator('#mp-sit-confirm').click();
  const code=await a.locator('.mp-code').innerText();
  await b.goto(url);await b.locator(`[data-join="${code}"]`).waitFor();
  await b.screenshot({path:'test-results/room-lobby-mobile.png',fullPage:true});
  await b.locator(`[data-join="${code}"]`).click();await b.locator('#mp-sit').click();await b.locator('#mp-name').fill('工厂乙');await b.locator('#mp-sit-confirm').click();
  await a.locator('#mp-start').click();
  await c.goto(`${url}/?room=${code}`);await c.locator('[data-watch]').first().waitFor();
  assert.match(await c.locator('.mp-heading .eyebrow').innerText(),/游客\d+ · 观战/);
  assert.equal(await c.locator('main').evaluate(el=>el.inert),true);
  const session=async page=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('factory-funner.multiplayer.v1')));
  const credentialsA=await session(a),credentialsB=await session(b);
  const state=credentials=>service({...credentials,action:'poll'});
  const ready=async()=>{await a.locator('#mp-ready').click();await b.locator('#mp-ready').click();await a.waitForFunction(()=>document.getElementById('mp-countdown').textContent.includes('选卡'));};
  const connection=async()=>{for(const p of [a,b])await p.waitForFunction(()=>!document.querySelector('main').inert);};
  const round=async n=>{for(const p of [a,b])await p.waitForFunction(r=>document.getElementById('round-label').textContent.startsWith(String(r).padStart(2,'0')),n);};
  async function build(page,credentials){
    const base=state(credentials).game;let solution;
    for(const cell of playableBoard(base.boardId,base.boardSkin).cells){if(solution)break;for(let rot=0;rot<6;rot++){
      const s=clone(base),[q,r]=cell.split(',').map(Number);try{
        place(s,{kind:'machine'},q,r,rot);
        for(const p of machine(s.deck[s.round-1]).ports){const edge=(p.edge+rot)%6,[x,y]=neighbor(q,r,edge);place(s,p.kind==='in'?{kind:'supply',color:p.colors[0]}:{kind:p.colors[0]==='black'?'black':'collector'},x,y,(edge+3)%6);}
        if(validate(s).valid){solution=s;break;}
      }catch{}
    }}assert.ok(solution);
    for(const p of solution.pieces){if(p.kind==='machine')await page.locator('#pick-machine').click();else await page.locator(`[data-tank="${p.kind==='supply'?['green','blue','pink','yellow'].indexOf(p.color):p.kind==='collector'?4:5}"]`).click();for(let i=0;i<p.rot;i++)await page.locator('#rotate').click();await page.locator(`[data-cell="${p.q},${p.r}"]`).click();}
    await page.waitForFunction(()=>document.getElementById('settle').disabled===false);
    // Wait for the actual network upload, not just the local browser draft.
    await new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{const spectator=service({...credentials,action:'poll'});const view=service({...credentials,action:'poll'});if(view.game && service({...watcher,action:'poll',watchId:spectator.selfId}).game?.pieces.length===solution.pieces.length)resolve();else if(Date.now()-start>10000)reject(Error('draft not uploaded'));else setTimeout(check,50);};check();});
    return solution;
  }
  const watcher=await session(c);
  await ready();now=30000;service.tick();await connection();
  for(const credentials of [credentialsA,credentialsB])assert.equal(state(credentials).selection.automatic,true);
  await build(a,credentialsA);
  await c.waitForFunction(()=>document.querySelectorAll('#board [data-piece-id]').length>1);
  await c.locator('[data-watch]').nth(1).click();
  await c.waitForFunction(()=>document.querySelectorAll('#board [data-piece-id]').length===0);
  assert.equal(await c.locator('main').evaluate(el=>el.inert),true);
  await b.locator('#skip').click();await b.locator('#confirm-skip').click();
  now=330000;service.tick();await a.locator('#mp-keep').waitFor();assert.equal(await a.locator('main').evaluate(el=>el.inert),true);
  await a.screenshot({path:'test-results/timeout-choice-desktop.png',fullPage:true});
  await a.locator('#mp-keep').click();await round(2);assert.equal(state(credentialsA).game.history[0].skip,false);
  await ready();now=360000;service.tick();await connection();
  now=660000;service.tick();await round(3);
  assert.equal(state(credentialsA).game.history[1].autoReason,'invalid-timeout');
  assert.equal(await a.locator('#mp-keep').count(),0);
  await ready();now=690000;service.tick();await connection();
  await build(b,credentialsB);
  now=990000;service.tick();await b.locator('#mp-keep').waitFor();
  await b.screenshot({path:'test-results/timeout-choice-mobile.png',fullPage:true});
  assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  now=1010000;service.tick();await round(4);
  assert.equal(state(credentialsB).game.history[2].autoReason,'decision-expired');
  assert.equal(await b.locator('#mp-keep').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: lobby discovery, guest roles, named seats, live spectating, automatic 30s deal, valid/invalid 5min expiry, frozen keep and one-shot choice expiry');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
