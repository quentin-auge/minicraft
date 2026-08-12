import * as THREE from "three";

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, WATER = 7, PLANKS = 8, GLASS = 9;

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
  glass: canvasTex((ctx) => {
    ctx.fillStyle = "rgba(190,230,255,0.55)"; ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, 14.5, 14.5);
    ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(8, 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(15, 8); ctx.stroke();
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

function key(x, y, z) { return x + "," + y + "," + z; }

const world = new Map();
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
  world.clear();
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
let yaw = 0, pitch = 0;
let onGround = false, flying = false, locked = false;
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
  const w = keys["KeyW"] || keys["ArrowUp"];
  const s = keys["KeyS"] || keys["ArrowDown"];
  const d = keys["KeyD"] || keys["ArrowRight"];
  const a = keys["KeyA"] || keys["ArrowLeft"];
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
const REACH = 6;
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
  setBlock(x, y, z, AIR);
  rebuildMeshes();
}
function placeBlock(id) {
  if (!currentBlock) return;
  const [nx, ny, nz] = currentBlock.face;
  const px = currentBlock.x + nx, py = currentBlock.y + ny, pz = currentBlock.z + nz;
  if (getBlock(px, py, pz) !== AIR) return;
  if (intersectsPlayer(px, py, pz)) return;
  setBlock(px, py, pz, id);
  rebuildMeshes();
}
function intersectsPlayer(bx, by, bz) {
  return (
    bx + 1 > pos.x - PLAYER_HW && bx < pos.x + PLAYER_HW &&
    by + 1 > pos.y && by < pos.y + PLAYER_H &&
    bz + 1 > pos.z - PLAYER_HW && bz < pos.z + PLAYER_HW
  );
}

// ---------------------------------------------------------------------------
// UI / hotbar
// ---------------------------------------------------------------------------
const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, GLASS, LEAVES, WATER];
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
    const keyEl = document.createElement("div");
    keyEl.className = "key";
    keyEl.textContent = i === 8 ? "0" : i + 1;
    slot.appendChild(keyEl);
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
  renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
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
  if (!locked) return;
  if (e.button === 0) breakBlock();
  if (e.button === 2) placeBlock(HOTBAR[selected]);
});

document.addEventListener("keydown", (e) => {
  if (keys[e.code]) { e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === "KeyF") flying = !flying;
  if (e.code === "KeyR") { seed = Math.floor(Math.random() * 100000); generateWorld(); rebuildMeshes(); spawnPlayer(); }
  if (e.code === "KeyP") { vel.set(0, 0, 0); spawnPlayer(); }
  if (e.code === "KeyE") { select((selected + 1) % HOTBAR.length); }
  if (e.code === "KeyQ") { select((selected - 1 + HOTBAR.length) % HOTBAR.length); }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9) select(n - 1);
  if (e.key === "0") select(8);
  if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
});
document.addEventListener("keyup", (e) => { keys[e.code] = false; });
document.addEventListener("contextmenu", (e) => e.preventDefault());

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

  updatePlayer(dt);
  camera.position.set(pos.x, pos.y + EYE, pos.z);
  camera.rotation.set(pitch, yaw, 0);
  updateTarget();

  if (pos.y < -20) { vel.set(0, 0, 0); spawnPlayer(); }

  // Gentle water shimmer
  if (instanced[WATER]) {
    const o = 0.55 + 0.1 * Math.sin(now * 0.002);
    for (const m of instanced[WATER].material) m.opacity = o;
  }

  renderer.render(scene, camera);
}

let dt = 0.016;
generateWorld();
rebuildMeshes();
spawnPlayer();
buildHotbar();
requestAnimationFrame(loop);
