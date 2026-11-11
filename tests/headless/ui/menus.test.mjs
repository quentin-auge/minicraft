// Generic menu registry: dispatch priority (topmost modal wins, open floats
// consume everything, overlay only on fallthrough), open predicates, the
// float hold/release cycle, and the shared resume policy. Three-free
// (stub specs, no DOM, injected scheduler) — plain `node` direct.
import assert from "node:assert/strict";
import { registerMenu, anyModalOpen, anyMenuOpen, anyPanelOpen, routeMenuKey, routeMenuKeyUp, resumePointer, openModal, closeModal, anyFloatOpen } from "../../../src/ui/menus.js";
import { openMobMenu, isMobMenuOpen, closeMobMenu } from "../../../src/ui/mobmenu.js";
import { openHelp, isHelpOpen, closeHelp } from "../../../src/ui/help.js";
import { createSpawnSelection } from "../../../src/mobs/spawn.js";

const key = (code, repeat = false) => ({ code, repeat, prevented: false, preventDefault() { this.prevented = true; } });

// --- duplicate keys are refused ---
registerMenu({ key: "__m_a", isOpen: () => false, onKeydown: () => {} });
assert.throws(() => registerMenu({ key: "__m_a", isOpen: () => false, onKeydown: () => {} }), /duplicate menu/);

// --- modal priority: most recently registered open modal consumes ---
let aOpen = false, bOpen = false;
const seen = [];
registerMenu({ key: "__m_pa", isOpen: () => aOpen, onKeydown: () => { seen.push("a"); } });
registerMenu({ key: "__m_pb", isOpen: () => bOpen, onKeydown: () => { seen.push("b"); } });
const ctx = { toast: () => {}, requestLock: () => {}, canResume: () => true };
aOpen = true; bOpen = true;
assert.equal(routeMenuKey(key("KeyH"), ctx), true);
assert.deepEqual(seen, ["b"], "topmost (last registered) wins");
seen.length = 0;
bOpen = false;
assert.equal(routeMenuKey(key("KeyH"), ctx), true);
assert.deepEqual(seen, ["a"]);
assert.equal(anyModalOpen(), true);
aOpen = false;
assert.equal(anyModalOpen(), false);

// --- overlay: only reached with no modal open, consumes what it reports ---
let pauseOpen = false;
registerMenu({
  key: "__m_pause", layer: "overlay", isOpen: () => pauseOpen,
  onKeydown: (e) => e.code === "Enter",
});
assert.equal(routeMenuKey(key("KeyH"), ctx), false, "closed overlay: fallthrough");
assert.equal(anyMenuOpen(), false);
pauseOpen = true;
assert.equal(anyMenuOpen(), true, "overlay counts as an open menu");
assert.equal(routeMenuKey(key("Enter"), ctx), true);
assert.equal(routeMenuKey(key("KeyH"), ctx), false, "overlay lets other keys fall through");
aOpen = true;
seen.length = 0;
assert.equal(routeMenuKey(key("Enter"), ctx), true);
assert.deepEqual(seen, ["a"], "modal shadows the overlay");
aOpen = false; pauseOpen = false;

// --- resume policy: direct relocks at once, no toast ---
let locked = 0, toasted = 0;
const ctx2 = { toast: () => { toasted++; }, requestLock: () => { locked++; }, canResume: () => true };
resumePointer(ctx2, { hint: false, defer: false });
assert.equal(locked, 1);
assert.equal(toasted, 0);

// --- resume policy: hint toasts, deferred waits for the scheduler + guard ---
let scheduled = null;
const fakeSchedule = (fn) => { scheduled = fn; };
let guard = true;
const ctx3 = { toast: () => { toasted++; }, requestLock: () => { locked++; }, canResume: () => guard };
resumePointer(ctx3, { hint: true, defer: true }, fakeSchedule);
assert.equal(toasted, 1);
assert.equal(locked, 1, "nothing sync on the deferred path");
assert.ok(scheduled, "relock scheduled");
scheduled();
assert.equal(locked, 2, "guard open: relocks");
guard = false;
resumePointer(ctx3, { hint: false, defer: true }, fakeSchedule);
scheduled();
assert.equal(locked, 2, "guard closed: stays unlocked, fails silent");

// --- open/close: showing releases, hiding only hides ---
const stubEl = () => ({ style: {} });
const shown = stubEl();
openModal(shown);
assert.equal(shown.style.display, "flex", "open shows the modal");
let exited = 0;
globalThis.document = { pointerLockElement: {}, exitPointerLock: () => { exited++; } };
openModal(stubEl());
assert.equal(exited, 1, "open releases pointer lock");
globalThis.document = { pointerLockElement: null, exitPointerLock: () => { exited++; } };
openModal(stubEl());
assert.equal(exited, 1, "nothing locked: no exit call");
delete globalThis.document;
closeModal(shown);
assert.equal(shown.style.display, "none", "close only hides");

// --- floats: hold-to-show, sim paused, release closes ---
// mobmenu/help floats render rows at open: stub the DOM reads they make,
// drive the real registered handlers via routeMenuKey/routeMenuKeyUp.
let rowClick = null;
globalThis.document = {
  pointerLockElement: {},
  exitPointerLock: () => { exited++; },
  getElementById: () => ({ style: {}, innerHTML: "", appendChild() {} }),
  createElement: () => ({
    style: {}, className: "", textContent: "", appendChild() {},
    addEventListener: (type, fn) => { if (type === "click") rowClick = fn; },
  }),
};
const keyup = (code) => ({ code, prevented: false, preventDefault() { this.prevented = true; } });
const gameCtx = { toast: () => { toasted++; }, requestLock: () => { locked++; }, canResume: () => true };
const before = locked;
const exitsBefore = exited;

// Help float: opens keeping the lock (no mouse on help) while pausing via
// the registry, consumes everything while shown (Enter/Escape do nothing),
// H release closes.
assert.equal(isHelpOpen(), false);
assert.equal(anyFloatOpen(), false);
openHelp();
assert.equal(isHelpOpen(), true);
assert.equal(anyFloatOpen(), true, "float open");
assert.equal(anyPanelOpen(), true, "float counts as an open panel");
assert.equal(anyMenuOpen(), true, "help float pauses the sim");
assert.equal(exited, exitsBefore, "help open keeps pointer lock");
assert.equal(routeMenuKey(key("KeyH"), ctx), true, "H repeat consumed");
assert.equal(isHelpOpen(), true, "H repeat never closes its own float");
assert.equal(routeMenuKey(key("Space"), ctx), true, "game keys freeze while shown");
assert.equal(routeMenuKey(key("Enter"), ctx), true, "Enter consumed with no effect");
assert.equal(isHelpOpen(), true, "Enter never closes the float");
assert.equal(routeMenuKey(key("Escape"), ctx), true, "Escape consumed with no effect");
assert.equal(isHelpOpen(), true, "Escape never closes the float");
assert.equal(routeMenuKeyUp(keyup("KeyH"), ctx), true, "H release consumed");
assert.equal(isHelpOpen(), false, "H release closes");
assert.equal(routeMenuKeyUp(keyup("KeyH"), ctx), false, "second release is a no-op");
closeHelp();

// Spawn float: nav keys act, everything consumed, release saves (live kept).
const catalog = [{ key: "cow", label: "Cow" }, { key: "pig", label: "Pig" }];
const sel = createSpawnSelection();
sel.keys = new Set(["cow"]);
sel.cursor = 0;
openMobMenu(catalog, sel);
assert.equal(isMobMenuOpen(), true);
assert.equal(anyFloatOpen(), true);
assert.equal(anyPanelOpen(), true);
assert.equal(exited, exitsBefore + 1, "spawn float releases pointer lock");
assert.equal(routeMenuKey(key("Space"), gameCtx), true, "Space consumed");
assert.ok(!sel.keys.has("cow"), "Space toggled the kind under the cursor");
assert.equal(routeMenuKey(key("ArrowDown"), gameCtx), true, "Down consumed");
assert.equal(sel.cursor, 1, "cursor moved");
rowClick();
assert.ok(sel.keys.has("pig"), "row click ticked pig");
assert.equal(routeMenuKey(key("Enter"), gameCtx), true, "Enter consumed with no effect");
assert.equal(isMobMenuOpen(), true, "Enter never validates");
assert.equal(routeMenuKey(key("KeyX"), gameCtx), true, "no key falls through while shown");
assert.equal(locked, before, "no relock while shown");
assert.equal(routeMenuKeyUp(keyup("KeyB"), gameCtx), true, "B release consumed");
assert.equal(isMobMenuOpen(), false, "B release closes");
assert.deepEqual([...sel.keys], ["pig"], "release saved the live selection");
assert.deepEqual([routeMenuKeyUp(keyup("KeyB"), gameCtx)], [false], "tap-B release falls through (spawn path)");
closeMobMenu();
delete globalThis.document;

console.log("menus: all PASS");
