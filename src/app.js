import {MACHINES,PIPES,COLORS,COLOR_NAMES} from './data.js';
import {BOARDS,BOARD_ORDER,BOARD_SKINS,playableBoard,boardImage,boardDefinition} from './boards.js';
import {newGame,clone,place,remove,rotate,settle,resetRound,validate,restore,machine,ports,pipeEdges,center,neighbor,label,placementError,mod,campaignResult,nextCampaignGame} from './engine.js';
const $=id=>document.getElementById(id),SAVE='factory-funner.save.v1',BEST='factory-funner.best.v1';
let game,saveError=false,loaded=false;
try{const raw=localStorage.getItem(SAVE);if(raw){game=restore(JSON.parse(raw));loaded=true;}}catch{saveError=true;}
game ||=newGame('FIRST-SHIFT',true);
let tool={kind:'machine'},rotation=0,flipped=false,selected=null,undo=[],redo=[],diagnose=false,result=validate(game),hover=null;
let camera={x:-25,y:-20,w:1015,h:920},toastTimer,focusedCell=null;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tankImage=(kind,color)=>`assets/game/${kind==='supply'?`Toke_Factory_Funner_Reservoirs_Supply-${color==='pink'?'red':color}`:kind==='black'?'Toke_Factory_Funner_Reservoir_b':'Toke_Factory_Funner_Reservoirs'}_a0s0.png`;
const current=()=>machine(game.deck[game.round-1]);
const placed=()=>game.pieces.some(p=>p.kind==='machine'&&p.round===game.round);
const selectedPiece=()=>game.pieces.find(p=>p.id===selected);
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3400);}
function save(){try{localStorage.setItem(SAVE,JSON.stringify(game));$('save-status').textContent='已自动保存';}catch{$('save-status').textContent='保存失败 · 请导出';saveError=true;}}
function change(action){const before=clone(game);try{action();undo.push(before);if(undo.length>100)undo.shift();redo=[];save();render();}catch(error){game=before;toast(error.message);}}
function point(e,length=67.5){const angle=e*Math.PI/3;return [Math.cos(angle)*length,Math.sin(angle)*length];}
function polygon(radius=77){return Array.from({length:6},(_,i)=>{const a=(i*60+30)*Math.PI/180;return `${Math.cos(a)*radius},${Math.sin(a)*radius}`;}).join(' ');}
function pipeDrawing(edges,color='#bdcfc0',small=false,bridge=false){
  let paths=edges.length===2?[`M ${point(edges[0]).join(' ')} Q 0 0 ${point(edges[1]).join(' ')}`]:edges.map(e=>`M 0 0 L ${point(e).join(' ')}`);
  if(bridge&&edges.length===2&&mod(edges[1]-edges[0])===3){
    const angle=edges[0]*Math.PI/3;
    const xy=(x,y)=>`${x*Math.cos(angle)-y*Math.sin(angle)} ${x*Math.sin(angle)+y*Math.cos(angle)}`;
    paths=[`M ${xy(67.5,0)} L ${xy(22,0)} C ${xy(14,-23)} ${xy(-14,-23)} ${xy(-22,0)} L ${xy(-67.5,0)}`];
  }
  return paths.map(d=>`<path d="${d}" fill="none" stroke="#233f40" stroke-width="${small?19:23}" stroke-linecap="butt"/><path d="${d}" fill="none" stroke="#edf0db" stroke-width="${small?13:16}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${small?7:9}"/>`).join('')+edges.map(e=>{const [x,y]=point(e,58);return `<path d="M ${x-4*Math.sin(e*Math.PI/3)} ${y+4*Math.cos(e*Math.PI/3)} l ${8*Math.sin(e*Math.PI/3)} ${-8*Math.cos(e*Math.PI/3)}" stroke="#748e85" stroke-width="3"/>`;}).join('');
}
function portMarkup(p){return ports(p).map(port=>{
  if(p.kind==='supply')return '';
  const resolvedColor=port.colors?.length>1?result.portColors[`${p.id}:${port.index}`]:port.color;
  const [x,y]=point(port.edge,61),color=COLORS[resolvedColor]||'#9d929f';
  if(port.kind==='pipe')return '';
  const isFed=result.fed.some(f=>f.id===p.id&&f.index===port.index);
  return `<g transform="translate(${x},${y})"><circle r="12" fill="${color}" stroke="${isFed?'#ffe6a2':'#f9f5df'}" stroke-width="${isFed?4:1.5}"/><text y="4" text-anchor="middle" font-size="11" font-weight="800" fill="${resolvedColor==='yellow'?'#453a19':'white'}">${port.kind==='in'?'•'.repeat(port.amount):port.kind==='out'?resolvedColor==='black'?'◆':port.amount:port.kind==='source'?'∞':'↓'}</text></g>`;
}).join('');}
function pieceMarkup(p,ghost=false){
  const [x,y]=center(p.q,p.r);let content='';
  if(p.kind==='machine')content=`<g clip-path="url(#hex-clip)"><image href="${machine(p.machineId).image}" x="-78" y="-67.5" width="156" height="135" transform="rotate(${30+p.rot*60})" class="board-art"/></g>`;
  else if(p.kind==='pipe'){
    const below=game.pieces.some(other=>other.kind==='pipe'&&other.q===p.q&&other.r===p.r&&other.id<p.id);
    content=pipeDrawing(pipeEdges(p),COLORS[result.pipeColors[p.id]]||'#abbdb5',false,below);
  }
  else content=`<image href="${tankImage(p.kind,p.color)}" x="-53" y="-64" width="106" height="116" transform="rotate(${90+p.rot*60})" clip-path="url(#tank-clip)" class="board-art"/>`;
  if($('show-ports').checked&&p.kind!=='pipe')content+=portMarkup(p);
  if(p.kind==='machine'&&p.round<game.round)content+='<circle cy="35" r="6" fill="#f6edcc"/><text y="38" text-anchor="middle" fill="#375c55" font-size="8">✓</text>';
  return `<g data-piece-id="${p.id}" data-pipe-color="${p.kind==='pipe'?(result.pipeColors[p.id]||'unconnected'):''}" transform="translate(${x} ${y})" pointer-events="none" opacity="${ghost?.55:1}">${content}</g>`;
}
function drawBoard(){
  const board=playableBoard(game.boardId),BOARD=board.cells;
  const ids=diagnose?new Set(result.issues.flatMap(i=>i.ids)):new Set();
  const selectedP=selectedPiece();
  let html=`<defs><clipPath id="hex-clip"><polygon points="${polygon()}"/></clipPath><clipPath id="tank-clip"><circle r="64"/></clipPath></defs><image href="${boardImage(game)}" width="${board.width}" height="${board.height}" class="board-art"/>`;
  html+=game.pieces.map(p=>pieceMarkup(p)).join('');
  if(hover&&tool&&!game.over){const p={...tool,machineId:current().id,q:hover[0],r:hover[1],rot:rotation,flip:flipped,id:-1,round:game.round};if(!placementError(game,p))html+=pieceMarkup(p,true);}
  html+=BOARD.map(k=>{const [q,r]=k.split(',').map(Number),[x,y]=center(q,r),pieces=game.pieces.filter(p=>p.q===q&&p.r===r);return `<g transform="translate(${x} ${y})"><polygon points="${polygon()}" class="hex-hit ${selectedP?.q===q&&selectedP?.r===r?'selected':''} ${pieces.some(p=>ids.has(p.id))?'issue':''}" data-cell="${k}" role="button" tabindex="0" aria-label="格子 ${q+1},${r+1}${pieces.length?'，'+pieces.map(label).join('，'):'，空格'}"/><text class="cell-label" text-anchor="middle" y="59">${q+1}·${r+1}</text></g>`;}).join('');
  $('board').innerHTML=html;$('board').setAttribute('viewBox',`${camera.x} ${camera.y} ${camera.w} ${camera.h}`);
}
function render(){
  result=validate(game);const m=current(),p=selectedPiece();
  $('board-id').textContent=game.boardId||'A';
  $('machine-name').textContent=m.name;$('machine-id').textContent=`MACHINE ${String(m.id).padStart(2,'0')} / 48`;$('revenue').textContent=`$${m.revenue}`;$('machine-image').src=m.image;
  $('machine-state').textContent=game.over?'本局已完成':placed()?'已放置':'等待安装';
  $('pick-machine').classList.toggle('selected',tool?.kind==='machine');$('pick-machine').disabled=game.over;
  $('machine-ports').innerHTML=['in','out'].map(kind=>`<div class="port-line"><span>${kind==='in'?'需要':'产出'}</span>${m.ports.filter(p=>p.kind===kind).map(port=>`<span class="port-chip">${port.colors.map(c=>`<i class="color-dot" style="--dot:${COLORS[c]}"></i>`).join('')}${port.colors.length>1?'任选':''} ×${port.amount}</span>`).join('<span class="muted">＋</span>')}</div>`).join('');
  const currentPiece=game.pieces.find(piece=>piece.kind==='machine'&&piece.round===game.round);
  m.ports.forEach((port,index)=>{
    if(port.colors.length<2)return;
    $('machine-ports').insertAdjacentHTML('beforeend',autoColorInfo(currentPiece,port,index));
  });
  $('money').textContent=`$${game.money}`;$('cost').textContent=`−$${game.cost}`;$('bonus').textContent=`+$${result.bonus}`;
  $('round-label').textContent=`${String(game.round).padStart(2,'0')} / 08`;$('rounds').innerHTML=Array.from({length:8},(_,i)=>`<i class="${i<game.history.length?'done':i===game.round-1?'current':''}" title="第 ${i+1} 回合"></i>`).join('');
  $('board-title').textContent=game.over?'生产完成 · 查看你的工厂':'布局阶段 · 不用着急，慢慢规划';
  $('undo').disabled=!undo.length||game.over;$('redo').disabled=!redo.length||game.over;
  $('reset-round').disabled=game.over||JSON.stringify(game.pieces)===JSON.stringify(game.baseline);
  $('settle').disabled=!game.over&&(!placed()||!result.valid);$('settle').innerHTML=game.over?'查看本局成绩 <span>↗</span>':`完成安装 <span>→</span>`;$('skip').disabled=game.over;
  const active=game.over?'本局已完成':p?label(p):tool?.kind==='machine'?'安装机器':tool?.kind==='pipe'?PIPES.find(x=>x.id===tool.shape).name:tool?label(tool):'选择 / 平移';
  $('active-tool').textContent=active;$('orientation').textContent=`${(p?.rot??rotation)*60}°`;
  $('selection-info').innerHTML=`${escape(active)}<small>${p?p.kind==='machine'&&p.round<game.round?'机器已固定 · 多色端口自动匹配':'点击旋转或拆除；同格交叉管道可再次点击切换':tool?'点击棋盘空格放置；旋转调整接口朝向':'点击组件查看；拖动棋盘平移'}</small>`;
  $('remove').disabled=!p||game.over||(p.kind==='machine'&&p.round<game.round);
  $('rotate').disabled=game.over||(!tool&&!p)||(p?.kind==='machine'&&p.round<game.round);
  $('flip').disabled=game.over||(p?.kind??tool?.kind)!=='pipe';
  $('wild-choices').innerHTML=p?.kind==='machine'?machine(p.machineId).ports.map((port,index)=>port.colors.length>1?autoColorInfo(p,port,index):'').join(''):'';
  const status=game.over?'ok':!game.pieces.length?'idle':result.valid&&placed()?'ok':'bad';
  $('status-icon').className=`status-icon ${status}`;$('status-icon').textContent=status==='ok'?'✓':status==='bad'?'!':'○';
  $('status-title').textContent=game.over?'八轮生产完成':status==='ok'?'所有连接已就绪':!game.pieces.length?'让工厂开始运转':`${result.issues.length} 项连接待检查`;
  $('status-detail').textContent=game.over?`最终成绩 $${game.money+result.bonus}`:status==='ok'?`本轮净收入 $${m.revenue-game.cost}，可以完成安装。`:!placed()?'选择本轮机器，点击棋盘空格安装。':result.issues[0]?.message||'继续搭建你的工厂。';
  $('board-guide').innerHTML=game.tutorial&&game.round===1&&!game.over?(!placed()?'<b>第一班，开工！</b><br>先选中左侧机器，再点棋盘的 <b>3·4</b> 格。':result.valid?'<b>连接成功！</b><br>点击「完成安装」，领取收入并开始下一回合。':'<b>连接机器的两端</b><br>绿色供应罐放在 <b>2·3</b>，旋转到 60°；黑色回收罐放在 <b>3·5</b>，旋转到 240°。'):'';
  renderPalette();renderLayers();drawBoard();
}
function autoColorInfo(piece,port,index){
  const color=piece?result.portColors[`${piece.id}:${index}`]:null;
  return `<div class="rainbow-choice"><strong>${port.kind==='out'?'彩虹输出':'双色输入'} · ${port.amount} 单位 · 自动匹配</strong><p class="auto-color" data-auto-color="${color||''}">${color?`<i class="color-dot" style="--dot:${COLORS[color]}"></i>自动采用${COLOR_NAMES[color]}色 ×${port.amount}`:piece?'连接颜色不兼容':'连接后自动选择颜色'}</p><small>根据整条管路统一选择一种颜色，无需手动操作。</small></div>`;
}
function renderLayers(){
  let panel=$('pipe-layers');
  if(!panel){panel=document.createElement('div');panel.id='pipe-layers';$('selection-info').after(panel);}
  const p=selectedPiece(),cell=p?[p.q,p.r]:focusedCell;
  const pipes=cell?game.pieces.filter(x=>x.kind==='pipe'&&x.q===cell[0]&&x.r===cell[1]):[];
  panel.innerHTML=pipes.length?`<div class="layer-heading">同格管道 · ${pipes.length} 条 <span>各自独立，不混色</span></div><div class="layer-buttons">${pipes.map((pipe,i)=>`<button data-layer="${pipe.id}" class="${selected===pipe.id?'active':''}"><i class="color-dot" style="--dot:${COLORS[result.pipeColors[pipe.id]]||'#abbdb5'}"></i>${result.pipeColors[pipe.id]?COLOR_NAMES[result.pipeColors[pipe.id]]+'色':'未接通'} · ${i+1}<small>${PIPES.find(x=>x.id===pipe.shape).name}</small></button>`).join('')}</div><p class="layer-hint">选管件再点此格可叠放；点上方管道可单独旋转或拆除。</p>`:'';
  panel.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.layer);tool=null;hover=null;render();});
}
function renderPalette(){
    const defs=[...['green','blue','pink','yellow'].map(color=>({kind:'supply',color})),{kind:'collector'},{kind:'black'}];
    $('tank-palette').innerHTML=defs.map((d,i)=>{const n=game.pieces.filter(p=>p.kind===d.kind&&(d.kind!=='supply'||p.color===d.color)).length;const remaining=d.kind==='supply'?1-n:d.kind==='collector'?3-n:'∞';return `<button class="component ${tool?.kind===d.kind&&tool?.color===d.color?'selected':''}" data-tank="${i}" ${remaining===0||game.over?'disabled':''} aria-label="${label(d)}"><small>${remaining}</small><img src="${tankImage(d.kind,d.color)}" alt=""><span>${d.kind==='supply'?COLOR_NAMES[d.color]+'色供应':d.kind==='collector'?'白色回收':'黑色回收'}</span></button>`;}).join('');
    $('tank-palette').querySelectorAll('[data-tank]').forEach(b=>b.onclick=()=>choose(defs[+b.dataset.tank]));
    $('pipe-palette').innerHTML=PIPES.map(d=>`<button class="component ${tool?.kind==='pipe'&&tool.shape===d.id?'selected':''}" data-pipe="${d.id}" ${game.over?'disabled':''} aria-label="${d.name}"><svg viewBox="-80 -80 160 160">${pipeDrawing(d.edges,'#84ac99',true)}</svg><span>${d.name}</span></button>`).join('');
    $('pipe-palette').querySelectorAll('[data-pipe]').forEach(b=>b.onclick=()=>choose({kind:'pipe',shape:b.dataset.pipe}));
    $('warehouse-hint').textContent='供应罐每色 1 个，白罐共 3 个。选管件再点已有管道格可独立叠放，自动避开占用接口。';
}
function choose(spec){tool=spec;selected=null;rotation=0;flipped=false;hover=null;render();}
function cellClick(q,r){
  focusedCell=[q,r];
  if(game.over){const ps=game.pieces.filter(p=>p.q===q&&p.r===r);selected=ps[0]?.id;tool=null;render();return;}
  const ps=game.pieces.filter(p=>p.q===q&&p.r===r);
  if(tool){const proposed={...tool,machineId:current().id,q,r,rot:rotation,flip:flipped,id:-1,round:game.round};
    let err=placementError(game,proposed);
    if(tool.kind==='pipe'&&ps.length&&ps.every(p=>p.kind==='pipe')){
      let adjusted=false;
      if(err){
        for(let step=1;step<6;step++){
          const candidate=mod(rotation+step);
          if(!placementError(game,{...proposed,rot:candidate})){rotation=candidate;adjusted=true;err=null;break;}
        }
      }
      if(err){toast('这格没有足够的空闲接口，请换一种管件或选择其他格子');return;}
      change(()=>{const p=place(game,tool,q,r,rotation,flipped);selected=p.id;tool=null;hover=null;});
      toast(adjusted?`已调整到 ${rotation*60}° 并叠放；各条管道互不连通`:'已叠放独立管道；连接后分别显示各自颜色');
      return;
    }
    if(ps.length&&err){selected=ps[0].id;tool=null;hover=null;render();return;}
    change(()=>{const p=place(game,tool,q,r,rotation,flipped);selected=p.id;tool=null;hover=null;});
  }else if(ps.length){const i=ps.findIndex(p=>p.id===selected);selected=ps[(i+1)%ps.length].id;render();}else{selected=null;render();}
}
$('pick-machine').onclick=()=>{if(placed()){selected=game.pieces.find(p=>p.kind==='machine'&&p.round===game.round).id;tool=null;render();}else choose({kind:'machine'});};
$('rotate').onclick=()=>{if(selected)change(()=>rotate(game,selected));else{rotation=mod(rotation+1);render();}};
$('flip').onclick=()=>{if(selected)change(()=>rotate(game,selected,0,true));else{flipped=!flipped;render();}};
$('remove').onclick=()=>{if(selected)change(()=>{remove(game,selected);selected=null;});};
$('select-tool').onclick=()=>{tool=null;hover=null;selected=null;render();};
$('undo').onclick=()=>{if(!undo.length||game.over)return;redo.push(clone(game));game=undo.pop();selected=null;hover=null;save();render();};
$('redo').onclick=()=>{if(!redo.length||game.over)return;undo.push(clone(game));game=redo.pop();selected=null;hover=null;save();render();};
$('reset-round').onclick=()=>{
  if(game.over)return;
  change(()=>{resetRound(game);selected=null;hover=null;focusedCell=null;tool={kind:'machine'};rotation=0;flipped=false;diagnose=false;});
  toast('已恢复本轮初始布局，当前机器不变；可点击撤销恢复刚才的方案。');
};
$('show-ports').onchange=drawBoard;
function resetCamera(){camera={x:-25,y:-20,w:1015,h:920};drawBoard();}
function zoom(factor){const width=Math.min(1522,Math.max(350,camera.w*factor)),ratio=width/camera.w;camera={x:camera.x+(camera.w-width)/2,y:camera.y+(camera.h-camera.h*ratio)/2,w:width,h:camera.h*ratio};drawBoard();}
$('zoom-in').onclick=()=>zoom(.8);$('zoom-out').onclick=()=>zoom(1.25);$('zoom-fit').onclick=resetCamera;
let pointers=new Map(),gesture=null,suppressClick=false;
const board=$('board');
board.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  gesture={start:{x:e.clientX,y:e.clientY},camera:{...camera},moved:false,cell:e.target.closest('[data-cell]')?.dataset.cell};
  if(pointers.size===2){const [a,b]=[...pointers.values()];gesture.distance=Math.hypot(a.x-b.x,a.y-b.y);gesture.moved=true;}
  board.setPointerCapture(e.pointerId);
});
board.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(!gesture)return;
  if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(gesture.distance){const w=Math.max(350,Math.min(1522,gesture.camera.w*gesture.distance/d));const ratio=w/gesture.camera.w;camera={x:gesture.camera.x+(gesture.camera.w-w)/2,y:gesture.camera.y+(gesture.camera.h-gesture.camera.h*ratio)/2,w,h:gesture.camera.h*ratio};drawBoard();}return;}
  const dx=e.clientX-gesture.start.x,dy=e.clientY-gesture.start.y;if(Math.hypot(dx,dy)<7&&!gesture.moved)return;
  gesture.moved=true;const rect=board.getBoundingClientRect();const scale=Math.max(gesture.camera.w/rect.width,gesture.camera.h/rect.height);
  camera.x=gesture.camera.x-dx*scale;camera.y=gesture.camera.y-dy*scale;drawBoard();
});
board.addEventListener('pointerup',e=>{
  pointers.delete(e.pointerId);if(!gesture)return;
  if(pointers.size){gesture.moved=true;return;}
  const g=gesture;gesture=null;suppressClick=true;
  if(!g.moved&&g.cell){const [q,r]=g.cell.split(',').map(Number);cellClick(q,r);}
});
board.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);gesture=null;});
board.addEventListener('click',e=>{if(suppressClick){suppressClick=false;return;}const cell=e.target.closest('[data-cell]');if(cell){const [q,r]=cell.dataset.cell.split(',').map(Number);cellClick(q,r);}});
board.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.dataset.cell){e.preventDefault();const [q,r]=e.target.dataset.cell.split(',').map(Number);cellClick(q,r);}});
board.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.1:.9);},{passive:false});
document.addEventListener('keydown',e=>{
  if($('modal').open||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}
  else if(e.key.toLowerCase()==='r')$('rotate').click();else if(e.key.toLowerCase()==='f')$('flip').click();
  else if(['Delete','Backspace'].includes(e.key)){e.preventDefault();$('remove').click();}else if(e.key==='Escape')$('select-tool').click();
});
function modal(title,subtitle,body){
  $('modal-content').innerHTML=`<div class="modal-body"><div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="close-modal" aria-label="关闭">×</button></div>${body}</div>`;
  $('modal-content').querySelector('.close-modal').onclick=()=>$('modal').close();if(!$('modal').open)$('modal').showModal();
}
$('modal').addEventListener('click',e=>{if(e.target===$('modal')){const r=$('modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('modal').close();}});
function start(seed,tutorial=false){game=newGame(seed||Math.random().toString(36).slice(2,9).toUpperCase(),tutorial);tool={kind:'machine'};selected=null;rotation=0;flipped=false;undo=[];redo=[];diagnose=false;hover=null;save();resetCamera();render();$('modal').close();toast(tutorial?'第一班开工！跟随棋盘提示完成安装。':'新工厂已就绪，开始规划吧。');}
function confirmNew(tutorial=false){modal('开始新工厂','当前存档将被新对局替换。可以先从工厂菜单导出存档。',`<p>${tutorial?'引导局从简单的 Time Machine 开始，第一回合提供放置提示。':'从 48 台机器中随机抽取 8 台。输入相同种子可重玩同一牌组。'}</p><input class="seed-field" id="seed" maxlength="50" placeholder="对局种子（留空则随机）" value="${tutorial?'FIRST-SHIFT':''}"><div class="modal-actions"><button id="cancel-new">保留当前对局</button><button class="primary" id="confirm-new">开始${tutorial?'引导局':'新对局'} →</button></div>`);$('cancel-new').onclick=()=>$('modal').close();$('confirm-new').onclick=()=>start($('seed').value.trim(),tutorial);}
$('menu').onclick=()=>{modal('工厂菜单','你的进度自动保存在当前浏览器。',`<div class="menu-grid"><button id="new-game" class="primary">新工厂 <small>随机 8 台机器，全新规划</small></button><button id="tutorial-game">引导对局 <small>从第一台机器开始学习</small></button><button id="export">导出存档 <small>保存文件，跨设备继续</small></button><button id="import">导入存档 <small>读取之前导出的 JSON</small></button><button id="ledger">本局账本 <small>查看每轮收入和支出</small></button><button id="catalog">机器图鉴 <small>查看完整 48 张机器</small></button></div><p class="muted">对局种子：<b>${escape(game.seed)}</b><br>规则：单人模式 · 工厂 A · 无时间限制</p>`);
  $('new-game').onclick=()=>confirmNew();$('tutorial-game').onclick=()=>confirmNew(true);$('export').onclick=exportSave;$('import').onclick=()=>$('import-file').click();$('ledger').onclick=showLedger;$('catalog').onclick=showCatalog;
};
function exportSave(){const blob=new Blob([JSON.stringify(game,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`factory-funner-round-${game.round}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('存档已导出');}
$('import-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>500000)throw Error('存档文件过大');const imported=restore(JSON.parse(await file.text()));modal('导入这份存档？',`第 ${imported.round} 回合 · 资金 $${imported.money}`,`<p>导入会替换当前浏览器中的对局。</p><div class="modal-actions"><button id="import-cancel">取消</button><button id="import-confirm" class="primary">导入并继续 →</button></div>`);$('import-cancel').onclick=()=>$('modal').close();$('import-confirm').onclick=()=>{game=imported;undo=[];redo=[];selected=null;tool=null;save();render();resetCamera();$('modal').close();toast('存档已恢复');};}catch(error){toast('无法导入：'+error.message);}};
function ledgerHTML(){return `<table class="ledger"><thead><tr><th>回合</th><th>机器</th><th>收入</th><th>支出</th><th>资金</th></tr></thead><tbody>${game.history.map(h=>`<tr><td>${h.round}</td><td>${machine(h.machineId).name}${h.skip?' · 跳过':''}</td><td>+$${h.revenue}</td><td>−$${h.cost}</td><td>$${h.money}</td></tr>`).join('')}</tbody></table>`;}
function showLedger(){modal('生产账本','每一份收益，都来自你的规划。',game.history.length?ledgerHTML():'<p>完成第一轮安装后，这里会记录你的收支。</p>');}
function showCatalog(){modal('机器图鉴','端口白点表示需求量；数字表示产出量。',`<div class="catalog-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${MACHINES.map(m=>`<button data-machine-info="${m.id}" style="padding:8px;font-size:10px"><img src="${m.image}" style="width:100%;clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)" alt="${m.name}" loading="lazy">${m.id}. ${m.name}<br><b>$${m.revenue}</b></button>`).join('')}</div>`);document.querySelectorAll('[data-machine-info]').forEach(b=>b.onclick=()=>{const m=machine(+b.dataset.machineInfo);modal(m.name,`机器 ${m.id} / 48 · 收入 $${m.revenue}`,`<img src="${m.image}" alt="${m.name}" style="width:240px;max-width:100%;display:block;margin:auto;image-rendering:auto"><p>${m.ports.map(p=>`${p.kind==='in'?'输入':'输出'}：${p.colors.map(c=>COLOR_NAMES[c]).join('或')} ×${p.amount}`).join('<br>')}</p><button id="catalog-back" class="outline">← 返回图鉴</button>`);$('catalog-back').onclick=showCatalog;});}
$('diagnostics').onclick=()=>{diagnose=true;drawBoard();modal('连接诊断',result.valid?'当前所有管路均通过检查。':'点击问题，定位到相关组件。',result.issues.length?`<ul class="issue-list">${result.issues.map((issue,i)=>`<li><button data-issue="${i}">${i+1}. ${escape(issue.message)} <span style="float:right">↗</span></button></li>`).join('')}</ul>`:'<p>颜色匹配、输入流量、端口连接和回收路径均正常。安装本轮机器后即可结算。</p>');document.querySelectorAll('[data-issue]').forEach(b=>b.onclick=()=>{selected=result.issues[+b.dataset.issue].ids[0];tool=null;resetCamera();$('modal').close();render();});};
function finishRound(skip=false){try{settle(game,skip);undo=[];redo=[];selected=null;tool=game.over?null:{kind:'machine'};rotation=0;flipped=false;diagnose=false;save();render();if(game.over)showResults();else toast(skip?'已跳过本轮，棋盘恢复到上轮结算状态。':`安装完成，进入第 ${game.round} 回合。`);}catch(error){toast(error.message);}}
$('settle').onclick=()=>game.over?showResults():finishRound();
$('skip').onclick=()=>{modal('跳过本回合？','单人模式跳过机器没有罚款。','<p>本回合的所有改动将撤销，工厂恢复至上回合结算后的布局，然后翻开下一台机器。</p><div class="modal-actions"><button id="cancel-skip">继续规划</button><button id="confirm-skip" class="primary">跳过本轮 →</button></div>');$('cancel-skip').onclick=()=>$('modal').close();$('confirm-skip').onclick=()=>{$('modal').close();finishRound(true);};};
function showResults(){const bonus=validate(game).bonus,total=game.money+bonus;let best=total;try{best=Math.max(total,Number(localStorage.getItem(BEST))||0);localStorage.setItem(BEST,String(best));}catch{}modal('这一班，干得漂亮。',total>=50?'高效运转的工厂，来自精心安排的每一条管道。':'你的第一条生产线，已经有了自己的模样。',`<div class="result-score">$${total}</div><div class="result-caption">工厂最终收益 · 本机最高 $${best}</div><div class="score-breakdown"><span>资金 $${game.money}</span><span>连锁奖励 +$${bonus}</span></div>${ledgerHTML()}<div class="modal-actions"><button id="review">看看我的工厂</button><button id="again" class="primary">再建一座工厂 →</button></div>`);$('review').onclick=()=>$('modal').close();$('again').onclick=()=>confirmNew();}
$('help').onclick=()=>modal('欢迎来到你的工厂','把每一台奇妙机器，接进井然有序的生产线。',`<div class="rule-step"><b>01</b><div><strong>选机器，找个好位置</strong><br>每轮只有一台机器，点击选中后放到空格。旋转让端口面向更合适的方向。</div></div><div class="rule-step"><b>02</b><div><strong>把每个接口连起来</strong><br>彩色罐提供无限原料；白罐回收一种彩色产物，黑罐回收成品。机器也能直接相邻连接。管道交叉不相通，三通和多通才会汇流。</div></div><div class="rule-step"><b>03</b><div><strong>检查，再完成安装</strong><br>颜色要相同，机器供给量必须覆盖需求；不能把供应罐和机器输出合流。机器不能接回自身输入。</div></div><div class="rule-step"><b>04</b><div><strong>八轮之后，看看收益</strong><br>初始 $10；安装机器获得收入，点击完成安装时，最终新增或调整的组件每件花 $1。机器供给的每个输入点在终局奖励 $3。</div></div><p class="muted">R 旋转 · F 镜像管道 · Delete 拆除 · Ctrl+Z 撤销<br>拖动平移 · 滚轮 / 双指缩放 · 手机可使用旋转和缩放按钮<br>已结算的机器不能移动；试放、拆除和反复旋转不累加费用；恢复到上轮布局不收费。</p><p><a href="https://c.tabletopia.com/games/factory-funner/rules/factory-funner-rulebook/en" target="_blank" rel="noreferrer">查看原版规则 ↗</a></p><p class="muted">本版使用提供的 Tabletopia 原版素材，支持单人工厂 A。管道使用清晰的矢量图显示连接关系。B 面难度进阶尚未实现。</p>`);
render();save();
if(!loaded){modal('你的工厂，今天开张。','FACTORY FUNNER · 单人模式',`<img src="assets/cover.png" class="welcome-art" alt="Factory Funner 桌游封面"><p>八台机器，一座工厂。把储罐与管道巧妙连接，让每一次安装都创造新的收益。</p><p class="muted">没有计时器，没有抢夺。专注享受规划的乐趣，进度会自动保存在这里。</p><div class="modal-actions"><button id="welcome-random">直接开始随机局</button><button id="welcome-tutorial" class="primary">跟随引导开工 →</button></div>`);$('welcome-tutorial').onclick=()=>$('modal').close();$('welcome-random').onclick=()=>start();}
if(saveError)toast('浏览器存档不可用或原存档损坏，请使用菜单导出保存。');
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

