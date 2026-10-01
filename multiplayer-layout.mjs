import {clone, place, settle} from './src/engine.js';
import {PIPES} from './src/data.js';
const fail=message=>{throw Error(message);};

// Rebuild using trusted history and the same placement/settlement engine as solo.
// Client money, deck, costs, machine identities and historical positions are never trusted.
export function submitLayout(base, pieces, skip, preview = false) {
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
  if(!preview) settle(state);
  return state;
}

