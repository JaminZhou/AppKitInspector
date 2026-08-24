import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeCommentTargetID,
  nativeCommentTargetLabel,
  nativeCommentTargets,
  type CommentTargetNode,
} from "../src/native-comment-targets.js";

const button: CommentTargetNode = {
  id: "button-1",
  className: "NSButton",
  frame: { x: 12, y: 26, width: 35, height: 20 },
  label: "Add Folder",
  subviews: [{
    id: "button-image",
    className: "NSButtonImageView",
    frame: { x: 18, y: 29, width: 14, height: 14 },
    subviews: [],
  }],
};

const root: CommentTargetNode = {
  id: "root",
  className: "NSThemeFrame",
  frame: { x: 0, y: 0, width: 800, height: 600 },
  subviews: [
    {
      id: "container",
      className: "NSView",
      frame: { x: 0, y: 0, width: 240, height: 600 },
      subviews: [button],
    },
    {
      id: "private-decoration",
      className: "_NSDecorationView",
      frame: { x: 0, y: 0, width: 800, height: 20 },
      subviews: [],
    },
    {
      id: "outside",
      className: "NSButton",
      frame: { x: 900, y: 20, width: 30, height: 20 },
      label: "Outside",
      subviews: [],
    },
  ],
};

test("native Browser comment targets expose semantic AppKit views without infrastructure overlays", () => {
  const targets = nativeCommentTargets(root, root.frame);

  assert.deepEqual(targets.map(({ node }) => node.id), ["button-1"]);
  assert.deepEqual(targets[0]?.path, ["NSThemeFrame", "NSView", "NSButton"]);
  assert.equal(nativeCommentTargetLabel(targets[0]!), "AppKit view: NSButton — Add Folder");
});

test("native Browser comment target IDs are stable and DOM-safe", () => {
  const first = nativeCommentTargetID("0x0000000100abcdef:42");
  assert.equal(first, nativeCommentTargetID("0x0000000100abcdef:42"));
  assert.match(first, /^appkit-view-[a-z0-9]+$/);
  assert.notEqual(first, nativeCommentTargetID("0x0000000100abcdef:43"));
});
