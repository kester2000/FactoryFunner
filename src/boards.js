import {BOARD,BOARD_IMAGE,ROWS} from './data.js';

export const BOARD_ORDER=['A','B1','B2','B3','B4','B5','B6'];
export const WEB_BOARD_ORDER=['A','C1','C2','C3','C4','C5','C6'];
const grid=ROWS.flatMap((count,r)=>Array.from({length:count},(_,q)=>`${q},${r}`));
const webObstacles=['3,3','1,2','5,4','4,1','2,5','1,4','5,2','2,3','4,3','2,1','4,5','4,2','2,4'];
const webNames=['双柱车间','错位车间','分区车间','窄巷车间','曲折车间','密集车间'];
const aGrid=[6,7,6,7,6,7,6].flatMap((n,r)=>Array.from({length:n},(_,q)=>`${q},${r}`));
const aWalls={Cian:['3,6','4,6','5,6'],Green:['5,0','6,1','6,5'],Red:['6,1','6,3','6,5'],Violet:['5,0','6,1','0,6'],White:['0,0','0,1','6,5'],Yellow:['4,0','5,0','6,1']};
export const BOARD_SKINS=[
  ['Cian','青色'],['Green','绿色'],['Red','红色'],
  ['Violet','紫色'],['White','白色'],['Yellow','黄色'],
].map(([id,name])=>({id,name,image:`assets/game/Boar_Factory_Funner_pBoard_A_${id}_a0s0.png`}));
// B-side geometry must be transcribed from original boards before enabling it.
// Never substitute the A board or invent obstacles for an unavailable level.
export const BOARDS=[
  {id:'A',name:'工厂 A',cells:BOARD,image:BOARD_IMAGE,width:965,height:880,available:true},
  ...BOARD_ORDER.slice(1).map(id=>({id,name:`工厂 ${id}`,cells:[],image:null,available:false})),
  ...WEB_BOARD_ORDER.slice(1).map((id,i)=>{
    const blocked=webObstacles.slice(0,3+i*2);
    return {id,name:webNames[i],cells:grid.filter(k=>!blocked.includes(k)),grid,blocked,image:null,width:965,height:880,available:true,custom:true};
  }),
];
export function boardDefinition(id='A'){
  const board=BOARDS.find(b=>b.id===id);
  if(!board)throw Error('未知工厂棋盘');
  return board;
}
export function playableBoard(id='A',skin='Cian'){
  const board=boardDefinition(id);
  if(!board.available)throw Error(`${id} 原版棋盘素材尚未接入`);
  if(id==='A'){
    if(!aWalls[skin])throw Error('未知 A 面');
    const blocked=['3,3',...aWalls[skin]];
    return {...board,name:BOARD_SKINS.find(s=>s.id===skin).name+' A 面',grid:aGrid,blocked,cells:aGrid.filter(k=>!blocked.includes(k))};
  }
  return board;
}
export function boardImage(state){
  const board=playableBoard(state.boardId);
  return board.id==='A'?(BOARD_SKINS.find(s=>s.id===state.boardSkin)?.image||board.image):board.image;
}
export function boardGridCells(id='A',skin='Cian'){
  const board=playableBoard(id,skin);
  return board.grid||ROWS.flatMap((count,r)=>Array.from({length:count},(_,q)=>`${q},${r}`));
}
export function progressionOrder(series='original'){
  if(!['original','web'].includes(series))throw Error('未知进阶系列');
  return series==='web'?WEB_BOARD_ORDER:BOARD_ORDER;
}
export function progressionForScore(boardId,total,series=boardId.startsWith('C')?'web':'original'){
  boardDefinition(boardId);
  if(!Number.isFinite(total))throw Error('成绩无效');
  const order=progressionOrder(series),level=order.indexOf(boardId);
  if(level<0)throw Error('棋盘与进阶系列不匹配');
  const nextLevel=Math.max(0,Math.min(order.length-1,level+(total>=50?1:total<=45?-1:0)));
  const completed=level===order.length-1&&total>=50;
  return {boardId,total,nextBoardId:order[nextLevel],completed,series,
    action:completed?'complete':nextLevel>level?'promote':nextLevel<level?'demote':'stay'};
}
