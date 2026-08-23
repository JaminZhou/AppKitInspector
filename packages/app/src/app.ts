import { App } from "@modelcontextprotocol/ext-apps";
import { LocalInspectorClient, standaloneConnection } from "./local-client.js";

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
type LaunchState = {
  connected: boolean;
  target?: { name: string; pid: number };
};
type FullscreenLaunch = LaunchState & {
  launchID: string;
};
type ReviewArtifacts = { imagePath?: string; contextPath?: string };

const isLocalSurface = window.location.protocol === "http:" && window.location.hostname === "127.0.0.1";
const connection = standaloneConnection(window.location);
if (connection?.token) window.history.replaceState(null, "", connection.cleanURL);
const localClient = connection
  ? new LocalInspectorClient(connection.origin, connection.token)
  : undefined;
const bridge = isLocalSurface
  ? undefined
  : new App(
      { name: "AppKit Inspector", version: "0.1.1" },
      { availableDisplayModes: ["inline", "fullscreen"] },
      { autoResize: false },
    );

let state: State | undefined;
let selectedNode: Node | undefined;
let selectedPath: string[] | undefined;
let note = "";
let toast = isLocalSurface ? "Loading the connected app…" : "Connecting to Codex…";
let bridgeConnected = false;
let launchState: LaunchState | undefined;
let loading = false;
let opening = false;
let fullscreenActive = false;

function isState(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<State>;
  return Boolean(candidate.snapshot?.imageDataURL && candidate.snapshot.root);
}

function isLaunchState(value: unknown): value is LaunchState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LaunchState> & {
    snapshot?: unknown;
    browserURL?: unknown;
    launchID?: unknown;
    confirmed?: unknown;
  };
  return (
    typeof candidate.connected === "boolean" &&
    candidate.snapshot === undefined &&
    candidate.browserURL === undefined &&
    candidate.launchID === undefined &&
    candidate.confirmed === undefined
  );
}

function isFullscreenLaunch(value: unknown): value is FullscreenLaunch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FullscreenLaunch>;
  return (
    typeof candidate.connected === "boolean" &&
    typeof candidate.launchID === "string"
  );
}

function rows(
  root: Node,
  depth = 0,
  ancestors: string[] = [],
): Array<{ node: Node; depth: number; path: string[] }> {
  const path = [...ancestors, root.className];
  return [
    { node: root, depth, path },
    ...root.subviews.flatMap((child) => rows(child, depth + 1, path)),
  ];
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
  const windowFrame = snapshot.window.frame;
  const left = (node.frame.x / windowFrame.width) * 100;
  const top = (1 - (node.frame.y + node.frame.height) / windowFrame.height) * 100;
  const width = (node.frame.width / windowFrame.width) * 100;
  const height = (node.frame.height / windowFrame.height) * 100;
  return `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
}

function targetLabel(): string {
  const target = state?.snapshot.target ?? launchState?.target;
  if (target) return `${target.name} · pid ${target.pid}`;
  if (launchState?.connected === false) return "Built-in mock target";
  return "Preparing inspector session…";
}

function renderLauncher(root: HTMLDivElement): void {
  const disabled = !bridgeConnected || opening;
  root.innerHTML = `
    <main class="launcher-shell" data-display-mode="inline">
      <header class="toolbar">
        <strong>AppKit Inspector</strong>
        <span class="status">${escapeHTML(targetLabel())}</span>
      </header>
      <section class="launcher" aria-label="Open AppKit Inspector">
        <div><strong>Experimental Full Screen</strong><span>${escapeHTML(toast)}</span></div>
        <div class="launcher-actions">
          <button type="button" id="open-window" class="secondary-action" ${disabled ? "disabled" : ""}>Open External Window</button>
          <button type="button" id="open-inspector" class="primary-action" ${disabled ? "disabled" : ""}>${opening ? "Opening…" : "Try Full Screen"}</button>
        </div>
      </section>
    </main>`;
  root.querySelector<HTMLButtonElement>("#open-inspector")?.addEventListener("click", () => {
    void openInspector();
  });
  root.querySelector<HTMLButtonElement>("#open-window")?.addEventListener("click", () => {
    void openInspectorWindow();
  });
}

function renderWorkspace(root: HTMLDivElement): void {
  const canLoad = Boolean(localClient || (bridge && fullscreenActive));
  const mode = isLocalSurface ? "window" : "fullscreen";
  if (!canLoad) {
    root.innerHTML = `<main class="shell mode-${mode}"><header class="toolbar"><strong>AppKit Inspector</strong></header><div class="startup" role="alert"><div><strong>Inspector authorization failed</strong><span>Reopen this surface from the Codex launcher.</span></div></div></main>`;
    return;
  }
  if (!state) {
    root.innerHTML = `<main class="shell mode-${mode}"><header class="toolbar"><strong>AppKit Inspector</strong><span class="status">${escapeHTML(targetLabel())}</span></header><div class="startup" role="status"><div><strong>Loading inspector…</strong><span>${escapeHTML(toast)}</span></div></div></main>`;
    return;
  }
  const snapshot = state.snapshot;
  const node = selectedNode ?? state.selected?.node;
  const treeRows = rows(snapshot.root)
    .map(
      ({ node: item, depth }) =>
        `<button type="button" role="treeitem" data-view-id="${escapeHTML(item.id)}" class="${node?.id === item.id ? "selected" : ""}" style="padding-left:${8 + depth * 14}px"><span>${escapeHTML(item.className)}</span>${item.label ? ` <small>${escapeHTML(item.label)}</small>` : ""}</button>`,
    )
    .join("");
  const path = selectedPath?.join(" › ") ?? node?.className ?? "Click a view to inspect it";
  root.innerHTML = `
    <main class="shell mode-${mode}" data-display-mode="${mode}">
      <header class="toolbar">
        <strong>AppKit Inspector</strong>
        <span class="status">${escapeHTML(state.isMock ? "Mock target" : `${snapshot.target.name} · pid ${snapshot.target.pid}`)}</span>
        <span class="spacer"></span>
        ${!isLocalSurface ? '<button type="button" id="open-window">Open Window</button>' : ""}
        ${!isLocalSurface ? '<button type="button" id="close-fullscreen">Close</button>' : ""}
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
            <button type="button" id="send" class="send" ${node && note.trim() ? "" : "disabled"}>Copy for Codex</button>
            <span class="toast" aria-live="polite">${escapeHTML(toast)}</span>
          </div>
        </aside>
      </section>
    </main>`;

  root.querySelector<HTMLButtonElement>("#refresh")?.addEventListener("click", () => void refresh());
  root.querySelector<HTMLButtonElement>("#open-window")?.addEventListener("click", () => {
    void openInspectorWindow();
  });
  root.querySelector<HTMLButtonElement>("#close-fullscreen")?.addEventListener("click", () => {
    void closeFullscreen();
  });
  root.querySelector<HTMLButtonElement>(".hit-surface")?.addEventListener("click", (event) => {
    const surface = event.currentTarget as HTMLElement;
    const bounds = surface.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    void inspect((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-view-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = rows(snapshot.root).find(({ node: item }) => item.id === button.dataset.viewId);
      selectedNode = selected?.node;
      selectedPath = selected?.path;
      render();
    });
  });
  root.querySelector<HTMLTextAreaElement>("#note")?.addEventListener("input", (event) => {
    note = (event.currentTarget as HTMLTextAreaElement).value;
    const send = root.querySelector<HTMLButtonElement>("#send");
    if (send) send.disabled = !(selectedNode ?? state?.selected?.node) || !note.trim();
  });
  root.querySelector<HTMLButtonElement>("#send")?.addEventListener("click", () => void copyForCodex());
}

function render(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) return;
  if (isLocalSurface || fullscreenActive) renderWorkspace(root);
  else renderLauncher(root);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = window.setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function callInspectorTool(name: string, arguments_: Record<string, unknown> = {}) {
  if (!bridge) throw new Error("Codex bridge is unavailable");
  const result = await bridge.callServerTool({ name, arguments: arguments_ });
  if (result.isError) throw new Error(`${name} failed`);
  return result.structuredContent;
}

async function openSeparateWindow(): Promise<void> {
  await callInspectorTool("open_appkit_inspector_window");
  toast = "Inspector opened in a separate local window.";
}

async function openInspectorWindow(): Promise<void> {
  if (!bridge || !bridgeConnected || opening) return;
  opening = true;
  toast = "Opening a separate Inspector window…";
  render();
  try {
    await openSeparateWindow();
  } catch (error) {
    toast = errorMessage(error);
  } finally {
    opening = false;
  }
  render();
}

async function waitForUsableFullscreen(): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(100);
    const root = document.querySelector<HTMLElement>('[data-display-mode="fullscreen"]');
    const bounds = root?.getBoundingClientRect();
    const hostMode = bridge?.getHostContext()?.displayMode;
    if (
      state &&
      bounds &&
      bounds.width >= 640 &&
      bounds.height >= 480 &&
      (hostMode === undefined || hostMode === "fullscreen")
    ) {
      return true;
    }
  }
  return false;
}

async function openInspector(): Promise<void> {
  if (!bridge || !bridgeConnected || opening) return;
  const availableModes = bridge.getHostContext()?.availableDisplayModes ?? [];
  if (!availableModes.includes("fullscreen")) {
    toast = "This Codex host does not offer Full Screen. Use the default Browser command or explicitly open the external window.";
    render();
    return;
  }

  opening = true;
  toast = "Opening fullscreen Inspector…";
  render();
  try {
    const launch = await callInspectorTool("begin_appkit_inspector_fullscreen");
    if (!isFullscreenLaunch(launch)) throw new Error("Fullscreen guard did not start");
    launchState = launch;
    const display = await withTimeout(
      bridge.requestDisplayMode({ mode: "fullscreen" }),
      2_000,
      "Codex did not complete the fullscreen transition",
    );
    if (display.mode !== "fullscreen") throw new Error(`Codex kept the Inspector in ${display.mode} mode`);

    fullscreenActive = true;
    state = undefined;
    toast = "Loading the connected app…";
    render();
    const loaded = await refresh();
    if (!loaded || !(await waitForUsableFullscreen())) {
      throw new Error("Codex fullscreen did not produce a usable Inspector surface");
    }

    const confirmation = await callInspectorTool("confirm_appkit_inspector_fullscreen", {
      launchID: launch.launchID,
    });
    if (!(confirmation as { confirmed?: unknown } | undefined)?.confirmed) {
      throw new Error("Fullscreen fallback was already released");
    }
    toast = "Experimental Full Screen Inspector is ready.";
  } catch (error) {
    fullscreenActive = false;
    state = undefined;
    toast = `${errorMessage(error)}. No external window was opened; return to the default Codex Browser path.`;
  } finally {
    opening = false;
  }
  render();
}

async function closeFullscreen(): Promise<void> {
  if (!bridge) return;
  try {
    await bridge.requestDisplayMode({ mode: "inline" });
  } catch {
    // Host context changes still restore the launcher when the host closes fullscreen.
  }
  fullscreenActive = false;
  state = undefined;
  toast = "Full Screen is experimental. Use the default Codex Browser path for normal inspection.";
  render();
}

async function snapshotRequest(): Promise<unknown> {
  if (localClient) return await localClient.snapshot<State>();
  return await callInspectorTool("appkit_snapshot");
}

async function inspectRequest(x: number, y: number): Promise<unknown> {
  if (localClient) return await localClient.inspect<State>(x, y);
  return await callInspectorTool("appkit_inspect_point", { x, y });
}

async function saveReviewRequest(selectedViewID: string, reviewNote: string): Promise<ReviewArtifacts> {
  if (localClient) return await localClient.saveReview<ReviewArtifacts>(selectedViewID, reviewNote);
  const output = await callInspectorTool("save_appkit_review", {
    selectedViewID,
    note: reviewNote,
  });
  return (output ?? {}) as ReviewArtifacts;
}

async function refresh(): Promise<boolean> {
  if (loading || (!localClient && !fullscreenActive)) return false;
  loading = true;
  toast = "Refreshing…";
  render();
  try {
    const nextState = await snapshotRequest();
    if (!isState(nextState)) throw new Error("Inspector returned an invalid snapshot");
    state = nextState;
    selectedNode = undefined;
    selectedPath = undefined;
    toast = nextState.isMock ? "Explore the mock UI or connect a Debug target" : "Snapshot refreshed";
    return true;
  } catch (error) {
    toast = errorMessage(error);
    return false;
  } finally {
    loading = false;
    render();
  }
}

async function inspect(x: number, y: number): Promise<void> {
  if (!localClient && !fullscreenActive) return;
  toast = "Inspecting point…";
  render();
  try {
    const nextState = await inspectRequest(x, y);
    if (!isState(nextState)) throw new Error("Inspector returned an invalid selection");
    state = nextState;
    selectedNode = nextState.selected?.node;
    selectedPath = nextState.selected?.ancestorPath;
    toast = selectedNode ? `Selected ${selectedNode.className}` : "No view at that point";
  } catch (error) {
    toast = errorMessage(error);
  }
  render();
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

async function copyForCodex(): Promise<void> {
  const node = selectedNode ?? state?.selected?.node;
  if (!state || !node || !note.trim()) return;
  toast = "Preparing review…";
  render();
  try {
    const output = await saveReviewRequest(node.id, note.trim());
    const path = selectedPath?.join(" › ") ?? node.className;
    const message = [
      `Please update the selected AppKit view based on this feedback: ${note.trim()}`,
      `View: ${node.className}`,
      `Hierarchy: ${path}`,
      `Frame: x=${node.frame.x}, y=${node.frame.y}, width=${node.frame.width}, height=${node.frame.height}`,
      output.imagePath ? `Snapshot: ${output.imagePath}` : undefined,
      output.contextPath ? `Review context: ${output.contextPath}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    if (!(await copyText(message))) throw new Error("Could not copy the review to the clipboard");
    toast = "Review copied. Paste it into Codex.";
  } catch (error) {
    toast = errorMessage(error);
  }
  render();
}

if (bridge) {
  bridge.ontoolresult = (result) => {
    if (isLaunchState(result.structuredContent)) {
      launchState = result.structuredContent;
      toast = "Full Screen is experimental. Nothing opens until you choose an action.";
      render();
    }
  };
  bridge.onhostcontextchanged = (context) => {
    if (context.displayMode === "inline" && fullscreenActive) {
      fullscreenActive = false;
      state = undefined;
      toast = "Full Screen is experimental. Use the default Codex Browser path for normal inspection.";
      render();
    }
  };
}

render();
if (localClient) {
  void refresh();
} else if (bridge) {
  bridge
    .connect()
    .then(() => {
      bridgeConnected = true;
      toast = "Nothing opens automatically. Try Full Screen or explicitly open the external window.";
      render();
    })
    .catch((error) => {
      toast = errorMessage(error);
      render();
    });
}
