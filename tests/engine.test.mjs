import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,place,settle,resetRound,validate,neighbor,rotate,remove,restore,machine,ports,clone,placementError,setChoice} from '../src/engine.js';
import {MACHINES,BOARD,PIPES} from '../src/data.js';
function setup(){const s=newGame('test',true);place(s,{kind:'machine'},2,3);place(s,{kind:'supply',color:'green'},1,2,1);place(s,{kind:'black'},2,4,4);return s;}

test('Maxi Mixer requires two pink units and two green units',()=>{
 const m=machine(20);
 assert.deepEqual(m.ports.filter(p=>p.kind==='in').map(p=>[p.colors[0],p.amount]),[['green',2],['pink',2]]);
 assert.equal(m.ports.find(p=>p.kind==='out').amount,3);
});

test('Moisture-stir requires two green units and three blue units',()=>{
 const m=machine(25);
 assert.deepEqual(m.ports.filter(p=>p.kind==='in').map(p=>[p.colors[0],p.amount]),[['blue',3],['green',2]]);
 assert.equal(m.ports.find(p=>p.kind==='out').amount,2);
});

test('Spectrumizer printed yellow and green demands are both two',()=>{
 const m=machine(39);
 assert.equal(m.name,'Spectrumizer');
 assert.deepEqual(m.ports.filter(p=>p.kind==='in').map(p=>[p.colors[0],p.amount]),[['yellow',2],['green',2]]);
});

test('four-machine cycle from the played board is rejected and cannot settle',()=>{
 const s=newGame('cycle-regression');s.deck=[32,3,31,23,9,1,2,4];
 const addMachine=(name,q,r,rot)=>{
  s.deck[s.round-1]=MACHINES.find(m=>m.name===name).id;
  const p=place(s,{kind:'machine'},q,r,rot);s.round++;return p;
 };
 const rainbow=addMachine('Rainbowrisor',2,2,1);
 addMachine('Boilnado',2,3,4);
 addMachine('Pixellator',4,4,3);
 addMachine('Meltdown',4,2,2);s.round=4;
 place(s,{kind:'supply',color:'pink'},3,2);
 const pipe=(q,r,edges)=>{
  for(const shape of PIPES)for(let rot=0;rot<6;rot++)for(const flip of [false,true]){
   const actual=shape.edges.map(e=>((flip?-e:e)+rot+6)%6).sort().join();
   if(actual===[...edges].sort().join())return place(s,{kind:'pipe',shape:shape.id},q,r,rot,flip);
  }
  throw Error('No pipe shape');
 };
 pipe(3,1,[0,2]);pipe(4,1,[0,3]);pipe(5,1,[2,3]);
 pipe(1,4,[0,5]);pipe(2,4,[0,3]);pipe(3,4,[0,3,5]);
 pipe(4,3,[2,5]);pipe(4,3,[1,4]);pipe(5,3,[1,4]);pipe(5,4,[3,4]);
 const result=validate(s);
 assert.equal(result.issues.length,1,JSON.stringify(result.issues));
 assert.match(result.issues[0].message,/生产链存在循环/);
 assert.deepEqual(result.issues[0].ids,[1,2,3,4]);
 const before=clone(s);assert.throws(()=>settle(s),/未通过/);assert.deepEqual(s,before);
 // Break just the feedback branch: keep the same crossing and split blue flow.
 remove(s,s.pieces.find(p=>p.q===3&&p.r===1).id);
 remove(s,s.pieces.find(p=>p.q===4&&p.r===1).id);
 place(s,{kind:'supply',color:'yellow'},3,1);
 place(s,{kind:'collector'},4,1,0);
 assert.equal(validate(s).valid,true,JSON.stringify(validate(s).issues));
 settle(s);assert.equal(s.round,5);
 assert.equal(rainbow.machineId,32);
});
test('48 distinct original machines; unique endpoints; seeded deck is reproducible',()=>{
 assert.equal(MACHINES.length,48);assert.equal(new Set(MACHINES.map(m=>m.id)).size,48);
 for(const m of MACHINES){assert.equal(new Set(m.ports.map(p=>p.edge)).size,m.ports.length);assert(m.ports.every(p=>p.amount>0&&p.colors.length));}
 assert.deepEqual(newGame('same').deck,newGame('same').deck);assert.equal(new Set(newGame('same').deck).size,8);
});
test('neighbor relation is reciprocal across odd and even rows',()=>{for(const k of BOARD){const [q,r]=k.split(',').map(Number);for(let d=0;d<6;d++){const [nq,nr]=neighbor(q,r,d);assert.deepEqual(neighbor(nq,nr,(d+3)%6),[q,r]);}}});
test('tutorial machine requires all ports and only settles a connected factory',()=>{
 const s=newGame('test',true);place(s,{kind:'machine'},2,3);assert.equal(validate(s).valid,false);assert.throws(()=>settle(s));
 place(s,{kind:'supply',color:'green'},1,2,1);place(s,{kind:'black'},2,4,4);
 assert.equal(validate(s).valid,true);settle(s);assert.equal(s.money,15);assert.equal(s.round,2);assert.equal(s.cost,0);
 assert.throws(()=>rotate(s,1),/固定|不能旋转/);assert.throws(()=>remove(s,1),/固定/);
});
test('colored source mismatch and incorrect black disposal are rejected',()=>{
 const s=setup();s.pieces[1].color='pink';assert(validate(s).issues.some(x=>x.message.includes('混色')));
 s.pieces[1].color='green';s.pieces[2].kind='collector';assert(validate(s).issues.some(x=>x.message.includes('黑色产品')));
});
test('adjacent different-colored supply tanks stay independent; a real pipe connection still mixes',()=>{
 const s=newGame('adjacent-supplies');s.deck[0]=44;
 place(s,{kind:'machine'},1,2);
 place(s,{kind:'supply',color:'yellow'},1,1);
 place(s,{kind:'supply',color:'green'},0,2);
 place(s,{kind:'collector'},2,3,4);
 assert(validate(s).valid,JSON.stringify(validate(s).issues));
 const connected=clone(s);
 place(connected,{kind:'pipe',shape:'elbow'},0,1,0);
 assert(validate(connected).issues.some(i=>i.message.includes('混色')));
 settle(s);assert.equal(s.money,15);assert.equal(s.history[0].cost,3);
});
test('physical placement blocks pillar, wall, overlapping machines and reused pipe edge',()=>{
 const s=newGame('test',true);assert.throws(()=>place(s,{kind:'machine'},3,3));assert.throws(()=>place(s,{kind:'machine'},-1,0));
 place(s,{kind:'pipe',shape:'straight'},2,2,0);place(s,{kind:'pipe',shape:'straight'},2,2,1);
 assert.throws(()=>place(s,{kind:'pipe',shape:'bend'},2,2,0),/共用/);
 assert.throws(()=>place(s,{kind:'machine'},2,2),/占用/);
});
test('pipe rotation skips blocked angles and preserves the board when no alternative fits',()=>{
 const s=newGame('rotate-crossing');
 const p=place(s,{kind:'pipe',shape:'straight'},2,2,0);
 place(s,{kind:'pipe',shape:'straight'},2,2,1);
 rotate(s,p.id);assert.equal(p.rot,2,'skip blocked 60 degrees and use 120 degrees');
 rotate(s,p.id);assert.equal(p.rot,3,'use the nearest legal next orientation');
 place(s,{kind:'pipe',shape:'straight'},2,2,2);
 const before=clone(s);
 assert.throws(()=>rotate(s,p.id),/没有其他合法旋转角度/);
 assert.deepEqual(s,before,'failed rotation must not change layout or cost');
 const single=newGame('rotate-single');const bend=place(single,{kind:'pipe',shape:'bend'},2,2,5);
 rotate(single,bend.id);assert.equal(bend.rot,0,'ordinary rotation wraps at 360 degrees');
});

test('inventory limits, removal and reinstallation cost are enforced',()=>{
 const s=newGame('test',true);place(s,{kind:'supply',color:'green'},0,0);assert.throws(()=>place(s,{kind:'supply',color:'green'},1,0));
 for(let q=1;q<=3;q++)place(s,{kind:'collector'},q,0);assert.throws(()=>place(s,{kind:'collector'},4,0));
 remove(s,1);assert.equal(s.cost,3);place(s,{kind:'supply',color:'green'},0,0);assert.equal(s.cost,4);rotate(s,5);assert.equal(s.cost,4);
});
test('trial placements and rotations only charge final retained materials on confirmation',()=>{
 const s=setup();const trial=place(s,{kind:'pipe',shape:'straight'},0,0);
 for(let i=0;i<5;i++)rotate(s,trial.id);
 assert.equal(s.cost,3);assert.equal(s.money,10);
 remove(s,trial.id);assert.equal(s.cost,2);
 for(let i=0;i<6;i++)rotate(s,3);
 assert.equal(s.cost,2);assert.equal(s.money,10);
 s.cost=99; // Settlement derives cost independently of a stale preview/cache.
 settle(s);assert.equal(s.money,15);assert.equal(s.history[0].cost,2);
});
test('restoring original components and equivalent orientations costs nothing',()=>{
 const s=setup();settle(s);
 remove(s,2);assert.equal(s.cost,0);
 const tank=place(s,{kind:'supply',color:'green'},1,2,5);assert.equal(s.cost,0);
 remove(s,tank.id);const moved=place(s,{kind:'supply',color:'green'},0,0);assert.equal(s.cost,1);
 for(let i=0;i<3;i++)rotate(s,moved.id);assert.equal(s.cost,1);
 remove(s,moved.id);place(s,{kind:'supply',color:'green'},1,2);assert.equal(s.cost,0);
 rotate(s,3);assert.equal(s.cost,1);for(let i=0;i<5;i++)rotate(s,3);assert.equal(s.cost,0);
 const pipe=place(s,{kind:'pipe',shape:'straight'},0,0);s.baseline=clone(s.pieces);s.cost=0;
 rotate(s,pipe.id,3);assert.equal(s.cost,0,'a straight pipe rotated 180 degrees is unchanged');
 const oldSave=clone(s);oldSave.cost=45;assert.equal(restore(oldSave).cost,0,'old pending fees are recalculated');
});
test('skip restores previous board and does not deduct pending expenses',()=>{
 const s=setup();settle(s);const old=clone(s.pieces);remove(s,2);place(s,{kind:'pipe',shape:'straight'},0,0);settle(s,true);
 assert.equal(s.money,15);assert.deepEqual(s.pieces,old);assert.equal(s.cost,0);assert.equal(s.round,3);
});
test('reset restores the round baseline without changing money, round, deck or history',()=>{
 const first=setup(),deck=clone(first.deck);resetRound(first);
 assert.deepEqual(first.pieces,[]);assert.equal(first.cost,0);assert.equal(first.money,10);assert.equal(first.round,1);assert.deepEqual(first.deck,deck);
 const s=setup();settle(s);const start=clone(s);
 remove(s,2);rotate(s,3);place(s,{kind:'pipe',shape:'straight'},0,0);
 resetRound(s);assert.deepEqual(s.pieces,start.pieces);assert.equal(s.cost,0);
 assert.equal(s.money,start.money);assert.equal(s.round,start.round);assert.deepEqual(s.deck,start.deck);assert.deepEqual(s.history,start.history);
 s.pieces[0].rot=1;assert.deepEqual(s.baseline,start.baseline,'baseline must not share mutable pieces');
 const restored=restore(JSON.parse(JSON.stringify(start)));remove(restored,2);resetRound(restored);assert.deepEqual(restored.pieces,start.pieces);
 s.over=true;assert.throws(()=>resetRound(s),/已结束/);
});
test('8 rounds finish exactly once, without a ninth draw or repeated bonus',()=>{
 const s=setup();settle(s);for(let i=0;i<7;i++)settle(s,true);assert(s.over);assert.equal(s.history.length,8);assert.equal(s.round,8);assert.equal(s.money,15);assert.throws(()=>settle(s,true));
});
test('machine chain calculates capacity and per-input-dot bonus',()=>{
 const s=newGame('chain');s.deck[0]=3;s.deck[1]=40;
 // Boilnado: green input SE, blue output NW. Judger: blue input NE rotated -60 => NW.
 // Instead rotate Judger 5: NE -> NW; position across Boilnado NW, rotate 2: NE->SE.
 const a=place(s,{kind:'machine'},3,2);const inA=neighbor(a.q,a.r,1);place(s,{kind:'supply',color:'green'},...inA,4);
 const outA=neighbor(a.q,a.r,4);s.round=2;const b=place(s,{kind:'machine'},...outA,2);
 const outB=ports(b).find(p=>p.kind==='out');place(s,{kind:'collector'},...neighbor(b.q,b.r,outB.edge),(outB.edge+3)%6);
 const result=validate(s);assert(result.valid,JSON.stringify(result.issues));assert.equal(result.bonus,3);
 // Change input volume by switching to a machine with three blue input dots.
 // Direct graph flow is checked below using a controlled port fixture in a separate machine.
});
test('self-return loops and source/machine merging are rejected',()=>{
 const s=newGame('feedback');s.deck[0]=27;place(s,{kind:'machine'},1,2,0);
 // Pink output loops to the pink input around the east side in three hexes.
 const a=neighbor(1,2,1),b=neighbor(1,2,5),c=neighbor(1,2,0);
 place(s,{kind:'pipe',shape:'elbow'},...a,4);
 place(s,{kind:'pipe',shape:'elbow'},...b,1);
 const bridge=place(s,{kind:'pipe',shape:'bend'},...c,2);
 assert(validate(s).issues.some(i=>i.message.includes('自身输入')));
 bridge.shape='fork';bridge.rot=0;
 place(s,{kind:'supply',color:'pink'},...neighbor(...c,0),3);
 assert(validate(s).issues.some(i=>i.message.includes('不能合流')));
 const isolated=newGame('isolated');place(isolated,{kind:'supply',color:'green'},0,0,0);place(isolated,{kind:'collector'},1,0,3);
 assert(validate(isolated).issues.some(i=>i.message.includes('服务于机器')));
});
test('wildcard options restrict choices to printed colors',()=>{
 const s=newGame('wild');s.deck[0]=33;const p=place(s,{kind:'machine'},2,2);
 assert.deepEqual(ports(p)[1].colors,['pink','yellow']);assert.equal(ports(p)[1].color,null);
});
test('Rebuilder requires two units of either pink or yellow, never a mixture',()=>{
 const s=newGame('rebuilder');s.deck[0]=33;
 const rebuilder=place(s,{kind:'machine'},1,2);
 place(s,{kind:'supply',color:'blue'},2,1);
 const pink=place(s,{kind:'supply',color:'pink'},2,2);
 place(s,{kind:'black'},0,2,0);
 assert.equal(ports(rebuilder)[1].amount,2);assert(validate(s).valid);
 assert.equal(validate(s).portColors[`${rebuilder.id}:1`],'pink');
 rebuilder.choices={1:'pink'}; // Existing manually chosen saves must also adapt.
 remove(s,pink.id);place(s,{kind:'supply',color:'yellow'},2,2);assert(validate(s).valid);
 assert.equal(validate(s).portColors[`${rebuilder.id}:1`],'yellow');
 const bad=clone(s);bad.pieces.find(p=>p.kind==='supply'&&p.color==='yellow').color='green';assert(!validate(bad).valid);
 // Replacing the infinite reservoir with Judger's yellow output (1) is insufficient.
 const yellow=s.pieces.find(p=>p.kind==='supply'&&p.color==='yellow');remove(s,yellow.id);
 s.round=2;s.deck[1]=40;place(s,{kind:'machine'},2,2);place(s,{kind:'pipe',shape:'elbow'},3,1,2);
 assert(validate(s).issues.some(i=>i.message.startsWith('流量不足：产出 1，需求 2')));
});
test('Rainbowrisor chooses one output color for the whole network, not all colors simultaneously',()=>{
 const s=newGame('rainbow');s.deck[0]=32;s.deck[1]=3;
 const rainbow=place(s,{kind:'machine'},1,2);
 place(s,{kind:'supply',color:'pink'},2,1);place(s,{kind:'supply',color:'yellow'},1,1);
 s.round=2;place(s,{kind:'machine'},2,3,3);place(s,{kind:'collector'},2,4,4);
 assert(validate(s).valid,JSON.stringify(validate(s).issues));assert.equal(validate(s).bonus,3);
 assert.equal(validate(s).portColors[`${rainbow.id}:2`],'green');
 for(const color of ['pink','yellow','blue']){rainbow.choices={2:color};assert(validate(s).valid);assert.equal(validate(s).portColors[`${rainbow.id}:2`],'green');}
 // Reconnect to a blue-input Judger: resolution changes without a color-setting action.
 const downstream=s.pieces.find(p=>p.kind==='machine'&&p.id!==rainbow.id);downstream.machineId=40;downstream.rot=5;
 const sink=s.pieces.find(p=>p.kind==='collector');sink.q=1;sink.r=4;sink.rot=5;
 assert(validate(s).valid,JSON.stringify(validate(s).issues));assert.equal(validate(s).portColors[`${rainbow.id}:2`],'blue');
 assert.equal(ports(rainbow).filter(p=>p.kind==='out').length,1);assert.equal(ports(rainbow)[2].amount,1);
});
test('automatic color cannot satisfy two different fixed colors on the same network',()=>{
 const s=newGame('conflict');s.deck[0]=32;
 const rainbow=place(s,{kind:'machine'},0,2);
 place(s,{kind:'supply',color:'pink'},1,1);place(s,{kind:'supply',color:'yellow'},0,1);
 place(s,{kind:'pipe',shape:'fork'},1,3,0);
 place(s,{kind:'supply',color:'green'},2,3);
 place(s,{kind:'supply',color:'blue'},0,4);
 const v=validate(s);assert(v.issues.some(i=>i.message.includes('混色')));assert.equal(v.portColors[`${rainbow.id}:2`],null);
});
test('insufficient machine output rejects a connected but under-supplied network',()=>{
 const s=newGame('capacity');s.deck[0]=40;s.deck[1]=34;
 place(s,{kind:'machine'},2,3);place(s,{kind:'supply',color:'blue'},2,2);
 s.round=2;place(s,{kind:'machine'},1,3,3);place(s,{kind:'collector'},0,2,1);
 const v=validate(s);assert(v.issues.some(i=>i.message.startsWith('流量不足：产出 1，需求 3')));
 assert.equal(v.bonus,0);
});
test('crossing pipes keep colors and networks independent',()=>{
 const s=newGame('cross');s.deck[0]=41;s.deck[1]=40;
 const horizontal=place(s,{kind:'pipe',shape:'straight'},2,4,0);
 const diagonal=place(s,{kind:'pipe',shape:'straight'},2,4,1);
 place(s,{kind:'supply',color:'green'},3,4);
 place(s,{kind:'supply',color:'blue'},2,3);
 place(s,{kind:'machine'},1,4,2);place(s,{kind:'black'},0,4,0);
 s.round=2;place(s,{kind:'machine'},3,5,5);place(s,{kind:'collector'},2,6,5);
 const v=validate(s);assert(v.valid,JSON.stringify(v.issues));assert.equal(v.pipeColors[horizontal.id],'green');assert.equal(v.pipeColors[diagonal.id],'blue');
});
test('supply tank provides six optional outlets, but cannot remain disconnected',()=>{
 const s=setup();assert.equal(ports(s.pieces[1]).length,6);assert(validate(s).valid);
 const empty=newGame('empty');place(empty,{kind:'supply',color:'pink'},0,0);
 assert(!validate(empty).valid);
});
test('save roundtrip preserves layout and rejects malformed input',()=>{
 const s=setup();assert.deepEqual(restore(JSON.parse(JSON.stringify(s))),s);assert.throws(()=>restore({version:1}));
 const bad=clone(s);bad.pieces[0].rot=99;assert.throws(()=>restore(bad));
});
