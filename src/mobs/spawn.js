// Mob spawn service: the catalog of placeable kinds, the picker's
// selection, and the place dispatch. The catalog comes from the mob
// registry — a kind opts in by registering a `spawn` hook — so the menu
// can never list a kind the world cannot build. Three-free (the
// registry is pure), so the catalog and the selection are headless
// testable.
import { MOB_TYPES, mobType, mobLabel } from "./registry.js";

// The placeable kinds, alphabetical by display name.
export function spawnCatalog() {
  return MOB_TYPES
    .filter((spec) => spec.spawn)
    .map((spec) => ({ key: spec.key, label: mobLabel(spec.key) }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

// The picker's state: the cursor, the ticked kinds, and the spawn
// cycle. One shared selection for the session (the picker keeps it
// between openings, so a tap of B places what the player chose).
// Defaults to cow + pig (the classic farm pair).
export function createSpawnSelection() {
  return { cursor: 0, keys: new Set(["cow", "pig"]), cycle: 0 };
}

const selection = createSpawnSelection();

export function spawnSelection() {
  return selection;
}

// Move the cursor over the catalog (wraps at both ends).
export function moveCursor(sel, catalog, delta) {
  if (!catalog.length) return;
  const n = catalog.length;
  sel.cursor = ((sel.cursor + delta) % n + n) % n;
}

// Tick or untick the kind under the cursor.
export function toggleAtCursor(sel, catalog) {
  const entry = catalog[sel.cursor];
  if (!entry) return null;
  if (sel.keys.has(entry.key)) sel.keys.delete(entry.key);
  else sel.keys.add(entry.key);
  return entry;
}

// The ticked kinds, in catalog order.
export function selectedKinds(sel, catalog) {
  return catalog.filter((entry) => sel.keys.has(entry.key));
}

// The kind the next spawn places: the ticked kinds in turn.
export function nextSpawnKey(sel, catalog) {
  const ticked = selectedKinds(sel, catalog);
  if (!ticked.length) return null;
  const index = sel.cycle % ticked.length;
  sel.cycle = index + 1;
  return ticked[index].key;
}

// Place a kind: the owning module's hook owns the model and the
// free-spot rules. Returns the mob, or null when there is no spot.
export function spawnMobAt(key, ctx) {
  const spec = mobType(key);
  if (!spec?.spawn) return null;
  return spec.spawn(ctx);
}
