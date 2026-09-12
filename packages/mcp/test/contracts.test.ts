import assert from "node:assert/strict";
import test from "node:test";
import { flattenViews, inspectResultSchema, snapshotSchema } from "../src/contracts.js";
import { inspectMockPoint, mockSnapshot } from "../src/mock.js";

test("mock snapshot satisfies the transport contract", () => {
  const snapshot = snapshotSchema.parse(mockSnapshot());
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.window.kind, "main");
  assert.equal(snapshot.availableWindows?.[0]?.id, "window-main");
  assert.equal(snapshot.window.captureScope, "windowFrame");
  assert.equal(snapshot.window.requestedCaptureMode, "exact");
  assert.equal(snapshot.window.requestedCaptureActivation, "current");
  assert.equal(snapshot.window.capturedWindowWasActive, false);
  assert.equal(snapshot.window.captureRendering, "windowFrameHybrid");
  assert.match(snapshot.window.captureFallbackReason ?? "", /mock target/);
  assert.ok(flattenViews(snapshot.root).some((view) => view.label === "Close Window"));
  assert.match(snapshot.imageDataURL, /^data:image\/svg\+xml;base64,/);

  const content = snapshotSchema.parse(mockSnapshot("content"));
  assert.equal(content.window.captureScope, "content");
  assert.equal(content.window.captureRendering, "viewCache");
  assert.match(content.window.captureFallbackReason ?? "", /mock target/);
  assert.equal(flattenViews(content.root).some((view) => view.label === "Close Window"), false);

  const exactFallback = snapshotSchema.parse(mockSnapshot("windowFrame", "exact"));
  assert.equal(exactFallback.window.requestedCaptureMode, "exact");
  assert.equal(exactFallback.window.captureRendering, "windowFrameHybrid");
  assert.match(exactFallback.window.captureFallbackReason ?? "", /mock target/);

  const explicitHybrid = snapshotSchema.parse(mockSnapshot("windowFrame", "hybrid"));
  assert.equal(explicitHybrid.window.requestedCaptureMode, "hybrid");
  assert.equal(explicitHybrid.window.captureRendering, "windowFrameHybrid");
  assert.equal(explicitHybrid.window.captureFallbackReason, undefined);

  const active = snapshotSchema.parse(mockSnapshot("windowFrame", "exact", "active"));
  assert.equal(active.window.requestedCaptureActivation, "active");
  assert.equal(active.window.capturedWindowWasActive, false);
});

test("mock point inspection returns a concrete view and ancestor path", () => {
  const result = inspectResultSchema.parse(inspectMockPoint(0.4, 0.25));
  assert.ok(result.node.className.length > 0);
  assert.equal(result.ancestorPath.at(-1), result.node.className);
});

test("window-frame point inspection can select a traffic-light control", () => {
  const result = inspectResultSchema.parse(inspectMockPoint(0.023, 0.04, "windowFrame"));
  assert.equal(result.node.label, "Close Window");
});

test("schema one content snapshots remain compatible", () => {
  const current = mockSnapshot("content");
  const legacy = {
    ...current,
    schemaVersion: 1,
    window: {
      id: current.window.id,
      title: current.window.title,
      frame: current.window.frame,
    },
  };
  assert.equal(snapshotSchema.parse(legacy).window.captureScope, undefined);
});

test("schema two window snapshots remain compatible without rendering metadata", () => {
  const current = mockSnapshot();
  const { captureRendering: _captureRendering, ...window } = current.window;
  const legacy = { ...current, schemaVersion: 2, window };
  assert.equal(snapshotSchema.parse(legacy).window.captureRendering, undefined);
});
