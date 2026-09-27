import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {newGame} from '../src/engine.js';
const require=createRequire(import.meta.url);
let pw;try{pw=require('playwright');}catch{pw=require('C:/Users/87736/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
await mkdir('test-results',{recursive:true});
const browser=await pw.chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const errors=[];
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width<760,hasTouch:width<760});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto('http://localhost:4173');
  const snapshot=()=>page.evaluate(()=>localStorage.getItem('factory-funner.save.v1'));
  const initial=await snapshot(),state=JSON.parse(initial);
  assert.equal(state.tutorial,false,'first visit starts an ordinary game');
  assert.deepEqual(state.deck,newGame(state.seed).deck);
  await page.locator('#welcome-tutorial').click();
  assert.equal(await page.locator('[data-lesson]').count(),12);
  assert.equal(await page.locator('#lesson-new').count(),0);
  for(let i=0;i<12;i++){
   assert.equal(await page.locator('[aria-current="step"]').getAttribute('data-lesson'),String(i));
   assert.equal(await page.locator('#modal').evaluate(el=>el.scrollWidth>el.clientWidth),false,`chapter ${i} overflow at ${width}`);
   if(i===1){
    assert.equal(await page.locator('.lesson-machine-example').count(),6);
    for(const name of ['Time Machine','Boilnado','Maxi Mixer','Umeaker','Rainbowrisor','Rebuilder'])assert.equal(await page.locator('.lesson-machine-example').getByRole('heading',{name,exact:true}).count(),1);
    await page.locator('.lesson-machine-example').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:`test-results/tutorial-${width}-cards.png`});
   }
   await page.locator('#lesson-next').click();
  }
  assert.equal(await snapshot(),initial,'reading preserves the game');
  await page.locator('#help').click();
  assert.equal(await page.locator('[aria-current]').getAttribute('data-lesson'),'11');
  await page.locator('#lesson-prev').click();
  assert.equal(await page.locator('[aria-current]').getAttribute('data-lesson'),'10');
  await page.locator('[data-lesson="6"]').click();
  assert.match(await page.locator('#lesson-title').innerText(),/完整安装/);
  await page.locator('#lesson-play').click();
  assert.equal(await page.locator('#board-guide').count(),0);
  await page.locator('#menu').click();
  assert.equal(await page.locator('#tutorial-game').count(),0);
  await page.locator('#new-game').click();
  await page.locator('#seed').fill('NORMAL-CHECK');
  await page.locator('#confirm-new').click();
  assert.deepEqual(JSON.parse(await snapshot()).deck,newGame('NORMAL-CHECK').deck);
  const saved=await snapshot();
  await page.locator('#menu').click();await page.locator('#welcome-replay').click();
  await page.locator('#welcome-random').click();
  assert.equal(await snapshot(),saved,'welcome play preserves current game');
  // Old tutorial saves remain playable, without resurrecting guidance.
  const legacy=newGame('FIRST-SHIFT',true);
  await page.evaluate(s=>localStorage.setItem('factory-funner.save.v1',JSON.stringify(s)),legacy);
  await page.reload();
  assert.deepEqual(JSON.parse(await snapshot()).deck,legacy.deck);
  assert.equal(await page.locator('#board-guide').count(),0);
  await page.locator('[data-cell="2,3"]').click();
  assert.equal(await page.locator('#board [data-piece-id]').count(),1);
  if(width===1440){await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);await page.reload();await page.locator('#help').click();assert.equal(await page.locator('[data-lesson]').count(),12);}
  await context.close();console.log(`${width}px: handbook, six machine examples, ordinary games, legacy saves passed`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
