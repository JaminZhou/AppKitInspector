import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedViewAtPoint,
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
      id: "shape-view",
      className: "NSView",
      frame: { x: 240, y: 560, width: 560, height: 20 },
      identifier: "shapeView",
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

test("native Browser comment targets exclude hidden and transparent view subtrees", () => {
  const hiddenRoot: CommentTargetNode = {
    id: "root",
    className: "NSPopoverFrame",
    frame: { x: 0, y: 0, width: 300, height: 200 },
    subviews: [
      {
        id: "visible",
        className: "NSButton",
        frame: { x: 20, y: 20, width: 80, height: 24 },
        label: "Visible",
        subviews: [],
      },
      {
        id: "hidden",
        className: "NSButton",
        frame: { x: 20, y: 60, width: 80, height: 24 },
        hidden: true,
        label: "Hidden",
        subviews: [{
          id: "hidden-child",
          className: "NSTextField",
          frame: { x: 22, y: 62, width: 60, height: 20 },
          label: "Hidden child",
          subviews: [],
        }],
      },
      {
        id: "transparent",
        className: "NSProgressIndicator",
        frame: { x: 20, y: 100, width: 14, height: 14 },
        alpha: 0,
        subviews: [],
      },
    ],
  };

  assert.deepEqual(
    nativeCommentTargets(hiddenRoot, hiddenRoot.frame).map(({ node }) => node.id),
    ["visible"],
  );
});

test("native Browser comment target IDs are stable and DOM-safe", () => {
  const first = nativeCommentTargetID("0x0000000100abcdef:42");
  assert.equal(first, nativeCommentTargetID("0x0000000100abcdef:42"));
  assert.match(first, /^appkit-view-[a-z0-9]+$/);
  assert.notEqual(first, nativeCommentTargetID("0x0000000100abcdef:43"));
});

test("table header virtual nodes expose one precise comment target per column", () => {
  const tableRoot: CommentTargetNode = {
    id: "root",
    className: "NSThemeFrame",
    frame: { x: 0, y: 0, width: 800, height: 600 },
    subviews: [{
      id: "header",
      className: "NSTableHeaderView",
      frame: { x: 200, y: 520, width: 600, height: 24 },
      subviews: [
        {
          id: "header:name",
          className: "NSTableHeaderCell",
          frame: { x: 200, y: 520, width: 360, height: 24 },
          identifier: "Name",
          label: "Name",
          subviews: [],
        },
        {
          id: "header:events",
          className: "NSTableHeaderCell",
          frame: { x: 560, y: 520, width: 100, height: 24 },
          identifier: "Events",
          label: "Events",
          subviews: [],
        },
      ],
    }],
  };

  const targets = nativeCommentTargets(tableRoot, tableRoot.frame);

  assert.deepEqual(targets.map(({ node }) => node.id), ["header:name", "header:events"]);
  assert.equal(
    nativeCommentTargetLabel(targets[1]!),
    "AppKit view: NSTableHeaderCell — Events",
  );
});

test("closed snapshots select the deepest frontmost cached AppKit view", () => {
  const backButton: CommentTargetNode = {
    id: "back",
    className: "NSButton",
    frame: { x: 20, y: 20, width: 80, height: 40 },
    subviews: [],
  };
  const frontButton: CommentTargetNode = {
    id: "front",
    className: "NSButton",
    frame: { x: 20, y: 20, width: 80, height: 40 },
    subviews: [{
      id: "label",
      className: "NSTextField",
      frame: { x: 30, y: 30, width: 60, height: 20 },
      subviews: [],
    }],
  };
  const cachedRoot: CommentTargetNode = {
    id: "root",
    className: "NSPopoverFrame",
    frame: { x: 0, y: 0, width: 120, height: 100 },
    subviews: [backButton, frontButton],
  };

  const selected = cachedViewAtPoint(
    cachedRoot,
    cachedRoot.frame,
    { x: 0.5, y: 0.6 },
  );

  assert.equal(selected?.node.id, "label");
  assert.deepEqual(selected?.path, ["NSPopoverFrame", "NSButton", "NSTextField"]);
});

test("closed snapshot hit testing ignores hidden and transparent cached views", () => {
  const cachedRoot: CommentTargetNode = {
    id: "root",
    className: "NSPopoverFrame",
    frame: { x: 0, y: 0, width: 100, height: 100 },
    subviews: [
      {
        id: "visible",
        className: "NSView",
        frame: { x: 0, y: 0, width: 100, height: 100 },
        subviews: [],
      },
      {
        id: "hidden",
        className: "NSButton",
        frame: { x: 0, y: 0, width: 100, height: 100 },
        hidden: true,
        subviews: [],
      },
      {
        id: "transparent",
        className: "NSButton",
        frame: { x: 0, y: 0, width: 100, height: 100 },
        alpha: 0,
        subviews: [],
      },
    ],
  };

  assert.equal(
    cachedViewAtPoint(cachedRoot, cachedRoot.frame, { x: 0.5, y: 0.5 })?.node.id,
    "visible",
  );
});
