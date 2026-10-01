import {selectionAdjustment} from './multiplayer-rules.js';
import {MACHINES, COLOR_NAMES} from './data.js';
const SESSION = 'factory-funner.multiplayer.v1';
const DRAFT = 'factory-funner.multiplayer-draft.v1';
const read = key => {try {return JSON.parse(sessionStorage.getItem(key));} catch {return null;}};
const write = (key, value) => {try {value ? sessionStorage.setItem(key, JSON.stringify(value)) : sessionStorage.removeItem(key);} catch {}};
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function setupMultiplayer({modal, toast, getGame, applyGame, restoreSolo, refresh, restore}) {
  let session = read(SESSION), room = null, connected = false, busy = false, polling = false, errorText = '';
  let applied = '', lastLocked = false, generation = 0;
  const panel = document.getElementById('multiplayer-panel');
  const active = () => !!session;
  const locked = () => active() && (!connected || busy || !room || room.phase === 'lobby' || (room.phase === 'playing' && room.stage !== 'connection') || room.submitted);
  const request = async (action, extra = {}) => {
    let response;
    try {
      response = await fetch('/api/multiplayer', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...session, ...extra, action}), signal:AbortSignal.timeout(8000)});
    } catch {throw Error('连接中断，正在重连。请保持游戏服务器运行。');}
    let data;
    try {data = await response.json();} catch {throw Error('多人模式需要使用 node server.mjs 启动服务器');}
    if(!response.ok) throw Error(data.error || '连接失败');
    return data;
  };
  function showRules() {
    modal('多人规则 · 实时抢选', '选机 → 连接 → 记账，共八轮。', `<p>每人持有八张暗牌，每轮各翻一张到共享区。所有人准备后倒计时，先点击者抢到；每人至多一台，不能反悔。抢完后一起进入连接阶段。</p><p>第 2–8 轮：三人以上首抢者付 $1；拿走最后一台者若建造成功，额外得 $1。双人只用末抢标记；首轮不用任何标记。</p><p>抢到却放弃建造通常罚 $2，首抢费用仍需支付。最后一台可以免费放弃，不获得建造奖励。可选择不主动抢选；余下玩家都不抢且剩余多台时随机分配，不拿首／末标记，放弃免罚。只剩一台则按最后一台处理。</p><p>机器安装免费，新增或改动的管件、储罐每件 $1；旧机器固定，全部输入输出必须接通。全体完成后统一记账；第八轮再加机间供料每个输入点 $3 的连锁分。放弃会撤销本轮施工。</p><p>网页以服务器接收顺序判定抢选。离线移除与房主转移是联机恢复措施。</p>`);
  }
  function marketHTML() {
    if(room?.phase !== 'playing') return '';
    return `<section class="mp-market" aria-label="共享机器区"><h3>共享机器区 · 每人抢一台</h3><div class="mp-cards">${room.market.map(card => {
      const m = MACHINES.find(m => m.id === card.machineId);
      const owner = room.players.find(p => p.id === card.playerId);
      return `<button class="mp-card ${card.playerId===room.selfId?'is-mine':''}" data-claim="${m.id}" ${busy || !connected || room.claimed || room.passed || room.stage !== 'selection' || owner?'disabled':''} aria-label="抢 ${escape(m.name)}"><img src="${m.image}" alt="${escape(m.name)}"><strong>${escape(m.name)} · $${m.revenue}</strong><small>${m.ports.map(p => `${p.kind==='in'?'入':'出'} ${p.colors.map(c=>COLOR_NAMES[c]).join('/')} ×${p.amount}`).join(' · ')}</small><span>${owner?`已被 ${escape(owner.name)} 抢走`:'抢这台 →'}</span></button>`;
    }).join('') || '<p>等待所有玩家准备，然后倒计时翻牌。</p>'}</div>${room.stage==='selection' && room.market.length && !room.claimed && !room.passed?'<button id="mp-pass">不主动抢选 · 等待剩余分配</button>':''}</section>`;
  }
  function draw() {
    panel.hidden = !active();
    document.querySelector('.header-tag').textContent = active() ? '多人对战 / ONLINE WORKSHOP' : '单人工厂 / SOLO WORKSHOP';
    document.querySelector('.bottom-note').firstElementChild.textContent = active() ? 'FACTORY FUNNER · MULTIPLAYER' : 'FACTORY FUNNER · SOLO EDITION';
    document.querySelector('.bottom-note').lastElementChild.textContent = active() ? '共享机器 · 实时抢选 · 八回合比拼' : '本地存档 · 无需账号 · 无时间限制';
    document.querySelector('main').inert = locked();
    document.body.classList.toggle('mp-picking', active() && room?.phase === 'playing' && !room.claimed);
    if(lastLocked !== locked()) {lastLocked = locked(); refresh();}
    if(!active()) return;
    const finished = room?.phase === 'finished';
    const players = [...(room?.players || [])];
    if(finished) players.sort((a,b) => Number(a.left)-Number(b.left) || (b.money+b.bonus)-(a.money+a.bonus));
    const rankOf = player => 1 + players.filter(p => !p.left && p.money+p.bonus > player.money+player.bonus).length;
    const tied = player => players.filter(p => !p.left && p.money+p.bonus === player.money+player.bonus).length > 1;
    const selection=room?.selection || {}, adjustment=selectionAdjustment(selection,false), discard=selectionAdjustment(selection,true);
    const tokenLabel=p=>p.selection?.first?'首抢 −$1':p.selection?.last?'末抢 · 建造 +$1':p.selection?.automatic?'随机分配':p.selection?.freeDiscard?'最后一台':'';
    const html = `<div class="mp-heading"><div><span class="eyebrow">MULTIPLAYER / 抢机器对战</span><h2>${finished?'本局排名':room?.phase==='playing'?`第 ${room.round} / 8 回合`:'好友房间'} <b class="mp-code">${escape(session.code)}</b></h2></div><button id="mp-copy">复制邀请链接</button></div>
      <p class="mp-status" role="status">${escape(errorText || (busy?'正在同步…':!connected?'正在重连房间…':finished?'八轮完成 · 资金 + 连锁奖励；同分并列。':room.phase==='lobby'?'2–6 人 · 每轮共享区翻出每人一台机器，先抢先得，选定后不能换。':room.submitted?'已提交，等待其他玩家完成本轮。':room.stage==='ready'?(room.ready?'已准备，等待其他玩家。':'检查好工厂后点击准备；全部准备后倒计时翻牌。'):room.stage==='selection' && room.claimed?'已抢到，等待其他玩家选机后一起连接。':room.passed && !room.claimed?'已放弃主动抢选，等待剩余机器分配。':!room.claimed?(room.market.length?'翻牌了！点击机器抢选，服务器先收到的请求获胜。':`准备翻牌 · ${Math.max(1,Math.ceil((room.opensAt-room.serverTime)/1000))} 秒`):'已抢到机器！完成安装或跳过后等待其他玩家。'))}</p>
      <div class="mp-players">${players.map(p => `<div class="mp-player ${p.id===room.selfId?'is-self':''}"><strong>${escape(p.name)}${p.id===room.selfId?'（你）':''}${p.id===room.hostId?' ♛':''}</strong><small>${tokenLabel(p)}</small><span>${p.left?'已退出':finished?`${rankOf(p)===1?'🏆 ':''}${tied(p)?'并列':''}第 ${rankOf(p)} 名 · `+`$${p.money+p.bonus}（资金 ${p.money} + 连锁 ${p.bonus}）`:!p.online?'暂时离线':room.phase==='lobby'?'已加入':room.stage==='ready'?(p.ready?'✓ 已准备':'等待准备'):p.submitted?'✓ 已提交':!p.claimed?(p.passed?'等待分配':'抢选中'):`规划中 · $${p.money}`}</span>${p.removable && room.hostId===room.selfId && !finished?`<button data-mp-remove="${p.id}">移除离线玩家</button>`:''}</div>`).join('')}</div>
      ${marketHTML()}
      ${room?.phase==='playing' && room.claimed?`<p class="mp-fees">${tokenLabel({selection}) || '普通抢选'} · 建造结算附加 ${adjustment.total>=0?'+':''}$${adjustment.total} · 放弃扣 $${-discard.total}</p>`:''}
      <div class="mp-actions">${room?.phase==='playing' && room.stage==='ready'?`<button id="mp-ready" class="primary" ${busy || !connected || room.ready?'disabled':''}>${room.ready?'已准备':'准备翻牌 →'}</button>`:''}<button id="mp-rules">多人规则</button>${room?.phase==='lobby' && room.hostId===room.selfId?`<button id="mp-start" class="primary" ${busy || !connected || players.filter(p=>!p.left).length<2?'disabled':''}>开始对战 →</button>`:''}<button id="mp-leave" ${busy?'disabled':''}>${finished?'返回单人工厂':'退出房间'}</button><span>单人进度独立保留 · 房间保存在运行中的服务器</span></div>`;
    if(panel.innerHTML !== html) panel.innerHTML = html;
    document.getElementById('mp-copy').onclick = async () => {
      const url = new URL(location.href); url.search = ''; url.searchParams.set('room',session.code); url.hash = '';
      try {await navigator.clipboard.writeText(url.href); toast('邀请链接已复制；其他设备需访问同一服务器的局域网或公网地址');}
      catch {modal('邀请好友', '请复制此链接；localhost 地址仅适用于当前电脑。', `<input class="seed-field" readonly value="${escape(url.href)}">`);}
    };
    panel.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => perform('claim', {round:room.round, machineId:Number(b.dataset.claim)}));
    const ready=document.getElementById('mp-ready');if(ready)ready.onclick=()=>perform('ready',{round:room.round});
    const pass=document.getElementById('mp-pass');if(pass)pass.onclick=()=>perform('pass',{round:room.round});
    document.getElementById('mp-rules').onclick=showRules;
    const start = document.getElementById('mp-start');
    if(start) start.onclick = () => perform('start');
    panel.querySelectorAll('[data-mp-remove]').forEach(b => b.onclick = () => perform('remove', {playerId:b.dataset.mpRemove}));
    document.getElementById('mp-leave').onclick = () => {
      modal('退出多人房间？', '你的单人工厂会恢复到进入房间前的进度。', '<p>进行中的对局退出后视为弃赛，不能重新加入。仅刷新页面会保留房间身份。</p><div class="modal-actions"><button id="mp-stay">继续对战</button><button id="mp-confirm-leave" class="primary">退出房间</button></div>');
      document.getElementById('mp-stay').onclick = () => document.getElementById('modal').close();
      document.getElementById('mp-confirm-leave').onclick = async () => {
        document.getElementById('modal').close(); busy = true; draw();
        try {await request('leave');} catch {toast('本机已退出；若服务器未收到请求，房主可在离线 30 秒后移除你。');}
        session = null; room = null; applied = ''; busy = false; connected = false;
        write(SESSION, null); write(DRAFT, null); draw(); restoreSolo();
      };
    };
  }
  function accept(data) {
    room = data; connected = true; errorText = '';
    if(data.game) {
      const key = `${data.code}:${data.round}:${data.phase}:${data.stage}:${data.claimed}`;
      if(applied !== key) {
        let game = data.game;
        const draft = read(DRAFT);
        if(!applied && draft?.code === data.code && draft?.game?.round === data.round && draft.claimed === data.claimed && draft.stage === data.stage && !draft.game.over) {
          try {game = restore(draft.game);} catch {write(DRAFT, null);}
        }
        applied = key; applyGame(game);
      }
    }
    draw();
  }
  async function perform(action, extra = {}) {
    if(busy) return;
    generation++;
    busy = true; draw();
    try {
      const data = await request(action, extra);
      if(action === 'create' || action === 'join') {
        session = {code:data.code, token:data.token}; write(SESSION, session); write(DRAFT, null);
        document.getElementById('modal').close();
      }
      accept(data);
    } catch(error) {errorText = error.message; toast(error.message);}
    finally {busy = false; draw(); if(action === 'claim') setTimeout(poll, 0);}
  }
  function open() {
    if(active()) {document.getElementById('modal').close(); panel.scrollIntoView({behavior:'smooth',block:'start'}); return;}
    const code = new URL(location.href).searchParams.get('room') || '';
    modal('和朋友一起开工', '2–6 人实时抢机器 · 八回合收益比拼', `<p>每轮倒计时后翻出与玩家人数相同的机器，大家同时抢选，每人一台，先抢先得且不能更换。抢到后各自安装，全部提交后进入下一轮。48 台机器整局不重复；抢到却不安装通常罚 $2，首抢另付 $1，末抢建造奖励 $1；首轮不用标记，双人只用末抢标记。</p><label for="mp-name">你的昵称</label><input id="mp-name" class="seed-field" maxlength="20" autocomplete="nickname" placeholder="例如：小林"><label for="mp-skin">房主的 A 面（其他玩家分配不同颜色）</label><select id="mp-skin" class="seed-field">${['Cian','Green','Red','Violet','White','Yellow'].map((skin,i)=>`<option value="${skin}">${['青色','绿色','红色','紫色','白色','黄色'][i]} A 面</option>`).join('')}</select><div class="modal-actions"><button id="mp-create" class="primary">创建房间</button></div><hr><label for="mp-code-input">已有房间码</label><input id="mp-code-input" class="seed-field" maxlength="6" placeholder="6 位房间码" value="${escape(code)}" autocapitalize="characters"><div class="modal-actions"><button id="mp-join">加入房间 →</button></div><p class="muted">朋友需打开同一服务器地址；同一 Wi-Fi 下可使用电脑的局域网 IP。请保持服务器运行。</p>`);
    document.getElementById('mp-create').onclick = () => perform('create', {name:document.getElementById('mp-name').value, boardSkin:document.getElementById('mp-skin').value});
    document.getElementById('mp-join').onclick = () => perform('join', {name:document.getElementById('mp-name').value, code:document.getElementById('mp-code-input').value});
  }
  async function poll() {
    if(!active() || busy || polling) return;
    polling = true;
    const token = session.token, version = generation;
    try {const data = await request('poll'); if(session?.token === token && version === generation && !busy) accept(data);}
    catch(error) {if(session?.token === token && version === generation) {connected = false; errorText = error.message; draw();}}
    finally {polling = false;}
  }
  document.getElementById('multiplayer').onclick = open;
  setInterval(poll, 300);
  // Defer callbacks until the app has assigned the returned controller.
  setTimeout(() => {draw(); if(active()) poll(); else if(new URL(location.href).searchParams.has('room')) open();}, 0);
  return {active, locked, open,
    adjustment() {return active() && room?.claimed ? selectionAdjustment(room.selection,false).total : 0;},
    saveDraft() {write(DRAFT, {code:session.code, claimed:room?.claimed, stage:room?.stage, game:getGame()});},
    discardDescription() {const a=selectionAdjustment(room?.selection||{},true);return `本轮放弃扣 $${-a.total}，包括弃建罚款 $${a.penalty}、首抢费用 $${a.firstFee}。`;},
    submit(skip) {if(!locked()) return perform('submit', {round:room.round, pieces:getGame().pieces, skip});},
  };
}
