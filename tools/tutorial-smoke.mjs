import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
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
    const initial=await snapshot();
    await page.locator('#welcome-tutorial').click();
    assert.equal(await page.locator('[data-lesson]').count(),12);
    assert.equal(await page.locator('#lesson-prev').isDisabled(),true);
    for(let i=0;i<12;i++){
      assert.equal(await page.locator('[aria-current="step"]').getAttribute('data-lesson'),String(i));
      assert.equal(await page.locator('#modal').evaluate(el=>el.scrollWidth>el.clientWidth),false,`chapter ${i} overflow at ${width}`);
      if([0,3,6,8,11].includes(i))await page.screenshot({path:`test-results/tutorial-${width}-${i+1}.png`});
      await page.locator('#lesson-next').click();
    }
    assert.equal(await page.locator('#modal').evaluate(el=>el.open),false);
    assert.equal(await snapshot(),initial,'reading must preserve game');
    await page.locator('#help').click();
    assert.equal(await page.locator('[aria-current]').getAttribute('data-lesson'),'11','resume chapter');
    await page.locator('#lesson-prev').click();
    assert.equal(await page.locator('[aria-current]').getAttribute('data-lesson'),'10');
    await page.locator('[data-lesson="6"]').click();
    await page.locator('#lesson-new').click();
    await page.locator('#cancel-new').click();
    assert.equal(await snapshot(),initial,'cancel new game preserves save');
    // Follow the actual lesson, including the now-correct unrotated supply.
    await page.locator('[data-cell="2,3"]').click();
    assert.match(await page.locator('#board-guide').innerText(),/实操 2/);
    await page.getByRole('button',{name:'绿色供应罐',exact:true}).click();
    await page.locator('[data-cell="1,2"]').click();
    assert.match(await page.locator('#board-guide').innerText(),/实操 3/);
    await page.getByRole('button',{name:'黑色回收罐',exact:true}).click();
    await page.locator('[data-cell="2,4"]').click();
    for(let i=0;i<4;i++)await page.locator('#rotate').click();
    assert.equal(await page.locator('#status-title').innerText(),'所有连接已就绪');
    assert.match(await page.locator('#board-guide').innerText(),/实操 4/);
    assert.equal(await page.locator('#cost').innerText(),'−$2');
    const guide=await page.locator('#board-guide').boundingBox(),board=await page.locator('#board-viewport').boundingBox();
    assert.ok(guide.y+guide.height<=board.y+1,'guide must not cover board');
    await page.screenshot({path:`test-results/tutorial-${width}-practice.png`,fullPage:true});
    await page.locator('#settle').click();
    assert.equal(await page.locator('#money').innerText(),'$15');
    assert.match(await page.locator('#board-guide').innerText(),/第 2 回合/);
    const saved=await snapshot();
    await page.locator('[data-guide-chapter]').click();
    assert.equal(await page.locator('[aria-current]').getAttribute('data-lesson'),'3');
    await page.locator('#lesson-play').click();
    await page.locator('#menu').click();
    await page.locator('#welcome-replay').click();
    await page.locator('#welcome-tutorial').click();
    assert.equal(await snapshot(),saved,'replaying welcome tutorial must not overwrite game');
    await page.locator('#lesson-play').click();
    await page.reload();
    assert.equal(await page.locator('#money').innerText(),'$15');
    assert.match(await page.locator('#board-guide').innerText(),/第 2 回合/);
    await page.locator('#menu').click();
    await page.locator('#tutorial-game').click();
    await page.locator('#confirm-new').click();
    assert.equal(await page.locator('[aria-current]').getAttribute('data-lesson'),'0');
    assert.equal(await page.locator('#money').innerText(),'$10');
    await page.locator('#lesson-play').click();
    for(let round=1;round<=8;round++){
      await page.locator('#skip').click();await page.locator('#confirm-skip').click();
      if(round<8)assert.match(await page.locator('#board-guide').innerText(),new RegExp(`第 ${round+1} 回合`));
    }
    assert.equal(await page.locator('#board-guide').innerText(),'');
    assert.equal(await page.locator('.result-score').innerText(),'$10');
    if(width===1440){
      await page.evaluate(()=>navigator.serviceWorker.ready);
      await context.setOffline(true);await page.reload();await page.locator('#help').click();
      assert.equal(await page.locator('[data-lesson]').count(),12,'handbook works offline');
    }
    await context.close();
    console.log(`${width}px: all chapters, read-only navigation, practice, confirmations, eight rounds passed`);
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
