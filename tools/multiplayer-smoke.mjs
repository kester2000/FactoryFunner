import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {clone, machine, neighbor, place, validate} from '../src/engine.js';
import {playableBoard} from '../src/boards.js';
const require=createRequire(import.meta.url);
let pw;try{pw=require('playwright');}catch{pw=require('C:/Users/87736/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const port=process.env.MULTIPLAYER_TEST_PORT || '4175';
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error(`Server exit ${code}`)));});
  browser=await pw.chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}});
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const a=await desktop.newPage(), b=await mobile.newPage(), errors=[];
  for(const page of [a,b])page.on('pageerror',error=>errors.push(error.message));
  const url=`http://localhost:${port}`;
  await mkdir('test-results',{recursive:true});
  await a.goto(url);await a.locator('#mp-create').waitFor();
  assert.equal(await a.locator('main').isVisible(),false);
  const solo=await a.evaluate(()=>localStorage.getItem('factory-funner.save.v1'));
  const sit=async(page,name)=>{await page.locator('#mp-sit').click();await page.locator('#mp-name').fill(name);await page.locator('#mp-sit-confirm').click();};
  await a.locator('#mp-create').click();await a.locator('#mp-sit').waitFor();
  assert.match(await a.locator('.mp-heading .eyebrow').innerText(),/游客/);
  await sit(a,'房主');
  await a.locator('.mp-code').waitFor();const code=await a.locator('.mp-code').innerText();
  assert.equal(await a.locator('#mp-start').isDisabled(),true);
  await b.goto(url);await b.locator(`[data-join="${code}"]`).click();
  await b.locator('#mp-sit').waitFor();assert.match(await b.locator('.mp-heading .eyebrow').innerText(),/游客/);
  await sit(b,'<好友>');
  await b.locator('.mp-player').nth(1).waitFor();
  await a.waitForFunction(()=>!document.getElementById('mp-start').disabled);
  await a.locator('#mp-start').click();
  const claim=async page=>{await page.locator('[data-claim]:enabled').first().click();await page.locator('.mp-card.is-mine').waitFor();};
  const ready=async()=>{await a.locator('#mp-ready').click();await b.locator('#mp-ready').click();};
  await ready();
  await a.waitForFunction(()=>document.getElementById('mp-countdown').textContent.includes('翻牌倒计时'));
  assert.equal(await a.locator('main').evaluate(el=>el.inert),true);
  await claim(a);
  await b.waitForFunction(()=>document.querySelector('[data-claim]:disabled'));
  await claim(b);
  for(const page of [a,b])await page.waitForFunction(()=>!document.querySelector('main').inert);
  assert.notEqual(await a.locator('#machine-name').innerText(),await b.locator('#machine-name').innerText());
  await a.screenshot({path:'test-results/multiplayer-market.png',fullPage:true});
  await a.locator('[data-cell="2,3"]').click();
  const pieces=await a.evaluate(()=>JSON.parse(sessionStorage.getItem('factory-funner.multiplayer-draft.v1')).game.pieces);
  assert.equal(pieces.length,1);
  await a.reload();
  await a.waitForFunction(()=>!document.querySelector('main').inert && document.querySelector('#board [data-piece-id]'));
  assert.equal(await a.locator('#board [data-piece-id]').count(),1);
  assert.equal(await a.evaluate(()=>localStorage.getItem('factory-funner.save.v1')),solo);
  await a.locator('#menu').click();await a.locator('#new-game').click();
  assert.equal(await a.locator('#confirm-new').count(),0);
  await a.locator('.close-modal').click();
  // Build a valid first-round layout through visible controls, exercising real
  // server settlement and unequal scores as well as the skip path.
  await a.locator('#reset-round').click();
  const initial=await a.evaluate(()=>JSON.parse(sessionStorage.getItem('factory-funner.multiplayer-draft.v1')).game);
  let solution;
  for(const cell of playableBoard(initial.boardId,initial.boardSkin).cells) {
    if(solution)break;
    for(let rot=0;rot<6;rot++) {
      const state=clone(initial), [q,r]=cell.split(',').map(Number), colors=new Set();
      try {
        place(state,{kind:'machine'},q,r,rot);
        for(const port of machine(state.deck[0]).ports) {
          const edge=(port.edge+rot)%6, [x,y]=neighbor(q,r,edge);
          if(port.kind==='in') {
            const color=port.colors.find(c=>!colors.has(c));colors.add(color);
            place(state,{kind:'supply',color},x,y);
          } else place(state,{kind:port.colors[0]==='black'?'black':'collector'},x,y,(edge+3)%6);
        }
        if(validate(state).valid){solution=state;break;}
      } catch {}
    }
  }
  assert.ok(solution,'first machine has a valid direct-reservoir solution');
  for(const p of solution.pieces) {
    if(p.kind==='machine') await a.locator('#pick-machine').click();
    else await a.locator(`[data-tank="${p.kind==='supply'?['green','blue','pink','yellow'].indexOf(p.color):p.kind==='collector'?4:5}"]`).click();
    for(let i=0;i<p.rot;i++)await a.locator('#rotate').click();
    await a.locator(`[data-cell="${p.q},${p.r}"]`).click();
  }
  assert.equal(await a.locator('#settle').isEnabled(),true);
  const skip=async page=>{await page.locator('#skip').click();await page.locator('#confirm-skip').click();};
  for(let round=1;round<=8;round++) {
    if(round===1)await a.locator('#settle').click();else await skip(a);
    await a.waitForFunction(()=>document.querySelector('.mp-status').textContent.includes('已提交'));
    assert.equal(await a.locator('main').evaluate(el=>el.inert),true);
    assert.match(await b.locator('#round-label').innerText(),new RegExp(String(round).padStart(2,'0')));
    if(round===1) {
      await a.reload();await a.waitForFunction(()=>document.querySelector('.mp-status').textContent.includes('已提交'));
      await mobile.setOffline(true);
      await b.waitForFunction(()=>document.querySelector('.mp-status').textContent.includes('连接中断'));
      assert.equal(await b.locator('main').evaluate(el=>el.inert),true);
      await mobile.setOffline(false);await b.waitForFunction(()=>!document.querySelector('main').inert);
    }
    await skip(b);
    if(round<8) {
      for(const page of [a,b])await page.waitForFunction(r=>document.getElementById('round-label').textContent.startsWith(String(r).padStart(2,'0'))&&document.querySelector('main').inert,round+1);
      await ready();
      await claim(a);
      await b.waitForFunction(()=>document.querySelector('[data-claim]:disabled'));
      await claim(b);
      for(const page of [a,b])await page.waitForFunction(()=>!document.querySelector('main').inert);
    }
  }
  for(const page of [a,b]) {
    await page.waitForFunction(()=>document.querySelector('.mp-heading h2').textContent.includes('本局排名'));
    assert.equal(await page.locator('.mp-player').count(),2);
    const expectedScore=10+machine(solution.deck[0]).revenue-solution.cost-14;
    assert.equal(await page.locator('.mp-player').filter({hasText:'房主'}).filter({hasText:`$${expectedScore}（资金 ${expectedScore} + 连锁 0）`}).count(),1);
    assert.equal(await page.locator('.mp-player').filter({hasText:'<好友>'}).filter({hasText:'$10（资金 10 + 连锁 0）'}).count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await mkdir('test-results',{recursive:true});
  await a.screenshot({path:'test-results/multiplayer-desktop.png',fullPage:true});
  await b.screenshot({path:'test-results/multiplayer-mobile.png',fullPage:true});
  await a.locator('#mp-leave').click();
  await a.locator('#mp-create').waitFor();
  assert.equal(await a.evaluate(()=>localStorage.getItem('factory-funner.save.v1')),solo);
  assert.equal(await a.locator('main').isVisible(),false);
  await a.evaluate(()=>navigator.serviceWorker.ready);
  await desktop.setOffline(true);await a.reload();
  await a.locator('#mp-create').waitFor();
  assert.equal(await a.evaluate(()=>localStorage.getItem('factory-funner.save.v1')),solo);
  assert.equal(await a.locator('#mp-create').isVisible(),true);
  await desktop.setOffline(false);
  await b.setViewportSize({width:320,height:760});
  assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: lobby, guest spectators, mandatory named seats, desktop/mobile room creation, invite, shared market claims, distinct machines, validated installation, eight rounds, waiting, reload, offline reconnect, ranking, 320px layout and solo preservation');
} finally {await browser?.close();server.kill();}
