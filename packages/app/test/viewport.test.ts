import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitZoom,
  normalizedPoint,
  scaledZoom,
  steppedZoom,
} from "../src/viewport.js";

test("fit zoom preserves the snapshot at or below its logical size", () => {
  assert.equal(fitZoom({ width: 1_100, height: 900 }, { width: 750, height: 500 }), 1);
  assert.equal(fitZoom({ width: 423, height: 298 }, { width: 750, height: 500 }), 0.5);
  assert.equal(fitZoom({ width: 0, height: 298 }, { width: 750, height: 500 }), 1);
});

test("stepped zoom is bounded and reversible", () => {
  assert.equal(steppedZoom(1, "in"), 1.25);
  assert.equal(steppedZoom(1.25, "out"), 1);
  assert.equal(steppedZoom(MAX_ZOOM, "in"), MAX_ZOOM);
  assert.equal(steppedZoom(MIN_ZOOM, "out"), MIN_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.ok(scaledZoom(1, -100) > 1.2);
  assert.ok(scaledZoom(1, 100) < 0.82);
});

test("selection coordinates stay normalized at any rendered size", () => {
  assert.deepEqual(
    normalizedPoint(
      { left: 100, top: 50, width: 1_500, height: 1_000 },
      { x: 850, y: 550 },
    ),
    { x: 0.5, y: 0.5 },
  );
  assert.deepEqual(
    normalizedPoint(
      { left: 100, top: 50, width: 1_500, height: 1_000 },
      { x: 2_000, y: -20 },
    ),
    { x: 1, y: 0 },
  );
});
