// MiniCraft static bootstrap: scene, input, main loop, world startup.
// No saves, no network — Play builds a fresh random world in the browser.
import * as THREE from "three";
import { generateOverworld } from "./src/world/overworld.js";
import {
  pos, vel, keys, setYaw, setPitch,
  spawnPlayer, updatePlayer,
} from "./src/player/physics.js";
import * as player from "./src/player/physics.js";
import { flyOn, setFly, updateFly } from "./src/player/fly.js";
import { updateTarget, breakTarget, placeAtSelection, breakBlockAt } from "./src/player/edit.js";
import { tickTNT, initTNTFx } from "./src/fx/tnt.js";
import { initFx, tickFx } from "./src/fx/particles.js";
import { initRenderer, rebuildAll, maybeStream, refreshBlocks, drainChunkQueue, hasPendingChunks } from "./src/render/mesher.js";
import { buildHotbar, select, selected, selectedId, initHotbarInput } from "./src/ui/hotbar.js";
import { initMenu, enterGame, setLoading, started, loading, isLocked } from "./src/ui/menu.js";
import { initHelp, openHelp, closeHelp, isHelpOpen } from "./src/ui/help.js";
import { EYE } from "./src/player/physics.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 160);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1500);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById("game").appendChild(renderer.domElement);

const sun = new THREE.DirectionalLight(0xfff5e0, 1.1);
sun.position.set(60, 90, 40);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x5a6a4a, 0.75));

initRenderer(scene);
initFx(scene);
initTNTFx(scene);

const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false })
);
highlight.visible = false;
highlight.renderOrder = 999;
scene.add(highlight);

function updateCamera() {
  camera.position.set(pos.x, pos.y + EYE, pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

let worldReady = false;

async function buildWorld() {
  setLoading(true);
  await new Promise((r) => setTimeout(r, 30));
  try {
    generateOverworld(Math.floor(Math.random() * 100000));
    spawnPlayer();
    rebuildAll(pos.x, pos.z);
    // Drain every chunk in range before the first playable frame so no
    // blocks pop in; yield between slices to keep the spinner animating.
    while (hasPendingChunks()) {
      drainChunkQueue(false);
      await new Promise((r) => requestAnimationFrame(r));
    }
    buildHotbar();
    select(0);
    updateCamera();
    worldReady = true;
  } finally {
    setLoading(false);
  }
}

initMenu(renderer, async () => {
  enterGame(renderer);
}, async () => {
  await buildWorld();
  enterGame(renderer);
}, isHelpOpen);

// Pre-build the backdrop world behind the translucent menu; Play enters it.
buildWorld();

initHelp(() => {
  if (started && !isLocked()) requestLockNow();
});

function requestLockNow() {
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

initHotbarInput(() => loading);

document.addEventListener("mousemove", (e) => {
  if (!isLocked() || loading) return;
  setYaw(player.yaw - e.movementX * 0.0022);
  const p = player.pitch - e.movementY * 0.0022;
  setPitch(Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p)));
});

document.addEventListener("mousedown", (e) => {
  if (!isLocked() || isHelpOpen() || loading || !started) return;
  if (e.button === 0) {
    const changed = placeAtSelection(selectedId());
    if (changed) refreshBlocks(changed);
  } else if (e.button === 2) {
    const bt = breakTarget(camera);
    if (bt) {
      const changed = breakBlockAt(bt.x, bt.y, bt.z);
      if (changed.length) refreshBlocks(changed);
    }
  }
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  if (loading) return;
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (isHelpOpen()) {
    if (e.code === "Escape") closeHelp();
    return;
  }
  if (e.code === "KeyH" && !keys[e.code]) { openHelp(); e.preventDefault(); return; }
  if (e.code === "KeyF" && !e.repeat && started && !loading && !isHelpOpen()) {
    setFly(!flyOn);
    e.preventDefault();
    return;
  }
  keys[e.code] = true;
  keys[e.key] = true;
  if (e.code === "KeyK") select(selected - 1);
  if (e.code === "KeyL") select(selected + 1);
  if (["Space", "Slash", "Tab", "ArrowUp", "ArrowDown"].includes(e.code) || e.key === " ") e.preventDefault();
});
document.addEventListener("keyup", (e) => {
  keys[e.code] = false;
  keys[e.key] = false;
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!worldReady) { renderer.render(scene, camera); return; }
  updateCamera();
  if (!started || loading) {
    highlight.visible = false;
    maybeStream(pos.x, pos.z);
    renderer.render(scene, camera);
    return;
  }
  tickFx(dt);
  const simActive = isLocked() && !isHelpOpen();
  if (simActive) {
    if (flyOn) updateFly(dt);
    else updatePlayer(dt);
    if (pos.y < -20) {
      vel.set(0, 0, 0);
      spawnPlayer();
    }
    tickTNT(dt, (touched) => refreshBlocks(touched));
  }
  if (isLocked() && !isHelpOpen()) {
    const hit = updateTarget(camera, selectedId());
    if (hit) {
      highlight.visible = true;
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      highlight.visible = false;
    }
  } else {
    highlight.visible = false;
  }
  maybeStream(pos.x, pos.z);
  renderer.render(scene, camera);
}

updateCamera();
requestAnimationFrame(loop);
