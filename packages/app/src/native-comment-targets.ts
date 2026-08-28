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
  label?: string;
  identifier?: string;
  subviews: CommentTargetNode[];
};

export type NativeCommentTarget = {
  node: CommentTargetNode;
  depth: number;
  path: string[];
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
