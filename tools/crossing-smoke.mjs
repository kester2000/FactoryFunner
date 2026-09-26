import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {newGame,place} from '../src/engine.js';
const require=createRequire(import.meta.url);
let pw;try{pw=require('playwright');}catch{pw=require('C:/Users/87736/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const browser=await pw.chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},isMobile:mobile,hasTouch:mobile});
  const game=newGame('crossing-ui');
  place(game,{kind:'supply',color:'green'},3,4);
  place(game,{kind:'supply',color:'blue'},2,3);
  await context.addInitScript(value=>{if(!localStorage.getItem('factory-funner.save.v1'))localStorage.setItem('factory-funner.save.v1',JSON.stringify(value));},game);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:4173');
  const tap=async selector=>mobile?page.locator(selector).tap():page.locator(selector).click();
  const pieces=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('factory-funner.save.v1')).pieces);
  await tap('[data-pipe="straight"]');
  await tap('[data-cell="2,4"]');await tap('[data-cell="2,4"]');
  let ps=(await pieces()).filter(p=>p.kind==='pipe');assert.equal(ps.length,2);assert.deepEqual(ps.map(p=>p.rot),[0,1]);
  assert.equal(await page.locator('[data-piece-id="3"]').getAttribute('data-pipe-color'),'green');
  assert.equal(await page.locator('[data-piece-id="4"]').getAttribute('data-pipe-color'),'blue');
  assert((await page.locator('[data-piece-id="4"] path').first().getAttribute('d')).includes(' C '),'upper pipe uses a bridge curve');
  assert.equal(await page.locator('[data-layer]').count(),2);
  await tap('[data-cell="2,4"]');assert.equal((await pieces()).filter(p=>p.kind==='pipe').length,3);
  await tap('[data-cell="2,4"]');assert.equal((await pieces()).filter(p=>p.kind==='pipe').length,3,'fourth pipe rejected');
  await tap('#undo');assert.equal((await pieces()).filter(p=>p.kind==='pipe').length,2);
  await tap('[data-layer="3"]');await tap('#remove');
  assert.deepEqual((await pieces()).filter(p=>p.kind==='pipe').map(p=>p.id),[4],'remove green layer without deleting blue');
  await tap('#undo');await page.reload();
  await tap('#select-tool');await tap('[data-cell="2,4"]');
  assert.equal(await page.locator('[data-layer]').count(),2,'layers survive reload');
  assert.equal(await page.locator('[data-piece-id="3"]').getAttribute('data-pipe-color'),'green');
  assert.equal(await page.locator('[data-piece-id="4"]').getAttribute('data-pipe-color'),'blue');
  await page.screenshot({path:`test-results/crossing-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  assert.deepEqual(errors,[]);console.log(`${mobile?'Touch':'Desktop'}: stacking, auto rotation, separate colors, bridge rendering, layer deletion, undo and reload passed`);
  await context.close();
 }
}finally{await browser.close();}
