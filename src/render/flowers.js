// Flowers as voxel clusters like master: each bloom is a cluster of 1/30
// cubes — thin stem, two leaves, flat vertical disc of petals with eight
// scalloped tips around a darker center. Color variants register in
// FLOWER_VARIANTS: shared properties live in FLOWER_DEFAULTS, entries
// override only what differs. Geometries bake once with vertex colors.
import * as THREE from "three";

const STEM = [20, 66, 30];
const LEAF = [36, 94, 42];

const FLOWER_DEFAULTS = { weight: 1 };

export const FLOWER_VARIANTS = [
  { ...FLOWER_DEFAULTS, petals: [232, 30, 52], center: [156, 16, 32] },
  { ...FLOWER_DEFAULTS, petals: [56, 106, 252], center: [30, 62, 180] },
  { ...FLOWER_DEFAULTS, petals: [248, 188, 16], center: [176, 124, 6] },
  { ...FLOWER_DEFAULTS, petals: [16, 204, 186], center: [8, 120, 112] },
  { ...FLOWER_DEFAULTS, petals: [252, 112, 10], center: [186, 66, 4] },
  { ...FLOWER_DEFAULTS, petals: [176, 66, 250], center: [110, 32, 176] },
  {
    ...FLOWER_DEFAULTS,
    petals: [
      232, 30, 52, 252, 112, 10, 248, 188, 16, 78, 210, 64,
      16, 204, 186, 56, 106, 252, 176, 80, 250, 252, 90, 196,
    ],
    center: [120, 84, 34],
    weight: 2,
    quadrant: true,
  },
];

const GRID = 30;
const BLOOM_R = 7;
const BLOOM_CY = 20.5;
const CORE_R = 3.4;
const TIP_R = 8.6;
const PETAL_COUNT = 8;
const TIP_WEDGE = 0.07;

const cubes = [];
{
  const used = new Set();
  const cell = (cx, cy, cz, role) => {
    const k = cx + "," + cy + "," + cz;
    if (used.has(k)) return;
    used.add(k);
    cubes.push([cx, cy, cz, role]);
  };
  const fc = (GRID - 1) / 2;
  for (let cy = 0; cy < 14; cy++)
    for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++)
      cell(14 + dx, cy, 14 + dz, "stem");
  for (let cx = 0; cx < GRID; cx++)
    for (let cz = 0; cz < GRID; cz++) {
      if (cx <= 15) {
        const d = Math.pow((cx - 8) / 6.5, 2) + Math.pow((cz - fc) / 3, 2);
        if (d <= 1) cell(cx, 11, cz, "leaf");
      }
      if (cx >= 14) {
        const d = Math.pow((cx - 21) / 6.5, 2) + Math.pow((cz - fc) / 3, 2);
        if (d <= 1) cell(cx, 11, cz, "leaf");
      }
    }
  for (let cx = 0; cx < GRID; cx++)
    for (let cy = 0; cy < GRID; cy++)
      for (const cz of [14, 15]) {
        const d = Math.hypot(cx - fc, cy - BLOOM_CY);
        if (d > TIP_R) continue;
        if (d > BLOOM_R) {
          const step = Math.PI / PETAL_COUNT;
          let w = Math.atan2(cy - BLOOM_CY, cx - fc) % step;
          if (w < 0) w += step;
          if (Math.min(w, step - w) > TIP_WEDGE) continue;
        }
        cell(cx, cy, cz, d <= CORE_R ? "center" : "petal");
      }
}

function colorOf(variant, role, cx, cy) {
  if (role === "stem") return STEM;
  if (role === "leaf") return LEAF;
  if (role === "center") return variant.center;
  if (!variant.quadrant) return variant.petals;
  const a = Math.atan2(cy - BLOOM_CY, cx - (GRID - 1) / 2) + Math.PI;
  const n = variant.petals.length / 3;
  const i = Math.floor(a / Math.PI * (n / 2)) % n;
  return [variant.petals[i * 3], variant.petals[i * 3 + 1], variant.petals[i * 3 + 2]];
}

function buildGeometry(variant) {
  const h = 1 / (GRID * 2);
  const faces = [
    { n: [1, 0, 0], c: [[h, -h, -h], [h, -h, h], [h, h, h], [h, h, -h]] },
    { n: [-1, 0, 0], c: [[-h, -h, h], [-h, -h, -h], [-h, h, -h], [-h, h, h]] },
    { n: [0, 1, 0], c: [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]] },
    { n: [0, -1, 0], c: [[-h, -h, h], [-h, -h, -h], [h, -h, -h], [h, -h, h]] },
    { n: [0, 0, 1], c: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], c: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
  ];
  const positions = [], normals = [], colors = [], indices = [];
  for (const [cx, cy, cz, role] of cubes) {
    const [r, g, b] = colorOf(variant, role, cx, cy);
    const ox = (cx + 0.5) / GRID - 0.5, oy = (cy + 0.5) / GRID - 0.5, oz = (cz + 0.5) / GRID - 0.5;
    for (const f of faces) {
      for (const [x, y, z] of f.c) {
        positions.push(x + ox, y + oy, z + oz);
        normals.push(f.n[0], f.n[1], f.n[2]);
        colors.push(r / 255, g / 255, b / 255);
      }
      const b0 = positions.length / 3 - 4;
      indices.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

export const FLOWER_GEOS = FLOWER_VARIANTS.map(buildGeometry);
export const FLOWER_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
