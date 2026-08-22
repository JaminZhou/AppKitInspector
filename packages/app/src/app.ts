import { App } from "@modelcontextprotocol/ext-apps";

type Rect = { x: number; y: number; width: number; height: number };
type Node = {
  id: string;
  className: string;
  frame: Rect;
  label?: string;
  identifier?: string;
  subviews: Node[];
};
type Snapshot = {
  target: { name: string; pid: number };
  window: { title: string; frame: Rect };
  imageDataURL: string;
  root: Node;
};
type State = {
  connected: boolean;
  isMock: boolean;
  snapshot: Snapshot;
  selected?: { node: Node; ancestorPath: string[] };
};

const bridge = new App(
  { name: "AppKit Inspector", version: "0.1.0" },
  { availableDisplayModes: ["inline", "fullscreen", "pip"] },
  { autoResize: true },
);

declare global {
  interface Window {
    __APPKIT_INSPECTOR_INITIAL_STATE__?: unknown;
  }
}

let state: State | undefined = isState(window.__APPKIT_INSPECTOR_INITIAL_STATE__)
  ? window.__APPKIT_INSPECTOR_INITIAL_STATE__
  : undefined;
let selectedNode: Node | undefined;
let note = "";
let toast = "Connecting to Codex…";

function isState(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<State>;
  return Boolean(candidate.snapshot?.imageDataURL && candidate.snapshot.root);
}

function rows(root: Node, depth = 0): Array<{ node: Node; depth: number }> {
  return [{ node: root, depth }, ...root.subviews.flatMap((child) => rows(child, depth + 1))];
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>'\"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;",
    };
    return entities[character] ?? character;
  });
}

function highlightStyle(node: Node, snapshot: Snapshot): string {
  const window = snapshot.window.frame;
  const left = (node.frame.x / window.width) * 100;
  const top = (1 - (node.frame.y + node.frame.height) / window.height) * 100;
  const width = (node.frame.width / window.width) * 100;
  const height = (node.frame.height / window.height) * 100;
  return `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
}

function render(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) return;
  if (!state) {
    root.innerHTML = `<main class="shell"><header class="toolbar"><strong>AppKit Inspector</strong><span class="status">${escapeHTML(toast)}</span></header></main>`;
    return;
  }
  const snapshot = state.snapshot;
  const node = selectedNode ?? state.selected?.node;
  const treeRows = rows(snapshot.root)
    .map(
      ({ node: item, depth }) =>
        `<button type="button" data-view-id="${escapeHTML(item.id)}" class="${node?.id === item.id ? "selected" : ""}" style="padding-left:${8 + depth * 14}px"><span>${escapeHTML(item.className)}</span>${item.label ? ` <small>${escapeHTML(item.label)}</small>` : ""}</button>`,
    )
    .join("");
  const path = state.selected?.ancestorPath.join(" › ") ?? node?.className ?? "Click a view to inspect it";
  root.innerHTML = `
    <main class="shell">
      <header class="toolbar">
        <strong>AppKit Inspector</strong>
        <span class="status">${escapeHTML(state.isMock ? "Mock target" : `${snapshot.target.name} · pid ${snapshot.target.pid}`)}</span>
        <span class="spacer"></span>
        <button type="button" id="refresh" aria-label="Refresh snapshot">Refresh</button>
      </header>
      <section class="content">
        <div class="stage">
          <div class="screen">
            <img src="${snapshot.imageDataURL}" alt="${escapeHTML(snapshot.window.title)} app snapshot" draggable="false" />
            ${node ? `<div class="highlight" style="${highlightStyle(node, snapshot)}"></div>` : ""}
            <button type="button" class="hit-surface" aria-label="Select a view in the application snapshot"></button>
          </div>
        </div>
        <aside class="inspector">
          <div class="summary"><h2>${escapeHTML(node?.className ?? "No Selection")}</h2><p>${escapeHTML(path)}</p>${node ? `<p>x ${Math.round(node.frame.x)} · y ${Math.round(node.frame.y)} · ${Math.round(node.frame.width)} × ${Math.round(node.frame.height)}</p>` : ""}</div>
          <div class="tree" role="tree" aria-label="AppKit view hierarchy">${treeRows}</div>
          <div class="review">
            <textarea id="note" aria-label="Feedback for Codex" placeholder="Describe what should change…">${escapeHTML(note)}</textarea>
            <button type="button" id="send" class="send" ${node && note.trim() ? "" : "disabled"}>Send to Codex</button>
            <span class="toast" aria-live="polite">${escapeHTML(toast)}</span>
          </div>
        </aside>
      </section>
    </main>`;

  root.querySelector<HTMLButtonElement>("#refresh")?.addEventListener("click", () => void refresh());
  root.querySelector<HTMLButtonElement>(".hit-surface")?.addEventListener("click", (event) => {
    const surface = event.currentTarget as HTMLElement;
    const bounds = surface.getBoundingClientRect();
    void inspect((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-view-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedNode = rows(snapshot.root).find(({ node: item }) => item.id === button.dataset.viewId)?.node;
      render();
    });
  });
  root.querySelector<HTMLTextAreaElement>("#note")?.addEventListener("input", (event) => {
    note = (event.currentTarget as HTMLTextAreaElement).value;
    const send = root.querySelector<HTMLButtonElement>("#send");
    if (send) send.disabled = !(selectedNode ?? state?.selected?.node) || !note.trim();
  });
  root.querySelector<HTMLButtonElement>("#send")?.addEventListener("click", () => void sendToCodex());
}

async function refresh(): Promise<void> {
  toast = "Refreshing…";
  render();
  try {
    const result = await bridge.callServerTool({ name: "appkit_snapshot", arguments: {} });
    if (isState(result.structuredContent)) state = result.structuredContent;
    selectedNode = undefined;
    toast = "Snapshot refreshed";
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
  }
  render();
}

async function inspect(x: number, y: number): Promise<void> {
  toast = "Inspecting point…";
  render();
  try {
    const result = await bridge.callServerTool({ name: "appkit_inspect_point", arguments: { x, y } });
    if (isState(result.structuredContent)) {
      state = result.structuredContent;
      selectedNode = state.selected?.node;
    }
    toast = selectedNode ? `Selected ${selectedNode.className}` : "No view at that point";
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
  }
  render();
}

async function sendToCodex(): Promise<void> {
  const node = selectedNode ?? state?.selected?.node;
  if (!state || !node || !note.trim()) return;
  toast = "Preparing review…";
  render();
  try {
    const saved = await bridge.callServerTool({
      name: "save_appkit_review",
      arguments: { selectedViewID: node.id, note },
    });
    const output = saved.structuredContent as { imagePath?: string; contextPath?: string } | undefined;
    const path = state.selected?.ancestorPath.join(" › ") ?? node.className;
    const message = [
      `Please update the selected AppKit view based on this feedback: ${note.trim()}`,
      `View: ${node.className}`,
      `Hierarchy: ${path}`,
      `Frame: x=${node.frame.x}, y=${node.frame.y}, width=${node.frame.width}, height=${node.frame.height}`,
      output?.imagePath ? `Snapshot: ${output.imagePath}` : undefined,
      output?.contextPath ? `Review context: ${output.contextPath}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    const result = await bridge.sendMessage({ role: "user", content: [{ type: "text", text: message }] });
    if (result.isError) throw new Error("Codex rejected the review message");
    toast = "Sent to Codex";
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
  }
  render();
}

bridge.ontoolresult = (result) => {
  if (isState(result.structuredContent)) {
    const nextState = result.structuredContent;
    state = nextState;
    selectedNode = nextState.selected?.node;
    toast = nextState.isMock ? "Explore the mock UI or connect a Debug target" : "Connected";
    render();
  }
};

render();
bridge
  .connect()
  .then(() => {
    toast = "Connected to Codex";
    render();
  })
  .catch((error) => {
    toast = error instanceof Error ? error.message : String(error);
    render();
  });
