// Browser instrumentation for reactor cones (mirror of the headless
// rocketfx spec, on the live engine + real renderer).
//
// Run:  1. npm i -D puppeteer   (peer dep, never shipped; static host keeps
//          zero dependencies — see index.html import map)
//       2. node tests/browser/fx/cones.mjs [--url http://localhost:8383]
//
// The script serves the repo itself (python3, same as AGENTS.md), opens
// ?seed=7&test=1, waits for boot, then drives tests/browser/fx/hook.js:
// per T preset it samples the real playFx exhaust + plume and asserts both
// ends widen with T (base disc and outward aim), the disc holds 4xSUB
// centers, and every layer lives long enough to read as a cone.
// Screenshots land in /tmp for eyeballing. Exit code reports.
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
  assert.deepEqual(presets, ["narrow", "flare", "wide", "max"], "four T presets ship");

  for (const fx of ["exhaust", "plume"]) {
    const per = {};
    for (const cone of presets) {
      const s = await sample(fx, cone);
      assert.ok(s.length > 0, `${fx}/${cone}: the engine sprayed`);
      per[cone] = s[0];
    }
    const bases = presets.map((c) => per[c].baseRadius);
    assert.ok(bases[0] < bases[1] && bases[1] < bases[2] && bases[2] < bases[3],
      `${fx}: the base disc widens with T (${bases.map((b) => b.toFixed(2)).join(" < ")})`);
    const flares = presets.map((c) => per[c].flare);
    assert.ok(flares[0] < flares[1] && flares[1] < flares[2] && flares[2] < flares[3],
      `${fx}: the outward aim strictly widens (${flares.map((f) => f.toFixed(2)).join(" < ")})`);
    for (const cone of presets) {
      assert.equal(per[cone].centers, 32, `${fx}/${cone}: 4 nozzles x 8 sub-centers`);
      assert.ok(per[cone].life >= 0.3, `${fx}/${cone}: lives long enough to read (life ${per[cone].life})`);
      assert.ok(per[cone].count >= 1, `${fx}/${cone}: emits particles`);
    }
    const spreads = presets.map((c) => per[c].spread);
    assert.ok(spreads[3] / spreads[0] < 3, `${fx}: the velocity spread breathes, never inverts (${spreads.map((s) => s.toFixed(2)).join(", ")})`);
    console.log(`PASS ${fx}: base ${bases.map((b) => b.toFixed(2)).join(" < ")}, flare ${flares.map((f) => f.toFixed(2)).join(" < ")}, life ${per.max.life}, spread ${spreads.map((s) => s.toFixed(2)).join(", ")}`);
  }

  // Screenshots for eyeballing: narrow vs max, exhaust + plume in view.
  // One call emits a dozen puffs on the live cadence and steps the
  // particle clock, so the shot shows the integrated steady-state cone.
  for (const [fx, cone] of [["plume", "narrow"], ["plume", "max"], ["exhaust", "max"]]) {
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
