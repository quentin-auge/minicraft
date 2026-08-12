import * as THREE from "three";

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, WATER = 7, PLANKS = 8, GLASS = 9, TNT = 10, PORTAL = 12;

const BLOCK_INFO = {
  [GRASS]:  { name: "Grass",   solid: true,  opaque: true,  placeable: true },
  [DIRT]:   { name: "Dirt",    solid: true,  opaque: true,  placeable: true },
  [STONE]:  { name: "Stone",   solid: true,  opaque: true,  placeable: true },
  [SAND]:   { name: "Sand",    solid: true,  opaque: true,  placeable: true },
  [LOG]:    { name: "Log",     solid: true,  opaque: true,  placeable: true },
  [LEAVES]: { name: "Leaves",  solid: true,  opaque: true,  placeable: true },
  [WATER]:  { name: "Water",   solid: false, opaque: false, placeable: true },
  [PLANKS]: { name: "Planks",  solid: true,  opaque: true,  placeable: true },
  [GLASS]:  { name: "Glass",   solid: true,  opaque: false, placeable: true },
  [TNT]:    { name: "TNT",     solid: true,  opaque: true,  placeable: true },
  [PORTAL]: { name: "Portal",  solid: true,  opaque: false, placeable: true },
};

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------
function hash2(x, z, seed) {
  let n = (x * 374761393 + z * 668265263 + seed * 2246822519) | 0;
  n = ((n ^ (n >>> 13)) | 0);
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
function valueNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = fade(xf), v = fade(zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return v * (u * (a - b) + b) + (1 - v) * (u * (c - d) + d);
}
function fbm(x, z, seed, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 101) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Procedural textures (16x16 pixel art)
// ---------------------------------------------------------------------------
function canvasTex(draw) {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d");
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pxNoise(ctx, base, amount, chance = 1) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (Math.random() > chance) continue;
    const d = (Math.random() - 0.5) * amount;
    ctx.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d})`;
    ctx.fillRect(x, y, 1, 1);
  }
}
const makeTex = (base, amount = 24) => canvasTex((ctx) => {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, 16, 16);
  pxNoise(ctx, base, amount);
});

const TEX = {
  grass_top: canvasTex((ctx) => {
    ctx.fillStyle = "#6ab04c"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [106, 176, 76], 20);
    for (let x = 0; x < 16; x++) if (Math.random() < 0.2) { ctx.fillStyle = "#8fce6b"; ctx.fillRect(x, 2 + Math.random() * 2, 1, 1); }
  }),
  grass_side: canvasTex((ctx) => {
    ctx.fillStyle = "#8a5a35"; ctx.fillRect(0, 4, 16, 12);
    pxNoise(ctx, [138, 90, 53], 22);
    ctx.fillStyle = "#6ab04c"; ctx.fillRect(0, 0, 16, 4);
    pxNoise(ctx, [106, 176, 76], 18, 0.9);
    for (let x = 0; x < 16; x++) if (Math.random() < 0.35) { ctx.fillStyle = "#8fce6b"; ctx.fillRect(x, 3, 1, 1); }
  }),
  dirt: makeTex([138, 90, 53], 26),
  stone: canvasTex((ctx) => {
    ctx.fillStyle = "#8d8d8d"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [141, 141, 141], 16);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 3, 4, 1); ctx.fillRect(6, 9, 5, 1); ctx.fillRect(11, 1, 3, 1); ctx.fillRect(3, 13, 4, 1);
  }),
  sand: makeTex([222, 207, 142], 14),
  log_side: canvasTex((ctx) => {
    ctx.fillStyle = "#6b4a2f"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [107, 74, 47], 16);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 3, 16, 1); ctx.fillRect(0, 8, 16, 1); ctx.fillRect(0, 13, 16, 1);
  }),
  log_top: canvasTex((ctx) => {
    ctx.fillStyle = "#8f6a3d"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [143, 106, 61], 14);
    ctx.strokeStyle = "#5d4026"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(8, 8, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, 8, 2, 0, Math.PI * 2); ctx.stroke();
  }),
  leaves: canvasTex((ctx) => {
    ctx.fillStyle = "#2e7d32"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [46, 125, 50], 22);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = Math.random() < 0.5 ? "#3f9145" : "#256a2a"; ctx.fillRect(Math.random() * 16, Math.random() * 16, 1, 1); }
  }),
  water: canvasTex((ctx) => {
    ctx.fillStyle = "#3a6fd8"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) if ((x + y * 5) % 6 === 0) ctx.fillRect(x, y * 4 + 2, 1, 1);
  }),
  planks: canvasTex((ctx) => {
    ctx.fillStyle = "#b98a4e"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [185, 138, 78], 12);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let y = 0; y < 4; y++) ctx.fillRect(0, y * 4, 16, 1);
    ctx.fillRect(4, 0, 1, 4); ctx.fillRect(11, 4, 1, 4); ctx.fillRect(6, 8, 1, 4); ctx.fillRect(13, 12, 1, 4);
  }),
  tnt: canvasTex((ctx) => {
    ctx.fillStyle = "#c0392b"; ctx.fillRect(0, 0, 16, 16);
    pxNoise(ctx, [192, 57, 43], 14);
    ctx.fillStyle = "#ece6d0"; ctx.fillRect(0, 6, 16, 4);
    pxNoise(ctx, [236, 230, 208], 8, 0.7);
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 7, 16, 1);
    ctx.fillRect(0, 9, 16, 1);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 7px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TNT", 8, 8);
    ctx.fillStyle = "#5d2b22";
    ctx.fillRect(8, 0, 2, 2);
  }),
  glass: canvasTex((ctx) => {
    ctx.fillStyle = "rgba(190,230,255,0.55)"; ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, 14.5, 14.5);
    ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(8, 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(15, 8); ctx.stroke();
  }),
  portal: canvasTex((ctx) => {
    ctx.fillStyle = "#3a0d6b"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#9b30ff";
    for (let y = 0; y < 16; y += 2) for (let x = ((y / 2) % 2) * 2; x < 16; x += 4) ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = "#d9a6ff";
    ctx.fillRect(7, 4, 2, 8);
  }),
};

function material(map, opts = {}) {
  return new THREE.MeshLambertMaterial({ map, ...opts });
}
// BoxGeometry face order: +x, -x, +y, -y, +z, -z
function materialsFor(id) {
  const [px, nx, py, ny, pz, nz] = [
    material(TEX.grass_side), material(TEX.grass_side), material(TEX.grass_top), material(TEX.dirt), material(TEX.grass_side), material(TEX.grass_side),
  ];
  switch (id) {
    case GRASS: return [px, nx, py, ny, pz, nz];
    case DIRT:  return faceTex(TEX.dirt);
    case STONE: return faceTex(TEX.stone);
    case SAND:  return faceTex(TEX.sand);
    case LOG:   return [material(TEX.log_side), material(TEX.log_side), material(TEX.log_top), material(TEX.log_top), material(TEX.log_side), material(TEX.log_side)];
    case LEAVES:return faceTex(TEX.leaves);
    case PLANKS:return faceTex(TEX.planks);
    case GLASS: return faceTex(TEX.glass, { transparent: true, opacity: 0.8, depthWrite: false });
    case WATER: return faceTex(TEX.water, { transparent: true, opacity: 0.65, depthWrite: false });
    case TNT:   return faceTex(TEX.tnt);
    case PORTAL: return faceTex(TEX.portal, { transparent: false, opacity: 1, side: THREE.DoubleSide });
    default: return faceTex(TEX.dirt);
  }
}
function faceTex(map, opts = {}) {
  return [material(map, opts), material(map, opts), material(map, opts), material(map, opts), material(map, opts), material(map, opts)];
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const WORLD_RADIUS = 48;
const WORLD_SIZE = WORLD_RADIUS * 2 + 1;
const WATER_LEVEL = 10;
let seed = Math.floor(Math.random() * 100000);
let endSeed = Math.floor(Math.random() * 100000);

function key(x, y, z) { return x + "," + y + "," + z; }

const worlds = { over: new Map(), end: new Map() };
let dim = "over";
let world = worlds.over;
const getBlock = (x, y, z) => world.get(key(x, y, z)) || AIR;

function setBlock(x, y, z, id) {
  if (y < 0 || y > 60) return;
  const k = key(x, y, z);
  if (id === AIR) world.delete(k); else world.set(k, id);
}

function heightAt(x, z) {
  const base = fbm(x * 0.02, z * 0.02, seed) * 2 - 1;
  const hills = fbm(x * 0.008 + 100, z * 0.008 + 100, seed + 7) * 2 - 1;
  const rough = fbm(x * 0.06, z * 0.06, seed + 13) * 0.6;
  let h = 8 + base * 6 + hills * 9 + rough;
  h = Math.max(3, Math.min(30, h));
  return Math.floor(h);
}

function growTree(x, y, z) {
  const trunkH = 4 + Math.floor(hash2(x, z, seed + 999) * 3);
  for (let i = 0; i < trunkH; i++) setBlock(x, y + i, z, LOG);
  const topY = y + trunkH;
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy >= 0 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r + 0.5) continue;
      if (Math.abs(dx) === r && Math.abs(dz) === r && dy < 1 && Math.random() < 0.5) continue;
      if (getBlock(x + dx, topY + dy, z + dz) !== AIR) continue;
      setBlock(x + dx, topY + dy, z + dz, LEAVES);
    }
  }
  setBlock(x, topY + 1, z, LEAVES);
}

function generateWorld() {
  world = worlds.over;
  worlds.over.clear();
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x++) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z++) {
      const h = heightAt(x, z);
      for (let y = 0; y <= h; y++) {
        let id = STONE;
        if (y === h) id = h <= WATER_LEVEL + 1 ? SAND : GRASS;
        else if (y >= h - 2) id = DIRT;
        else if (y >= h - 5 && Math.random() < 0.3) id = STONE;
        setBlock(x, y, z, id);
      }
      if (h < WATER_LEVEL) for (let y = h + 1; y <= WATER_LEVEL; y++) setBlock(x, y, z, WATER);
      if (getBlock(x, h, z) === GRASS && hash2(x, z, seed + 555) < 0.012) growTree(x, h + 1, z);
    }
  }
}

function generateEnd() {
  const w = worlds.end;
  w.clear();
  const R = 24;  // 2x larger platform
  const top = 20;
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++)
      for (let y = top - 2; y <= top; y++) w.set(key(x, y, z), STONE);
  for (let y = 1; y <= top - 3; y++) w.set(key(0, y, 0), STONE);
}

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 160);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 300);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
document.getElementById("game").appendChild(renderer.domElement);

const sun = new THREE.DirectionalLight(0xfff5e0, 1.1);
sun.position.set(60, 90, 40);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a6a4a, 0.75);
scene.add(hemi);

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const matrix = new THREE.Matrix4();
const color = new THREE.Color();
const dummy = new THREE.Object3D();

// One instanced mesh per block type, only exposed faces rendered
const instanced = {};
function rebuildMeshes() {
  const counts = {};
  const exposed = [];
  world.forEach((id, k) => {
    if (!BLOCK_INFO[id]) return;
    const [x, y, z] = k.split(",").map(Number);
    if (!isExposed(x, y, z)) return;
    counts[id] = (counts[id] || 0) + 1;
    exposed.push([x, y, z, id]);
  });

  for (const id in instanced) {
    scene.remove(instanced[id]);
    instanced[id].geometry.dispose();
    instanced[id].material.forEach((m) => m.dispose());
  }

  for (const idStr in counts) {
    const id = +idStr;
    const n = counts[id];
    const mesh = new THREE.InstancedMesh(boxGeo, materialsFor(id), n);
    mesh.count = n;
    mesh.visible = n > 0;
    let i = 0;
    for (const [x, y, z, bid] of exposed) {
      if (bid !== id) continue;
      dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i++, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    instanced[id] = mesh;
  }
}

function isExposed(x, y, z) {
  const id = getBlock(x, y, z);
  const info = BLOCK_INFO[id];
  if (!info) return false;
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (const [dx, dy, dz] of dirs) {
    const n = getBlock(x + dx, y + dy, z + dz);
    const ninfo = BLOCK_INFO[n];
    if (!ninfo) return true;
    if (!ninfo.opaque) return true;
    if (!ninfo.solid) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const PLAYER_HW = 0.3;
const PLAYER_H = 1.8;
const EYE = 1.62;
const GRAVITY = 26;
const JUMP = 8.2;
const WALK = 4.4, SPRINT = 7.2, FLY = 10;

const pos = new THREE.Vector3(0, 20, 0);
const vel = new THREE.Vector3();
const camPos = new THREE.Vector3();
let yaw = 0, pitch = 0;
let onGround = false, flying = false, freeCam = false, locked = false;
const keys = {};

function spawnPlayer() {
  for (let y = 60; y > 0; y--) {
    if (getBlock(0, y, 0) !== AIR) {
      pos.set(0.5, y + 1.01, 0.5);
      break;
    }
  }
  vel.set(0, 0, 0);
}

function isSolid(x, y, z) {
  const info = BLOCK_INFO[getBlock(x, y, z)];
  return !!info && info.solid;
}

function tryStep(dirX, dirZ) {
  const nx = dirX !== 0 ? Math.floor(pos.x + dirX * (PLAYER_HW + 0.001)) : Math.floor(pos.x);
  const nz = dirZ !== 0 ? Math.floor(pos.z + dirZ * (PLAYER_HW + 0.001)) : Math.floor(pos.z);
  const feetY = Math.floor(pos.y);
  const standY = feetY + 1;
  if (!isSolid(nx, feetY, nz)) return false;
  if (isSolid(nx, standY, nz) || isSolid(nx, standY + 1, nz)) return false;
  pos.y = standY + 0.001;
  vel.y = 0;
  onGround = true;
  return true;
}

function moveAxisX(dx) {
  pos.x += dx;
  if (dx === 0) return;
  const dir = dx > 0 ? 1 : -1;
  const edge = dir > 0 ? pos.x + PLAYER_HW : pos.x - PLAYER_HW;
  const cellX = Math.floor(edge);
  for (let by = Math.floor(pos.y); by <= Math.floor(pos.y + PLAYER_H); by++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      if (!isSolid(cellX, by, bz)) continue;
      if (dir > 0 && edge > cellX) {
        if (tryStep(dir, 0)) return;
        pos.x = cellX - PLAYER_HW - 0.001; vel.x = 0; return;
      }
      if (dir < 0 && edge < cellX + 0.999) {
        if (tryStep(dir, 0)) return;
        pos.x = cellX + 1 + PLAYER_HW + 0.001; vel.x = 0; return;
      }
    }
}
function moveAxisZ(dz) {
  pos.z += dz;
  if (dz === 0) return;
  const dir = dz > 0 ? 1 : -1;
  const edge = dir > 0 ? pos.z + PLAYER_HW : pos.z - PLAYER_HW;
  const cellZ = Math.floor(edge);
  for (let by = Math.floor(pos.y); by <= Math.floor(pos.y + PLAYER_H); by++)
    for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++) {
      if (!isSolid(bx, by, cellZ)) continue;
      if (dir > 0 && edge > cellZ) {
        if (tryStep(0, dir)) return;
        pos.z = cellZ - PLAYER_HW - 0.001; vel.z = 0; return;
      }
      if (dir < 0 && edge < cellZ + 0.999) {
        if (tryStep(0, dir)) return;
        pos.z = cellZ + 1 + PLAYER_HW + 0.001; vel.z = 0; return;
      }
    }
}
function moveAxisY(dy) {
  pos.y += dy;
  onGround = false;
  const top = pos.y + PLAYER_H, feet = pos.y;
  for (let bx = Math.floor(pos.x - PLAYER_HW); bx <= Math.floor(pos.x + PLAYER_HW); bx++)
    for (let bz = Math.floor(pos.z - PLAYER_HW); bz <= Math.floor(pos.z + PLAYER_HW); bz++) {
      if (vel.y > 0 && isSolid(bx, Math.floor(top), bz) && top > Math.floor(top)) { pos.y = Math.floor(top) - PLAYER_H - 0.001; vel.y = 0; return; }
      if (vel.y <= 0 && isSolid(bx, Math.floor(feet), bz)) { pos.y = Math.floor(feet) + 1 + 0.001; vel.y = 0; onGround = true; return; }
    }
}
function collide() {
  moveAxisY(vel.y * dt);
  moveAxisX(vel.x * dt);
  moveAxisZ(vel.z * dt);
}

function updatePlayer(dt) {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  const w = keys["ArrowUp"];
  const s = keys["ArrowDown"];
  const d = keys["ArrowRight"];
  const a = keys["ArrowLeft"];
  const sprintKey = keys["ShiftLeft"] || keys["ShiftRight"];

  if (w) move.add(fwd);
  if (s) move.sub(fwd);
  if (d) move.add(right);
  if (a) move.sub(right);

  const inWater = headInWater();

  if (flying) {
    const speed = FLY;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x = move.x; vel.z = move.z;
    vel.y = (keys["Space"] ? speed : 0) - (sprintKey ? speed : 0);
  } else if (inWater) {
    // Buoyancy: automatically float toward the surface, hold Space to swim up.
    const speed = 4.2;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x += (move.x - vel.x) * Math.min(1, dt * 8);
    vel.z += (move.z - vel.z) * Math.min(1, dt * 8);
    const target = keys["Space"] ? 4.0 : 1.8;
    vel.y += (target - vel.y) * Math.min(1, dt * 4);
  } else {
    const sprint = sprintKey && move.lengthSq() > 0;
    const speed = sprint ? SPRINT : WALK;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    vel.x = move.x; vel.z = move.z;
    vel.y -= GRAVITY * dt;
    if (keys["Space"] && onGround) { vel.y = JUMP; onGround = false; }
    if (vel.y < -40) vel.y = -40;
  }
  collide();
}

// Free camera (spectator): detach from the player, fly through anything.
function updateFreeCam(dt) {
  const cp = Math.cos(pitch);
  const fwd = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  if (keys["ArrowUp"]) move.add(fwd);
  if (keys["ArrowDown"]) move.sub(fwd);
  if (keys["ArrowRight"]) move.add(right);
  if (keys["ArrowLeft"]) move.sub(right);
  const sprint = keys["ShiftLeft"] || keys["ShiftRight"];
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(FLY * (sprint ? 3 : 1) * dt);
  const r = 0.3;
  const tryAxis = (axis, v) => {
    if (v === 0) return;
    const nx = camPos.x + (axis === "x" ? v : 0);
    const ny = camPos.y + (axis === "y" ? v : 0);
    const nz = camPos.z + (axis === "z" ? v : 0);
    if (!freeCamBlocked(nx, ny, nz, r)) camPos.set(nx, ny, nz);
  };
  tryAxis("x", move.x);
  tryAxis("z", move.z);
  tryAxis("y", move.y);
}

function freeCamBlocked(x, y, z, r) {
  for (const ox of [-r, r])
    for (const oy of [-r, r])
      for (const oz of [-r, r])
        if (isSolid(Math.floor(x + ox), Math.floor(y + oy), Math.floor(z + oz))) return true;
  return false;
}

function exitFreeCam() {
  pos.set(camPos.x, Math.max(0, camPos.y), camPos.z);
  vel.set(0, 0, 0);
  const outOfLevel =
    Math.abs(pos.x) > WORLD_RADIUS || Math.abs(pos.z) > WORLD_RADIUS ||
    pos.y < 0 || pos.y > 60;
  if (outOfLevel) spawnPlayer();
}

function headInWater() {
  const hw = PLAYER_HW;
  for (let i = 0; i < 2; i++) {
    const py = pos.y + (i === 0 ? 0.3 : PLAYER_H - 0.4);
    for (let bx = Math.floor(pos.x - hw); bx <= Math.floor(pos.x + hw); bx++)
      for (let bz = Math.floor(pos.z - hw); bz <= Math.floor(pos.z + hw); bz++)
        if (getBlock(bx, Math.floor(py), bz) === WATER) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Raycast (DDA voxel traversal)
// ---------------------------------------------------------------------------
const REACH = 6 * 1.2;
function pickBlock(origin, dir) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? Math.floor(origin.x) + 1 - origin.x : origin.x - Math.floor(origin.x)) / Math.abs(dir.x)) : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? Math.floor(origin.y) + 1 - origin.y : origin.y - Math.floor(origin.y)) / Math.abs(dir.y)) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? Math.floor(origin.z) + 1 - origin.z : origin.z - Math.floor(origin.z)) / Math.abs(dir.z)) : Infinity;
  let face = [0, 0, 0];

  for (let i = 0; i < 64; i++) {
    const id = getBlock(x, y, z);
    if (id !== AIR && id !== WATER) return { x, y, z, id, face };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
    if (Math.min(tMaxX, tMaxY, tMaxZ) > REACH) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Highlight box
// ---------------------------------------------------------------------------
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
);
highlight.visible = false;
scene.add(highlight);

let currentBlock = null;
function updateTarget() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  currentBlock = pickBlock(camera.position, dir);
  if (currentBlock) {
    highlight.visible = true;
    highlight.position.set(currentBlock.x + 0.5, currentBlock.y + 0.5, currentBlock.z + 0.5);
  } else {
    highlight.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------
function breakBlock() {
  if (!currentBlock) return;
  const { x, y, z } = currentBlock;
  if (getBlock(x, y, z) === STONE && y === 0) return;
  if (getBlock(x, y, z) === TNT) { igniteTNT(x, y, z); return; }
  setBlock(x, y, z, AIR);
  rebuildMeshes();
  queueSave();
}
function placeBlock(id) {
  if (!currentBlock) return;
  const [nx, ny, nz] = currentBlock.face;
  const px = currentBlock.x + nx, py = currentBlock.y + ny, pz = currentBlock.z + nz;
  if (getBlock(px, py, pz) !== AIR) return;
  if (intersectsPlayer(px, py, pz)) return;
  setBlock(px, py, pz, id);
  rebuildMeshes();
  queueSave();
}
function intersectsPlayer(bx, by, bz) {
  return (
    bx + 1 > pos.x - PLAYER_HW && bx < pos.x + PLAYER_HW &&
    by + 1 > pos.y && by < pos.y + PLAYER_H &&
    bz + 1 > pos.z - PLAYER_HW && bz < pos.z + PLAYER_HW
  );
}

// ---------------------------------------------------------------------------
// TNT: breaking a TNT block lights a 3s fuse, then it explodes, destroying
// nearby blocks (with particles) and igniting any TNT caught in the blast.
// ---------------------------------------------------------------------------
const FUSE_TIME = 3;
const BLAST_RADIUS = 3;
const tntLit = new Map();
const bursts = [];
const flashes = [];

function igniteTNT(x, y, z) {
  const k = key(x, y, z);
  if (tntLit.has(k)) return;
  const spr = makeFuseSprite();
  spr.position.set(x + 0.5, y + 1.35, z + 0.5);
  scene.add(spr);
  tntLit.set(k, { x, y, z, fuse: FUSE_TIME, spr });
}

function makeFuseSprite() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(1.5, 0.75, 1);
  spr.userData = { c, ctx, tex };
  return spr;
}
function drawFuseSprite(spr, v) {
  const { c, ctx, tex } = spr.userData;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = "bold 52px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(v.toFixed(1), 64, 32);
  ctx.fillStyle = v <= 1 ? "#ff6a3d" : "#ffffff";
  ctx.fillText(v.toFixed(1), 64, 32);
  tex.needsUpdate = true;
}

function tickTNT(dt) {
  for (const [k, t] of [...tntLit]) {
    t.fuse -= dt;
    if (t.fuse <= 0) {
      scene.remove(t.spr);
      t.spr.material.map.dispose();
      t.spr.material.dispose();
      tntLit.delete(k);
      explodeTNT(t.x, t.y, t.z);
    } else {
      drawFuseSprite(t.spr, t.fuse);
    }
  }
}

function explodeTNT(x, y, z) {
  setBlock(x, y, z, AIR);
  spawnExplosion(x + 0.5, y + 0.5, z + 0.5);
  damageDragon(x + 0.5, y + 0.5, z + 0.5);
  const R = BLAST_RADIUS, R2 = R * R;
  const affected = [];
  for (let dx = -R; dx <= R; dx++)
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        const bx = x + dx, by = y + dy, bz = z + dz;
        const id = getBlock(bx, by, bz);
        if (id === AIR || id === WATER) continue;
        if (id === STONE && by === 0) continue;
        if (id === TNT) {
          if (!tntLit.has(key(bx, by, bz))) igniteTNT(bx, by, bz);
          continue;
        }
        affected.push([bx, by, bz]);
      }
  if (affected.length) {
    for (const [bx, by, bz] of affected) setBlock(bx, by, bz, AIR);
    rebuildMeshes();
    queueSave();
  }
}

function spawnExplosion(cx, cy, cz) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffdd77, transparent: true, opacity: 0.95 })
  );
  flash.position.set(cx, cy, cz);
  scene.add(flash);
  flashes.push({ mesh: flash, born: performance.now(), life: 0.28 });

  const N = 64;
  const posA = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    posA[i * 3] = cx; posA[i * 3 + 1] = cy; posA[i * 3 + 2] = cz;
    colA[i * 3] = 1; colA[i * 3 + 1] = 0.55 + Math.random() * 0.4; colA[i * 3 + 2] = 0.1 + Math.random() * 0.2;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = 4 + Math.random() * 8;
    vel[i * 3] = s * Math.sin(ph) * Math.cos(th);
    vel[i * 3 + 1] = s * Math.cos(ph) + 3;
    vel[i * 3 + 2] = s * Math.sin(ph) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posA, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.18, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  bursts.push({ pts, geo, mat, vel, life: 0.8, max: 0.8 });
}

function tickEffects(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life -= dt;
    const attr = b.pts.geometry.attributes.position;
    for (let j = 0; j < attr.count; j++) {
      attr.array[j * 3] += b.vel[j * 3] * dt;
      attr.array[j * 3 + 1] += b.vel[j * 3 + 1] * dt;
      attr.array[j * 3 + 2] += b.vel[j * 3 + 2] * dt;
      b.vel[j * 3 + 1] -= 22 * dt;
    }
    attr.needsUpdate = true;
    if (b.life <= 0) {
      scene.remove(b.pts);
      b.geo.dispose();
      b.mat.dispose();
      bursts.splice(i, 1);
    } else {
      b.mat.opacity = Math.min(1, b.life / b.max);
    }
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = (performance.now() - f.born) / 1000;
    if (age >= f.life) {
      scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
      flashes.splice(i, 1);
      continue;
    }
    const t = age / f.life;
    f.mesh.scale.setScalar(0.4 + t * 4.2);
    f.mesh.material.opacity = 0.95 * (1 - t);
  }
}

// ---------------------------------------------------------------------------
// Portals & The End dimension
// ---------------------------------------------------------------------------
let portalCd = 0;
let returnPortalBuilt = false;
let overPortalSpawn = { x: 0.5, y: 1.01, z: 0.5 };

function setDimensionEnv() {
  if (dim === "end") {
    scene.background.setHex(0x07070f);
    scene.fog.color.setHex(0x07070f);
    scene.fog.near = 30; scene.fog.far = 150;
    sun.intensity = 0.35; hemi.intensity = 0.45;
  } else {
    scene.background.setHex(0x87ceeb);
    scene.fog.color.setHex(0x87ceeb);
    scene.fog.near = 60; scene.fog.far = 160;
    sun.intensity = 1.1; hemi.intensity = 0.75;
  }
}

function buildReturnPortal() {
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++) {
      const isCorner = (x === -2 && z === -2) || (x === -2 && z === 2) || (x === 2 && z === -2) || (x === 2 && z === 2);
      const isEdge = x === -2 || x === 2 || z === -2 || z === 2;
      if (isEdge && !isCorner) setBlock(x, 21, z, PORTAL);
    }
  returnPortalBuilt = true;
}

function goToDimension(name, sx, sy, sz) {
  dim = name;
  world = worlds[name];
  if (name === "end") {
    if (worlds.end.size === 0) generateEnd();
    if (!returnPortalBuilt) buildReturnPortal();
    if (!dragon.alive) spawnDragon();
    setDimensionEnv();
  } else {
    setDimensionEnv();
    if (dragon.alive) { scene.remove(dragon.mesh); dragon.mesh = null; dragon.alive = false; }
  }
  rebuildMeshes();
  pos.set(sx, sy, sz);
  camPos.set(sx, sy, sz);
  vel.set(0, 0, 0);
  updateCamera();
  portalCd = 1.5;
  queueSave();
  updateDimLabel();
}

function findPortalWindow(bx, by, bz) {
  for (let wx = -1; wx <= 1; wx++)
    for (let wz = -1; wz <= 1; wz++) {
      const minX = bx + wx, minZ = bz + wz;
      const maxX = minX + 4, maxZ = minZ + 4;
      let ok = true;
      for (let x = minX; x <= maxX && ok; x++)
        for (let z = minZ; z <= maxZ && ok; z++) {
          const isCorner = (x === minX && z === minZ) || (x === minX && z === maxZ) || (x === maxX && z === minZ) || (x === maxX && z === maxZ);
          const isEdge = x === minX || x === maxX || z === minZ || z === maxZ;
          if (isCorner) continue;
          const id = getBlock(x, by, z);
          if (isEdge) { if (id !== PORTAL) ok = false; }
          else { if (id !== AIR) ok = false; }
        }
      if (ok) return { minX, minZ, by };
    }
  return null;
}

let portalGlow = null;

function syncPortalGlow(win) {
  if (!win) { clearPortalGlow(); return; }
  const key = `${win.minX},${win.minZ},${win.by}`;
  if (portalGlow && portalGlow.userData.key === key) return;
  clearPortalGlow();
  const geo = new THREE.PlaneGeometry(3, 3);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(win.minX + 2, win.by + 0.55, win.minZ + 2);
  mesh.userData.key = key;
  scene.add(mesh);
  portalGlow = mesh;
}

function clearPortalGlow() {
  if (portalGlow) {
    scene.remove(portalGlow);
    portalGlow.geometry.dispose();
    portalGlow.material.dispose();
    portalGlow = null;
  }
}

function updatePortalVisual() {
  if (dim !== "over" || freeCam) { clearPortalGlow(); return; }
  const bx = Math.floor(pos.x), bz = Math.floor(pos.z);
  const by = Math.floor(pos.y + 0.9);
  syncPortalGlow(findPortalWindow(bx, by, bz));
}

function checkPortal() {
  if (portalCd > 0 || freeCam) return;
  const bx = Math.floor(pos.x), bz = Math.floor(pos.z);
  const by = Math.floor(pos.y + 0.9);
  const win = findPortalWindow(bx, by, bz);
  if (!win) return;
  if (bx < win.minX + 1 || bx > win.minX + 3 || bz < win.minZ + 1 || bz > win.minZ + 3) return;
  if (dim === "over") {
    overPortalSpawn = { x: win.minX + 1.5, y: win.by + 1.01, z: win.minZ + 1.5 };
    goToDimension("end", 0.5, 21.6, 4);
    showMsg("You arrived in The End");
  } else {
    goToDimension("over", overPortalSpawn.x, overPortalSpawn.y, overPortalSpawn.z);
    showMsg("You returned to the Overworld");
  }
}

// ---------------------------------------------------------------------------
// Ender Dragon (The End boss)
// ---------------------------------------------------------------------------
const dragon = { mesh: null, alive: false, hp: 100, maxHp: 100, angle: 0, wingL: null, wingR: null };

function spawnDragon() {
  if (dragon.mesh) return;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.6 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 5), bodyMat);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.8), accentMat); head.position.set(0, 0.5, 3.1);
  const eL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.1), eyeMat); eL.position.set(-0.4, 0.7, 4.0);
  const eR = eL.clone(); eR.position.x = 0.4;
  const wingGeo = new THREE.BoxGeometry(4.5, 0.15, 2.6);
  const wL = new THREE.Mesh(accentMat, accentMat); wL.position.set(-3.3, 0.5, 0);
  const wR = new THREE.Mesh(accentMat, accentMat); wR.position.set(3.3, 0.5, 0);
  g.add(body, head, eL, eR, wL, wR);
  scene.add(g);
  dragon.mesh = g; dragon.alive = true; dragon.hp = dragon.maxHp; dragon.angle = 0;
  dragon.wingL = wL; dragon.wingR = wR;
  updateBossBar();
}

function updateDragon(dt) {
  if (!dragon.alive || !dragon.mesh) return;
  dragon.angle += dt * 0.35;
  const r = 14;
  dragon.mesh.position.set(Math.cos(dragon.angle) * r, 18 + Math.sin(dragon.angle * 2) * 2, Math.sin(dragon.angle) * r);
  dragon.mesh.rotation.y = -dragon.angle + Math.PI / 2;
  const f = Math.sin(performance.now() * 0.012) * 0.6;
  dragon.wingL.rotation.z = f; dragon.wingR.rotation.z = -f;
}

function damageDragon(cx, cy, cz) {
  if (!dragon.alive || !dragon.mesh) return;
  const d = Math.hypot(dragon.mesh.position.x - cx, dragon.mesh.position.y - cy, dragon.mesh.position.z - cz);
  if (d < 9) {
    dragon.hp -= 34;
    updateBossBar();
    if (dragon.hp <= 0) {
      dragon.alive = false;
      scene.remove(dragon.mesh);
      dragon.mesh = null;
      updateBossBar();
      showMsg("The Ender Dragon is defeated!");
    }
  }
}

// ---------------------------------------------------------------------------
// Save / load
// Normal mode (run `python3 server.py`, open http://localhost:8383): every world is a
// .sav file in save/ on disk, named when you press New World.
// Fallback when opened straight from disk or a plain static server:
// Chromium saves to a user-picked file; Firefox/Safari keep it in IndexedDB,
// J exports it as .sav, Load imports one. Same binary format either way.
// ---------------------------------------------------------------------------
const SAVE_MAGIC = [0x4d, 0x49, 0x4e, 0x49, 0x43, 0x52, 0x41, 0x46, 0x54]; // "MINICRAFT"
const fileMode = "showSaveFilePicker" in window && "showOpenFilePicker" in window;
const fileDirOK = typeof window.showDirectoryPicker === "function";
const hasIDB = typeof indexedDB !== "undefined";
const apiOkPromise = fetch("api/worlds").then((r) => r.ok).catch(() => false);
let apiOk = false;
apiOkPromise.then((v) => { apiOk = v; });
let saveHandle = null;
let saveName = "";
let started = false;
let lastManualSave = 0;
const autosaveEl = document.getElementById("autosave");

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("minicraft", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("saves");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function storageSave(buf) {
  const db = await dbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("saves", "readwrite");
    tx.objectStore("saves").put(buf, "autosave");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function storageLoad() {
  const db = await dbOpen();
  const buf = await new Promise((resolve, reject) => {
    const req = db.transaction("saves", "readonly").objectStore("saves").get("autosave");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return buf;
}
async function storageClear() {
  const db = await dbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("saves", "readwrite");
    tx.objectStore("saves").delete("autosave");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function serialize() {
  const writeBlocks = (map) => {
    const arr = [];
    map.forEach((id, k) => { const s = k.split(","); arr.push([+s[0], +s[1], +s[2], id]); });
    return arr;
  };
  const over = writeBlocks(worlds.over);
  const end = writeBlocks(worlds.end);
  const n = over.length + end.length;
  const buf = new ArrayBuffer(93 + n * 4);
  const dv = new DataView(buf);
  let o = 0;
  new Uint8Array(buf, o, 9).set(SAVE_MAGIC); o += 9;
  dv.setUint8(o++, 2); // format version
  dv.setUint8(o++, dim === "end" ? 1 : 0);
  dv.setInt32(o, seed, true); o += 4;
  dv.setInt32(o, endSeed, true); o += 4;
  dv.setFloat64(o, pos.x, true); o += 8;
  dv.setFloat64(o, pos.y, true); o += 8;
  dv.setFloat64(o, pos.z, true); o += 8;
  dv.setFloat64(o, yaw, true); o += 8;
  dv.setFloat64(o, pitch, true); o += 8;
  dv.setUint8(o++, flying ? 1 : 0);
  dv.setUint8(o++, selected);
  dv.setFloat64(o, overPortalSpawn.x, true); o += 8;
  dv.setFloat64(o, overPortalSpawn.y, true); o += 8;
  dv.setFloat64(o, overPortalSpawn.z, true); o += 8;
  dv.setUint32(o, over.length, true); o += 4;
  for (const [x, y, z, id] of over) {
    dv.setUint8(o++, x + 128);
    dv.setUint8(o++, y);
    dv.setUint8(o++, z + 128);
    dv.setUint8(o++, id);
  }
  dv.setUint32(o, end.length, true); o += 4;
  for (const [x, y, z, id] of end) {
    dv.setUint8(o++, x + 128);
    dv.setUint8(o++, y);
    dv.setUint8(o++, z + 128);
    dv.setUint8(o++, id);
  }
  return buf;
}

function deserialize(buf) {
  const dv = new DataView(buf);
  let o = 0;
  for (let i = 0; i < 9; i++) if (new Uint8Array(buf, o, 9)[i] !== SAVE_MAGIC[i]) throw new Error("Not a MiniCraft save");
  o += 9;
  const ver = dv.getUint8(o++);
  if (ver !== 1 && ver !== 2) throw new Error("Unsupported save version");
  let dimFlag = 0, endSeedVal = endSeed;
  if (ver >= 2) { dimFlag = dv.getUint8(o++); endSeedVal = dv.getInt32(o, true); o += 4; }
  seed = dv.getInt32(o, true); o += 4;
  if (ver >= 2) endSeed = endSeedVal;
  pos.x = dv.getFloat64(o, true); o += 8;
  pos.y = dv.getFloat64(o, true); o += 8;
  pos.z = dv.getFloat64(o, true); o += 8;
  yaw = dv.getFloat64(o, true); o += 8;
  pitch = dv.getFloat64(o, true); o += 8;
  flying = dv.getUint8(o++) === 1;
  selected = dv.getUint8(o++);
  overPortalSpawn = { x: dv.getFloat64(o, true), y: dv.getFloat64(o, true), z: dv.getFloat64(o, true) };
  o += 24;
  const n = dv.getUint32(o, true); o += 4;
  worlds.over.clear();
  for (let i = 0; i < n; i++) {
    const x = dv.getUint8(o++) - 128;
    const y = dv.getUint8(o++);
    const z = dv.getUint8(o++) - 128;
    worlds.over.set(key(x, y, z), dv.getUint8(o++));
  }
  if (ver >= 2) {
    const ne = dv.getUint32(o, true); o += 4;
    worlds.end.clear();
    for (let i = 0; i < ne; i++) {
      const x = dv.getUint8(o++) - 128;
      const y = dv.getUint8(o++);
      const z = dv.getUint8(o++) - 128;
      worlds.end.set(key(x, y, z), dv.getUint8(o++));
    }
  }
  dim = dimFlag ? "end" : "over";
  world = worlds[dim];
}

function canSave() {
  if (apiOk && saveName) return true;
  return fileMode ? !!saveHandle : hasIDB;
}

function updateAutosaveEl() {
  if (!autosaveEl) return;
  if (apiOk) {
    autosaveEl.textContent = saveName
      ? "World: " + saveName + (lastManualSave ? " · saved " + new Date(lastManualSave).toLocaleTimeString() : "")
      : "Start a world with New World";
    return;
  }
  if (!fileMode && !hasIDB) autosaveEl.textContent = "Autosave: not supported in this browser";
  else if (!canSave()) autosaveEl.textContent = started ? "No save file (press J)" : fileMode ? "Pick a save file when you start" : "Autosave: kept in your browser";
  else if (lastManualSave) autosaveEl.textContent = "Saved " + new Date(lastManualSave).toLocaleTimeString();
  else autosaveEl.textContent = fileMode ? "Save file: " + saveHandle.name : "Autosave: on (in browser)";
}

function updateCamera() {
  camera.position.set(pos.x, pos.y + EYE, pos.z);
  camera.rotation.set(pitch, yaw, 0);
}

// ---------------------------------------------------------------------------
// HUD (dimension label, boss bar, toast)
// ---------------------------------------------------------------------------
const dimEl = document.getElementById("dim");
const bossEl = document.getElementById("boss");
const bossFill = bossEl.querySelector(".fill");
const toastEl = document.getElementById("toast");
let toastTimer = 0;

function updateDimLabel() {
  if (!started) { dimEl.style.display = "none"; return; }
  dimEl.textContent = dim === "end" ? "The End" : "Overworld";
  dimEl.style.display = "block";
}
function updateBossBar() {
  if (dim === "end" && dragon.alive) {
    bossEl.style.display = "block";
    bossFill.style.width = Math.max(0, (dragon.hp / dragon.maxHp) * 100) + "%";
  } else {
    bossEl.style.display = "none";
  }
}
function showMsg(text) {
  toastEl.textContent = text;
  toastEl.style.opacity = "1";
  toastTimer = 2.6;
}

function downloadSave(buf) {
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "minicraft.sav";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function apiList() {
  const res = await fetch("api/worlds");
  return res.ok ? await res.json() : [];
}
async function apiLoad(name) {
  const res = await fetch("api/worlds/" + encodeURIComponent(name));
  if (!res.ok) throw new Error("Save not found");
  return await res.arrayBuffer();
}
function normalizeWorldName(raw) {
  let n = (raw || "").trim().replace(/[\\/]/g, "_");
  n = n.replace(/\.\.+/g, "_").replace(/^\.+/, "").trim();
  if (!n) return null;
  if (!n.toLowerCase().endsWith(".sav")) n += ".sav";
  return n;
}
function dialogEl() {
  const dlg = document.createElement("div");
  dlg.className = "dlg";
  const box = document.createElement("div");
  box.className = "dlg-box";
  dlg.appendChild(box);
  document.body.appendChild(dlg);
  return { dlg, box };
}
function askName(title, initial) {
  return new Promise((resolve) => {
    const { dlg, box } = dialogEl();
    box.innerHTML = "<h2>" + title + "</h2>" +
      '<input class="dlg-input" type="text" value="" spellcheck="false" placeholder="world name"/>' +
      '<div class="dlg-actions"><button class="dlg-cancel">Cancel</button><button class="dlg-ok">Create</button></div>';
    const input = box.querySelector(".dlg-input");
    const finish = (v) => { dlg.remove(); resolve(v); };
    const ok = () => { const n = normalizeWorldName(input.value); if (n) finish(n); };
    box.querySelector(".dlg-ok").onclick = ok;
    box.querySelector(".dlg-cancel").onclick = () => finish(null);
    input.onkeydown = (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") finish(null); };
    dlg.onmousedown = (e) => { if (e.target === dlg) finish(null); };
    box.onmousedown = (e) => e.stopPropagation();
    input.value = initial;
    input.focus();
    input.select();
  });
}

// Firefox/Safari have no File System Access API, so the OS picker can't be
// dropped into save/. Show the folder contents instead; click a row to load.
function pickWorld(entries) {
  return new Promise((resolve) => {
    const names = entries.map((e) => (typeof e === "string" ? e : e.name));
    const { dlg, box } = dialogEl();
    let html = "<h2>Load save</h2>" +
      '<div class="dlg-path">~/projects/tech/minicraft/save/</div>';
    if (!names.length) {
      html += '<div class="dlg-empty">No saves in save/ yet. Create one with New World.</div>' +
        '<div class="dlg-actions"><button class="dlg-cancel">Close</button></div>';
    } else {
      html += '<ul class="dlg-list">' + names.map((n) =>
        '<li data-name="' + n + '"><span class="w">' + n.replace(/\.sav$/i, "") +
        '</span></li>').join("") +
        '</ul><div class="dlg-actions"><button class="dlg-cancel">Cancel</button></div>';
    }
    box.innerHTML = html;
    const finish = (v) => { dlg.remove(); resolve(v); };
    dlg.onmousedown = (e) => { if (e.target === dlg) finish(null); };
    box.onmousedown = (e) => e.stopPropagation();
    box.querySelector(".dlg-cancel").onclick = () => finish(null);
    box.querySelectorAll("li").forEach((li) => {
      li.onclick = () => finish(li.dataset.name);
    });
  });
}

// Saving the whole save/ directory handle (Chrome/Edge File System Access)
// so loaders start straight inside save/ instead of asking every time.
function idbPut(key, val) {
  return new Promise((resolve, reject) => {
    dbOpen().then((db) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put(val, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  });
}
function idbGet(key) {
  return new Promise((resolve, reject) => {
    dbOpen().then((db) => {
      const req = db.transaction("saves", "readonly").objectStore("saves").get(key);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => reject(req.error);
    });
  });
}
let saveDirPromise = null;
function getSaveDir() {
  if (!fileDirOK) return Promise.resolve(null);
  if (!saveDirPromise) {
    saveDirPromise = (async () => {
      let h = await idbGet("savedir").catch(() => null);
      if (h) {
        try {
          if (await h.queryPermission({ mode: "read" }) !== "granted") {
            await h.requestPermission({ mode: "read" });
          }
        } catch { h = null; }
      }
      if (!h) {
        try {
          h = await window.showDirectoryPicker({ id: "minicraft-save-dir", mode: "read" });
          await idbPut("savedir", h).catch(() => {});
        } catch { return null; }
      }
      return h;
    })();
    saveDirPromise.then((h) => { if (!h) saveDirPromise = null; });
  }
  return saveDirPromise;
}

async function pickSaveFile() {
  apiOk = await apiOkPromise;
  if (apiOk) {
    if (saveName) await saveToFile();
    return;
  }
  if (fileMode) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "minicraft.sav",
        types: [{ description: "MiniCraft save", accept: { "application/octet-stream": [".sav"] } }],
      });
      try { await handle.requestPermission({ mode: "readwrite" }); } catch {}
      saveHandle = handle;
      await saveToFile();
      updateAutosaveEl();
    } catch {}
  } else if (hasIDB) {
    try { await storageSave(serialize()); } catch {}
    downloadSave(serialize());
    lastManualSave = Date.now();
    updateAutosaveEl();
  }
}

async function saveToFile(opts = {}) {
  if (apiOk && saveName) {
    try {
      const res = await fetch("api/worlds/" + encodeURIComponent(saveName), {
        method: "PUT", body: serialize(), keepalive: !!opts.keepalive,
      });
      if (res.ok) { lastManualSave = Date.now(); updateAutosaveEl(); }
      else throw new Error("save failed");
    } catch {
      if (autosaveEl) autosaveEl.textContent = "Save failed — run `python3 server.py` and open http://localhost:8383";
    }
    return;
  }
  if (!canSave()) return;
  const buf = serialize();
  try {
    if (fileMode) {
      const writable = await saveHandle.createWritable();
      await writable.write(buf);
      await writable.close();
    } else {
      await storageSave(buf);
    }
    lastManualSave = Date.now();
    updateAutosaveEl();
  } catch (e) {
    if (autosaveEl) autosaveEl.textContent = fileMode
      ? "Autosave failed (file deleted or permission revoked) — press J to pick a new file"
      : "Autosave failed (storage unavailable)";
  }
}

function importSaveFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sav,application/octet-stream";
    input.style.display = "none";
    let done = false;
    const finish = (v) => { if (done) return; done = true; removeEventListener("focus", onFocus); resolve(v); };
    const onFocus = () => setTimeout(() => finish(null), 400);
    input.onchange = async () => {
      const file = input.files && input.files[0];
      finish(file ? { name: file.name, buf: await file.arrayBuffer() } : null);
    };
    document.body.appendChild(input);
    input.click();
    input.remove();
    addEventListener("focus", onFocus);
  });
}

function restoreSave(buf) {
  deserialize(buf);
  rebuildMeshes();
  select(selected);
  updateCamera();
  setDimensionEnv();
  updateDimLabel();
  updateBossBar();
  if (dim === "end") { returnPortalBuilt = true; if (!dragon.alive) spawnDragon(); }
  lastManualSave = Date.now();
  return true;
}

async function loadSave() {
  apiOk = await apiOkPromise;
  if (apiOk) {
    if (fileDirOK) {
      const dir = await getSaveDir();
      if (!dir) return false;
      const opts = {
        startIn: dir,
        types: [{ description: "MiniCraft save", accept: { "application/octet-stream": [".sav"] } }],
        multiple: false,
      };
      try {
        const [handle] = await window.showOpenFilePicker(opts);
        const file = await handle.getFile();
        saveName = normalizeWorldName(file.name) || file.name;
        restoreSave(await file.arrayBuffer());
        await saveToFile();
        updateAutosaveEl();
        return true;
      } catch { return false; }
    }
    const list = await apiList();
    const name = await pickWorld(list);
    if (!name) return false;
    try {
      saveName = name;
      restoreSave(await apiLoad(name));
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch {
      if (autosaveEl) autosaveEl.textContent = "That file isn't a valid MiniCraft save.";
      return false;
    }
  }
  if (fileMode) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "MiniCraft save", accept: { "application/octet-stream": [".sav"] } }],
      });
      saveHandle = handle;
      const file = await handle.getFile();
      restoreSave(await file.arrayBuffer());
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch { return false; }
  }
  const picked = await importSaveFile();
  if (picked) {
    try {
      restoreSave(picked.buf);
      await saveToFile();
      updateAutosaveEl();
      return true;
    } catch {
      if (autosaveEl) autosaveEl.textContent = "That file isn't a valid MiniCraft save.";
      return false;
    }
  }
  const cached = await storageLoad();
  if (cached) {
    try {
      restoreSave(cached);
      updateAutosaveEl();
      return true;
    } catch { return false; }
  }
  if (autosaveEl) autosaveEl.textContent = "No save found.";
  return false;
}

function resetDims() {
  dim = "over";
  world = worlds.over;
  worlds.end.clear();
  returnPortalBuilt = false;
  overPortalSpawn = { x: 0.5, y: 1.01, z: 0.5 };
  if (dragon.alive) { scene.remove(dragon.mesh); dragon.mesh = null; dragon.alive = false; }
  setDimensionEnv();
  updateDimLabel();
  updateBossBar();
}

async function regenerate() {
  if (fileMode && !saveHandle) await pickSaveFile();
  resetDims();
  seed = Math.floor(Math.random() * 100000);
  generateWorld();
  rebuildMeshes();
  spawnPlayer();
  select(0);
  updateCamera();
  queueSave();
}

function queueSave() {
  if (!canSave()) return;
  const now = Date.now();
  if (now - lastManualSave > 3000) { lastManualSave = now; saveToFile(); }
}

function enterGame() {
  started = true;
  updateAutosaveEl();
  renderer.domElement.requestPointerLock();
}

setInterval(() => { if (canSave() && started) saveToFile(); }, 10000);
addEventListener("pagehide", () => { if (canSave()) saveToFile({ keepalive: true }); });
document.addEventListener("visibilitychange", () => { if (document.hidden && canSave()) saveToFile({ keepalive: true }); });

// ---------------------------------------------------------------------------
// UI / hotbar
// ---------------------------------------------------------------------------
const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, WATER, TNT, PORTAL];
let selected = 0;
const hotbarEl = document.getElementById("hotbar");

function iconSrc(id) {
  const texs = materialsFor(id);
  const map = texs[0].map;
  return map.image.toDataURL();
}
function buildHotbar() {
  hotbarEl.innerHTML = "";
  HOTBAR.forEach((id, i) => {
    const slot = document.createElement("div");
    slot.className = "slot" + (i === selected ? " selected" : "");
    const img = document.createElement("img");
    img.src = iconSrc(id);
    slot.appendChild(img);
    slot.addEventListener("click", () => select(i));
    hotbarEl.appendChild(slot);
  });
}
function select(i) {
  selected = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
  [...hotbarEl.children].forEach((c, j) => c.classList.toggle("selected", j === selected));
}
document.addEventListener("wheel", (e) => select(selected + (e.deltaY > 0 ? 1 : -1)), { passive: true });

// ---------------------------------------------------------------------------
// Input / pointer lock
// ---------------------------------------------------------------------------
const overlay = document.getElementById("overlay");
const crosshair = document.getElementById("crosshair");
const info = document.getElementById("info");

overlay.addEventListener("click", () => {
  if (!started) return;
  renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener("click", () => {
  if (started && !locked && !helpOpen) renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  const wasLocked = locked;
  locked = document.pointerLockElement === renderer.domElement;
  if (suppressMenu) { suppressMenu = false; return; }
  if (helpOpen) return;
  if (!locked && Date.now() - helpCloseTime < 2000) return;
  if (wasLocked && !locked && started) saveToFile();
  overlay.style.display = locked ? "none" : "flex";
  crosshair.style.display = locked ? "block" : "none";
  hotbarEl.style.display = locked ? "flex" : "none";
  info.style.display = locked ? "block" : "none";
});

document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});

document.addEventListener("mousedown", (e) => {
  if (!locked || helpOpen) return;
  if (e.button === 0) placeBlock(HOTBAR[selected]);
  if (e.button === 2) breakBlock();
});

const helpEl = document.getElementById("help");
let helpOpen = false;
let suppressMenu = false;
let helpCloseTime = 0;
function openHelp() {
  helpOpen = true;
  helpEl.style.display = "flex";
  if (document.pointerLockElement === renderer.domElement) {
    suppressMenu = true;
    document.exitPointerLock();
  }
}
function closeHelp() {
  helpOpen = false;
  helpEl.style.display = "none";
}
function closeHelpAndResume() {
  closeHelp();
  helpCloseTime = Date.now();
  if (!started) return;
  const tryLock = (attempt) => {
    if (document.pointerLockElement === renderer.domElement) return;
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => { if (attempt < 5) setTimeout(() => tryLock(attempt + 1), 400); });
  };
  tryLock(0);
}
helpEl.addEventListener("click", (e) => { if (e.target === helpEl) closeHelpAndResume(); });
helpEl.querySelector("#btnHelpClose").addEventListener("click", closeHelpAndResume);

document.addEventListener("keydown", (e) => {
  if (helpOpen) {
    if (e.code === "Escape") { closeHelpAndResume(); e.preventDefault(); }
    return;
  }
  if (e.code === "KeyH" && !keys[e.code]) { openHelp(); e.preventDefault(); return; }
  if (keys[e.code]) { e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === "KeyF") { freeCam = !freeCam; if (freeCam) camPos.copy(camera.position); else exitFreeCam(); }
  if (e.code === "Escape") { if (saveName) saveToFile(); }
  if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
});
document.addEventListener("keyup", (e) => { keys[e.code] = false; });
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.getElementById("btnNew").addEventListener("click", async (e) => {
  e.stopPropagation();
  apiOk = await apiOkPromise;
  if (apiOk) {
    const name = await askName("New World", "world");
    if (!name) return;
    const existing = await apiList();
    if (existing.some((w) => w.name === name) && !confirm("Overwrite existing save '" + name.replace(/\.sav$/i, "") + "'?")) return;
    saveName = name;
    resetDims();
    seed = Math.floor(Math.random() * 100000);
    generateWorld();
    rebuildMeshes();
    spawnPlayer();
    select(0);
    updateCamera();
    enterGame();
    await saveToFile();
    return;
  }
  if (fileMode) await pickSaveFile();
  resetDims();
  seed = Math.floor(Math.random() * 100000);
  generateWorld();
  rebuildMeshes();
  spawnPlayer();
  select(0);
  updateCamera();
  enterGame();
});
document.getElementById("btnLoad").addEventListener("click", async (e) => {
  e.stopPropagation();
  if (await loadSave()) enterGame();
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (freeCam) {
    updateFreeCam(dt);
    camera.position.copy(camPos);
  } else {
    updatePlayer(dt);
    camera.position.set(pos.x, pos.y + EYE, pos.z);
    if (pos.y < -20) { vel.set(0, 0, 0); spawnPlayer(); }
  }
  camera.rotation.set(pitch, yaw, 0);
  updateTarget();
  tickTNT(dt);
  tickEffects(dt);
  if (portalCd > 0) portalCd -= dt;
  updatePortalVisual();
  checkPortal();
  if (dim === "end") updateDragon(dt);
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = "0"; }

  // Gentle water shimmer
  if (instanced[WATER]) {
    const o = 0.55 + 0.1 * Math.sin(now * 0.002);
    for (const m of instanced[WATER].material) m.opacity = o;
  }
  if (portalGlow) portalGlow.material.opacity = 0.2 + 0.1 * Math.sin(now * 0.004);

  renderer.render(scene, camera);
}

const SVGNS = "http://www.w3.org/2000/svg";
let dt = 0.016;
buildHotbar();
buildPortalArt();
requestAnimationFrame(loop);

function buildPortalArt() {
  const host = document.getElementById("portalArt");
  if (!host) return;
  const N = 5, cell = 19, size = 15, off = 6;
  const w = off * 2 + (N - 1) * cell + size;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${w}`);
  svg.setAttribute("width", "150");
  svg.setAttribute("height", "150");
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const isCorner = (r === 0 && c === 0) || (r === 0 && c === N - 1) || (r === N - 1 && c === 0) || (r === N - 1 && c === N - 1);
      const isEdge = r === 0 || r === N - 1 || c === 0 || c === N - 1;
      if (!isEdge || isCorner) continue;
      const x = off + c * cell, y = off + r * cell;
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("x", x); rect.setAttribute("y", y);
      rect.setAttribute("width", size); rect.setAttribute("height", size); rect.setAttribute("rx", 3);
      rect.setAttribute("fill", "#5a2da6");
      rect.setAttribute("stroke", "#7b2ff7"); rect.setAttribute("stroke-width", "1.5");
      svg.appendChild(rect);
    }
  host.appendChild(svg);
}
