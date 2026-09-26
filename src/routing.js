import {PIPES,ROWS} from './data.js';
import {playableBoard} from './boards.js';
import {center,neighbor,key,mod,clone,ports,pipeEdges,place,placementError,installationCost} from './engine.js';

export function edgeBetween(a,b){
  for(let e=0;e<6;e++){const [q,r]=neighbor(a.q,a.r,e);if(q===b.q&&r===b.r)return e;}
  throw Error('划线必须经过相邻的六边形');
}
// Clip each pointer segment against the six shared hex boundaries. This also
// captures cells crossed between pointer events during fast strokes.
function clipHex(a,b,q,r){
  const [x,y]=center(q,r);let lo=0,hi=1;
  for(let e=0;e<6;e++){
    const [nq,nr]=neighbor(q,r,e),[nx,ny]=center(nq,nr),dx=nx-x,dy=ny-y;
    const limit=(dx*dx+dy*dy)/2,start=(a.x-x)*dx+(a.y-y)*dy,delta=(b.x-a.x)*dx+(b.y-a.y)*dy;
    if(Math.abs(delta)<1e-8){if(start>limit+1e-7)return null;continue;}
    const t=(limit-start)/delta;
    if(delta>0)hi=Math.min(hi,t);else lo=Math.max(lo,t);
    if(lo>hi)return null;
  }
  return hi-lo>1e-7?{q,r,lo,hi}:null;
}
export function tracePipeStroke(state,points){
  const allowed=new Set(playableBoard(state.boardId).cells),path=[];
  const append=cell=>{
    if(!allowed.has(key(cell.q,cell.r)))throw Error('划线经过墙壁或障碍，请绕开');
    const last=path.at(-1);if(last&&last.q===cell.q&&last.r===cell.r)return;
    const previous=path.at(-2);
    if(previous&&previous.q===cell.q&&previous.r===cell.r){path.pop();return;}
    if(path.some(p=>p.q===cell.q&&p.r===cell.r))throw Error('一条划线不能重复绕回同一格，请分段铺管');
    if(last)edgeBetween(last,cell);
    path.push({q:cell.q,r:cell.r});
  };
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];if(Math.hypot(a.x-b.x,a.y-b.y)<1e-6)continue;
    const hits=ROWS.flatMap((count,r)=>Array.from({length:count},(_,q)=>clipHex(a,b,q,r))).filter(Boolean).sort((a,b)=>a.lo-b.lo||b.hi-a.hi);
    let covered=0;
    for(const hit of hits){
      if(hit.lo>covered+1e-5)throw Error('划线超出棋盘，请在格子内铺管');
      if(hit.hi<=covered+1e-7)continue;
      append(hit);covered=Math.max(covered,hit.hi);
    }
    if(covered<1-1e-5)throw Error('划线超出棋盘，请在格子内铺管');
  }
  return path;
}
function pipeSpec(edges){
  const signature=[...edges].sort().join();
  for(const shape of PIPES)for(let rot=0;rot<6;rot++)for(const flip of [false,true]){
    if(shape.edges.map(e=>mod((flip?-e:e)+rot)).sort().join()===signature)return {kind:'pipe',shape:shape.id,rot,flip};
  }
  throw Error('这些边无法组合成管道');
}
export function planPipePath(state,path){
  if(state.over)throw Error('本局已结束');
  if(path.length<2)throw Error('按住右键划过至少两个格子');
  if(new Set(path.map(p=>key(p.q,p.r))).size!==path.length)throw Error('一条划线不能重复绕回同一格');
  const draft=clone(state),ids=[];
  for(let i=0;i<path.length;i++){
    const cell=path[i];if(!playableBoard(state.boardId).cells.includes(key(cell.q,cell.r)))throw Error('划线经过墙壁或障碍，请绕开');
    const edges=[];
    if(i)edges.push(edgeBetween(cell,path[i-1]));
    if(i+1<path.length)edges.push(edgeBetween(cell,path[i+1]));
    const occupants=draft.pieces.filter(p=>p.q===cell.q&&p.r===cell.r);
    const fixed=occupants.find(p=>p.kind!=='pipe');
    if(fixed){
      if(edges.length!==1)throw Error('划线不能穿过机器或储罐内部');
      if(!ports(fixed).some(p=>p.edge===edges[0]))throw Error('划线没有对准机器或储罐的接口');
      continue;
    }
    const touched=occupants.filter(p=>pipeEdges(p).some(e=>edges.includes(e)));
    if(touched.length>1)throw Error('划线不能把同格独立管道合并，请改走空闲边');
    if(touched.length){
      const p=touched[0],merged=[...new Set([...pipeEdges(p),...edges])];
      const candidate={...p,...pipeSpec(merged)},error=placementError(draft,candidate,p.id);
      if(error)throw Error(error);Object.assign(p,candidate);ids.push(p.id);
    }else{
      if(edges.length===1)edges.push(mod(edges[0]+3));
      const spec=pipeSpec(edges),p=place(draft,spec,cell.q,cell.r,spec.rot,spec.flip);ids.push(p.id);
    }
  }
  draft.cost=installationCost(draft);
  return {pieces:draft.pieces,cost:draft.cost,nextId:draft.nextId,ids};
}
export function layPipePath(state,path){
  const plan=planPipePath(state,path);
  Object.assign(state,{pieces:plan.pieces,cost:plan.cost,nextId:plan.nextId});
  return plan.ids;
}
