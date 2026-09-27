import {MACHINES,PIPES,COLOR_NAMES} from './data.js';
import {BOARDS,BOARD_SKINS,playableBoard,progressionForScore,progressionOrder} from './boards.js';
export const clone = value=>structuredClone(value);
export const key = (q,r)=>`${q},${r}`;
const boardCells = state=>new Set(playableBoard(state.boardId,state.boardSkin).cells);
export const mod = n=>(n%6+6)%6;
export function neighbor(q,r,e) {
  if(e===0)return [q+1,r]; if(e===3)return [q-1,r];
  const nr=r+([1,2].includes(e)?1:-1);
  const off=v=>v%2===0?1:0.5;
  return [Math.round(q+off(r)+([1,5].includes(e)?0.5:-0.5)-off(nr)),nr];
}
export function center(q,r) {return [144+135*q-(r%2?67.5:0),89+117*r];}
export function machine(id) {const m=MACHINES.find(m=>m.id===id); if(!m)throw Error('未知机器'); return m;}
export function pipeEdges(p) {return PIPES.find(x=>x.id===p.shape).edges.map(e=>mod((p.flip?-e:e)+p.rot));}
// Charge the final installation, not the sequence of editing gestures.
// Match equivalent components against the last confirmed layout, regardless of IDs.
export function installationCost(state) {
  const signature=p=>JSON.stringify([p.kind,p.q,p.r,p.kind==='pipe'?pipeEdges(p).sort((a,b)=>a-b):p.kind==='supply'?p.color:p.rot]);
  const remaining=new Map();
  for(const p of state.baseline)if(p.kind!=='machine'){
    const k=signature(p);remaining.set(k,(remaining.get(k)||0)+1);
  }
  let cost=0;
  for(const p of state.pieces)if(p.kind!=='machine'){
    const k=signature(p),count=remaining.get(k)||0;
    if(count)remaining.set(k,count-1);else cost++;
  }
  return cost;
}
export function ports(p) {
  if(p.kind==='machine')return machine(p.machineId).ports.map((port,i)=>({...port,edge:mod(port.edge+p.rot),color:port.colors.length===1?port.colors[0]:null,index:i}));
  if(p.kind==='pipe')return pipeEdges(p).map(edge=>({edge,kind:'pipe'}));
  if(p.kind==='supply')return Array.from({length:6},(_,edge)=>({edge,kind:'source',color:p.color,optional:true}));
  return [{edge:p.rot,kind:p.kind==='supply'?'source':'sink',color:p.kind==='supply'?p.color:p.kind==='black'?'black':null}];
}
export function seededRandom(seed) {
  let n=2166136261; for(const c of seed)n=Math.imul(n^c.charCodeAt(0),16777619);
  return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
}
export function newGame(seed='factory',tutorial=false,options={}) {
  const boardId=tutorial?'A':options.boardId||'A';playableBoard(boardId);
  const series=options.series||(boardId.startsWith('C')?'web':'original');
  if(!progressionOrder(series).includes(boardId))throw Error('棋盘与进阶系列不匹配');
  const boardSkin=options.boardSkin||'Cian';
  if(!BOARD_SKINS.some(s=>s.id===boardSkin))throw Error('未知棋盘配色');
  const rand=seededRandom(seed),deck=MACHINES.map(m=>m.id);
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  if(tutorial){deck.splice(deck.indexOf(41),1);deck.unshift(41);}
  return {version:1,aLayoutVersion:1,seed,tutorial,boardId,boardSkin,series,campaign:[],round:1,money:10,deck:deck.slice(0,8),pieces:[],baseline:[],cost:0,nextId:1,history:[],over:false};
}
export function campaignResult(state){
  if(!state.over)throw Error('完成八回合后才能结算进阶');
  const result=validate(state);
  if(!result.valid)throw Error('当前工厂连接无效，不能用于进阶');
  return progressionForScore(state.boardId||'A',state.money+result.bonus,state.series||'original');
}
export function nextCampaignGame(state,seed){
  const result=campaignResult(state);
  const next=newGame(seed,false,{boardId:result.nextBoardId,boardSkin:state.boardSkin,series:result.series});
  next.campaign=[...(state.campaign||[]),{...result,seed:state.seed}];
  return next;
}
export function placementError(state,p,ignoreId=null) {
  if(state.over)return '本局已结束，请开始新工厂';
  if(!boardCells(state).has(key(p.q,p.r)))return '这里是墙壁或设备，不能放置';
  const others=state.pieces.filter(x=>x.id!==ignoreId);
  const occupied=others.filter(x=>x.q===p.q&&x.r===p.r);
  if(occupied.length && (p.kind!=='pipe'||occupied.some(x=>x.kind!=='pipe')))return '这个格子已经被占用';
  if(p.kind==='pipe'){
    const used=occupied.flatMap(pipeEdges);
    if(pipeEdges(p).some(e=>used.includes(e)))return '管道可以交叉，但不能共用同一条边';
  }
  if(p.kind==='machine'&&others.some(x=>x.kind==='machine'&&x.round===state.round))return '每回合只能安装一台新机器';
  if(p.kind==='supply'&&others.some(x=>x.kind==='supply'&&x.color===p.color))return '每种颜色只有一个供应罐，请移动已有储罐或用三通分流';
  if(p.kind==='collector'&&others.filter(x=>x.kind==='collector').length>=3)return '白色回收罐最多三个';
  return null;
}
export function place(state,spec,q,r,rot=0,flip=false) {
  const p={...spec,q,r,rot:mod(rot),flip,id:state.nextId,round:state.round};
  if(p.kind==='machine')p.machineId=state.deck[state.round-1];
  const error=placementError(state,p);if(error)throw Error(error);
  state.pieces.push(p);state.nextId++;state.cost=installationCost(state);
  return p;
}
export function remove(state,id) {
  const p=state.pieces.find(x=>x.id===id);if(!p)throw Error('请选择组件');
  if(state.over)throw Error('本局已结束');
  if(p.kind==='machine'&&p.round!==state.round)throw Error('之前回合安装的机器已经固定');
  state.pieces=state.pieces.filter(x=>x.id!==id);
  state.cost=installationCost(state);
}
export function rotate(state,id,step=1,flip=false) {
  const p=state.pieces.find(x=>x.id===id);if(!p)throw Error('请选择组件');
  if(p.kind==='machine'&&p.round!==state.round)throw Error('之前回合安装的机器不能旋转');
  const changed={...p,rot:mod(p.rot+step),flip:flip?!p.flip:p.flip};
  if(p.kind==='pipe'&&step===1&&!flip){
    const originalEdges=pipeEdges(p).sort().join();
    for(let offset=1;offset<6;offset++){
      changed.rot=mod(p.rot+offset);
      if(pipeEdges(changed).sort().join()===originalEdges)continue;
      if(!placementError(state,changed,id)){
        Object.assign(p,changed);state.cost=installationCost(state);return;
      }
    }
    throw Error('没有其他合法旋转角度，管道保持原位');
  }
  const error=placementError(state,changed,id);if(error)throw Error(error);
  Object.assign(p,changed);state.cost=installationCost(state);
}
export function move(state,id,q,r){
  const p=state.pieces.find(x=>x.id===id);if(!p)throw Error('请选择组件');
  if(p.kind==='machine'&&p.round!==state.round)throw Error('之前回合安装的机器不能移动');
  const moved={...p,q,r};
  const error=placementError(state,moved,id);if(error)throw Error(error);
  Object.assign(p,moved);state.cost=installationCost(state);
  return p;
}
export function setChoice(state,id,index,color) {
  if(state.over)throw Error('本局已结束');
  const p=state.pieces.find(p=>p.id===id);const port=p&&machine(p.machineId).ports[index];
  if(!port?.colors.includes(color))throw Error('只能选择这个端口印刷的颜色');
  p.choices={...p.choices,[index]:color};
}
// Port graph: a machine's ports are separate nodes; each pipe or reservoir is one node.
// Separate pieces sharing a hex remain separate networks, which models real crossings.
export function validate(state) {
  const boardSet=boardCells(state);
  const nodes=[],ends=new Map(),parent=[],issues=[],pipeColors={},portColors={},fed=[],networks=[],dependencies=new Map();
  const addIssue=(message,ids=[])=>{if(!issues.some(x=>x.message===message&&x.ids.join()===ids.join()))issues.push({message,ids});};
  const find=n=>parent[n]===n?n:(parent[n]=find(parent[n]));
  const join=(a,b)=>{parent[find(a)]=find(b);};
  for(const p of state.pieces){
    if(!boardSet.has(key(p.q,p.r)))addIssue('组件超出棋盘范围',[p.id]);
    const pp=ports(p);const first=nodes.length;
    pp.forEach((port,i)=>{
      const node=nodes.length;nodes.push({piece:p,port});parent.push(node);
      if(p.kind!=='machine'&&i)join(first,node);
      const edgeKey=`${p.q},${p.r},${port.edge}`;
      if(ends.has(edgeKey))addIssue('两条管道共用同一条边',[p.id,nodes[ends.get(edgeKey)].piece.id]);
      ends.set(edgeKey,node);
    });
  }
  nodes.forEach(({piece:p,port},i)=>{
    const [q,r]=neighbor(p.q,p.r,port.edge);const other=ends.get(`${q},${r},${mod(port.edge+3)}`);
    // Supply outlets are optional: neighboring reservoirs do not connect to each other.
    // A pipe joining their outlets still merges the networks and must pass color checks.
    if(other!==undefined&&p.kind==='supply'&&nodes[other].piece.kind==='supply')return;
    if(other===undefined){if(!port.optional)addIssue(`${label(p)}有未连接的端口`,[p.id]);}else join(i,other);
  });
  const groups=new Map();nodes.forEach((node,i)=>{const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(node);});
  for(const group of groups.values()){
    const unique=[...new Set(group.map(n=>n.piece.id))];
    const inputs=group.filter(n=>n.port.kind==='in'),outputs=group.filter(n=>n.port.kind==='out');
    const supplies=group.filter(n=>n.port.kind==='source'),sinks=group.filter(n=>n.port.kind==='sink');
    const colors=[...new Set(group.map(n=>n.port.color).filter(Boolean))];
    // A connected network must have ONE color accepted by every endpoint.
    // Wildcards constrain the allowed set; they never split into multiple colors.
    // Ignore legacy manual choices so old saves also adapt when connections change.
    const constraints=group.map(n=>n.port.colors||(n.port.color?[n.port.color]:null)).filter(Boolean);
    const allowed=['pink','yellow','green','blue','black'].filter(c=>constraints.every(options=>options.includes(c)));
    const compatible=constraints.length>0&&allowed.length>0;
    const color=compatible?allowed[0]:null;
    const demand=inputs.reduce((s,n)=>s+n.port.amount,0),capacity=outputs.reduce((s,n)=>s+n.port.amount,0);
    if(constraints.length&&!allowed.length)addIssue(colors.length>1?`管路混色：${colors.map(c=>COLOR_NAMES[c]).join(' / ')}`:'管路颜色与端口允许的颜色不兼容',unique);
    for(const n of group)if(n.piece.kind==='machine')portColors[`${n.piece.id}:${n.port.index}`]=color;
    if(!supplies.length&&!outputs.length)addIssue('管路没有供应来源',unique);
    if(!inputs.length&&!sinks.length)addIssue('管路没有通往机器或回收罐',unique);
    if(!inputs.length&&!outputs.length)addIssue('储罐和管道必须服务于机器',unique);
    if(supplies.length&&outputs.length)addIssue('供应罐与机器输出不能合流',unique);
    if(!supplies.length&&capacity<demand)addIssue(`流量不足：产出 ${capacity}，需求 ${demand}（${inputs.map(n=>`${label(n.piece)} ×${n.port.amount}`).join(' + ')}）`,unique);
    if(color==='black'&&sinks.some(n=>n.piece.kind==='collector'))addIssue('黑色产品必须接入黑色回收罐',unique);
    if(outputs.some(o=>inputs.some(i=>i.piece.id===o.piece.id)))addIssue('机器输出不能连接回自身输入',unique);
    for(const output of outputs)for(const input of inputs){
      const id=output.piece.id;
      if(!dependencies.has(id))dependencies.set(id,new Set());
      dependencies.get(id).add(input.piece.id);
    }
    if(outputs.length&&!supplies.length&&compatible&&capacity>=demand)for(const n of inputs)fed.push({id:n.piece.id,index:n.port.index,amount:n.port.amount});
    for(const n of group)if(n.piece.kind==='pipe')pipeColors[n.piece.id]=color;
    networks.push({ids:unique,color,capacity:supplies.length?'∞':capacity,demand});
  }
  // Follow directed machine output -> input dependencies across color networks.
  // Strongly connected components identify every machine in a cycle, without
  // mistaking independent crossings or converging production branches for loops.
  const indices=new Map(),low=new Map(),stack=[],onStack=new Set();let nextIndex=0;
  function visit(id){
    indices.set(id,nextIndex);low.set(id,nextIndex++);stack.push(id);onStack.add(id);
    for(const target of dependencies.get(id)||[]){
      if(!indices.has(target)){visit(target);low.set(id,Math.min(low.get(id),low.get(target)));}
      else if(onStack.has(target))low.set(id,Math.min(low.get(id),indices.get(target)));
    }
    if(low.get(id)===indices.get(id)){
      const cycle=[];let member;
      do{member=stack.pop();onStack.delete(member);cycle.push(member);}while(member!==id);
      if(cycle.length>1){
        cycle.sort((a,b)=>a-b);
        addIssue(`生产链存在循环：${cycle.map(id=>label(state.pieces.find(p=>p.id===id))).join('、')}，输出不能经其他机器回到自身`,cycle);
      }
    }
  }
  for(const id of dependencies.keys())if(!indices.has(id))visit(id);
  const bonus=fed.reduce((s,n)=>s+n.amount*3,0);
  return {valid:!issues.length,issues,bonus,fed,pipeColors,portColors,networks};
}
export function label(p) {return p.kind==='machine'?machine(p.machineId).name:p.kind==='pipe'?'管道':p.kind==='supply'?`${COLOR_NAMES[p.color]}色供应罐`:p.kind==='black'?'黑色回收罐':'白色回收罐';}
export function resetRound(state) {
  if(state.over)throw Error('本局已结束');
  state.pieces=clone(state.baseline);
  state.cost=0;
}
export function settle(state,skip=false) {
  if(state.over)throw Error('本局已结束');
  let revenue=0,cost=0;
  if(skip){state.pieces=clone(state.baseline);} else {
    const current=state.pieces.find(p=>p.kind==='machine'&&p.round===state.round);
    if(!current)throw Error('请先安装本回合机器，或选择跳过');
    const result=validate(state);if(!result.valid)throw Error('还有未通过的连接，请检查诊断面板');
    revenue=machine(current.machineId).revenue;cost=installationCost(state);state.money+=revenue-cost;
  }
  state.history.push({round:state.round,machineId:state.deck[state.round-1],revenue,cost,skip,money:state.money});
  state.baseline=clone(state.pieces);state.cost=0;
  if(state.round===8)state.over=true;else state.round++;
}
export function restore(value) {
  if(!value||value.version!==1||!Array.isArray(value.deck)||value.deck.length!==8||new Set(value.deck).size!==8||value.deck.some(id=>!MACHINES.some(m=>m.id===id)))throw Error('存档牌组无效');
  if(!Number.isInteger(value.round)||value.round<1||value.round>8||!Number.isFinite(value.money)||!Number.isFinite(value.cost)||value.cost<0||!Number.isInteger(value.nextId)||!Array.isArray(value.history)||typeof value.seed!=='string'||typeof value.over!=='boolean')throw Error('存档格式无效');
  if(value.history.length!==(value.over?8:value.round-1)||value.history.some((h,i)=>!h||h.round!==i+1||h.machineId!==value.deck[i]||typeof h.skip!=='boolean'||![h.revenue,h.cost,h.money].every(Number.isFinite)))throw Error('存档账本无效');
  // Older versions used cyan geometry for every skin. Keep those pieces intact.
  if(!value.aLayoutVersion&&(value.boardId||'A')==='A'&&BOARD_SKINS.some(s=>s.id===value.boardSkin)){
    const pieces=[...(value.pieces||[]),...(value.baseline||[])],target=boardCells(value);
    if(pieces.some(p=>!target.has(key(p.q,p.r))))value={...value,boardSkin:'Cian'};
  }
  const boardSet=boardCells(value);
  const series=value.series||(value.boardId?.startsWith('C')?'web':'original');
  if(!progressionOrder(series).includes(value.boardId||'A'))throw Error('存档棋盘与进阶系列不匹配');
  if(value.boardSkin!==undefined&&!BOARD_SKINS.some(s=>s.id===value.boardSkin))throw Error('存档棋盘配色无效');
  if(value.campaign!==undefined&&(!Array.isArray(value.campaign)||value.campaign.length>10000||value.campaign.some(run=>{
    if(!run||!BOARDS.some(b=>b.id===run.boardId)||!Number.isFinite(run.total)||typeof run.seed!=='string')return true;
    const expected=progressionForScore(run.boardId,run.total,run.series);
    return expected.nextBoardId!==run.nextBoardId||expected.action!==run.action||expected.completed!==run.completed;
  })))throw Error('存档进阶记录无效');
  for(const pieces of [value.pieces,value.baseline]){
    if(!Array.isArray(pieces)||pieces.length>130||new Set(pieces.map(p=>p.id)).size!==pieces.length)throw Error('存档组件无效');
    for(const p of pieces){
      if(!['machine','pipe','supply','collector','black'].includes(p.kind)||!Number.isInteger(p.id)||p.id<1||p.id>=value.nextId||!boardSet.has(key(p.q,p.r))||!Number.isInteger(p.rot)||p.rot<0||p.rot>5||!Number.isInteger(p.round)||p.round<1||p.round>value.round)throw Error('存档组件无效');
      if(p.kind==='machine'){
        const def=machine(p.machineId);
        for(const [i,color] of Object.entries(p.choices||{}))if(!def.ports[i]?.colors.includes(color))throw Error('存档端口颜色无效');
      }
      if(p.kind==='pipe'&&!PIPES.some(s=>s.id===p.shape))throw Error('存档管道无效');
      if(p.kind==='supply'&&!['pink','yellow','green','blue'].includes(p.color))throw Error('存档储罐无效');
    }
  }
  const restored=clone(value);
  restored.boardId||='A';restored.boardSkin||='Cian';restored.campaign||=[];
  restored.series=series;restored.aLayoutVersion=1;
  restored.cost=restored.over?0:installationCost(restored);
  return restored;
}
