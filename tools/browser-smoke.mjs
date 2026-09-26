import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
let pw;try{pw=require('playwright');}catch{pw=require('C:/Users/87736/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
await mkdir('test-results',{recursive:true});
const browser=await pw.chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const errors=[];
async function run(viewport,mobile){
 const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto('http://localhost:4173');await page.getByRole('button',{name:'跟随引导开工'}).click();
 const tap=async loc=>mobile?loc.tap():loc.click();
 await tap(page.locator('[data-cell="2,3"]'));
 await tap(page.getByRole('button',{name:'绿色供应罐',exact:true}));
 await tap(page.locator('#rotate'));
 await tap(page.locator('[data-cell="1,2"]'));
 await tap(page.getByRole('button',{name:'黑色回收罐',exact:true}));
 for(let i=0;i<4;i++)await tap(page.locator('#rotate'));
 await tap(page.locator('[data-cell="2,4"]'));
 assert.equal(await page.locator('#status-title').innerText(),'所有连接已就绪');
 assert.equal(await page.locator('#cost').innerText(),'−$2');
 await tap(page.locator('#undo'));
 assert.equal(await page.locator('#cost').innerText(),'−$1');
 await tap(page.locator('#redo'));assert.equal(await page.locator('#cost').innerText(),'−$2');
 const firstMachine=await page.locator('#machine-id').innerText();
 await tap(page.locator('#reset-round'));
 assert.equal(await page.locator('#cost').innerText(),'−$0');assert.equal(await page.locator('#money').innerText(),'$10');
 assert.equal(await page.locator('#machine-id').innerText(),firstMachine);
 assert.equal(await page.locator('#board [data-piece-id]').count(),0);
 await tap(page.locator('#undo'));assert.equal(await page.locator('#board [data-piece-id]').count(),3);
 await page.reload();assert.equal(await page.locator('#status-title').innerText(),'所有连接已就绪');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow');
 await page.screenshot({path:`test-results/${mobile?'mobile':'desktop'}-connected.png`,fullPage:true});
 await tap(page.locator('#settle'));assert.equal(await page.locator('#money').innerText(),'$15');
 // Export then re-import the real UI save file.
 await tap(page.locator('#menu'));const downloadPromise=page.waitForEvent('download');await tap(page.locator('#export'));
 const download=await downloadPromise;const path=`test-results/${mobile?'mobile':'desktop'}-save.json`;await download.saveAs(path);
 await page.locator('#import-file').setInputFiles(path);await tap(page.locator('#import-confirm'));
 assert.equal(await page.locator('#money').innerText(),'$15');
 for(let i=2;i<=8;i++){await tap(page.locator('#skip'));await tap(page.locator('#confirm-skip'));}
 assert.equal(await page.locator('.result-score').innerText(),'$15');
 await page.locator('#review').click();await page.locator('#settle').click();assert.equal(await page.locator('.result-score').innerText(),'$15');
 await page.reload();assert.equal(await page.locator('#money').innerText(),'$15');
 if(!mobile){await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);await page.reload();assert.equal(await page.locator('#money').innerText(),'$15');await context.setOffline(false);}
 console.log(`${mobile?'Mobile 390px':'Desktop 1440px'}: placement, rotation, undo/redo, autosave, export/import, 8 rounds, final score passed`);
 await context.close();
}
try{await run({width:1440,height:1100},false);await run({width:390,height:844},true);assert.deepEqual(errors,[]);console.log('No browser errors; no missing assets.');}finally{await browser.close();}
