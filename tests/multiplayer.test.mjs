import {selectionAdjustment} from '../src/multiplayer-rules.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRoomService, submitLayout, multiplayerHandler} from '../multiplayer.mjs';
import {newGame, place, clone, settle} from '../src/engine.js';
import {machine, neighbor, validate} from '../src/engine.js';
import {playableBoard} from '../src/boards.js';

function fixture(options) {
  const request = createRoomService({revealDelay:0,...options});
  const a = request({action:'create', name:'甲', boardSkin:'Green'});
  const b = request({action:'join', name:'乙', code:a.code});
  const call = (who, action, extra={}) => request({code:a.code, token:who.token, action, ...extra});
  return {request, a, b, call};
}
const readyRound=(call,players,round)=>{for(const player of players)call(player,'ready',{round});};

test('rooms share board and a machine market, require host and two players, and protect identities', () => {
  const {request,a,b,call} = fixture();
  assert.throws(()=>call(b,'start'), /房主/);
  assert.throws(()=>call({token:'wrong'},'poll'), /凭据/);
  assert.throws(()=>request({action:'join',code:a.code,name:'甲'}), /昵称/);
  const started = call(a,'start'), peer = call(b,'poll');
  assert.equal(started.stage,'ready');assert.deepEqual(started.market,[]);
  assert.notEqual(started.game.boardSkin,peer.game.boardSkin);
  assert.equal(started.game.boardSkin, 'Green');
  assert.equal(peer.players.some(p=>'token' in p), false);
  assert.throws(()=>request({action:'join',code:a.code,name:'丙'}), /开始/);
  const solo = request({action:'create',name:'独自'});
  assert.throws(()=>request({...solo,action:'start'}), /至少/);
});
test('all eight rounds advance only after all submissions; repeats are safe and stale rounds rejected', () => {
  const {a,b,call} = fixture(); call(a,'start');
  const drawn=new Set();
  for(let round=1;round<=8;round++) {
    readyRound(call,[a,b],round);
    const market=call(a,'poll').market;
    assert.equal(market.length,2);
    for(const card of market){assert.equal(drawn.has(card.machineId),false);drawn.add(card.machineId);}
    call(a,'claim',{round,machineId:market[0].machineId});
    call(b,'claim',{round,machineId:market[1].machineId});
    const waiting = call(a,'submit',{round,skip:true});
    assert.equal(waiting.round,round); assert.equal(waiting.submitted,true);
    assert.equal(call(a,'submit',{round,skip:true}).round,round);
    const next = call(b,'submit',{round,skip:true});
    assert.equal(next.phase,round===8?'finished':'playing');
    assert.equal(next.game.history.length,round);
    assert.equal(next.game.money,10);
    assert.throws(()=>call(a,'submit',{round,skip:true}), /回合/);
  }
});
test('layout settlement reconstructs money and rejects invalid or changed historical machines', () => {
  const base = newGame('test',true);
  const draft=clone(base);
  place(draft,{kind:'machine'},2,3);
  place(draft,{kind:'supply',color:'green'},1,2,1);
  place(draft,{kind:'black'},2,4,4);
  const expected=clone(draft); settle(expected);
  draft.money=99999;
  const next=submitLayout(base,draft.pieces,false);
  assert.equal(next.money,expected.money);
  assert.deepEqual(next.history,expected.history);
  assert.throws(()=>submitLayout(base,draft.pieces.slice(0,1),false), /连接/);
  assert.throws(()=>submitLayout(base,[{kind:'pipe',shape:'bad',q:2,r:2,rot:0}],false), /管道/);
  const changed=clone(next.pieces); changed.find(p=>p.kind==='machine').rot++;
  assert.throws(()=>submitLayout(next,changed,false), /之前回合/);
  assert.equal(submitLayout(next,[],true).history.length,2);
});
test('claim is exclusive, cannot be changed, survives reconnect and gates submission', () => {
  const {a,b,call}=fixture(); call(a,'start');readyRound(call,[a,b],1);const room=call(a,'poll');
  assert.throws(()=>call(a,'submit',{round:1,skip:true}), /先.*抢/);
  assert.throws(()=>call(a,'claim',{round:0,machineId:room.market[0].machineId}), /回合/);
  assert.throws(()=>call(a,'claim',{round:1,machineId:999}), /共享区/);
  const id=room.market[0].machineId;
  assert.equal(call(a,'claim',{round:1,machineId:id}).claimed,id);
  assert.equal(call(a,'claim',{round:1,machineId:id}).claimed,id);
  assert.throws(()=>call(b,'claim',{round:1,machineId:id}), /抢走/);
  assert.throws(()=>call(a,'claim',{round:1,machineId:room.market[1].machineId}), /只能抢一台/);
  assert.equal(call(a,'poll').game.deck[0],id);
  call(b,'claim',{round:1,machineId:room.market[1].machineId});
  assert.notEqual(call(a,'poll').game.deck[0],call(b,'poll').game.deck[0]);
});
test('countdown hides cards and rejects early claims', () => {
  let time=0;
  const {a,b,call}=fixture({now:()=>time,revealDelay:3000});
  assert.deepEqual(call(a,'start').market,[]);readyRound(call,[a,b],1);
  assert.throws(()=>call(a,'claim',{round:1,machineId:1}), /倒计时/);
  time=3000;
  assert.equal(call(a,'poll').market.length,2);
});
test('six players draft all 48 machines once without exhausting the deck', () => {
  const {request,a,b,call}=fixture(), players=[a,b], drawn=new Set();
  for(let i=0;i<4;i++)players.push(request({action:'join',code:a.code,name:`额外${i}`}));
  call(a,'start');
  for(let round=1;round<=8;round++) {
    readyRound(call,players,round);
    const market=call(a,'poll').market;
    assert.equal(market.length,6);
    market.forEach((card,i)=>{
      assert.equal(drawn.has(card.machineId),false);drawn.add(card.machineId);
      call(players[i],'claim',{round,machineId:card.machineId});
    });
    for(const player of players)call(player,'submit',{round,skip:true});
  }
  assert.equal(drawn.size,48);
  for(const player of players) {
    const game=call(player,'poll').game;
    assert.equal(game.over,true);assert.equal(new Set(game.deck).size,8);
    assert.deepEqual(game.history.map(h=>h.machineId),game.deck);
  }
});
test('original first/last fees, round-one exemption and random leftovers', () => {
  const {request,a,b,call}=fixture();const c=request({action:'join',code:a.code,name:'丙'});
  const players=[a,b,c];call(a,'start');readyRound(call,players,1);
  let market=call(a,'poll').market;
  for(let i=0;i<3;i++)call(players[i],'claim',{round:1,machineId:market[i].machineId});
  assert.equal(call(a,'poll').selection.first,false);
  assert.equal(call(c,'poll').selection.last,false);
  for(const p of players)call(p,'submit',{round:1,skip:true});
  assert.deepEqual(players.map(p=>call(p,'poll').game.money),[8,8,10]);
  readyRound(call,players,2);market=call(a,'poll').market;
  call(a,'claim',{round:2,machineId:market[0].machineId});
  assert.equal(call(a,'poll').selection.first,true);
  assert.throws(()=>call(a,'submit',{round:2,skip:true}),/所有玩家/);
  call(b,'pass',{round:2});const dealt=call(c,'pass',{round:2});
  assert.equal(dealt.stage,'connection');
  for(const p of [b,c]) {
    const selection=call(p,'poll').selection;
    assert.equal(selection.automatic,true);assert.equal(selection.freeDiscard,true);
    assert.equal(selection.first,false);assert.equal(selection.last,false);
  }
  for(const p of players)call(p,'submit',{round:2,skip:true});
  assert.deepEqual(players.map(p=>call(p,'poll').game.money),[5,8,10]);
  assert.equal(call(a,'poll').game.history[1].penalty,2);
  assert.equal(call(a,'poll').game.history[1].firstFee,1);
  readyRound(call,players,3);
  for(const p of players)call(p,'pass',{round:3});
  assert.ok(players.every(p=>call(p,'poll').selection.automatic));
});
test('two players have only the last token, and its reward requires building', () => {
  const {a,b,call}=fixture();call(a,'start');readyRound(call,[a,b],1);
  for(const p of [a,b])call(p,'pass',{round:1});
  for(const p of [a,b])call(p,'submit',{round:1,skip:true});
  readyRound(call,[a,b],2);const market=call(a,'poll').market;
  call(a,'claim',{round:2,machineId:market[0].machineId});
  const last=call(b,'claim',{round:2,machineId:market[1].machineId});
  assert.equal(call(a,'poll').selection.first,false);
  assert.equal(last.selection.last,true);
  assert.equal(selectionAdjustment(last.selection,false).total,1);
  assert.equal(selectionAdjustment(last.selection,true).total,0);
  assert.equal(selectionAdjustment({first:true,freeDiscard:false},true).total,-3);
  const base=call(b,'poll').game;
  let layout;
  for(const cell of playableBoard(base.boardId,base.boardSkin).cells) {
    if(layout)break;
    for(let rot=0;rot<6;rot++) {
      const game=clone(base),[q,r]=cell.split(',').map(Number);
      try {
        place(game,{kind:'machine'},q,r,rot);
        for(const port of machine(game.deck[game.round-1]).ports) {
          const edge=(port.edge+rot)%6,[x,y]=neighbor(q,r,edge);
          place(game,port.kind==='in'?{kind:'supply',color:port.colors[0]}:{kind:port.colors[0]==='black'?'black':'collector'},x,y,(edge+3)%6);
        }
        if(validate(game).valid){layout=game;break;}
      }catch{}
    }
  }
  assert.ok(layout);
  const expected=base.money+machine(base.deck[1]).revenue-layout.cost+1;
  call(a,'submit',{round:2,skip:true});
  const built=call(b,'submit',{round:2,skip:false,pieces:layout.pieces,money:9999,selection:{last:false}});
  assert.equal(built.game.money,expected);
  assert.equal(built.game.history[1].lastBonus,1);
});
test('Umeaker revenue matches the original card and rulebook example', () => {
  assert.equal(machine(45).revenue,7);
});
test('simultaneous HTTP claims have exactly one winner', async t => {
  const server=http.createServer(multiplayerHandler(createRoomService({revealDelay:0})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const post=async body=>{const r=await fetch(url,{method:'POST',body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const a=(await post({action:'create',name:'甲'})).data;
  const b=(await post({action:'join',code:a.code,name:'乙'})).data;
  const act=(p,action,extra={})=>post({code:a.code,token:p.token,action,...extra});
  await act(a,'start');await act(a,'ready',{round:1});
  const ready=(await act(b,'ready',{round:1})).data;
  const machineId=ready.market[0].machineId;
  const responses=await Promise.all([act(a,'claim',{round:1,machineId}),act(b,'claim',{round:1,machineId})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const snapshot=(await act(a,'poll')).data;
  assert.equal(snapshot.players.filter(p=>p.claimed===machineId).length,1);
  assert.equal('stack' in snapshot,false);
  assert.equal(snapshot.players.some(p=>'stack' in p || 'token' in p),false);
});
test('departing players keep claimed cards unavailable and future pools shrink', () => {
  const {request,a,b,call}=fixture();const c=request({action:'join',code:a.code,name:'丙'});
  call(a,'start');readyRound(call,[a,b,c],1);const market=call(a,'poll').market;
  call(a,'claim',{round:1,machineId:market[0].machineId});call(a,'leave');
  assert.throws(()=>call(b,'claim',{round:1,machineId:market[0].machineId}), /抢走/);
  call(b,'claim',{round:1,machineId:market[1].machineId});
  call(c,'claim',{round:1,machineId:market[2].machineId});
  call(b,'submit',{round:1,skip:true});call(c,'submit',{round:1,skip:true});
  readyRound(call,[b,c],2);assert.equal(call(b,'poll').market.length,2);
});
test('capacity, host transfer, offline removal, forfeits and expiration', () => {
  let time=0;
  const {a,b,call,request}=fixture({now:()=>time});
  for(let i=0;i<4;i++)request({action:'join',code:a.code,name:`玩家${i}`});
  assert.throws(()=>request({action:'join',code:a.code,name:'第七位'}), /已满/);
  call(a,'leave');
  assert.equal(call(b,'poll').hostId,b.selfId);
  call(b,'start');
  const target=call(b,'poll').players.find(p=>p.id!==b.selfId);
  assert.throws(()=>call(b,'remove',{playerId:target.id}), /30 秒/);
  time=31000;
  assert.equal(call(b,'remove',{playerId:target.id}).players.find(p=>p.id===target.id).left,true);
  time+=86400001;
  assert.throws(()=>call(b,'poll'), /过期/);
});
test('leaving unblocks a submitted peer, and polling recovers identity', () => {
  const {a,b,call}=fixture();call(a,'start');readyRound(call,[a,b],1);
  call(b,'claim',{round:1,machineId:call(b,'poll').market[0].machineId});
  call(a,'leave');
  call(b,'submit',{round:1,skip:true});
  const resumed=call(b,'poll');
  assert.equal(resumed.round,2);assert.equal(resumed.hostId,b.selfId);
  assert.throws(()=>call(a,'poll'), /凭据/);
});
test('HTTP endpoint validates methods, origins and JSON with no caching', async t => {
  const server=http.createServer(multiplayerHandler());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url)).status,405);
  assert.equal((await fetch(url,{method:'POST',headers:{Origin:'http://evil.example'},body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{Origin:'null'},body:'{}'})).status,400);
  assert.equal((await fetch(url,{method:'POST',body:'not json'})).status,400);
  const response=await fetch(url,{method:'POST',body:JSON.stringify({action:'create',name:'HTTP 玩家'})});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match((await response.json()).code,/^[A-F0-9]{6}$/);
});
