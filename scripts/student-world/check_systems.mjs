/**
 * Logic checks for the student world systems.
 *
 *   node --experimental-strip-types scripts/student-world/check_systems.mjs
 *
 * Verifies that quest nodes sit on the authored path, that path sampling and the
 * camera produce finite, in-bounds values, and that node medallions map to the
 * real quest status. Plain .mjs on purpose: the app's tsconfig type-checks the
 * source tree, and this script imports those .ts modules directly via Node's type
 * stripping.
 */
import fs from "node:fs";

import { clampCamera, fitCamera, MAX_ZOOM, MIN_ZOOM, zoomAtPoint } from "../../src/features/student-world/systems/camera.ts";
import { createPathSampler } from "../../src/features/student-world/systems/path.ts";
import { nodeFrame } from "../../src/features/student-world/systems/renderer.ts";

const layout = JSON.parse(
  fs.readFileSync(new URL("../../public/assets/nabta/world/regions/forest-clearing/decor.json", import.meta.url), "utf8"),
);

const failures = [];
const sampler = createPathSampler(layout.path);

function quest(status, slot = 0) {
  return { id: `q-${slot}`, slot, title: "t", objective: "", classroomName: "c", status, rewardXp: 0 };
}

for (const node of layout.nodes) {
  const at = sampler.sample(node.t);
  const drift = Math.hypot(at.x - node.x, at.y - node.y);
  // node.y is stored 4px above the path so the medallion stands on it
  if (drift > 5) failures.push(`node ${node.slot} drifts ${drift.toFixed(2)}px from its path fraction`);
}

for (let i = 0; i <= 100; i += 1) {
  const sample = sampler.sample(i / 100);
  if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) failures.push(`path sample is not finite at ${i}%`);
  if (sample.x < 0 || sample.x > layout.width || sample.y < 0 || sample.y > layout.height) {
    failures.push(`path leaves the region at ${i}%`);
  }
}

const fit = fitCamera(800, 600, layout.width, layout.height);
if (fit.zoom < MIN_ZOOM || fit.zoom > MAX_ZOOM) failures.push(`fit zoom ${fit.zoom} outside limits`);

const clamped = clampCamera({ x: -5000, y: 99999, zoom: 2 }, 800, 600, layout.width, layout.height);
if (Math.abs(clamped.x - 200) > 0.01 || Math.abs(clamped.y - (layout.height - 150)) > 0.01) {
  failures.push(`camera clamp produced ${JSON.stringify(clamped)}`);
}

const zoomed = zoomAtPoint({ x: 480, y: 320, zoom: 1.5 }, 99, 0, 0, 800, 600, layout.width, layout.height);
if (zoomed.zoom > MAX_ZOOM + 1e-9) failures.push("zoom exceeded the maximum");
if (zoomed.x < 0 || zoomed.y < 0) failures.push("zoom pushed the camera out of bounds");

if (nodeFrame(quest("locked"), true) !== 3) failures.push("locked node must use the padlock medallion");
if (nodeFrame(quest("studied"), true) !== 2) failures.push("studied node must use the completed medallion");
if (nodeFrame(quest("available"), true) !== 1) failures.push("selected available node must use the active medallion");
if (nodeFrame(quest("available"), false) !== 0) failures.push("available node must use the sprout medallion");
if (nodeFrame(undefined, true) !== 3) failures.push("a slot without a quest must look locked");

if (failures.length) {
  console.log("FAILED");
  for (const failure of failures) console.log(" -", failure);
  process.exit(1);
}

console.log(
  `PASSED: ${layout.nodes.length} nodes on path, ${layout.objects.length} objects, sampler/camera/medallion checks ok (fit zoom ${fit.zoom.toFixed(2)})`,
);
