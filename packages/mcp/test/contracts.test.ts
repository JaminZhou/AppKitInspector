import assert from "node:assert/strict";
import test from "node:test";
import { flattenViews, inspectResultSchema, snapshotSchema } from "../src/contracts.js";
import { inspectMockPoint, mockSnapshot } from "../src/mock.js";

test("mock snapshot satisfies the transport contract", () => {
  const snapshot = snapshotSchema.parse(mockSnapshot());
  assert.equal(snapshot.schemaVersion, 1);
  assert.ok(flattenViews(snapshot.root).length >= 8);
  assert.match(snapshot.imageDataURL, /^data:image\/svg\+xml;base64,/);
});

test("mock point inspection returns a concrete view and ancestor path", () => {
  const result = inspectResultSchema.parse(inspectMockPoint(0.4, 0.25));
  assert.ok(result.node.className.length > 0);
  assert.equal(result.ancestorPath.at(-1), result.node.className);
});
