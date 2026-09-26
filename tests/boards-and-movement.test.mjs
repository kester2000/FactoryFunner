import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,place,move,settle,restore,clone,campaignResult,nextCampaignGame,validate} from '../src/engine.js';
import {BOARD_ORDER,BOARD_SKINS,BOARDS,progressionForScore,boardImage} from '../src/boards.js';

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
