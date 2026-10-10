// Deterministic 2D value noise, ported exactly from master (including its
// z-flipped bilinear blend) so terrain matches the original distribution.
export function hash2(x, z, seed) {
  let n = (x * 374761393 + z * 668265263 + seed * 2246822519) | 0;
  n = ((n ^ (n >>> 13)) | 0);
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
}

const fade = (t) => t * t * (3 - 2 * t);

export function valueNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = fade(xf), v = fade(zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return v * (u * (a - b) + b) + (1 - v) * (u * (c - d) + d);
}

export function fbm(x, z, seed, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 101) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

export function smoothstep(u) {
  return u * u * (3 - 2 * u);
}
