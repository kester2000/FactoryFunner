import {randomBytes, randomInt} from 'node:crypto';
import {newGame, clone, validate} from './src/engine.js';
import {MACHINES} from './src/data.js';
import {BOARD_SKINS} from './src/boards.js';
import {selectionAdjustment} from './src/multiplayer-rules.js';
import {submitLayout} from './multiplayer-layout.mjs';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const shuffle=items=>{for(let i=items.length-1;i>0;i--){const j=randomInt(i+1);[items[i],items[j]]=[items[j],items[i]];}return items;};

export function createRoomService({now=Date.now,revealDelay=3000,selectionMs=30000,buildMs=300000,inactiveMs=120000,disconnectMs=15000,decisionMs=20000}={}) {
  const rooms=new Map();
  const members=r=>r.players.filter(p=>!p.left);
  const seats=r=>members(r).filter(p=>p.role==='player');
  const online=p=>!p.left && now()-p.seen<disconnectMs && now()-p.acted<inactiveMs;
  function begin(r) {
    if(r.stage==='ready' && seats(r).length && seats(r).every(p=>p.ready || !online(p))) {
      r.stage='selection';r.opensAt=now()+revealDelay;r.selectionEndsAt=r.opensAt+selectionMs;
    }
  }
  function openRound(r) {
    r.market=seats(r).map(p=>({machineId:p.stack.shift(),playerId:null}));
    r.stage='ready';r.opensAt=null;r.selectionEndsAt=null;r.buildEndsAt=null;r.claimCount=0;r.roundPlayers=seats(r).length;
    for(const p of seats(r)) Object.assign(p,{claimed:null,ready:false,passed:false,selection:{},draft:null,draftSeq:0,submitted:false,pending:null,timeoutCandidate:null,decisionUntil:null,autoReason:null});
    begin(r);
  }
  function assign(r,p,card,automatic=false) {
    const last=r.market.filter(c=>!c.playerId).length===1;
    card.playerId=p.id;p.claimed=card.machineId;
    p.selection={automatic,freeDiscard:automatic||last,first:!automatic&&r.round>1&&r.roundPlayers>2&&r.claimCount===0,last:!automatic&&r.round>1&&last};
    if(!automatic)r.claimCount++;
    const i=r.round-1,existing=p.game.deck.indexOf(card.machineId);
    if(existing>=0)p.game.deck[existing]=p.game.deck[i];p.game.deck[i]=card.machineId;
  }
  function resolve(r,expired=false) {
    if(r.stage!=='selection'||now()<r.opensAt)return;
    const remaining=seats(r).filter(p=>p.claimed===null);
    if(remaining.length && (expired||remaining.every(p=>p.passed||!online(p)))) {
      const cards=shuffle(r.market.filter(c=>!c.playerId));
      // Timed allocations never award a First/Last token, even for one card.
      const automatic=expired||cards.length>1;
      remaining.forEach((p,i)=>assign(r,p,cards[i],automatic));
    }
    if(seats(r).length&&seats(r).every(p=>p.claimed!==null)) {
      r.stage='connection';r.buildEndsAt=(expired?r.selectionEndsAt:now())+buildMs;
    }
  }
  function complete(p,skip,pieces,reason=null,candidate=null) {
    const next=candidate?clone(candidate):submitLayout(p.game,pieces,skip);
    const adjustment=selectionAdjustment(p.selection,skip);
    next.money+=adjustment.total;
    Object.assign(next.history.at(-1),adjustment,{money:next.money,selection:clone(p.selection),autoReason:reason});
    Object.assign(p,{pending:next,submitted:true,decisionUntil:null,timeoutCandidate:null,autoReason:reason});
  }
  function advance(r) {
    if(r.phase!=='playing'||r.stage!=='connection')return;
    const ps=seats(r);
    if(!ps.length){r.phase='finished';return;}
    // Polling alone is not activity. A silent browser cannot hold up other players.
    if(ps.some(p=>p.submitted)&&ps.filter(online).every(p=>p.submitted)) {
      for(const p of ps.filter(p=>!p.submitted&&!online(p)))complete(p,true,[],'offline');
    }
    if(!ps.every(p=>p.submitted))return;
    for(const p of ps){p.game=p.pending;p.pending=null;p.submitted=false;}
    if(r.round===8)r.phase='finished';else {r.round++;openRound(r);}
  }
  function tickRoom(r) {
    if(r.phase!=='playing')return;
    begin(r);
    resolve(r,r.selectionEndsAt!==null&&now()>=r.selectionEndsAt);
    if(r.stage==='connection') {
      for(const p of seats(r)) {
        if(p.submitted)continue;
        if(p.decisionUntil!==null) {
          if(now()>=p.decisionUntil)complete(p,true,[],'decision-expired');
        } else if(now()>=r.buildEndsAt) {
          try {
            p.timeoutCandidate=submitLayout(p.game,p.draft?.pieces||p.game.pieces,false);
            p.decisionUntil=r.buildEndsAt+decisionMs;
            if(now()>=p.decisionUntil)complete(p,true,[],'decision-expired');
          } catch {complete(p,true,[],'invalid-timeout');}
        }
      }
      advance(r);
    }
    if(!seats(r).length)r.phase='finished';
  }
  function tick(){for(const [code,r] of rooms){if(now()-r.touched>86400000)rooms.delete(code);else tickRoom(r);}}
  function addGuest(r,name) {
    if(members(r).length>=100)fail('观众席已满');
    name=typeof name==='string'?name.trim():'';
    if(!name||name.length>20||members(r).some(p=>p.name===name)){do{name=`游客${randomInt(100000,1000000)}`;}while(members(r).some(p=>p.name===name));}
    const p={id:randomBytes(8).toString('hex'),token:randomBytes(24).toString('hex'),name,role:'spectator',left:false,seen:now(),acted:now(),game:null,selection:{},claimed:null,ready:false,passed:false,submitted:false,decisionUntil:null};
    r.players.push(p);return p;
  }
  function snapshot(r,self,watchId) {
    const target=self.role==='player'?self:r.players.find(p=>p.id===watchId&&p.game)||seats(r).find(p=>p.game)||r.players.find(p=>p.game);
    return {code:r.code,hostId:r.hostId,phase:r.phase,stage:r.stage,round:r.round,boardSkin:r.boardSkin,selfId:self.id,name:self.name,role:self.role,
      submitted:self.submitted,claimed:self.claimed,selection:self.selection,ready:self.ready,passed:self.passed,
      game:target?(self.role==='spectator'?(r.phase==='finished'?target.game:(target.draft||target.game)):(self.timeoutCandidate?(self.draft||self.game):self.game)):null,watchId:target?.id,
      gameRevision:target?.draftSeq||0,timeoutChoice:!!self.timeoutCandidate,decisionUntil:self.decisionUntil,autoReason:self.autoReason,
      serverTime:now(),opensAt:r.opensAt,selectionEndsAt:r.selectionEndsAt,buildEndsAt:r.buildEndsAt,
      market:r.stage!=='ready'&&r.opensAt!==null&&now()>=r.opensAt?r.market:[],
      players:r.players.map(p=>({id:p.id,name:p.name,role:p.role,left:p.left,online:online(p),submitted:p.submitted,claimed:p.claimed,ready:p.ready,passed:p.passed,selection:p.selection,boardSkin:p.boardSkin,
        removable:!p.left&&!online(p),money:p.game?.money??10,bonus:p.game?validate(p.game).bonus:0,timeoutChoice:!!p.timeoutCandidate,autoReason:p.autoReason}))};
  }
  function request(input) {
    if(!input||typeof input!=='object')fail('请求无效');
    tick();
    if(input.action==='list')return {rooms:[...rooms.values()].filter(r=>members(r).length).map(r=>({code:r.code,phase:r.phase,round:r.round,host:members(r).find(p=>p.id===r.hostId)?.name||'房间',players:seats(r).length,spectators:members(r).filter(p=>p.role==='spectator').length}))};
    if(input.action==='create') {
      if(rooms.size>=200)fail('房间数量已满',503);
      const initial=newGame(randomBytes(6).toString('hex').toUpperCase(),false,{boardSkin:input.boardSkin||'Cian'});
      let code;do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));
      const r={code,initial,boardSkin:initial.boardSkin,deck:shuffle(MACHINES.map(m=>m.id)),players:[],market:[],phase:'lobby',stage:'lobby',round:1,opensAt:null,selectionEndsAt:null,buildEndsAt:null,touched:now()};
      const self=addGuest(r,input.name);r.hostId=self.id;rooms.set(code,r);return {...snapshot(r,self),token:self.token};
    }
    const r=rooms.get(String(input.code||'').trim().toUpperCase());
    if(!r)fail('房间不存在或已过期；服务器重启后需重新创建',404);
    if(input.action==='join'){const self=addGuest(r,input.name);r.touched=now();return {...snapshot(r,self),token:self.token};}
    const self=members(r).find(p=>p.token===input.token);
    if(!self)fail('你已离开房间或连接凭据失效',401);
    self.seen=now();r.touched=now();
    if(input.activity===true||!['poll','draft'].includes(input.action))self.acted=now();
    const playerActions=['ready','claim','pass','submit','draft','timeout'];
    if(playerActions.includes(input.action)&&self.role!=='player')fail('观战者不能操作，请先设置名称并入座',403);
    if(playerActions.includes(input.action)&&(r.phase!=='playing'||input.round!==r.round))fail('回合已变化，请等待同步',409);
    switch(input.action) {
      case 'poll':break;
      case 'rename': {
        const name=typeof input.name==='string'?input.name.trim():'';
        if(!name||name.length>20)fail('昵称需为1-20个字符');
        if(self.role==='player'&&/^游客/.test(name))fail('选手名称不能以游客开头');
        if(members(r).some(p=>p!==self&&p.name===name))fail('此昵称已被使用');
        self.name=name;break;
      }
      case 'sit': {
        if(r.phase!=='lobby')fail('比赛中只能观战，不能入座');
        if(self.role==='player')fail('你已经入座');
        if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>20||/^游客/.test(input.name.trim()))fail('入座前请设置自己的名称（1–20 字，不能使用游客名称）');
        if(members(r).some(p=>p!==self&&p.name===input.name.trim()))fail('此昵称已被使用');
        if(seats(r).length>=6)fail('座位已满（最多 6 人）');
        self.boardSkin=[r.boardSkin,...BOARD_SKINS.map(s=>s.id)].find(s=>!seats(r).some(p=>p.boardSkin===s));
        self.role='player';self.name=input.name.trim();break;
      }
      case 'start':
        if(self.id!==r.hostId)fail('只有房主可以开始');
        if(r.phase!=='lobby')fail('对局已经开始');
        if(seats(r).length<2)fail('至少需要 2 位选手入座');
        for(const p of seats(r)){p.game=newGame(r.initial.seed,false,{boardSkin:p.boardSkin});p.stack=r.deck.splice(0,8);}
        r.phase='playing';openRound(r);break;
      case 'ready':
        if(r.stage!=='ready')fail('阶段已变化',409);self.ready=true;begin(r);break;
      case 'claim': {
        if(r.stage==='ready'||now()<r.opensAt)fail('还未翻牌，请等待倒计时结束',409);
        if(self.claimed===input.machineId)break;
        if(self.claimed!==null)fail('每轮只能抢一台机器，选定后不能更换',409);
        if(r.stage!=='selection'||self.passed)fail('你已放弃主动抢选，请等待分配',409);
        const card=r.market.find(c=>c.machineId===input.machineId);
        if(!card)fail('这台机器不在本轮共享区');if(card.playerId)fail('这台机器已被抢走，请选另一台',409);
        assign(r,self,card);resolve(r);break;
      }
      case 'pass':
        if(r.stage!=='selection'||now()<r.opensAt)fail('尚未进入抢选阶段',409);
        if(self.claimed!==null)fail('已抢到机器，不能退回');self.passed=true;resolve(r);break;
      case 'draft':
        if(r.stage==='connection'&&!self.submitted&&!self.timeoutCandidate&&now()<r.buildEndsAt&&Number.isSafeInteger(input.seq)&&input.seq>self.draftSeq) {
          self.draft=submitLayout(self.game,input.pieces,false,true);self.draftSeq=input.seq;
        }
        break;
      case 'timeout':
        if(!self.timeoutCandidate||self.submitted||now()>=self.decisionUntil)fail('这次超时选择已经结束',409);
        if(typeof input.skip!=='boolean')fail('提交格式无效');
        complete(self,input.skip,[],'timeout-choice',input.skip?null:self.timeoutCandidate);advance(r);break;
      case 'submit':
        if(self.claimed===null)fail('请先从共享区抢一台机器');
        if(r.stage!=='connection')fail('请等待所有玩家完成选机');
        if(self.timeoutCandidate||now()>=r.buildEndsAt)fail('施工时间已到，请处理超时选择',409);
        if(typeof input.skip!=='boolean')fail('提交格式无效');
        if(!self.submitted){complete(self,input.skip,input.pieces);advance(r);}break;
      case 'leave':
      case 'remove': {
        const p=input.action==='leave'?self:members(r).find(p=>p.id===input.playerId);
        if(!p)fail('玩家不存在');
        if(input.action==='remove'&&(r.hostId!==self.id||online(p)))fail('房主只能移除离线玩家');
        p.left=true;
        if(p.id===r.hostId)r.hostId=seats(r).find(online)?.id||members(r)[0]?.id;
        if(r.phase==='lobby')r.players=r.players.filter(x=>x!==p);
        tickRoom(r);if(!members(r).length)rooms.delete(r.code);break;
      }
      default:fail('未知操作');
    }
    return snapshot(r,self,input.watchId);
  }
  request.tick=tick;return request;
}
