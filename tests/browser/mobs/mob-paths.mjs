// Browser instrumentation for mob paths (mirror of the headless
// tests/headless/mob-paths.test.mjs, on live voxels + the real game tick).
//
// Run:  1. npm i -D puppeteer   (peer dep, never shipped; static host keeps
//          zero dependencies — see index.html import map)
//       2. node tests/browser/mob-paths.mjs [--url http://localhost:8383]
//
// The script serves the repo itself (python3, same as AGENTS.md), opens
// ?seed=7&test=1, waits for boot, then drives tests/browser/hook.js
// trials (deterministic per seed) and asserts centre tracking, fluidity,
// branch coverage and the muret≡trench equivalence. Exit code reports.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const URL = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://localhost:8383";

let puppeteer;
try {
  puppeteer = (await import("puppeteer")).default;
} catch {
  console.error("mob-paths.mjs: puppeteer not installed — run `npm i -D puppeteer` first (dev-only).");
  process.exit(2);
}

const GOALS = {
  straight: "(m) => Math.floor(m.z) >= 6",
  l: "(m) => Math.floor(m.x) >= 3 && Math.floor(m.z) >= 2",
  t: "(m) => Math.floor(m.z) === 2 && (Math.floor(m.x) === 0 || Math.floor(m.x) === 2)",
  cross: "(m) => ['1,3', '0,1', '2,1'].includes(Math.floor(m.x) + ',' + Math.floor(m.z))",
  zigzag: "(m) => Math.floor(m.x) >= 2 && Math.floor(m.z) >= 4",
  deadend: null,
  straight2: "(m) => Math.floor(m.z) >= 7",
  l2: "(m) => Math.floor(m.x) >= 5",
  funnel21: "(m) => Math.floor(m.z) >= 6",
  doorway: "(m) => m.z >= 4.5",
  t2: "(m) => (Math.floor(m.x) <= -1 || Math.floor(m.x) >= 3) && (Math.floor(m.z) === 2 || Math.floor(m.z) === 3)",
};

const server = spawn("python3", ["-m", "http.server", "8383"], { cwd: new URL(".", import.meta.url).pathname + "../.." });
await new Promise((r) => setTimeout(r, 1200));
let failed = 0;
try {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); failed = 1; });
  await page.goto(`${URL}/?seed=7&test=1`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForFunction(() => window.__test, { timeout: 60000 });
  await page.waitForFunction(() => window.__test.ready(), { timeout: 180000 });
  console.log("boot ok");

  const walk = (kind, name, opts) =>
    page.evaluate(
      async (k, n, o) => window.__test.walk(k, n, { ...o, goal: o.goal ? eval(`(${o.goal})`) : null }),
      kind, name, opts,
    );

  const speeds = (trace) => trace.slice(1).map((p, i) =>
    Math.hypot(p.x - trace[i].x, p.z - trace[i].z) * 60);

  async function expectReach(kind, name, opts) {
    const r = await walk(kind, name, { maxTicks: 2000, ...opts, goal: GOALS[name] });
    assert.ok(r.ok && r.trace.length < (opts?.maxTicks ?? 2000), `${kind}/${name}: reached the end`);
    assert.ok(r.trace.every((p) => Math.abs(p.y - 1) < 0.05), `${kind}/${name}: feet on ground`);
    return r.trace;
  }

  for (const kind of ["muret", "trench"]) {
    const t = await expectReach(kind, "straight", {});
    assert.ok(Math.max(...t.slice(15).map((p) => Math.abs(p.x - 0.5))) < 0.2, `${kind}/straight: centred`);
    assert.ok(t.slice(10).every((p) => p.lane), `${kind}/straight: servo latched`);
    console.log(`PASS ${kind}/straight`);
  }
  for (const kind of ["muret", "trench"]) {
    const t = await expectReach(kind, "l", {});
    assert.ok(speeds(t).slice(15).filter((v) => v < 0.8).length <= 8, `${kind}/L: fluid`);
    console.log(`PASS ${kind}/L`);
  }
  for (const kind of ["muret", "trench"]) {
    const t = await expectReach(kind, "zigzag", { maxTicks: 2500 });
    assert.ok(speeds(t).slice(15).filter((v) => v < 0.8).length <= 12, `${kind}/zigzag: fluid`);
    console.log(`PASS ${kind}/zigzag`);
  }
  for (const kind of ["muret", "trench"]) {
    const r = await walk(kind, "deadend", { maxTicks: 1200 });
    const zs = r.trace.map((p) => p.z);
    assert.ok(Math.max(...zs) >= 2.3, `${kind}/deadend: reached the back`);
    assert.ok(Math.min(...zs.slice(Math.floor(zs.length * 0.6))) <= 1.0, `${kind}/deadend: walked out`);
    console.log(`PASS ${kind}/deadend`);
  }
  for (const kind of ["muret", "trench"]) {
    const arms = new Set();
    for (let s = 0; s < 16; s++) {
      const t = await expectReach(kind, "t", { seed: 500 + s, maxTicks: 1200 });
      assert.ok(t.every((p) => p.z > -0.2), `${kind}/T: never back down the stem`);
      arms.add(t.at(-1).x < 1.5 ? "W" : "E");
    }
    assert.ok(arms.has("W") && arms.has("E"), `${kind}/T: both arms`);
    console.log(`PASS ${kind}/T branches`);
  }
  for (const kind of ["muret", "trench"]) {
    const exits = new Set();
    for (let s = 0; s < 24; s++) {
      const t = await expectReach(kind, "cross", { seed: 900 + s, maxTicks: 1500 });
      exits.add(`${Math.floor(t.at(-1).x)},${Math.floor(t.at(-1).z)}`);
    }
    assert.deepEqual(exits, new Set(["1,3", "0,1", "2,1"]), `${kind}/cross: all exits`);
    console.log(`PASS ${kind}/cross branches`);
  }
  for (const kind of ["muret", "trench"]) {
    const t = await expectReach(kind, "straight2", {});
    const tail = t.slice(Math.floor(t.length * 0.66));
    assert.ok(Math.max(...tail.map((p) => Math.abs(p.x - 0.75))) < 0.2, `${kind}/straight2: wall offset`);
    assert.ok(tail.every((p) => Math.abs(p.x - 1.0) > 0.08), `${kind}/straight2: never mid-space`);
    console.log(`PASS ${kind}/straight2`);
  }
  for (const kind of ["muret", "trench"]) {
    const t = await expectReach(kind, "l2", {});
    assert.ok(speeds(t).slice(15).filter((v) => v < 0.8).length <= 12, `${kind}/L2: fluid`);
    console.log(`PASS ${kind}/L2`);
  }
  for (const kind of ["muret", "trench"]) {
    await expectReach(kind, "funnel21", {});
    console.log(`PASS ${kind}/funnel21`);
  }
  {
    const r = await walk("muret", "doorway", {
      walls: { auto: false, extra: [[-1, 3], [2, 3], [3, 3], [-1, 6], [0, 6], [1, 6], [2, 6], [3, 6], [-1, 4], [-1, 5], [3, 4], [3, 5]] },
      maxTicks: 1500, goal: GOALS.doorway,
    });
    assert.ok(r.ok && r.trace.length < 1500, "doorway: entered the room");
    console.log("PASS doorway");
  }
  for (const kind of ["muret", "trench"]) {
    const arms = new Set();
    for (let s = 0; s < 16; s++) {
      const t = await expectReach(kind, "t2", { seed: 500 + s, maxTicks: 1500 });
      assert.ok(t.every((p) => p.z > -0.2), `${kind}/T2: never back down the stem`);
      arms.add(t.at(-1).x < 1.5 ? "W" : "E");
    }
    assert.ok(arms.has("W") && arms.has("E"), `${kind}/T2: both arms`);
    console.log(`PASS ${kind}/T2 branches`);
  }
  {
    const r = await walk("muret", "mouth", { walls: { skip: [[0, 4]] }, maxTicks: 1200 });
    assert.ok(Math.max(...r.trace.map((p) => p.z)) >= 4.0, "mouth: walked out");
    console.log("PASS mouth");
  }
  for (const dir of ["out-in", "in-out"]) {
    const r = await page.evaluate(async (d) => window.__test.walkFence(d, {}), dir);
    assert.ok(r.ok && r.trace.length < 1200, `fence-hole ${dir}: crossed`);
    console.log(`PASS fence-hole ${dir}`);
  }
  for (const dir of ["out-in", "in-out"]) {
    const r = await page.evaluate(async (d) => window.__test.walkVillageDoor(d, { seed: 7 }), dir);
    assert.ok(r.ok, `village-door ${dir}: ran (${r.reason ?? r.type})`);
    if (r.ok) {
      const h = r.house;
      const inside = (p) => p.x > h.minX && p.x < h.maxX + 1 && p.z > h.minZ && p.z < h.maxZ + 1;
      assert.ok(dir === "out-in" ? inside(r.trace.at(-1)) : !inside(r.trace.at(-1)),
        `village-door ${dir}: through the door`);
    }
    console.log(`PASS village-door ${dir}`);
  }
  // Equivalence: same seed, same rig => identical traces.
  for (const name of ["straight", "l", "zigzag", "straight2", "l2", "funnel21"]) {
    const a = await walk("muret", name, { seed: 7, maxTicks: 1200, goal: GOALS[name] });
    const b = await walk("trench", name, { seed: 7, maxTicks: 1200, goal: GOALS[name] });
    assert.equal(a.trace.length, b.trace.length, `${name}: same length`);
    let dev = 0;
    for (let i = 0; i < a.trace.length; i++) {
      dev = Math.max(dev, Math.abs(a.trace[i].x - b.trace[i].x) + Math.abs(a.trace[i].z - b.trace[i].z));
    }
    assert.ok(dev < 1e-9, `${name}: identical trajectories`);
  }
  console.log("PASS muret≡trench equivalence");
  await browser.close();
} catch (e) {
  console.error("FAIL:", e.message);
  failed = 1;
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
