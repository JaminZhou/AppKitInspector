import assert from "node:assert/strict";
import test from "node:test";
import { targetRefreshDecision } from "../src/target-monitor.js";

test("target monitor refreshes only when a new Debug process appears", () => {
  assert.equal(
    targetRefreshDecision(100, { connected: true, target: { pid: 101 } }),
    "refresh",
  );
  assert.equal(
    targetRefreshDecision(undefined, { connected: true, target: { pid: 101 } }),
    "refresh",
  );
  assert.equal(
    targetRefreshDecision(101, { connected: true, target: { pid: 101 } }),
    "unchanged",
  );
  assert.equal(targetRefreshDecision(101, { connected: false }), "waiting");
  assert.equal(targetRefreshDecision(undefined, { connected: false }), "unchanged");
});
