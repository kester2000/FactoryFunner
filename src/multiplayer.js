import {selectionAdjustment} from './multiplayer-rules.js';
import {MACHINES,COLOR_NAMES} from './data.js';
import {showMultiplayerRules} from './multiplayer-rules-ui.js';
const SESSION='factory-funner.multiplayer.v1',DRAFT='factory-funner.multiplayer-draft.v1';
const read=k=>{try{return JSON.parse(sessionStorage.getItem(k));}catch{return null;}};
const write=(k,v)=>{try{v?sessionStorage.setItem(k,JSON.stringify(v)):sessionStorage.removeItem(k);}catch{}};
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);

export function setupMultiplayer({modal,toast,getGame,applyGame,refresh,restore}) {
  let session=read(SESSION),room=null,rooms=[],connected=false,busy=false,polling=false,errorText='',applied='',generation=0;
  let applying=false,dirty=null,sequence=Date.now(),activity=false,watchId=null,lastLock=true,lastLobbyPoll=0,lastChoice=null,renderedHTML='';
  let nickname;try{nickname=localStorage.getItem('factory-funner.nickname.v1');}catch{}
  if(!nickname?.trim()||nickname.length>20)nickname='游客'+Math.floor(100000+Math.random()*900000);
  const rememberName=name=>{nickname=name;try{localStorage.setItem('factory-funner.nickname.v1',name);}catch{}};
  rememberName(nickname);
  const panel=$('multiplayer-panel');
  const locked=()=>!session||!room||!connected||busy||room.role!=='player'||room.phase!=='playing'||room.stage!=='connection'||room.submitted||room.timeoutChoice;
  async function request(action,extra={}) {
    let response;
    try {response=await fetch('/api/multiplayer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...session,action,...(['create','join'].includes(action)?{name:nickname}:{}),...extra}),signal:AbortSignal.timeout(8000)});}
    catch{throw Error('连接中断，正在重连。请保持服务器运行。');}
    let data;try{data=await response.json();}catch{throw Error('房间模式需要使用 node server.mjs 启动服务器');}
    if(!response.ok)throw Object.assign(Error(data.error||'连接失败'),{status:response.status});return data;
  }
  function remaining(deadline){const s=Math.max(0,Math.ceil((deadline-room.serverTime)/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
  function rules(){showMultiplayerRules(modal);}
  function joinDialog(){modal('加入房间','加入后先以游客身份观战。','<label for="mp-code-input">房间码</label><input id="mp-code-input" class="seed-field" maxlength="6"><div class="modal-actions"><button id="mp-join" class="primary">进入观战</button></div>');$('mp-join').onclick=()=>perform('join',{code:$('mp-code-input').value});}
  function nameDialog(){
    modal('修改昵称','昵称为 1–20 个字符，保存后用于创建和加入房间。','<label for="mp-edit-name">你的昵称</label><input id="mp-edit-name" class="seed-field" maxlength="20" autocomplete="nickname"><div class="modal-actions"><button id="mp-name-save" class="primary">保存昵称</button></div>');
    $('mp-edit-name').value=room?.name||nickname;$('mp-edit-name').focus();
    $('mp-name-save').onclick=()=>{const name=$('mp-edit-name').value.trim();if(!name||name.length>20){toast('昵称需为1-20个字符');return;}if(session)perform('rename',{name});else{rememberName(name);$('modal').close();draw();}};
  }
  function sitDialog(){modal('设置名称并入座','入座后才能参加比赛；名称不能以“游客”开头。','<label for="mp-name">你的名称</label><input id="mp-name" class="seed-field" maxlength="20" autocomplete="nickname" placeholder="请输入你的名称"><div class="modal-actions"><button id="mp-sit-confirm" class="primary">确认入座</button></div>');$('mp-sit-confirm').onclick=()=>perform('sit',{name:$('mp-name').value});$('mp-name').value=/^游客/.test(room?.name||nickname)?'':room?.name||nickname;$('mp-name').focus();}
  function lobbyHTML(){return `<div class="mp-heading"><div><span class="eyebrow">FACTORY FUNNER / ROOM LOBBY</span><h1>工厂大厅</h1></div><button id="mp-create" class="primary">创建房间 →</button></div><p class="mp-status" role="status">${escape(errorText||'选择房间先观战，设置自己的名称后入座。选卡 30 秒 · 每轮施工 5 分钟。')}</p><div class="mp-actions"><span>你的昵称：${escape(nickname)}</span><button id="mp-rename">修改昵称</button><button id="mp-join-code">输入房间码</button><button id="mp-refresh">刷新房间</button><button id="mp-rules">游戏规则</button></div><div class="mp-room-list">${rooms.map(r=>`<article class="mp-room"><div><strong>${escape(r.host)}的房间 · ${r.code}</strong><p>${r.phase==='lobby'?'等待入座':r.phase==='finished'?'比赛结束':`第 ${r.round}/8 轮`} · ${r.players}/6 位选手 · ${r.spectators} 位观众</p></div><button data-join="${r.code}" ${busy?'disabled':''}>进入观战 →</button></article>`).join('')||'<p class="mp-empty">暂无房间，创建一个邀请朋友来开工。</p>'}</div>`;}
  function marketHTML(){
    if(room.phase!=='playing')return '';
    return `<section class="mp-market"><h3>共享机器区</h3><div class="mp-cards">${room.market.map(card=>{const m=MACHINES.find(m=>m.id===card.machineId),owner=room.players.find(p=>p.id===card.playerId);return `<button class="mp-card ${owner?.id===room.selfId?'is-mine':''}" data-claim="${m.id}" ${busy||!connected||room.role!=='player'||room.claimed||room.passed||room.stage!=='selection'||owner?'disabled':''}><img src="${m.image}" alt="${m.name}"><strong>${m.name} · $${m.revenue}</strong><small>${m.ports.map(p=>`${p.kind==='in'?'入':'出'} ${p.colors.map(c=>COLOR_NAMES[c]).join('/')} ×${p.amount}`).join(' · ')}</small><span>${owner?`${escape(owner.name)} 已取得`:'抢这台 →'}</span></button>`;}).join('')||'<p>等待准备、同时翻牌。</p>'}</div>${room.role==='player'&&room.stage==='selection'&&room.market.length&&!room.claimed&&!room.passed?'<button id="mp-pass">不主动抢选 · 等待随机分配</button>':''}</section>`;
  }
  function roomHTML(){
    if(!room)return `<p class="mp-status">${escape(errorText||'正在恢复房间…')}</p><button id="mp-leave">返回大厅</button>`;
    const players=room.players.filter(p=>p.role==='player'),guests=room.players.filter(p=>p.role==='spectator'&&!p.left),finished=room.phase==='finished';
    if(finished)players.sort((a,b)=>Number(a.left)-Number(b.left)||(b.money+b.bonus)-(a.money+a.bonus));
    let status=room.role==='spectator'?'你正在观战，可以选择下方选手查看工厂。':room.submitted?'已提交，等待其他在线选手。':room.stage==='ready'?(room.ready?'已准备，等待其他在线选手。':'点击准备，全部准备后同时翻牌。'):room.stage==='selection'?(room.claimed?'已取得机器，等待选机结束。':'选择一台机器，倒计时结束自动分配剩余卡。'):'正在施工，连接全部端口后完成安装。';
    if(room.phase==='lobby')status='进入房间默认观战，设置名称后选择座位。至少两位选手才能开始。';
    if(finished)status='八轮完成，按资金与连锁奖励排名。';
    if(room.timeoutChoice)status='施工超时：最新局面有效，请选择保留或跳过。仅有这一次机会，局面已冻结。';
    const countdown=room.timeoutChoice?`最后选择 ${remaining(room.decisionUntil)}`:room.stage==='selection'?(room.serverTime<room.opensAt?`翻牌倒计时 ${remaining(room.opensAt)}`:`选卡剩余 ${remaining(room.selectionEndsAt)}`):room.stage==='connection'&&!finished?`施工剩余 ${remaining(room.buildEndsAt)}`:'';
    const adj=selectionAdjustment(room.selection||{},false),discard=selectionAdjustment(room.selection||{},true);
    return `<div class="mp-heading"><div><span class="eyebrow">${escape(room.name)} · ${room.role==='spectator'?'观战':'选手'}</span><h2>${finished?'本局排名':room.phase==='playing'?`第 ${room.round}/8 轮`:'房间'} <b class="mp-code">${room.code}</b></h2></div><strong id="mp-countdown">${countdown}</strong><button id="mp-rename">修改昵称</button><button id="mp-copy">复制邀请链接</button></div><p class="mp-status" role="status">${escape(errorText||(!connected?'连接中断，正在重连…':busy?'正在同步…':status))}</p><div class="mp-players">${players.map(p=>`<div class="mp-player ${p.id===room.selfId?'is-self':''}"><strong>${escape(p.name)}${p.id===room.selfId?'（你）':''}${p.id===room.hostId?' ♛':''}</strong><span>${p.left?'已离开':finished?`$${p.money+p.bonus}（资金 ${p.money} + 连锁 ${p.bonus}）`:!p.online?'离线 / 暂无操作':p.timeoutChoice?'超时选择中':p.submitted?'✓ 已提交':room.stage==='ready'?(p.ready?'✓ 已准备':'等待准备'):p.claimed?'正在施工':'正在选卡'}</span><small>${p.selection?.first?'首抢 −$1':p.selection?.last?'末抢建成 +$1':p.selection?.automatic?'随机分配，无额外奖励':''}</small>${room.role==='spectator'&&room.phase!=='lobby'?`<button data-watch="${p.id}">${watchId===p.id?'正在观看':'观看工厂'}</button>`:''}</div>`).join('')}${room.phase==='lobby'&&players.filter(p=>!p.left).length<6?`<button id="mp-sit" class="mp-player" ${room.role==='player'?'disabled':''}>＋ 设置名称并入座</button>`:''}</div><p class="mp-guests">观众 ${guests.length} 人：${guests.map(p=>escape(p.name)).join('、')||'暂无'}</p>${marketHTML()}${room.timeoutChoice?`<div id="mp-timeout" class="mp-timeout"><strong>最新有效局面已冻结 · ${remaining(room.decisionUntil)}</strong><p>保留会按此局面结算；跳过会撤销本轮施工。未选择则跳过。</p><button id="mp-keep" class="primary">保留最新局面</button><button id="mp-timeout-skip">跳过本轮</button></div>`:''}${room.role==='player'&&room.claimed&&room.phase==='playing'?`<p class="mp-fees">建造附加 ${adj.total>=0?'+':''}$${adj.total} · 放弃扣 $${-discard.total}</p>`:''}<div class="mp-actions">${room.role==='player'&&room.phase==='playing'&&room.stage==='ready'?`<button id="mp-ready" class="primary" ${room.ready||busy?'disabled':''}>${room.ready?'已准备':'准备翻牌 →'}</button>`:''}${room.phase==='lobby'&&room.selfId===room.hostId?`<button id="mp-start" class="primary" ${players.filter(p=>!p.left).length<2||busy?'disabled':''}>开始对战 →</button>`:''}<button id="mp-rules">游戏规则</button><button id="mp-leave">返回大厅</button><span>无操作 2 分钟或断连 15 秒判定离线，不阻塞其他选手。</span></div>`;
  }
  function draw(){
    panel.hidden=false;
    document.body.classList.toggle('room-lobby',!session||!room?.game);
    document.body.classList.toggle('mp-picking',!!session&&room?.phase==='playing'&&!room.claimed&&room.role==='player');
    document.querySelector('main').inert=locked();
    $('menu').hidden=!room?.game;
    document.querySelector('.header-tag').textContent='房间模式 / ONLINE WORKSHOP';
    document.querySelector('.bottom-note').firstElementChild.textContent='FACTORY FUNNER · ROOM MATCH';
    document.querySelector('.bottom-note').lastElementChild.textContent='选卡 30 秒 · 每轮施工 5 分钟';
    if(!session)$('save-status').textContent='房间大厅';else if(room?.role==='spectator')$('save-status').textContent='观战模式';
    if(lastLock!==locked()){lastLock=locked();refresh();}
    const html=(session?roomHTML():lobbyHTML()).replace(/(<strong id="mp-countdown">)[^<]*/, '$1').replace(/(最新有效局面已冻结 · )[^<]*/, '$1<span id="mp-choice-time"></span>');
    if(renderedHTML!==html){panel.innerHTML=html;renderedHTML=html;}
    if(room&&$('mp-countdown'))$('mp-countdown').textContent=room.timeoutChoice?`最后选择 ${remaining(room.decisionUntil)}`:room.stage==='selection'?(room.serverTime<room.opensAt?`翻牌倒计时 ${remaining(room.opensAt)}`:`选卡剩余 ${remaining(room.selectionEndsAt)}`):room.stage==='connection'&&room.phase!=='finished'?`施工剩余 ${remaining(room.buildEndsAt)}`:'';
    if(room?.timeoutChoice&&$('mp-choice-time'))$('mp-choice-time').textContent=remaining(room.decisionUntil);
    const bind=(id,fn)=>{if($(id))$(id).onclick=fn;};
    bind('mp-rename',nameDialog);bind('mp-create',()=>perform('create'));bind('mp-join-code',joinDialog);bind('mp-refresh',()=>{lastLobbyPoll=0;poll();});bind('mp-rules',rules);
    panel.querySelectorAll('[data-join]').forEach(b=>b.onclick=()=>perform('join',{code:b.dataset.join}));
    bind('mp-sit',sitDialog);bind('mp-start',()=>perform('start'));bind('mp-ready',()=>perform('ready',{round:room.round}));bind('mp-pass',()=>perform('pass',{round:room.round}));
    panel.querySelectorAll('[data-claim]').forEach(b=>b.onclick=()=>perform('claim',{round:room.round,machineId:Number(b.dataset.claim)}));
    panel.querySelectorAll('[data-watch]').forEach(b=>b.onclick=()=>{watchId=b.dataset.watch;applied='';generation++;poll();});
    bind('mp-keep',()=>perform('timeout',{round:room.round,skip:false}));bind('mp-timeout-skip',()=>perform('timeout',{round:room.round,skip:true}));
    bind('mp-copy',async()=>{const u=new URL(location.href);u.search='';u.searchParams.set('room',session.code);try{await navigator.clipboard.writeText(u.href);toast('邀请链接已复制');}catch{modal('邀请好友','其他设备需使用服务器局域网或公网地址。',`<input class="seed-field" readonly value="${escape(u.href)}">`);}});
    bind('mp-leave',()=>{if(room?.role==='player'&&room.phase==='playing'){modal('离开对局？','离开后不再等待你，本场不能重新入座。','<div class="modal-actions"><button id="mp-confirm-leave" class="primary">离开并返回大厅</button></div>');$('mp-confirm-leave').onclick=leave;}else leave();});
  }
  async function leave(){
    busy=true;generation++;$('modal').close();draw();try{await request('leave');}catch{toast('已返回大厅，服务器会把失联选手标记离线。');}
    session=null;room=null;applied='';dirty=null;watchId=null;lastChoice=null;busy=false;connected=false;errorText='';write(SESSION,null);write(DRAFT,null);lastLobbyPoll=0;draw();poll();
  }
  function accept(data){
    const previousRound=room?.round;
    room=data;connected=true;errorText='';
    if(dirty&&dirty.round!==data.round)dirty=null;
    if(room.role==='spectator')watchId=data.watchId;
    if(data.game){
      const key=`${data.code}:${data.round}:${data.phase}:${data.stage}:${data.claimed}:${data.role}:${data.timeoutChoice}:${data.role==='spectator'?data.watchId+':'+data.gameRevision:''}`;
      if(applied!==key){
        let game=data.game;const draft=read(DRAFT);
        if(!applied&&data.role==='player'&&!data.timeoutChoice&&draft?.code===data.code&&draft.game?.round===data.round&&draft.claimed===data.claimed&&draft.stage===data.stage&&!draft.game.over){try{game=restore(draft.game);dirty={round:data.round,pieces:game.pieces,seq:++sequence};}catch{}}
        applied=key;applying=true;applyGame(game,{keepDialog:data.role==='spectator'});applying=false;
      }
    }
    draw();
    if(previousRound&&previousRound!==data.round&&data.role==='player') {
      const reason=data.game?.history.at(-1)?.autoReason;
      if(reason)toast(reason==='offline'?'上轮因离线自动跳过。':reason==='invalid-timeout'?'上轮超时且连接未完成，已自动跳过。':reason==='decision-expired'?'超时选择未确认，上轮已跳过。':'超时选择已结算。');
    }
    if(data.timeoutChoice&&lastChoice!==data.decisionUntil){lastChoice=data.decisionUntil;$('modal').close();$('mp-timeout')?.scrollIntoView({behavior:'smooth',block:'center'});}
  }
  async function perform(action,extra={}){
    if(busy)return;generation++;busy=true;draw();
    try{const data=await request(action,{...extra,activity:true,watchId});
      if(['create','join'].includes(action)){session={code:data.code,token:data.token};write(SESSION,session);write(DRAFT,null);applied='';dirty=null;}
      if(['create','join','sit','rename'].includes(action)){rememberName(data.name);$('modal').close();}
      if(['submit','timeout'].includes(action))dirty=null;
      accept(data);
    }catch(e){errorText=e.message;toast(e.message);}finally{busy=false;draw();setTimeout(poll,0);}
  }
  async function poll(){
    if(busy||polling)return;
    if(!session&&Date.now()-lastLobbyPoll<2000)return;
    polling=true;const version=generation,token=session?.token;
    const sendDraft=dirty&&room?.role==='player'&&!room.submitted&&!room.timeoutChoice&&room.stage==='connection'?dirty:null;
    const hadActivity=activity;activity=false;
    try{
      const data=await request(session?(sendDraft?'draft':'poll'):'list',{...(sendDraft||{}),activity:hadActivity,watchId});
      if(version===generation&&session?.token===token&&!busy){
        if(session){if(sendDraft&&dirty?.seq===sendDraft.seq){dirty=null;$('save-status').textContent='施工稿已同步';}accept(data);}
        else{rooms=data.rooms;connected=true;errorText='';lastLobbyPoll=Date.now();draw();}
      }
    }catch(e){if(version===generation){if(e.status===409){dirty=null;}else{connected=false;errorText=e.message;draw();}}}
    finally{polling=false;}
  }
  for(const event of ['pointerdown','keydown','wheel'])document.addEventListener(event,e=>{if(e.isTrusted)activity=true;},{passive:true});
  document.addEventListener('pointermove',e=>{if(e.isTrusted&&(e.buttons||e.pointerType==='touch'))activity=true;},{passive:true});
  $('multiplayer').textContent='房间大厅';$('multiplayer').onclick=()=>{ $('modal').close();if(session)$('mp-leave')?.click();else{panel.scrollIntoView({behavior:'smooth'});lastLobbyPoll=0;poll();}};
  setInterval(poll,300);
  setTimeout(()=>{draw();const code=new URL(location.href).searchParams.get('room');if(!session&&code)perform('join',{code});else poll();},0);
  return {active:()=>true,locked,open:()=>{ $('modal').close();panel.scrollIntoView({behavior:'smooth'});},
    adjustment:()=>room?.role==='player'&&room.claimed?selectionAdjustment(room.selection,false).total:0,
    saveDraft(){if(applying||!session||room?.role!=='player'||room.phase!=='playing'||room.stage!=='connection'||room.timeoutChoice||room.submitted)return;const game=getGame();write(DRAFT,{code:session.code,claimed:room.claimed,stage:room.stage,game});dirty={round:game.round,pieces:structuredClone(game.pieces),seq:++sequence};$('save-status').textContent='施工稿待同步';setTimeout(poll,30);},
    discardDescription(){const a=selectionAdjustment(room?.selection||{},true);return `本轮放弃扣 $${-a.total}，并撤销本轮施工。`;},
    submit(skip){if(!locked())return perform('submit',{round:room.round,pieces:getGame().pieces,skip});},
  };
}
