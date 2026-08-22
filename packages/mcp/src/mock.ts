import type { InspectResult, Snapshot, ViewNode } from "./contracts.js";

const view = (
  id: string,
  className: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string | undefined,
  subviews: ViewNode[] = [],
): ViewNode => ({
  id,
  className,
  frame: { x, y, width, height },
  bounds: { x: 0, y: 0, width, height },
  hidden: false,
  alpha: 1,
  ...(label ? { label } : {}),
  subviews,
});

const root = view("root", "NSThemeFrame", 0, 0, 960, 600, "Demo window", [
  view("split", "NSSplitView", 0, 0, 960, 552, undefined, [
    view("sidebar", "NSVisualEffectView", 0, 0, 224, 552, "Sidebar", [
      view("sessions", "NSOutlineView", 12, 54, 200, 450, "Sessions"),
      view("add", "NSButton", 12, 14, 28, 28, "Add Folder"),
    ]),
    view("content", "NSView", 224, 0, 736, 552, "Session detail", [
      view("title", "NSTextField", 260, 486, 310, 28, "Agent Session"),
      view("search", "NSSearchField", 260, 438, 320, 30, "Search events"),
      view("timeline", "NSCollectionView", 260, 24, 660, 390, "Timeline"),
    ]),
  ]),
  view("toolbar", "NSToolbarView", 0, 552, 960, 48, "Toolbar"),
]);

function mockImageDataURL(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
  <defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#f6f6f8"/><stop offset="1" stop-color="#ececf0"/></linearGradient></defs>
  <rect width="960" height="600" rx="12" fill="url(#bg)"/>
  <rect width="960" height="48" fill="#fafafbcc"/><path d="M0 48h960" stroke="#d5d5da"/>
  <circle cx="22" cy="24" r="6" fill="#ff5f57"/><circle cx="42" cy="24" r="6" fill="#febc2e"/><circle cx="62" cy="24" r="6" fill="#28c840"/>
  <text x="480" y="29" text-anchor="middle" font-family="-apple-system" font-size="13" font-weight="600" fill="#303035">AppKit Inspector Demo</text>
  <rect y="48" width="224" height="552" fill="#e7e7eb"/><path d="M224 48v552" stroke="#c9c9cf"/>
  <text x="18" y="82" font-family="-apple-system" font-size="11" font-weight="600" fill="#717178">SESSIONS</text>
  <rect x="10" y="94" width="204" height="34" rx="7" fill="#0a84ff"/><text x="28" y="116" font-family="-apple-system" font-size="13" fill="white">Current Session</text>
  <text x="260" y="112" font-family="-apple-system" font-size="24" font-weight="700" fill="#222227">Agent Session</text>
  <rect x="260" y="132" width="320" height="30" rx="8" fill="white" stroke="#c8c8ce"/><text x="290" y="152" font-family="-apple-system" font-size="13" fill="#8a8a91">Search events</text>
  <rect x="260" y="186" width="660" height="88" rx="10" fill="white"/><text x="280" y="216" font-family="-apple-system" font-size="12" font-weight="600" fill="#55555b">USER</text><text x="280" y="244" font-family="-apple-system" font-size="14" fill="#25252a">Inspect this AppKit interface.</text>
  <rect x="260" y="288" width="660" height="148" rx="10" fill="white"/><text x="280" y="318" font-family="-apple-system" font-size="12" font-weight="600" fill="#55555b">ASSISTANT</text><text x="280" y="348" font-family="-apple-system" font-size="14" fill="#25252a">Click any element to inspect its native view.</text>
  <rect x="12" y="558" width="28" height="28" rx="7" fill="#ffffff88" stroke="#c9c9cf"/><text x="26" y="578" text-anchor="middle" font-family="-apple-system" font-size="20" fill="#44444a">+</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function mockSnapshot(): Snapshot {
  return {
    schemaVersion: 1,
    target: {
      pid: 1,
      name: "AppKit Inspector Demo",
      bundleIdentifier: "dev.appkit-inspector.mock",
      port: 1,
      startedAt: "2026-01-01T00:00:00Z",
    },
    window: {
      id: "window-main",
      title: "AppKit Inspector Demo",
      frame: { x: 0, y: 0, width: 960, height: 600 },
    },
    imageDataURL: mockImageDataURL(),
    root,
  };
}

export function inspectMockPoint(x: number, y: number): InspectResult {
  const snapshot = mockSnapshot();
  const pointX = x * snapshot.window.frame.width;
  const pointY = (1 - y) * snapshot.window.frame.height;

  const visit = (node: ViewNode, path: string[]): { node: ViewNode; path: string[] } | undefined => {
    for (const child of [...node.subviews].reverse()) {
      const result = visit(child, [...path, node.className]);
      if (result) return result;
    }
    const frame = node.frame;
    if (
      pointX >= frame.x &&
      pointX <= frame.x + frame.width &&
      pointY >= frame.y &&
      pointY <= frame.y + frame.height
    ) {
      return { node, path: [...path, node.className] };
    }
    return undefined;
  };

  const found = visit(root, []) ?? { node: root, path: [root.className] };
  return { snapshot, node: found.node, ancestorPath: found.path };
}
