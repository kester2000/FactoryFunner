import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,place,move,settle,restore,clone,campaignResult,nextCampaignGame,validate,neighbor,center} from '../src/engine.js';
import {BOARD_ORDER,WEB_BOARD_ORDER,BOARD_SKINS,BOARDS,progressionForScore,boardImage,playableBoard} from '../src/boards.js';
import {tracePipeStroke} from '../src/routing.js';

test('six distinct custom layouts shrink progressively and all open cells stay connected',()=>{
 const signatures=new Set();
 for(const [i,id] of WEB_BOARD_ORDER.slice(1).entries()){
  const board=playableBoard(id);assert.equal(board.cells.length,39-i*2);signatures.add(board.cells.join('|'));
  const visited=new Set([board.cells[0]]),queue=[board.cells[0]];
  while(queue.length){const [q,r]=queue.shift().split(',').map(Number);for(let edge=0;edge<6;edge++){
   const next=neighbor(q,r,edge).join(',');if(board.cells.includes(next)&&!visited.has(next)){visited.add(next);queue.push(next);}
  }}
  assert.equal(visited.size,board.cells.length,`${id} has no isolated rooms`);
  const s=newGame(id,false,{boardId:id});assert.equal(s.series,'web');
  for(const cell of board.blocked){const [q,r]=cell.split(',').map(Number);assert.throws(()=>place(s,{kind:'pipe',shape:'straight'},q,r),/墙壁/);}
  assert.deepEqual(restore(clone(s)),s);
 }
 assert.equal(signatures.size,6);
});
test('web campaign promotes through all boards once per completed game and preserves history',()=>{
 let s=newGame('campaign',false,{series:'web'});
 for(let i=0;i<7;i++){
  assert.equal(s.boardId,WEB_BOARD_ORDER[i]);
  for(let round=0;round<8;round++)settle(s,true);
  s.money=50;const before=clone(s),result=campaignResult(s);
  assert.equal(result.completed,i===6);
  const next=nextCampaignGame(s,`next-${i}`);
  assert.equal(next.boardId,WEB_BOARD_ORDER[Math.min(i+1,6)]);
  assert.equal(next.campaign.length,i+1);assert.equal(next.round,1);assert.equal(next.money,10);assert.equal(next.pieces.length,0);
  assert.deepEqual(s,before);assert.deepEqual(nextCampaignGame(s,`next-${i}`),next,'reopening results cannot duplicate records');
  s=restore(JSON.parse(JSON.stringify(next)));
 }
});
test('custom board demotion, stay and A floor obey threshold and series',()=>{
 for(const [score,next] of [[45,'C2'],[46,'C3'],[49,'C3'],[50,'C4']])assert.equal(progressionForScore('C3',score).nextBoardId,next);
 assert.equal(progressionForScore('C1',45).nextBoardId,'A');
 assert.equal(progressionForScore('A',50,'web').nextBoardId,'C1');
 assert.equal(progressionForScore('A',45,'web').nextBoardId,'A');
 assert.throws(()=>newGame('wrong',false,{boardId:'C1',series:'original'}),/不匹配/);
 assert.throws(()=>restore({...newGame(),series:'invalid'}),/未知进阶/);
});
test('changing layout changes blocked cells for both placement and drawn pipes',()=>{
 const a=newGame('same'),c=newGame('same',false,{boardId:'C1'});
 assert.deepEqual(a.deck,c.deck,'same seed preserves machine draw across boards');
 place(a,{kind:'pipe',shape:'straight'},1,2);
 assert.throws(()=>place(c,{kind:'pipe',shape:'straight'},1,2),/墙壁/);
 const points=[center(0,2),center(2,2)].map(([x,y])=>({x,y}));
 assert.equal(tracePipeStroke(a,points).length,3);
 assert.throws(()=>tracePipeStroke(c,points),/墙壁/);
 c.pieces=clone(a.pieces);c.nextId=a.nextId;assert.throws(()=>restore(c),/组件无效/);
});

test('solo progression boundaries and first/last levels',()=>{
 for(const [score,next,action] of [[44,'B1','demote'],[45,'B1','demote'],[46,'B2','stay'],[49,'B2','stay'],[50,'B3','promote'],[80,'B3','promote']]){
  const p=progressionForScore('B2',score);assert.equal(p.nextBoardId,next);assert.equal(p.action,action);
 }
 assert.equal(progressionForScore('A',45).nextBoardId,'A');
 assert.equal(progressionForScore('A',50).nextBoardId,'B1');
 assert.equal(progressionForScore('B6',50).completed,true);
 assert.equal(progressionForScore('B6',45).nextBoardId,'B5');
 assert.equal(BOARD_ORDER.length,7);
});
test('unavailable original boards cannot silently fall back to A',()=>{
 for(const id of BOARD_ORDER.slice(1))assert.throws(()=>newGame('board',false,{boardId:id}),/尚未接入/);
 assert.throws(()=>restore({...newGame(),boardId:'unknown'}),/未知工厂/);
 assert.throws(()=>restore({...newGame(),boardId:'B1'}),/尚未接入/);
 for(const skin of BOARD_SKINS)assert.equal(boardImage(newGame('skin',false,{boardSkin:skin.id})),skin.image);
});
test('legacy saves migrate to A and retain layout; campaign records survive export/import',()=>{
 const s=newGame();place(s,{kind:'pipe',shape:'straight'},0,0);
 const legacy=clone(s);delete legacy.boardId;delete legacy.boardSkin;delete legacy.campaign;
 const restored=restore(legacy);assert.equal(restored.boardId,'A');assert.deepEqual(restored.pieces,s.pieces);
 assert.deepEqual(restored.campaign,[]);
 for(let i=0;i<8;i++)settle(restored,true);
 const next=nextCampaignGame(restored,'next');assert.equal(next.round,1);assert.equal(next.money,10);
 assert.equal(next.campaign.length,1);assert.equal(next.campaign[0].total,10);
 assert.deepEqual(restore(JSON.parse(JSON.stringify(next))),next);
 assert.equal(restored.campaign.length,0,'continuing must not mutate the completed game');
 next.campaign[0].action='promote';assert.throws(()=>restore(next),/进阶记录/);
});
test('campaign uses final bonus, requires completion, and blocks unavailable next level',()=>{
 const s=newGame();assert.throws(()=>campaignResult(s),/八回合/);
 for(let i=0;i<8;i++)settle(s,true);
 s.money=50;assert.equal(campaignResult(s).nextBoardId,'B1');
 const before=clone(s);assert.throws(()=>nextCampaignGame(s,'next'),/尚未接入/);assert.deepEqual(s,before);
});
test('placement and save validation use the selected board geometry',()=>{
 // Test-only geometry; no unverified board is exposed in the product.
 const b=BOARDS[1],before={...b};
 try{
  Object.assign(b,{available:true,cells:['0,0','1,0'],width:965,height:880});
  const s=newGame('geometry',false,{boardId:'B1'});
  place(s,{kind:'pipe',shape:'straight'},0,0);
  assert.throws(()=>place(s,{kind:'pipe',shape:'straight'},2,0),/墙壁/);
  s.pieces[0].q=2;assert.equal(validate(s).valid,false);assert.throws(()=>restore(s),/组件无效/);
 }finally{Object.assign(b,before);}
});
test('moving components preserves identity, orientation and final-layout costs',()=>{
 const s=newGame('move',true),p=place(s,{kind:'machine'},2,3);
 move(s,p.id,1,3);assert.equal(s.cost,0);assert.equal(p.id,1);
 const pipe=place(s,{kind:'pipe',shape:'bend'},2,2,4,true);
 s.baseline=clone(s.pieces);s.cost=0;
 move(s,pipe.id,1,2);assert.equal(s.cost,1);assert.equal(pipe.rot,4);assert.equal(pipe.flip,true);
 move(s,pipe.id,0,2);assert.equal(s.cost,1);
 move(s,pipe.id,2,2);assert.equal(s.cost,0);
 const tank=place(s,{kind:'supply',color:'pink'},4,2);
 move(s,tank.id,5,2);assert.equal(tank.color,'pink');assert.equal(s.cost,1);
});
test('illegal drag drops and old machines leave state untouched; crossings move one layer',()=>{
 const s=newGame('drag'),p=place(s,{kind:'pipe',shape:'straight'},2,2,0);
 const other=place(s,{kind:'pipe',shape:'straight'},2,2,1);
 const target=place(s,{kind:'pipe',shape:'straight'},1,2,0);
 const before=clone(s);
 assert.throws(()=>move(s,p.id,1,2),/共用/);assert.deepEqual(s,before);
 assert.throws(()=>move(s,p.id,3,3),/墙壁/);assert.deepEqual(s,before);
 move(s,other.id,1,2);assert.equal(p.q,2);assert.equal(target.q,1);assert.equal(other.q,1);
 const m=place(s,{kind:'machine'},4,2);s.round=2;
 const locked=clone(s);assert.throws(()=>move(s,m.id,5,2),/不能移动/);assert.deepEqual(s,locked);
 s.over=true;assert.throws(()=>move(s,p.id,0,0),/本局已结束/);
});

test('original A sides use their own printed walls for placement, strokes and restore',()=>{
 const walls={Cian:['3,6','4,6','5,6'],Green:['5,0','6,1','6,5'],Red:['6,1','6,3','6,5'],Violet:['5,0','6,1','0,6'],White:['0,0','0,1','6,5'],Yellow:['4,0','5,0','6,1']};
 const signatures=new Set();
 for(const [skin,blocked] of Object.entries(walls)){
  const b=playableBoard('A',skin);assert.equal(b.cells.length,41);signatures.add(b.cells.join('|'));
  const s=newGame('a-sides',false,{boardSkin:skin});
  for(const cell of [...blocked,'3,3']){
   const [q,r]=cell.split(',').map(Number);assert.throws(()=>place(s,{kind:'pipe',shape:'straight'},q,r));
   const [x,y]=center(q,r);assert.throws(()=>tracePipeStroke(s,[{x:x-1,y},{x:x+1,y}]));
  }
  for(const cell of b.cells){
   const [q,r]=cell.split(',').map(Number),copy=clone(s);place(copy,{kind:'pipe',shape:'straight'},q,r);assert.deepEqual(restore(copy),copy);
  }
 }
 assert.equal(signatures.size,6);
});

test('legacy cosmetic skins preserve occupied cyan cells when loading',()=>{
 const s=newGame('old');place(s,{kind:'pipe',shape:'straight'},5,0);
 s.boardSkin='Green';delete s.aLayoutVersion;
 const migrated=restore(s);assert.equal(migrated.boardSkin,'Cian');assert.deepEqual(migrated.pieces,s.pieces);
 const invalid={...s,aLayoutVersion:1};assert.throws(()=>restore(invalid));
});
