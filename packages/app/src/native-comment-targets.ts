export type CommentTargetRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CommentTargetNode = {
  id: string;
  className: string;
  frame: CommentTargetRect;
  hidden?: boolean;
  alpha?: number;
  label?: string;
  identifier?: string;
  subviews: CommentTargetNode[];
};

export type NativeCommentTarget = {
  node: CommentTargetNode;
  depth: number;
  path: string[];
};

export type NormalizedSnapshotPoint = {
  x: number;
  y: number;
};

const GENERIC_CONTAINER_CLASSES = new Set([
  "NSBox",
  "NSButtonBezelView",
  "NSButtonImageView",
  "NSClipView",
  "NSGlassContainerView",
  "NSGlassEffectView",
  "NSScrollPocket",
  "NSStackView",
  "NSThemeFrame",
  "NSTitlebarBackgroundView",
  "NSTitlebarContainerView",
  "NSTitlebarView",
  "NSTableBackgroundView",
  "NSToolbarPlatterView",
  "NSToolbarView",
  "NSView",
  "NSVisualEffectView",
]);

function finiteRect(rect: CommentTargetRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
}

function intersectsWindow(rect: CommentTargetRect, windowFrame: CommentTargetRect): boolean {
  return (
    rect.width >= 2 &&
    rect.height >= 2 &&
    rect.x < windowFrame.width &&
    rect.y < windowFrame.height &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0
  );
}

function isSemanticView(node: CommentTargetNode): boolean {
  if (node.label?.trim()) return true;
  if (node.className.startsWith("_")) return false;
  if (GENERIC_CONTAINER_CLASSES.has(node.className)) return false;
  if (node.identifier?.trim()) return true;
  const isProductView = node.className.includes(".") && !node.className.startsWith("AppKit.");
  return node.subviews.length === 0 || isProductView;
}

export function nativeCommentTargets(
  root: CommentTargetNode,
  windowFrame: CommentTargetRect,
): NativeCommentTarget[] {
  const targets: NativeCommentTarget[] = [];

  function visit(node: CommentTargetNode, depth: number, ancestors: string[]): void {
    if (node.hidden || (node.alpha ?? 1) <= 0) return;
    const path = [...ancestors, node.className];
    if (
      depth > 0 &&
      finiteRect(node.frame) &&
      intersectsWindow(node.frame, windowFrame) &&
      isSemanticView(node)
    ) {
      targets.push({ node, depth, path });
    }
    node.subviews.forEach((child) => visit(child, depth + 1, path));
  }

  visit(root, 0, []);
  return targets;
}

function containsPoint(rect: CommentTargetRect, point: { x: number; y: number }): boolean {
  return (
    finiteRect(rect) &&
    rect.width > 0 &&
    rect.height > 0 &&
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function cachedViewAtPoint(
  root: CommentTargetNode,
  windowFrame: CommentTargetRect,
  point: NormalizedSnapshotPoint,
): NativeCommentTarget | undefined {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    windowFrame.width <= 0 ||
    windowFrame.height <= 0
  ) {
    return undefined;
  }

  const appKitPoint = {
    x: root.frame.x + windowFrame.width * Math.min(Math.max(point.x, 0), 1),
    y: root.frame.y + windowFrame.height * (1 - Math.min(Math.max(point.y, 0), 1)),
  };

  function hit(
    node: CommentTargetNode,
    depth: number,
    ancestors: string[],
  ): NativeCommentTarget | undefined {
    if (node.hidden || (node.alpha ?? 1) <= 0 || !containsPoint(node.frame, appKitPoint)) {
      return undefined;
    }

    const path = [...ancestors, node.className];
    for (let index = node.subviews.length - 1; index >= 0; index -= 1) {
      const result = hit(node.subviews[index]!, depth + 1, path);
      if (result) return result;
    }
    return { node, depth, path };
  }

  return hit(root, 0, []);
}

export function nativeCommentTargetID(viewID: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < viewID.length; index += 1) {
    hash ^= viewID.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `appkit-view-${(hash >>> 0).toString(36)}`;
}

export function nativeCommentTargetLabel(target: NativeCommentTarget): string {
  const detail = target.node.label?.trim() || target.node.identifier?.trim();
  return detail
    ? `AppKit view: ${target.node.className} — ${detail}`
    : `AppKit view: ${target.node.className}`;
}
