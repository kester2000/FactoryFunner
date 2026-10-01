import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomService} from '../multiplayer.mjs';
import {clone,place,machine,neighbor,validate} from '../src/engine.js';
import {playableBoard} from '../src/boards.js';

function setup(options={}) {
  let time=0;
  const api=createRoomService({now:()=>time,revealDelay:0,disconnectMs:1e9,inactiveMs:1e9,...options});
  const a=api({action:'create'}),b=api({action:'join',code:a.code});
  const act=(p,action,extra={})=>api({code:a.code,token:p.token,action,...extra});
  act(a,'sit',{name:'甲'});act(b,'sit',{name:'乙'});
  const start=()=>{act(a,'start');act(a,'ready',{round:1});act(b,'ready',{round:1});};
  const choose=()=>{const cards=act(a,'poll').market;act(a,'claim',{round:1,machineId:cards[0].machineId});act(b,'claim',{round:1,machineId:cards[1].machineId});};
  return {api,a,b,act,start,choose,time:t=>{time=t;},tick:()=>api.tick()};
}
function validLayout(base) {
  for(const cell of playableBoard(base.boardId,base.boardSkin).cells)for(let rot=0;rot<6;rot++) {
    const s=clone(base),[q,r]=cell.split(',').map(Number);
    try {
      place(s,{kind:'machine'},q,r,rot);
      for(const port of machine(s.deck[s.round-1]).ports) {
        const edge=(port.edge+rot)%6,[x,y]=neighbor(q,r,edge);
        place(s,port.kind==='in'?{kind:'supply',color:port.colors[0]}:{kind:port.colors[0]==='black'?'black':'collector'},x,y,(edge+3)%6);
      }
      if(validate(s).valid)return s;
    }catch{}
  }
  assert.fail('expected valid layout');
}
test('public lobby, default guest spectators, mandatory named seats and read-only watching',()=>{
  const {api,a,b,act,start,choose}=setup();
  assert.equal(a.role,'spectator');assert.match(a.name,/^游客\d+$/);assert.equal(a.game,null);
  const list=api({action:'list'}).rooms[0];assert.equal(list.players,2);assert.equal(list.spectators,0);
  assert.equal('token' in list,false);
  start();choose();
  const c=api({action:'join',code:a.code});
  assert.equal(c.role,'spectator');assert.match(c.name,/^游客\d+$/);
  for(const action of ['claim','draft','submit','timeout','ready'])assert.throws(()=>act(c,action,{round:1}),/观战者/);
  assert.throws(()=>act(c,'sit',{name:'丙'}),/比赛中/);
  const game=validLayout(act(a,'poll').game);
  act(a,'draft',{round:1,pieces:game.pieces,seq:1});
  const watched=act(c,'poll',{watchId:a.selfId});assert.equal(watched.game.pieces.length,game.pieces.length);
  assert.equal(watched.watchId,a.selfId);assert.equal(watched.gameRevision,1);
  assert.notEqual(act(c,'poll',{watchId:b.selfId}).watchId,a.selfId);
});
test('blank, generated guest names and duplicate names cannot take seats',()=>{
  const api=createRoomService();const p=api({action:'create'});
  const sit=name=>api({code:p.code,token:p.token,action:'sit',name});
  for(const name of ['', '  ','游客123','x'.repeat(21)])assert.throws(()=>sit(name),/名称/);
  assert.equal(sit('合法名称').role,'player');
  const q=api({action:'join',code:p.code});assert.throws(()=>api({code:p.code,token:q.token,action:'sit',name:'合法名称'}),/使用/);
  assert.equal(api({action:'list'}).rooms[0].players,1);
});
test('30-second selection deadline deals all remaining cards without extra scoring',()=>{
  const {a,b,act,start,time,tick}=setup();start();
  time(29999);assert.equal(act(a,'poll').claimed,null);
  time(30000);tick();
  const x=act(a,'poll'),y=act(b,'poll');assert.equal(x.stage,'connection');assert.equal(x.buildEndsAt,330000);
  assert.notEqual(x.claimed,y.claimed);
  for(const p of [x,y]) {assert.equal(p.selection.automatic,true);assert.equal(p.selection.first,false);assert.equal(p.selection.last,false);}
  act(a,'submit',{round:1,skip:true});const next=act(b,'submit',{round:1,skip:true});assert.equal(next.game.money,10);
});
test('invalid newest draft times out immediately, rather than keeping an older valid draft',()=>{
  const {a,b,act,start,choose,time,tick}=setup();start();choose();
  const game=validLayout(act(a,'poll').game);
  act(a,'draft',{round:1,pieces:game.pieces,seq:1});
  act(a,'draft',{round:1,pieces:[],seq:2});
  act(a,'draft',{round:1,pieces:game.pieces,seq:1}); // Out-of-order upload cannot win.
  act(b,'submit',{round:1,skip:true});time(300000);tick();
  const s=act(a,'poll');assert.equal(s.round,2);assert.equal(s.timeoutChoice,false);
  assert.equal(s.game.history[0].skip,true);assert.equal(s.game.history[0].autoReason,'invalid-timeout');
});
test('valid timeout gets one frozen choice and keeping it settles the exact latest layout',()=>{
  const {a,b,act,start,choose,time,tick}=setup();start();choose();
  const game=validLayout(act(a,'poll').game);
  act(a,'draft',{round:1,pieces:game.pieces,seq:1});act(b,'submit',{round:1,skip:true});
  time(300000);tick();const prompt=act(a,'poll');
  assert.equal(prompt.timeoutChoice,true);assert.equal(prompt.decisionUntil,320000);
  assert.equal(prompt.game.pieces.length,game.pieces.length);
  act(a,'draft',{round:1,pieces:[],seq:2});
  assert.throws(()=>act(a,'submit',{round:1,skip:false,pieces:game.pieces}),/超时选择/);
  const kept=act(a,'timeout',{round:1,skip:false,pieces:[],money:99999});
  assert.equal(kept.round,2);assert.equal(kept.game.history[0].skip,false);
  assert.equal(kept.game.pieces.length,game.pieces.length);
  assert.throws(()=>act(a,'timeout',{round:1,skip:false}),/回合/);
});
test('timeout choice can skip and expires without repeatedly offering another chance',()=>{
  for(const chooseSkip of [true,false]) {
    const {a,b,act,start,choose,time,tick}=setup();start();choose();
    act(a,'draft',{round:1,pieces:validLayout(act(a,'poll').game).pieces,seq:1});act(b,'submit',{round:1,skip:true});
    time(300000);tick();assert.equal(act(a,'poll').timeoutChoice,true);
    if(chooseSkip)act(a,'timeout',{round:1,skip:true});else{time(320000);tick();}
    const s=act(a,'poll');assert.equal(s.round,2);assert.equal(s.game.history[0].skip,true);assert.equal(s.timeoutChoice,false);
  }
});
test('polling does not count as operation, and idle players do not block completed peers',()=>{
  const {a,b,act,start,choose,time}=setup({inactiveMs:120000});start();choose();
  time(60000);act(b,'poll');time(119999);act(b,'poll');act(a,'poll',{activity:true});
  time(120001);const waiting=act(a,'submit',{round:1,skip:true});
  assert.equal(waiting.round,2);assert.equal(act(b,'poll').game.history[0].autoReason,'offline');
  assert.equal(act(b,'poll').players.find(p=>p.id===b.selfId).online,false);
  assert.equal(act(b,'poll',{activity:true}).players.find(p=>p.id===b.selfId).online,true);
});
test('disconnected and explicitly departed players do not block rounds',()=>{
  const {a,b,act,start,choose,time}=setup({disconnectMs:15000});start();choose();
  time(14999);act(a,'poll',{activity:true});time(15001);
  assert.equal(act(a,'submit',{round:1,skip:true}).round,2);
  assert.equal(act(b,'poll').game.history[0].autoReason,'offline');
  const s=setup();s.start();s.choose();s.act(s.a,'submit',{round:1,skip:true});s.act(s.b,'leave');
  assert.equal(s.act(s.a,'poll').round,2);
});


test('guest creation tolerates missing names and supports names before and after entry',()=>{
  const api=createRoomService();
  for(const name of [undefined,'','   ']){const guest=api({action:'create',name});assert.match(guest.name,/^游客\d+$/);assert.equal(guest.role,'spectator');}
  const host=api({action:'create',name:'大厅昵称'});
  assert.equal(host.name,'大厅昵称');assert.equal(host.role,'spectator');
  const call=(action,name)=>api({action,code:host.code,token:host.token,name});
  assert.equal(call('rename','房内昵称').name,'房内昵称');
  assert.equal(api({action:'list'}).rooms.find(r=>r.code===host.code).host,'房内昵称');
  assert.equal(call('poll').role,'spectator');
  for(const name of ['', ' ', 'x'.repeat(21)])assert.throws(()=>call('rename',name),/1-20/);
  const join=api({action:'join',code:host.code,name:'加入昵称'});assert.equal(join.name,'加入昵称');assert.equal(join.role,'spectator');
  assert.throws(()=>call('rename','加入昵称'),/使用/);
  const duplicate=api({action:'join',code:host.code,name:'房内昵称'});assert.match(duplicate.name,/^游客\d+$/);
  call('sit','入座昵称');assert.equal(call('rename','选手新昵称').role,'player');
  assert.throws(()=>call('rename','游客123'),/游客/);
});
