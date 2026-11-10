// Targets: what a mob is asked to reach. A target is a set of blocks;
// the arrival rule is uniform for every kind — the mob makes CONTACT with
// a target block: it stands on top of it, or, when it cannot get up
// there, it comes beside it. So a pen floor, a roof tile, a block lying
// on the ground, or a lure cell all read the same way.
// Stable-key registry like registry.js: a new kind registers a spec, the
// engine never forks on the kind.
// Three-free: plain block cells, no store, no THREE.
export const TARGET_KINDS = [];
const byKey = new Map();

export function registerTargetKind(spec) {
  if (!spec?.key || byKey.has(spec.key)) throw new Error(`Invalid or duplicate target kind: ${spec?.key}`);
  if (typeof spec.cells !== "function") throw new Error(`Target kind without cells(): ${spec?.key}`);
  byKey.set(spec.key, spec);
  TARGET_KINDS.push(spec);
  return spec;
}

export function targetKind(key) {
  return byKey.get(key) ?? null;
}

export function createTarget(key, data) {
  const spec = targetKind(key);
  if (!spec) return null;
  return { key, ...data };
}

// Block cells the target covers. Kinds own the enumeration; callers
// never inspect the target shape.
export function targetCells(target) {
  const spec = targetKind(target?.key);
  if (!spec) return [];
  return spec.cells(target) ?? [];
}

export function targetContains(target, x, y, z) {
  const spec = targetKind(target?.key);
  if (!spec) return false;
  if (spec.contains) return spec.contains(target, x, y, z) === true;
  for (const c of targetCells(target)) {
    if (c.x === x && c.y === y && c.z === z) return true;
  }
  return false;
}

// The goal cells of a target, in tiers: the planner tries them in order
// and keeps the first tier it can reach. The tiers are a generator, so
// the second one (four neighbours per target block) is only built when
// the first one cannot be reached.
//
// Tier 0 — on top: the feet cell on top of every target block. A block
// embedded in the ground is flush with the surface, so the mob walks onto
// it.
// Tier 1 — beside: the lateral neighbours of every target block. A block
// lying on the ground cannot be stepped onto, so the mob comes to its
// side instead.
//
// The tiers are ordered, not merged: a block reachable both ways is
// reached on top, and only a block the mob cannot climb is approached
// from the side.
export function* contactGoalTiers(target) {
  const spec = targetKind(target?.key);
  if (!spec) return;
  if (spec.goalTiers) {
    yield* spec.goalTiers(target) ?? [];
    return;
  }
  const cells = targetCells(target);
  const onTop = [];
  const beside = [];
  const topSeen = new Set();
  const sideSeen = new Set();
  for (const c of cells) {
    const top = { x: c.x, y: c.y + 1, z: c.z };
    const topKey = `${top.x},${top.y},${top.z}`;
    if (!topSeen.has(topKey)) {
      topSeen.add(topKey);
      onTop.push(top);
    }
    for (const side of [
      { x: c.x - 1, y: c.y, z: c.z },
      { x: c.x + 1, y: c.y, z: c.z },
      { x: c.x, y: c.y, z: c.z - 1 },
      { x: c.x, y: c.y, z: c.z + 1 },
    ]) {
      const key = `${side.x},${side.y},${side.z}`;
      if (sideSeen.has(key)) continue;
      sideSeen.add(key);
      beside.push(side);
    }
  }
  yield onTop;
  yield beside;
}

// A single block.
registerTargetKind({
  key: "block",
  cells: (t) => [{ x: t.x, y: t.y, z: t.z }],
});

// A rectangle on one axis plane: the axis
// coordinate is fixed, the other two span the bounds. Bounds are
// normalized, so any corner order reads the same rectangle.
registerTargetKind({
  key: "area",
  cells: (t) => {
    const axis = t.axis ?? "y";
    const free = axis === "x" ? ["y", "z"] : axis === "y" ? ["x", "z"] : ["x", "y"];
    const [u, v] = free;
    const lo = {
      x: Math.min(t.x0, t.x1), y: Math.min(t.y0, t.y1), z: Math.min(t.z0, t.z1),
    };
    const hi = {
      x: Math.max(t.x0, t.x1), y: Math.max(t.y0, t.y1), z: Math.max(t.z0, t.z1),
    };
    const out = [];
    for (let a = lo[u]; a <= hi[u]; a++) {
      for (let b = lo[v]; b <= hi[v]; b++) {
        const c = { x: 0, y: 0, z: 0 };
        c[axis] = lo[axis];
        c[u] = a;
        c[v] = b;
        out.push(c);
      }
    }
    return out;
  },
});

// An explicit cell set: arbitrary shapes (a room interior, a path of
// cells, a cluster of lure blocks) without a new kind.
registerTargetKind({
  key: "volume",
  cells: (t) => (t.cells ?? []).map((c) => ({ x: c.x, y: c.y, z: c.z })),
});
