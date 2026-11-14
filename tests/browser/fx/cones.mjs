// Browser instrumentation for reactor cones (mirror of the headless
// rocketfx spec, on the live engine + real renderer).
//
// Run:  1. npm i -D puppeteer   (peer dep, never shipped; static host keeps
//          zero dependencies — see index.html import map)
//       2. node tests/browser/fx/cones.mjs [--url http://localhost:8383]
//
// The script serves the repo itself (python3, same as AGENTS.md), opens
// ?seed=7&test=1, waits for boot, then drives tests/browser/fx/hook.js:
// it samples the real playFx exhaust + plume for the shipped setup and
// asserts the cone sprayed from the full nozzle grid with a positive life
// and count. Screenshots land in /tmp for eyeballing. Exit code reports.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const SERVER_URL = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://localhost:8383";

let puppeteer;
try {
  puppeteer = (await import("puppeteer")).default;
} catch {
  console.error("cones.mjs: puppeteer not installed — run `npm i -D puppeteer` first (dev-only).");
  process.exit(2);
}

const server = spawn("python3", ["-m", "http.server", "8383"], { cwd: new URL(".", import.meta.url).pathname + "../.." });
await new Promise((r) => setTimeout(r, 1200));
let failed = 0;
try {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); failed = 1; });
  await page.goto(`${SERVER_URL}/?seed=7&test=1`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForFunction(() => window.__test, { timeout: 60000 });
  await page.waitForFunction(() => window.__test.ready(), { timeout: 180000 });
  await page.waitForFunction(() => window.__fx, { timeout: 30000 });
  console.log("boot ok");

  const sample = (fx, cone) =>
    page.evaluate((f, c) => window.__fx.sample(f, c), fx, cone);

  const presets = await page.evaluate(() => window.__fx.presets());
  assert.deepEqual(presets, ["narrow"], "only the shipped setup remains");

  for (const fx of ["exhaust", "plume"]) {
    const s = await sample(fx, presets[0]);
    assert.ok(s.length > 0, `${fx}/narrow: the engine sprayed`);
    const p = s[0];
    assert.equal(p.diameter, "narrow", `${fx}: the shipped diameter sprayed`);
    assert.equal(p.depth, "shorter", `${fx}: the shipped depth sprayed`);
    assert.equal(p.centers, 32, `${fx}/narrow: 4 nozzles x 8 sub-centers`);
    assert.ok(Number.isFinite(p.baseRadius) && p.baseRadius > 0, `${fx}/narrow: the spawn disc opened`);
    assert.ok(Number.isFinite(p.flare) && p.flare > 0, `${fx}/narrow: the outward aim opened`);
    assert.ok(p.life > 0, `${fx}/narrow: the jet keeps a positive life (life ${p.life})`);
    assert.ok(p.count >= 1, `${fx}/narrow: emits particles`);
    console.log(`PASS ${fx}: base ${p.baseRadius.toFixed(2)}, flare ${p.flare.toFixed(2)}, life ${p.life}, spread ${p.spread}`);
  }

  // Screenshots for eyeballing: the shipped cone, exhaust + plume in view.
  // One call emits a dozen puffs on the live cadence and steps the
  // particle clock, so the shot shows the integrated steady-state cone.
  for (const [fx, cone] of [["plume", "narrow"], ["exhaust", "narrow"]]) {
    await page.evaluate((f, c) => window.__fx.sampleInView(f, c), fx, cone);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: `/tmp/cone-${fx}-${cone}.png` });
    console.log(`shot /tmp/cone-${fx}-${cone}.png`);
  }

  await browser.close();
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
