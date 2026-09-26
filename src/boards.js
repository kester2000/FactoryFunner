import {BOARD,BOARD_IMAGE} from './data.js';

export const BOARD_ORDER=['A','B1','B2','B3','B4','B5','B6'];
export const BOARD_SKINS=[
  ['Cian','青色'],['Green','绿色'],['Red','红色'],
  ['Violet','紫色'],['White','白色'],['Yellow','黄色'],
].map(([id,name])=>({id,name,image:`assets/game/Boar_Factory_Funner_pBoard_A_${id}_a0s0.png`}));
// B-side geometry must be transcribed from original boards before enabling it.
// Never substitute the A board or invent obstacles for an unavailable level.
export const BOARDS=[
  {id:'A',name:'工厂 A',cells:BOARD,image:BOARD_IMAGE,width:965,height:880,available:true},
  ...BOARD_ORDER.slice(1).map(id=>({id,name:`工厂 ${id}`,cells:[],image:null,available:false})),
];
export function boardDefinition(id='A'){
  const board=BOARDS.find(b=>b.id===id);
  if(!board)throw Error('未知工厂棋盘');
  return board;
}
export function playableBoard(id='A'){
  const board=boardDefinition(id);
  if(!board.available)throw Error(`${id} 原版棋盘素材尚未接入`);
  return board;
}
export function boardImage(state){
  const board=playableBoard(state.boardId);
  return board.id==='A'?(BOARD_SKINS.find(s=>s.id===state.boardSkin)?.image||board.image):board.image;
}
export function progressionForScore(boardId,total){
  boardDefinition(boardId);
  if(!Number.isFinite(total))throw Error('成绩无效');
  const level=BOARD_ORDER.indexOf(boardId);
  const nextLevel=Math.max(0,Math.min(BOARD_ORDER.length-1,level+(total>=50?1:total<=45?-1:0)));
  const completed=level===BOARD_ORDER.length-1&&total>=50;
  return {boardId,total,nextBoardId:BOARD_ORDER[nextLevel],completed,
    action:completed?'complete':nextLevel>level?'promote':nextLevel<level?'demote':'stay'};
}
