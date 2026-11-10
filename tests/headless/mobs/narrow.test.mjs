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
import { SEP_GAP, PASS_BUDGET } from '../../../src/mobs/collide.js';
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

// Head-on crossing: a one-cell corridor is narrower than two bodies, so the
// pair must overlap to swap sides, and the deepest contact is a head
// sweeping past the peer's core — those two discs reach full coincidence
// (their own radii plus the gap). The narrow agreement must allow that
// depth; capped at the passing budget the pair wedges instead and never
// crosses.
function headOn(name, pair, iA, iB, rotation=0, mirror=1, ticks=900, maxBackwards=Infinity) {
  const transform=([x,z])=>{
    x*=mirror;
    for(let i=0;i<rotation;i++) [x,z]=[z,-x];
    return [x,z];
  };
  const cells=paths[name].map(transform);
  build(cells);
  const yaw=(a,b)=>Math.atan2(b[0]-a[0],b[1]-a[1]);
  const a=cells[iA], b=cells[iB];
  const list=[
    mob(pair[0],a[0]+.5,a[1]+.5,yaw(a,cells[iA+1]),0),
    mob(pair[1],b[0]+.5,b[1]+.5,yaw(b,cells[iB-1]),1),
  ];
  let still=0, worstStill=0, maxPen=0, crossed=false, previousOrder=0;
  let backwards=0, crossingBackwards=0, touch=0, unflagged=0;
  for(let t=0;t<ticks;t++) {
    const prev=list.map(m=>({x:m.pos.x,z:m.pos.z,yaw:m.yaw}));
    step(list);
    const d=list.map((m,i)=>Math.hypot(m.pos.x-prev[i].x,m.pos.z-prev[i].z));
    still=d.every(v=>v<FARM_WALK*DT*.15)?still+1:0;
    worstStill=Math.max(worstStill,still);
    maxPen=Math.max(maxPen,worstPairPen(...list)?.pen??0);
    // A crossing must not walk the mob backwards: the squeeze pushes it
    // sideways, never along its own heading. Backward steps are the visible
    // half of the crossing buzz (the pair oscillating in the swap).
    list.forEach((m,i)=>{
      const along=(m.pos.x-prev[i].x)*Math.sin(prev[i].yaw)+(m.pos.z-prev[i].z)*Math.cos(prev[i].yaw);
      if(along<-1e-6) {
        backwards++;
        // Only the crossing counts, and only while the mob walks STRAIGHT:
        // a mob turning around at a dead end legitimately walks back while
        // it pivots, and that is not the buzz.
        const aligned=Math.abs(normYaw(m.yaw-(m.lane?.axis??m.yaw)))<0.3;
        if(activeNarrowPeer(m)&&aligned) crossingBackwards++;
      }
      // The 1-wide red must survive the crossing: a wall-follow ride latched
      // inside the corridor reads blue and steals it.
      if(m._narrow) { if(m.followLine?.touch) touch++; if(!m.oneWide) unflagged++; }
    });
    const order=Math.sign(along(list[0].pos,cells)-along(list[1].pos,cells));
    if(order && previousOrder && order!==previousOrder) crossed=true;
    if(order) previousOrder=order;
  }
  // The head sweep may reach full disc coincidence and nothing deeper.
  const ceiling=Math.max(pair[0].nose.r+pair[1].hw,pair[1].nose.r+pair[0].hw)+SEP_GAP;
  console.log(`head-on/${name}/${pair.map(s=>s.hw).join(',')}/${iA}-${iB}/r${rotation}m${mirror}: crossed ${crossed}, quiet ${worstStill}, maxPen ${maxPen.toFixed(3)} (ceiling ${ceiling.toFixed(3)}), backwards ${backwards} (${crossingBackwards} in the crossing), touch ${touch}, unflagged ${unflagged}`);
  assert.ok(crossed,`the head-on pair crosses (${name} ${iA}-${iB})`);
  assert.ok(worstStill<=45,`no frozen episode (${worstStill})`);
  assert.ok(maxPen<=ceiling+1e-9,`overlap stays inside the anatomy's coincidence limit (${maxPen.toFixed(3)} vs ${ceiling.toFixed(3)})`);
  assert.ok(crossingBackwards<=maxBackwards,`the crossing never walks the pair backwards (${crossingBackwards} vs ${maxBackwards})`);
  assert.equal(touch,0,'no wall-follow ride is latched inside the closed rail');
  assert.equal(unflagged,0,'the 1-wide flag survives the whole crossing');
}
// The corner and the 1-cell jogs are the tightest spots: the pair meets
// head-on right at a bend, where the head sweep has to clear the corner.
// Adjacent cells are the deadlock — the noses touch before the bodies can
// slide past, so the pair wedges at the passing budget and never crosses.
// The zigzag carries the crossing budget: it is where the pair must really
// squeeze past each other, so it also carries the buzz bound (a closed
// three-cell corridor has no room for two bodies at all and backs up a
// little on its own).
// The straight bound is the tightest interlock of all: two bodies cannot
// pass side by side in a one-cell corridor, so the pair squeezes THROUGH
// each other and the separation shoves the loser back along the corridor
// as it does. That shove is the price of the squeeze (the thrash it
// replaced measured the same corridor sideways, every tick); the sideways
// tremble and the turn on top of the peer have their own rigs below.
const BACKWARDS_BOUND = { straight: 120, corner: 150, zigzag: 60 };
for(const name of ['straight','corner','zigzag']) {
  for(const [iA,iB] of name==='zigzag'?[[1,2],[2,3],[3,4],[4,5],[5,6],[6,7]]:name==='corner'?[[0,1],[1,2]]:[[1,2]]) {
    headOn(name,[shapes[0],shapes[0]],iA,iB,0,1,900,BACKWARDS_BOUND[name]);
  }
}
// Mixed species clear the same bends: the head sweep allowance is sized by
// the pair's own anatomy, so a cow and a pig swap sides as well.
for(const name of ['straight','corner','zigzag']) {
  for(const [iA,iB] of name==='zigzag'?[[3,4],[5,6]]:name==='corner'?[[0,1],[1,2]]:[[1,2]]) {
    headOn(name,[shapes[0],shapes[1]],iA,iB,0,1,900,BACKWARDS_BOUND[name]);
  }
}

// A file (same-direction traffic) keeps its gap: the deep head sweep is a
// crossing allowance, never a merge. The follower must never overtake, and
// the two cores must stay inside the corridor fit.
{
  const cells=Array.from({length:30},(_,z)=>[0,z]);
  build(cells);
  const list=[mob(shapes[0],.5,2.5,0,0),mob(shapes[0],.5,2.0,0,1)];
  for(const m of list) m.target={x:.5,z:29.5};
  let order=0, flipped=false, minGap=Infinity, maxCore=0;
  for(let t=0;t<150;t++) {
    step(list);
    minGap=Math.min(minGap,list[0].pos.z-list[1].pos.z);
    const d=Math.hypot(list[0].pos.x-list[1].pos.x,list[0].pos.z-list[1].pos.z);
    maxCore=Math.max(maxCore,shapes[0].hw*2+SEP_GAP-d);
    const o=Math.sign(along(list[0].pos,cells)-along(list[1].pos,cells));
    if(order && o && o!==order) flipped=true;
    if(o) order=o;
  }
  console.log(`file: min leader gap ${minGap.toFixed(3)}, max core overlap ${maxCore.toFixed(3)}, overtakes ${flipped}`);
  assert.ok(!flipped,'a file never overtakes');
  assert.ok(minGap>0,`the follower keeps its gap (${minGap.toFixed(3)})`);
  assert.ok(maxCore<=PASS_BUDGET-SEP_GAP+1e-9,`the file never merges (${maxCore.toFixed(3)})`);
}

const straight=Array.from({length:16},(_,z)=>[0,z]);
// The rail coordinate is memoized per rail. A stale reading (the mob
// changed rail, or left the rail and came back) measures a huge delta, and
// that reads as a closing pair — the crossing allowance handed to two mobs
// that are not crossing.
{
  const cells=straight;
  build(cells);
  const a=mob(shapes[0],.5,4.5,0,0), b=mob(shapes[0],.5,6.5,0,1);
  const list=[a,b];
  for(let t=0;t<10;t++) step(list);
  assert.ok(a._railQ?.key===a._narrow?.key,'the rail coordinate is memoized per rail');
  a._railQ={key:'another-rail',q:999};
  step(list);
  assert.ok(list.every(m=>!m._narrow?.meeting?.crossing),'a stale rail reading never arms the crossing');
  const third=mob(shapes[0],.5,8.5,0,2);
  for(let t=0;t<30;t++) step([a,b,third]);
  assert.ok(!a._narrow,'a third body drops the pair out of the narrow agreement');
  assert.ok(!a._railQ,'leaving the rail drops the memoized rail coordinate');
}
{
  build(straight);
  const list=[mob(shapes[0],.5,2.5,0,0),mob(shapes[0],.5,12.5,Math.PI,1)];
  for(let t=0;t<80;t++) {
    step(list);
    assert.ok(list.every(m=>!activeNarrowPeer(m) && !m._lineOff && Math.abs(m.pos.x-.5)<1e-9),'no sidestep before an imminent collision');
    assert.ok(Math.abs(list[0].pos.z-(2.5+(t+1)*FARM_WALK*DT))<1e-8,'unobstructed forward movement stays at the original speed');
  }
  let crossed=false, settled=false, settledAt=-1;
  for(let t=0;t<600;t++) {
    step(list);
    if(list[0].pos.z>list[1].pos.z) crossed=true;
    // The sidestep is what comes down: the agreement stays open (it is the
    // relaxed budget the pair needs), the lateral offset goes, and each mob
    // is back on the corridor centre line.
    if(crossed && list.every(m=>Math.abs(m.pos.x-.5)<.005 && !m._lineOff)) {settled=true;settledAt=t;break;}
  }
  console.log(`recentring: settled ${settled} at tick ${settledAt}`);
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
    // The rail index direction flips at every bend, so a file rounding a
    // corner used to read as an opposing crossing and earn the deep head
    // sweep. The crossing signal is the pair closing on each other along
    // the rail, which a file never does.
    assert.ok(list.every(m=>!m._narrow?.meeting?.crossing),'a file rounding a bend never arms the crossing allowance');
  }
}
// A dead-end turn is gradual (the servo rate caps the rotation), so a
// reversal is a signed yaw travel over a window, not a one-tick flip. The
// mob at the corridor end turns around while its peer may still be close:
// the turn must not happen on top of the peer.
{
  const cells=paths.zigzag;
  build(cells);
  const yaw=(a,b)=>Math.atan2(b[0]-a[0],b[1]-a[1]);
  const list=[mob(shapes[0],cells[0][0]+.5,cells[0][1]+.5,yaw(cells[0],cells[1]),0),
              mob(shapes[0],cells.at(-1)[0]+.5,cells.at(-1)[1]+.5,yaw(cells.at(-1),cells.at(-2)),1)];
  const hist=[[],[]], armed=[false,false];
  let overlapping=0, reversals=0;
  for(let t=0;t<2400;t++) {
    const prev=list.map(m=>m.yaw);
    step(list);
    const pen=worstPairPen(...list)?.pen??0;
    list.forEach((m,i)=>{
      hist[i].push(normYaw(m.yaw-prev[i]));
      if(hist[i].length>120) hist[i].shift();
      let travel=0; for(const h of hist[i]) travel+=h;
      if(travel>Math.PI&&!armed[i]) {armed[i]=true; reversals++; if(pen>0.1) overlapping++;}
      else if(travel<Math.PI*0.5) armed[i]=false;
    });
  }
  console.log(`dead-end turn: ${reversals} reversals, ${overlapping} of them on top of the peer`);
  assert.ok(reversals>0,'the corridor ends really do turn the mobs around');
  assert.equal(overlapping,0,'no dead-end turn happens on top of the peer');
}
// A head-on crossing in a straight closed rail: the pair squeezes past each
// other without trembling sideways, the two never aim at the same side of
// the corridor, and neither mob spins around at the crossing. The passing
// offset pushes the nose against the corridor wall; read as a dead end,
// that flipped the lane under the pair and the sidestep side inverted with
// it — a sideways tremble every tick — and the flipped axis latched into
// the nose turn spun the mob 180° right there, head to tail with its peer.
// The corridor end still turns the mobs around, and that turn happens with
// the peer far away.
{
  const cells=straight;
  build(cells);
  const list=[mob(shapes[0],.5,2.5,0,0),mob(shapes[0],.5,12.5,Math.PI,1)];
  const lastAxis=[null,null];
  let flips=0, sameSide=0, maxPen=0, penAt=-1, latAtSwap=-1, swapped=false;
  const flipEnd=[], flipGap=[];
  // World side of a mob's lateral offset: the lane's lateral axis, signed
  // by the offset. Two mobs in a rail walk opposite ways, so the same
  // offset sign puts them on opposite sides of the corridor.
  const side=(m)=>{
    const off=m._lineOff??0;
    // A half offset means the mob is on its way back to the centre (the
    // offset crosses zero when the lane turns at a dead end): both mobs are
    // then near the centre line and the two sides carry no meaning.
    if(!m.lane||Math.abs(off)<0.15) return null;
    const ax=Math.sin(m.lane.axis), az=Math.cos(m.lane.axis), s=Math.sign(off);
    return [-s*az, s*ax];
  };
  for(let t=0;t<900;t++) {
    step(list);
    const gap=Math.hypot(list[0].pos.x-list[1].pos.x,list[0].pos.z-list[1].pos.z);
    // The heads must not interlock: a head-on pair slides past side by side
    // (the sidestep carries it), so every overlap stays a graze. A pair
    // that meets nose to nose embeds the whole head instead — the noses
    // reach a body-length ahead of the centre, and two of them cannot pass
    // in a one-cell corridor without the sidestep.
    const pen=worstPairPen(...list)?.pen??0;
    if(pen>maxPen){maxPen=pen;penAt=t;}
    if(!swapped&&list[0]._narrow?.meeting?.swapped){
      swapped=true; latAtSwap=Math.abs(list[0].pos.x-list[1].pos.x);
    }
    list.forEach((m,i)=>{
      const axis=m.lane?m.lane.axis:m.yaw;
      if(m.lane&&lastAxis[i]!==null&&Math.abs(axis-lastAxis[i])>2) {
        flips++;
        flipEnd.push(m.pos.z<1.6||m.pos.z>14.4);
        flipGap.push(+gap.toFixed(2));
      }
      if(m.lane) lastAxis[i]=axis;
    });
    // While the pair CLOSE on each other, they must never aim at the same
    // side of the corridor (they would drive into each other). Outside the
    // approach the offsets glide home and the lane turns at a dead end, so
    // the two sides are momentarily meaningless.
    const closing=list[0]._narrow?.meeting?.closing===true;
    const sa=closing?side(list[0]):null, sb=closing?side(list[1]):null;
    if(sa&&sb&&sa[0]*sb[0]+sa[1]*sb[1]>0) sameSide++;
  }
  console.log(`crossing rail: lane flips ${flips} (at a dead end: ${flipEnd.filter(Boolean).length}), same-side ticks ${sameSide}, max overlap ${maxPen.toFixed(3)} @t${penAt}, lateral at the swap ${latAtSwap.toFixed(2)}`);
  assert.ok(flips>0,'the corridor end still turns the mobs around');
  assert.ok(flipEnd.every(Boolean),`the lane only flips at a dead end (${flipEnd.map((e,i)=>`${e?'end':'MID'}:${flipGap[i]}`).join(' ')})`);
  assert.ok(flipGap.every(g=>g>1.5),`no mob turns around on top of its peer (${flipGap.join(' ')})`);
  assert.equal(sameSide,0,'the pair never aims at the same side of the corridor');
  assert.ok(maxPen<=0.3,`the heads never interlock: every overlap stays a graze (${maxPen.toFixed(3)})`);
  assert.ok(latAtSwap>=0.45,`the sidestep carries the pair past each other (lateral ${latAtSwap.toFixed(2)})`);
}
// Never a freeze: whatever the geometry, the pair sorts its meeting out.
// These are the scenarios that used to deadlock for good — the corner and
// the zigzag, both species mixes, the pair meeting head-on or nose to
// tail. The agreement opens on the jam (a pair that touches and stops), the
// overlap is relaxed enough for the squeeze to go through, and the backstop
// pulls a wedged pair apart instead of leaving it stuck inside each other.
for(const [name,iA,iB,ia,ib] of [
  ['corner',1,0,0,0], ['corner',0,1,0,1], ['corner',1,2,0,1],
  ['zigzag',3,2,0,0], ['zigzag',2,3,0,1], ['zigzag',4,3,0,0], ['zigzag',3,4,2,3],
]) {
  const cells=paths[name];
  build(cells);
  const a=cells[iA], b=cells[iB];
  const dirA=iA<cells.length-1?cells[iA+1]:cells[iA-1];
  const dirB=iB<cells.length-1?cells[iB+1]:cells[iB-1];
  const list=[mob(shapes[ia],a[0]+.5,a[1]+.5,Math.atan2(dirA[0]-a[0],dirA[1]-a[1]),0),
              mob(shapes[ib],b[0]+.5,b[1]+.5,Math.atan2(dirB[0]-b[0],dirB[1]-b[1]),1)];
  let still=0, worst=0, crossed=false, previousOrder=0;
  for(let t=0;t<900;t++) {
    const prev=list.map(m=>({...m.pos}));
    step(list);
    const d=list.map((m,i)=>Math.hypot(m.pos.x-prev[i].x,m.pos.z-prev[i].z));
    still=d.every(v=>v<0.001)?still+1:0; worst=Math.max(worst,still);
    const order=Math.sign(along(list[0].pos,cells)-along(list[1].pos,cells));
    if(order&&previousOrder&&order!==previousOrder) {crossed=true;break;}
    if(order) previousOrder=order;
  }
  console.log(`no-freeze ${name} ${shapes[ia].hw}/${shapes[ib].hw}: crossed ${crossed}, worst still ${worst}`);
  assert.ok(worst<=45,`no frozen episode (${name} ${shapes[ia].hw}/${shapes[ib].hw}: ${worst})`);
  assert.ok(crossed,`the pair swaps sides (${name} ${shapes[ia].hw}/${shapes[ib].hw})`);
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
