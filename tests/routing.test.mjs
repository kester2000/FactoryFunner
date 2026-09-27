import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,place,pipeEdges,clone,center,validate,machine} from '../src/engine.js';
import {PIPES} from '../src/data.js';
import {tracePipeStroke,planPipePath,layPipePath} from '../src/routing.js';
const cell=(q,r)=>({q,r});
const point=(q,r)=>{const [x,y]=center(q,r);return {x,y};};
const addPipe=(s,q,r,edges)=>{
 for(const shape of PIPES)for(let rot=0;rot<6;rot++)for(const flip of [false,true]){
  const spec={kind:'pipe',shape:shape.id,rot,flip};
  if(pipeEdges(spec).sort().join()===[...edges].sort().join())return place(s,spec,q,r,rot,flip);
 }
 throw Error('No matching pipe');
};
test('played Boilnado network supplies Mondrianator 2 plus Cwalichecker 1, not 4',()=>{
 const s=newGame('blue-demand');s.deck=[3,26,7,1,2,4,5,6];
 place(s,{kind:'machine'},3,1,2);s.round=2;place(s,{kind:'machine'},4,0,5);
 s.round=3;place(s,{kind:'machine'},4,2,4);
 place(s,{kind:'supply',color:'green'},3,0);place(s,{kind:'supply',color:'yellow'},5,1);
 place(s,{kind:'black'},5,0,3);place(s,{kind:'black'},5,3,4);
 addPipe(s,2,0,[0,2]);addPipe(s,2,1,[0,5]);
 addPipe(s,4,1,[2,3,5]);addPipe(s,4,1,[1,4]);addPipe(s,3,2,[0,5]);
 const result=validate(s);assert.equal(result.valid,true,JSON.stringify(result.issues));
 const blue=result.networks.find(n=>n.color==='blue');assert.equal(blue.capacity,3);assert.equal(blue.demand,3);
 assert.equal(result.bonus,9);assert.equal(machine(26).ports.find(p=>p.color==='blue'||p.colors.includes('blue')).amount,2);
 assert.deepEqual(result.fed.map(f=>[s.pieces.find(p=>p.id===f.id).machineId,f.amount,f.amount*3]),[[26,2,6],[7,1,3]],'each split destination earns its own bonus');
 s.pieces.find(p=>p.machineId===3).machineId=35;
 assert(validate(s).issues.some(i=>i.message.includes('Mondrianator ×2 + Cwalichecker ×1')));
});
test('fast horizontal strokes capture every crossed hex and backtracking removes the tail',()=>{
 const s=newGame();
 assert.deepEqual(tracePipeStroke(s,[point(0,0),point(5,0)]),Array.from({length:6},(_,q)=>cell(q,0)));
 assert.deepEqual(tracePipeStroke(s,[point(0,0),point(3,0),point(2,0)]),[cell(0,0),cell(1,0),cell(2,0)]);
 assert.deepEqual(tracePipeStroke(s,[point(3,0),point(0,0)]),[cell(3,0),cell(2,0),cell(1,0),cell(0,0)]);
});
test('turning strokes choose the entry and exit edges; previews never mutate state',()=>{
 const s=newGame(),before=clone(s);
 const path=tracePipeStroke(s,[point(0,0),point(1,0),point(2,1),point(2,2)]);
 assert.deepEqual(path,[cell(0,0),cell(1,0),cell(2,1),cell(2,2)]);
 const plan=planPipePath(s,path);assert.deepEqual(s,before);assert.equal(plan.cost,4);
 const ids=layPipePath(s,path);assert.equal(ids.length,4);
 assert.deepEqual(pipeEdges(s.pieces[1]).sort(),[1,3]);
 assert.deepEqual(pipeEdges(s.pieces[2]).sort(),[1,4]);
});
test('endpoints connect to machine ports and supply without replacing them',()=>{
 const s=newGame('line',true);const m=place(s,{kind:'machine'},2,3);
 const tank=place(s,{kind:'supply',color:'green'},0,2);
 const ids=layPipePath(s,[cell(0,2),cell(1,2),cell(2,3)]);
 assert.equal(ids.length,1);assert.equal(s.pieces.length,3);
 assert.equal(s.pieces.find(p=>p.id===m.id).machineId,41);
 assert.equal(s.pieces.find(p=>p.id===tank.id).kind,'supply');
 assert.deepEqual(pipeEdges(s.pieces.at(-1)).sort(),[1,3]);
});
test('crossings stay independent, touched pipes upgrade and existing routes are reused',()=>{
 const s=newGame();const cross=addPipe(s,1,0,[1,4]);
 const path=[cell(0,0),cell(1,0),cell(2,0)];layPipePath(s,path);
 assert.equal(s.pieces.filter(p=>p.q===1&&p.r===0).length,2);
 assert.deepEqual(pipeEdges(s.pieces.find(p=>p.id===cross.id)).sort(),[1,4]);
 const count=s.pieces.length,cost=s.cost;layPipePath(s,path);assert.equal(s.pieces.length,count);assert.equal(s.cost,cost);
 const t=newGame();const original=addPipe(t,1,1,[0,3]);
 layPipePath(t,[cell(0,1),cell(1,1),cell(1,0)]);
 assert.deepEqual(pipeEdges(t.pieces.find(p=>p.id===original.id)).sort(),[0,3,5]);
});
test('invalid strokes reject atomically: walls, machines, wrong ports and layer merging',()=>{
 const s=newGame('invalid',true);place(s,{kind:'machine'},2,3);
 const before=clone(s);
 for(const path of [[cell(2,3),cell(3,3)],[cell(1,3),cell(2,3),cell(3,2)],[cell(2,3),cell(3,2)]]){
  assert.throws(()=>layPipePath(s,path));assert.deepEqual(s,before);
 }
 assert.throws(()=>tracePipeStroke(s,[point(2,3),point(4,3)]),/墙壁/);
 assert.throws(()=>tracePipeStroke(s,[point(0,0),{x:-100,y:-100}]),/超出棋盘/);
 const t=newGame();addPipe(t,2,2,[0,3]);addPipe(t,2,2,[1,4]);const old=clone(t);
 assert.throws(()=>layPipePath(t,[cell(1,2),cell(2,2),cell(2,1)]));assert.deepEqual(t,old);
});
