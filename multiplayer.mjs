import {randomBytes, randomInt} from 'node:crypto';
import {newGame, clone, place, settle, validate} from './src/engine.js';
import {PIPES, MACHINES} from './src/data.js';
import {BOARD_SKINS} from './src/boards.js';
import {selectionAdjustment} from './src/multiplayer-rules.js';

const fail = (message, status = 400) => {throw Object.assign(Error(message), {status});};
const nameOf = name => {
  if(typeof name !== 'string' || !name.trim() || name.trim().length > 20) fail('昵称需为 1–20 个字符');
  return name.trim();
};

// Rebuild using trusted history and the same placement/settlement engine as solo.
// Client money, deck, costs, machine identities and historical positions are never trusted.
export function submitLayout(base, pieces, skip) {
  const state = clone(base);
  if(skip) {settle(state, true); return state;}
  if(!Array.isArray(pieces) || pieces.length > 130) fail('组件数据无效');
  const locked = base.pieces.filter(p => p.kind === 'machine');
  const remaining = [...pieces];
  for(const old of locked) {
    const i = remaining.findIndex(p => p && p.kind === 'machine' && p.id === old.id &&
      p.machineId === old.machineId && p.q === old.q && p.r === old.r && p.rot === old.rot);
    if(i < 0) fail('之前回合的机器不能移动、旋转或拆除');
    remaining.splice(i, 1);
  }
  state.pieces = clone(locked);
  for(const p of remaining) {
    if(!p || !['machine','pipe','supply','collector','black'].includes(p.kind) ||
      !Number.isInteger(p.q) || !Number.isInteger(p.r) || !Number.isInteger(p.rot) || p.rot < 0 || p.rot > 5 ||
      (p.flip !== undefined && typeof p.flip !== 'boolean')) fail('组件数据无效');
    const spec = {kind:p.kind};
    if(p.kind === 'pipe') {
      if(!PIPES.some(shape => shape.id === p.shape)) fail('管道类型无效');
      spec.shape = p.shape;
    }
    if(p.kind === 'supply') {
      if(!['pink','yellow','green','blue'].includes(p.color)) fail('供应罐颜色无效');
      spec.color = p.color;
    }
    place(state, spec, p.q, p.r, p.rot, p.flip || false);
  }
  settle(state);
  return state;
}

export function createRoomService({now = Date.now, revealDelay = 3000} = {}) {
  const rooms = new Map();
  const active = room => room.players.filter(p => !p.left);
  const openMarket = room => {
    room.market = active(room).map(p => ({machineId:p.stack.shift(), playerId:null}));
    room.stage = 'ready'; room.opensAt = null; room.claimCount = 0; room.roundPlayers = active(room).length;
    for(const p of active(room)) {p.claimed = null; p.ready = false; p.passed = false; p.selection = {};}
  };
  const assign = (room, player, card, automatic = false) => {
    const last = room.market.filter(c => !c.playerId).length === 1;
    card.playerId = player.id; player.claimed = card.machineId;
    player.selection = {automatic, freeDiscard:automatic || last,
      first:!automatic && room.round > 1 && room.roundPlayers > 2 && room.claimCount === 0,
      last:!automatic && room.round > 1 && last};
    if(!automatic) room.claimCount++;
    const index = room.round-1, existing = player.game.deck.indexOf(card.machineId);
    if(existing >= 0) player.game.deck[existing] = player.game.deck[index];
    player.game.deck[index] = card.machineId;
  };
  const resolveSelection = room => {
    if(room.stage !== 'selection') return;
    const remaining = active(room).filter(p => p.claimed === null);
    if(remaining.length && remaining.every(p => p.passed)) {
      const cards = room.market.filter(c => !c.playerId);
      for(let i=cards.length-1;i>0;i--) {const j=randomInt(i+1); [cards[i],cards[j]]=[cards[j],cards[i]];}
      // Multiple unclaimed cards are dealt randomly without tokens/penalties.
      const automatic = cards.length > 1;
      remaining.forEach((p,i) => assign(room,p,cards[i],automatic));
    }
    if(active(room).every(p => p.claimed !== null)) room.stage = 'connection';
  };
  const beginWhenReady = room => {
    if(room.stage === 'ready' && active(room).length && active(room).every(p=>p.ready)) {
      room.stage = 'selection'; room.opensAt = now() + revealDelay;
    }
  };
  const advance = room => {
    const players = active(room);
    if(room.phase !== 'playing' || !players.length || !players.every(p => p.submitted)) return;
    for(const p of players) {p.game = p.pending; p.pending = null; p.submitted = false;}
    if(room.round === 8) room.phase = 'finished'; else {room.round++; openMarket(room);}
  };
  const snapshot = (room, self) => ({
    code:room.code, hostId:room.hostId, phase:room.phase, round:room.round, boardSkin:room.boardSkin,
    selfId:self.id, submitted:self.submitted, game:self.game, claimed:self.claimed,
    stage:room.stage, ready:self.ready, passed:self.passed, selection:self.selection,
    serverTime:now(), opensAt:room.opensAt,
    market:room.stage !== 'ready' && now() >= room.opensAt ? room.market : [],
    players:room.players.map(p => {
      const game = p.game;
      return {id:p.id, name:p.name, left:p.left, online:!p.left && now()-p.seen < 15000,
        removable:!p.left && now()-p.seen >= 30000, submitted:p.submitted, claimed:p.claimed,
        ready:p.ready, passed:p.passed, selection:p.selection, boardSkin:p.boardSkin,
        money:game?.money ?? 10, bonus:game ? validate(game).bonus : 0};
    }),
  });
  const addPlayer = (room, name) => {
    const player = {id:randomBytes(8).toString('hex'), token:randomBytes(24).toString('hex'),
      name:nameOf(name), seen:now(), submitted:false, left:false, game:null, claimed:null,
      ready:false, passed:false, selection:{},
      boardSkin:[room.boardSkin,...BOARD_SKINS.map(s=>s.id)].find(s=>!active(room).some(p=>p.boardSkin===s))};
    room.players.push(player); return player;
  };
  return function request(input) {
    if(!input || typeof input !== 'object') fail('请求无效');
    for(const [code, room] of rooms) if(now()-room.touched > 86400000) rooms.delete(code);
    if(input.action === 'create') {
      if(rooms.size >= 200) fail('房间数量已满，请稍后再试', 503);
      const initial = newGame(randomBytes(6).toString('hex').toUpperCase(), false,
        {boardSkin:input.boardSkin || 'Cian'});
      let code;
      do {code = randomBytes(3).toString('hex').toUpperCase();} while(rooms.has(code));
      const deck = MACHINES.map(m => m.id);
      for(let i=deck.length-1;i>0;i--) {const j=randomInt(i+1); [deck[i],deck[j]]=[deck[j],deck[i]];}
      const room = {code, boardSkin:initial.boardSkin, initial, deck, market:[], opensAt:0, phase:'lobby', round:1, players:[], touched:now()};
      const self = addPlayer(room, input.name); room.hostId = self.id; rooms.set(code, room);
      return {...snapshot(room, self), token:self.token};
    }
    const room = rooms.get(String(input.code || '').trim().toUpperCase());
    if(!room) fail('房间不存在或已过期；服务器重启后需重新创建', 404);
    if(input.action === 'join') {
      if(room.phase !== 'lobby') fail('对局已经开始，不能中途加入');
      if(active(room).length >= 6) fail('房间已满（最多 6 人）');
      if(active(room).some(p => p.name === nameOf(input.name))) fail('此昵称已被使用，请换一个');
      const self = addPlayer(room, input.name); room.touched = now();
      return {...snapshot(room, self), token:self.token};
    }
    const self = room.players.find(p => p.token === input.token && !p.left);
    if(!self) fail('你已离开房间或连接凭据失效', 401);
    self.seen = now(); room.touched = now();
    switch(input.action) {
      case 'poll': break;
      case 'start':
        if(self.id !== room.hostId) fail('只有房主可以开始');
        if(room.phase !== 'lobby') fail('对局已经开始');
        if(active(room).length < 2) fail('至少需要 2 位玩家');
        for(const p of active(room)) {
          p.game = newGame(room.initial.seed,false,{boardSkin:p.boardSkin});
          p.stack = room.deck.splice(0,8);
        }
        room.phase = 'playing'; openMarket(room); break;
      case 'ready':
        if(room.phase !== 'playing' || input.round !== room.round || room.stage !== 'ready') fail('回合或阶段已变化',409);
        self.ready = true; beginWhenReady(room); break;
      case 'claim': {
        if(room.phase !== 'playing' || input.round !== room.round) fail('回合已变化，请等待同步', 409);
        if(room.stage === 'ready' || now() < room.opensAt) fail('还未翻牌，请等待倒计时结束', 409);
        if(self.claimed === input.machineId) break; // Retry after a lost response.
        if(self.claimed !== null) fail('每轮只能抢一台机器，选定后不能更换', 409);
        if(room.stage !== 'selection' || self.passed) fail('你已放弃主动抢选，请等待分配',409);
        const card = room.market.find(c => c.machineId === input.machineId);
        if(!card) fail('这台机器不在本轮共享区');
        if(card.playerId) fail('这台机器已被抢走，请选另一台', 409);
        assign(room,self,card); resolveSelection(room);
        break;
      }
      case 'pass':
        if(room.phase !== 'playing' || input.round !== room.round || room.stage !== 'selection' || now() < room.opensAt) fail('尚未进入抢选阶段',409);
        if(self.claimed !== null) fail('已抢到机器，不能退回');
        self.passed = true; resolveSelection(room); break;
      case 'submit':
        if(room.phase !== 'playing' || input.round !== room.round) fail('回合已变化，请等待同步', 409);
        if(self.claimed === null) fail('请先从共享区抢一台机器');
        if(room.stage !== 'connection') fail('请等待所有玩家完成选机');
        if(typeof input.skip !== 'boolean') fail('提交格式无效');
        if(!self.submitted) {
          self.pending = submitLayout(self.game, input.pieces, input.skip);
          const adjustment = selectionAdjustment(self.selection,input.skip);
          self.pending.money += adjustment.total;
          Object.assign(self.pending.history.at(-1),adjustment,{money:self.pending.money,selection:clone(self.selection)});
          self.submitted = true;
          advance(room);
        }
        break;
      case 'leave':
      case 'remove': {
        const target = input.action === 'leave' ? self : room.players.find(p => p.id === input.playerId && !p.left);
        if(!target) fail('玩家不存在');
        if(input.action === 'remove' && (self.id !== room.hostId || now()-target.seen < 30000)) fail('房主只能移除离线至少 30 秒的玩家');
        target.left = true;
        if(room.phase === 'lobby') room.players = room.players.filter(p => p !== target);
        if(target.id === room.hostId) room.hostId = active(room)[0]?.id;
        beginWhenReady(room); resolveSelection(room);
        advance(room);
        if(!active(room).length) rooms.delete(room.code);
        break;
      }
      default: fail('未知操作');
    }
    return snapshot(room, self);
  };
}

export function multiplayerHandler(service = createRoomService()) {
  return async (req, res) => {
    const send = (status, body) => res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}).end(JSON.stringify(body));
    if(req.method !== 'POST') {send(405, {error:'请使用 POST'}); return;}
    try {
      if(req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {send(403, {error:'不允许跨站请求'}); return;}
      let body = '', length = 0;
      for await(const chunk of req) {
        length += chunk.length;
        if(length > 65536) {send(413, {error:'请求过大'}); return;}
        body += chunk;
      }
      let input;
      try {input = JSON.parse(body);} catch {fail('JSON 格式无效');}
      send(200, service(input));
    } catch(error) {send(error.status || 400, {error:error.message || '请求失败'});}
  };
}
