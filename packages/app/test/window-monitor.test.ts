import assert from "node:assert/strict";
import test from "node:test";
import { windowRefreshDecision } from "../src/window-monitor.js";

test("automatic inspection captures a newly appeared popover", () => {
  assert.equal(
    windowRefreshDecision("main", undefined, "popover", [
      { id: "popover", kind: "popover" },
      { id: "main", kind: "main" },
    ]),
    "capture-preferred",
  );
});

test("closed transient snapshots remain available for comments", () => {
  assert.equal(
    windowRefreshDecision("popover", undefined, "main", [{ id: "main", kind: "main" }]),
    "retain-closed",
  );
});

test("manual window selection is stable while the window remains visible", () => {
  assert.equal(
    windowRefreshDecision("main", "main", "popover", [
      { id: "popover", kind: "popover" },
      { id: "main", kind: "main" },
    ]),
    "stable",
  );
});
