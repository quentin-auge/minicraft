// The paint owner: one place decides the material of a mob's paintable
// meshes. Two styles want them — the target debug's green (the mob being
// targeted) and the displacement mode colour (the `?color=1` debug tint)
// — and they must never fight over the saved materials. So the owner keeps
// the natural coat ONCE and resolves the style by rule: the green first
// (the debug is the strongest signal), the mode colour next, the natural
// coat last. Turning a style off never restores a stale material: the
// owner re-resolves.
//
// The gate is `?color=1` and nothing else: without it a mob keeps its
// natural coat, so no debug colour ever reaches a mob.
//
// Three-free (it only assigns `mesh.material`), headless-testable.

// The paintable meshes of a mob (the farm quadrupeds expose them).
function paintables(mob) {
  return mob?.root?.userData?.paintables ?? [];
}

// The owner's state per mob: the two styles and the natural coat.
const STATE = new WeakMap(); // mob -> { green, mode, natural }

function state(mob) {
  let st = STATE.get(mob);
  if (!st) {
    st = { green: null, mode: null, natural: null };
    STATE.set(mob, st);
  }
  return st;
}

// The gate: `?color=1` and nothing else. The flag is session-fixed, so the
// query is parsed once (the search string never changes); the headless
// rigs swap the stub to drive both sides of the gate.
let lastSearch = null;
let gate = false;

export function paintEnabled() {
  const search = typeof location !== "undefined" ? location.search : "";
  if (search !== lastSearch) {
    lastSearch = search;
    gate = new URLSearchParams(search).get("color") === "1";
  }
  return gate;
}

// The material the state resolves to: the debug's green, else the mode
// colour, else null (the natural coat).
function resolve(st) {
  return st.green ?? st.mode ?? null;
}

// Apply the resolved style to the mob's paintable meshes. The natural
// coat is captured the first time the owner paints, and never again — so
// a style can never be restored over another.
function apply(mob) {
  const st = state(mob);
  const list = paintables(mob);
  if (!list.length) return;
  if (!st.natural) st.natural = list.map((m) => m.material);
  const want = resolve(st);
  const mats = want ? list.map(() => want) : st.natural;
  list.forEach((m, i) => { if (m.material !== mats[i]) m.material = mats[i]; });
}

// The debug's green: the targeted mob. `null` turns it off.
export function setGreenPaint(mob, material) {
  if (!paintEnabled()) return;
  const st = state(mob);
  if (st.green === material) return;
  st.green = material;
  apply(mob);
}

// The displacement mode colour. `null` turns it off (the natural coat).
export function setModePaint(mob, material) {
  if (!paintEnabled()) return;
  const st = state(mob);
  if (st.mode === material) return;
  st.mode = material;
  apply(mob);
}
