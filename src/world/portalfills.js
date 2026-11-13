// Portal fill geometry and riding rules (three-free, no THREE, no store):
// the pure shapes of a fill and the rule that decides which fills travel
// with a moving hull.
//
// A fill is a translucent slab standing inside a portal frame, not a voxel:
// a hull that flies the frame's blocks would drop the fill on the ground.
// A fill rides the hull only when its WHOLE frame ring rides with it (a
// split ring cannot hold a fill, the same scope portal validation uses).
// The flying copy keeps the family's colour (a family may declare a
// flight colour when its static fill reads poorly against a faded hull)
// and only its opacity moves.

// Fade depth of a riding fill: the hull breathes at 0.5, a fill matches it.
export const FILL_FLIGHT_FADE = 0.5;

// Bounding box of a fill from its cells: the centre and the size of the
// slab. `orient`/`face` give the slab its axis (a flat window is one cell
// tall, an upright one is one cell wide).
export function fillBox(cells, orient, face) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [x, y, z] of cells) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, cz = (z0 + z1 + 1) / 2;
  const sy = y1 - y0 + 1, sx = x1 - x0 + 1, sz = z1 - z0 + 1;
  if (orient === "h") return { cx, cy, cz, sx, sy: 1, sz };
  if (face === "x") return { cx, cy, cz, sx: 1, sy, sz };
  return { cx, cy, cz, sx, sy, sz: 1 };
}

// The frame ring around a window: the cells of the frame box border that
// actually carry a frame block (`isFrameCell` decides, so a family with
// optional corners keeps its own shape).
export function frameRingCells(bbox, orient, face, isFrameCell) {
  const out = [];
  const push = (x, y, z) => { if (isFrameCell(x, y, z)) out.push([x, y, z]); };
  if (orient === "v") {
    if (face === "x") {
      for (let y = bbox.baseY; y <= bbox.topY; y++)
        for (let z = bbox.minZ; z <= bbox.maxZ; z++) {
          if (y !== bbox.baseY && y !== bbox.topY && z !== bbox.minZ && z !== bbox.maxZ) continue;
          push(bbox.minX, y, z);
        }
    } else {
      for (let y = bbox.baseY; y <= bbox.topY; y++)
        for (let x = bbox.minX; x <= bbox.maxX; x++) {
          if (y !== bbox.baseY && y !== bbox.topY && x !== bbox.minX && x !== bbox.maxX) continue;
          push(x, y, bbox.minZ);
        }
    }
  } else {
    for (let x = bbox.minX; x <= bbox.maxX; x++)
      for (let z = bbox.minZ; z <= bbox.maxZ; z++) {
        if (x !== bbox.minX && x !== bbox.maxX && z !== bbox.minZ && z !== bbox.maxZ) continue;
        push(x, bbox.baseY, z);
      }
  }
  return out;
}

// Ride signature: the fill key minus its world-anchored min, plus the fill
// size and the ring size. A portal the hull carries lands at a translated
// min, so the exact key never matches at the stamp — the signature does
// (same family, shape and size anywhere). Different families, shapes, or
// fill sizes never share one.
export function rideSigFromKey(key, box, ringN = -1) {
  const parts = String(key).split(":");
  const head = parts.slice(0, 3).join(":");
  const tail = parts.slice(3).join(":");
  const m = /^-?\d+,-?\d+,-?\d+(.*)$/.exec(tail);
  const shape = m ? m[1] : tail;
  const size = box ? `:${box.sx}x${box.sy}x${box.sz}` : "";
  const ring = ringN >= 0 ? `#${ringN}` : "";
  return `${head}:${shape}${size}${ring}`;
}

// The fills of `fills` that ride a hull holding the cells `hasCell` reports.
// Each fill is { ring, box, color, alpha }: the world cells of its frame
// ring, its world fill box, the flying colour and the flying opacity.
export function ridingFills(fills, hasCell) {
  return fills.filter((f) => f.ring.every(([x, y, z]) => hasCell(x, y, z)));
}
