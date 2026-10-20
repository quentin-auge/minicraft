// Ambient-effect registry: a dimension opts in through its spec (`ambient:
// "<key>"`), and the matching module owns the scene objects. Initialization
// is lazy on first entry, exit disposes everything, so switching dimensions
// never leaves particles behind. New ambience registers a module; the main
// loop never names a dimension.
import * as nether from "./nether.js";

export const AMBIENT = { nether };

let sceneRef = null;
let activeKey = null;
let active = null;

export function initAmbient(scene) {
  sceneRef = scene;
}

export function exitAmbient() {
  if (active?.exit) active.exit(sceneRef);
  active = null;
  activeKey = null;
}

export function tickAmbient(dt, time, camera, key) {
  if (key !== activeKey) {
    exitAmbient();
    activeKey = key;
    active = key ? AMBIENT[key] ?? null : null;
    if (active?.init) active.init(sceneRef);
  }
  if (active?.tick) active.tick(dt, time, camera, sceneRef);
}
