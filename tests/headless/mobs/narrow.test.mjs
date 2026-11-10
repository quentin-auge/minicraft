// Repeated closed-trench returns through the production group/tick/backstop.
import assert from 'node:assert/strict';
import { STONE } from '../../../src/core/blocks.js';
import { resetWorld, setDimension, setBlock } from '../../../src/core/store.js';
import { LIVESTOCK_SPECS, specCircles } from '../../../src/mobs/livestock.js';
import { FARM_WALK, tickFarmMob, separateFarmMobs, worstPairPen, SERVO_TURN, WALL_ALLOW, peerStepOk, makeTurnGate } from '../../../src/mobs/mover.js';
import { planGroup } from '../../../src/mobs/forecast.js';
import { buildMobGrid } from '../../../src/mobs/grid.js';
import { aabbIntersectsSolid, NO_EXPIRY, TURN_RATE } from '../../../src/mobs/step.js';
import { activeNarrowPeer } from '../../../src/mobs/narrow.js';
import { normYaw } from '../../../src/mobs/corridor.js';
import { resetMobMotion } from '../../../src/mobs/carry.js';
import { clearEntryClaims } from '../../../src/mobs/entry.js';

const DT = 1 / 60;
const paths = {
  straight: [[0, 0], [0, 1], [0, 2]],
  corner: [[0, 0], [0, 1], [1, 1]],
  zigzag: [[0,0],[0,1],[1,1],[1,2],[2,2],[2,3],[3,3],[3,4]],
};
const tiny = { hw: 0.17, h: 0.7, nose: {along: 0.3, r: 0.15}, tail: {along: -0.25, r: 0.1} };
const broad = { hw: 0.42, h: 1.6, nose: {along: 0.65, r: 0.3}, tail: {along: -0.55, r: 0.2} };
const shapes = [specCircles(LIVESTOCK_SPECS.cow), specCircles(LIVESTOCK_SPECS.pig), tiny, broad];
function build(cells, wallHeight = 1) {
  resetWorld('over'); setDimension('over'); clearEntryClaims();
  const open = new Set(cells.map(p => p.join(',')));
  const xs=cells.map(p=>p[0]), zs=cells.map(p=>p[1]);
  for (let x = Math.min(...xs)-6; x <= Math.max(...xs)+6; x++) for (let z = Math.min(...zs)-6; z <= Math.max(...zs)+6; z++) {
    setBlock(x, 0, z, STONE);
    if (!open.has(`${x},${z}`)) for (let y = 1; y <= wallHeight; y++) setBlock(x, y, z, STONE);
  }
}
function mob(shape, x, z, yaw, i) {
  return { ...shape, type: 'fixture', dim: 'over', pos: {x, y: 1, z}, vel: {y: 0},
    maxDrop: 1, alive: true, root: null, yaw, yawTarget: yaw, target: {x: 8, z: 8},
    speed: FARM_WALK, legPhase: 0, rand: () => 0.37, wanderT: NO_EXPIRY,
    lastX: x, lastZ: z, stuckT: 0, fallFrom: 1, lane: null, servoStall: 0,
    followLine: null, followCool: 0, entryScanT: 0, entryCoolT: 0, turnHold: 0, _peerIdx: i };
}
function step(list, dt = DT, reversed = false) {
  const grid = buildMobGrid(list);
  planGroup(list, dt, grid);
  for (const m of reversed ? [...list].reverse() : list) tickFarmMob(m, dt, () => ({x: 8, z: 8}), m.rand, list, grid);
  const before = list.map(m => ({...m.pos}));
  separateFarmMobs(list, grid);
  return before;
}
function along(pos, cells) {
  let best=Infinity, result=0;
  for(let i=0;i<cells.length-1;i++) {
    const [x,z]=cells[i], dx=cells[i+1][0]-x, dz=cells[i+1][1]-z;
    const t=Math.max(0,Math.min(1,(pos.x-x-.5)*dx+(pos.z-z-.5)*dz));
    const d=Math.hypot(pos.x-x-.5-dx*t,pos.z-z-.5-dz*t);
    if(d<best) {best=d;result=i+t;}
  }
  return result;
}
function run(name, pair, rotation=0, mirror=1, gap=null, ticks=1200) {
  const transform=([x,z])=>{
    x*=mirror;
    for(let i=0;i<rotation;i++) [x,z]=[z,-x];
    return [x,z];
  };
  const cells=paths[name].map(transform);
  build(cells);
  const yaw=(a,b)=>Math.atan2(b[0]-a[0],b[1]-a[1]);
  const list=pair.map((shape,i)=>{
    const p=i?cells.at(-1):cells[0];
    return mob(shape,p[0]+.5,p[1]+.5,i?yaw(p,cells.at(-2)):yaw(p,cells[1]),i);
  });
  if(gap!=null) {
    const [dx,dz]=transform([0,1]);
    list[0].pos.x+=dx*gap;list[0].pos.z+=dz*gap;
    list[1].pos.x=cells[0][0]+.5;list[1].pos.z=cells[0][1]+.5;list[1].yaw=list[0].yaw;
  }
  const still=[0,0], worst=[0,0], ends=[null,null], visits=[0,0];
  let crossing=0, previousOrder=0, contacts=0, active=0, centered=0, corrections=0;
  for(let t=0;t<ticks;t++) {
    const prev=list.map(m=>({...m.pos,yaw:m.yaw}));
    const beforeSep=step(list);
    list.forEach((m,i)=>{
      const d=Math.hypot(m.pos.x-prev[i].x,m.pos.z-prev[i].z);
      still[i]=d<FARM_WALK*DT*.15?still[i]+1:0;worst[i]=Math.max(worst[i],still[i]);
      assert.equal(m.pos.y,1,'feet remain on the trench floor');
      assert.ok(Math.abs(normYaw(m.yaw-prev[i].yaw))<=Math.max(2*SERVO_TURN,5*TURN_RATE)*DT+1e-8,'the original servo and escape turn limits are retained');
      assert.ok(!aabbIntersectsSolid(m.pos.x,1,m.pos.z,m.hw-WALL_ALLOW-1e-5,m.h),'wall graze stays bounded');
      const q=along(m.pos,cells), end=q<1.1?'start':q>cells.length-2.1?'end':null;
      if(end && ends[i]!==end) {visits[i]++;ends[i]=end;}
      if(Math.hypot(m.pos.x-beforeSep[i].x,m.pos.z-beforeSep[i].z)>1e-8) corrections++;
      if(activeNarrowPeer(m)) active++;
      else if(Math.abs(m._lineOff??0)<1e-6) centered++;
    });
    const pen=worstPairPen(...list)?.pen??0;
    if(pen>.03) contacts++;
    if(t>60) {
      const order=Math.sign(along(list[0].pos,cells)-along(list[1].pos,cells));
      if(order && previousOrder && order!==previousOrder) crossing++;
      if(order) previousOrder=order;
    }
  }
  console.log(`${name}/${pair.map(s=>s.hw).join(',')}/r${rotation}m${mirror}g${gap}: visits ${visits}, crossings ${crossing}, quiet ${worst}, contact ${contacts}, centered ${centered}, corrections ${corrections}`);
  assert.ok(worst.every(n=>n<=45),`no frozen episode (${worst})`);
  const minimum=ticks>=3600?10:2;
  assert.ok(visits.every(n=>n>=minimum),`both mobs repeatedly reach both ends (${visits})`);
  assert.ok(crossing>=minimum,`repeated actual crossings (${crossing})`);
  assert.ok(contacts>0 && active>0,'crossings retain real contact and a scoped sidestep');
  return list;
}
for(const name of Object.keys(paths)) run(name,[shapes[0],shapes[0]],0,1,null,3600);
for(const name of Object.keys(paths)) for(let rotation=0;rotation<4;rotation++) for(const mirror of [1,-1]) run(name,[shapes[0],shapes[0]],rotation,mirror);
for(const name of Object.keys(paths)) for(const pair of [[shapes[1],shapes[1]],[shapes[0],shapes[1]],[tiny,broad]]) run(name,pair);
for(const name of Object.keys(paths)) for(const gap of [.001,.05,.3,.8,1.2]) run(name,[shapes[0],shapes[0]],0,1,gap);

// Long approach and quiet following must remain on the original centreline.
const straight=Array.from({length:16},(_,z)=>[0,z]);
{
  build(straight);
  const list=[mob(shapes[0],.5,2.5,0,0),mob(shapes[0],.5,12.5,Math.PI,1)];
  for(let t=0;t<80;t++) {
    step(list);
    assert.ok(list.every(m=>!activeNarrowPeer(m) && !m._lineOff && Math.abs(m.pos.x-.5)<1e-9),'no sidestep before an imminent collision');
    assert.ok(Math.abs(list[0].pos.z-(2.5+(t+1)*FARM_WALK*DT))<1e-8,'unobstructed forward movement stays at the original speed');
  }
  let crossed=false, settled=false;
  for(let t=0;t<240;t++) {
    step(list);
    if(list[0].pos.z>list[1].pos.z) crossed=true;
    if(crossed && list.every(m=>!activeNarrowPeer(m) && Math.abs(m.pos.x-.5)<.005 && !m._lineOff)) {settled=true;break;}
  }
  assert.ok(crossed && settled,'the pair slides only for its meeting, then returns to centre');
}
{
  build(straight);
  const list=[mob(shapes[0],.5,4.5,0,0),mob(shapes[0],.5,1.5,0,1)];
  for(let t=0;t<90;t++) {
    step(list);
    assert.ok(list.every(m=>!activeNarrowPeer(m) && !m._lineOff && Math.abs(m.pos.x-.5)<1e-9),'same-speed followers do not drift onto permanent parallel tracks');
  }
}
// Following around a bend does not imply an opposing crossing.
{
  const cells=[...Array.from({length:10},(_,z)=>[0,z]),...Array.from({length:8},(_,i)=>[i+1,9])];
  build(cells);
  const list=[mob(shapes[0],.5,6.5,0,0),mob(shapes[0],.5,4.2,0,1)];
  for(let t=0;t<150;t++) {
    step(list);
    assert.ok(list.every(m=>!activeNarrowPeer(m) && !m._lineOff),'ordinary corner-following never arms a passing sidestep');
  }
}
// Active passing still rejects deepening core collisions and resolves residue.
{
  build(straight);
  const a=mob(shapes[0],.5,5.5,0,0), b=mob(shapes[0],.5,7.5,Math.PI,1), list=[a,b];
  planGroup(list,DT);
  assert.ok(activeNarrowPeer(a)===b);
  assert.equal(peerStepOk(a,b.pos.x,b.pos.z,1,list,null,null,.5),false,'passing never exempts a peer from the step collision gate');
  a.pos.x=.24;b.pos.x=.76;b.pos.z=5.7;
  const headX=b.pos.x+Math.sin(b.yaw)*b.nose.along;
  const headZ=b.pos.z+Math.cos(b.yaw)*b.nose.along;
  assert.equal(makeTurnGate(a,list)(Math.atan2(headX-a.pos.x,headZ-a.pos.z)),false,'a turn sweeping the heads past the passing limit is blocked');
  b.speed=0;planGroup(list,DT);
  assert.ok(!activeNarrowPeer(a));
  assert.equal(peerStepOk(a,b.pos.x,b.pos.z,1,list,null,null,.15),false,'a parked mob stays a solid peer');
  b.speed=FARM_WALK;a.pos.x=.5;b.pos.x=.5;b.pos.z=a.pos.z+.01;
  const before=step(list);
  assert.ok(list.some((m,i)=>Math.hypot(m.pos.x-before[i].x,m.pos.z-before[i].z)>0),'over-budget contact is corrected instead of exempted');
  const third=mob(shapes[0],.5,10.5,0,2);
  planGroup([...list,third],DT);
  assert.ok([...list,third].every(m=>!activeNarrowPeer(m)),'a third body revokes pair-specific allowances');
  planGroup(list,DT);
  const key=a._narrow?.key;
  resetMobMotion(a);assert.equal(a._narrow,null,'carry clears the agreement');
  assert.ok(!a._passT && !a._lineOff,'carry clears the transient passing offset');
  setBlock(0,1,6,STONE);planGroup(list,DT);
  assert.notEqual(a._narrow?.key,key,'terrain edits invalidate the cached connectivity');
}
console.log('narrow.test.mjs: ALL PASS');
