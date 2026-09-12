import { App } from "@modelcontextprotocol/ext-apps";
import {
  type CaptureActivation,
  type CaptureMode,
  type CaptureScope,
  LocalInspectorClient,
  standaloneConnection,
} from "./local-client.js";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitZoom,
  normalizedPoint,
  scaledZoom,
  steppedZoom,
} from "./viewport.js";
import { targetRefreshDecision } from "./target-monitor.js";
import { windowRefreshDecision, type WindowKind } from "./window-monitor.js";
import {
  cachedViewAtPoint,
  nativeCommentTargetID,
  nativeCommentTargetLabel,
  nativeCommentTargets,
  type NativeCommentTarget,
} from "./native-comment-targets.js";

type Rect = { x: number; y: number; width: number; height: number };
type WindowOption = {
  id: string;
  title: string;
  className: string;
  kind: WindowKind;
  frame: Rect;
  isKeyWindow: boolean;
  isMainWindow: boolean;
};
type Node = {
  id: string;
  className: string;
  frame: Rect;
  hidden?: boolean;
  alpha?: number;
  label?: string;
  identifier?: string;
  subviews: Node[];
};
type Snapshot = {
  target: { name: string; pid: number };
  window: {
    id: string;
    title: string;
    kind?: WindowKind;
    frame: Rect;
    contentFrame?: Rect;
    captureScope?: CaptureScope;
    requestedCaptureMode?: CaptureMode;
    requestedCaptureActivation?: CaptureActivation;
    capturedWindowWasActive?: boolean;
    captureRendering?: "viewCache" | "windowFrameHybrid" | "windowServerExact";
    captureFallbackReason?: string;
  };
  availableWindows?: WindowOption[];
  imageDataURL: string;
  root: Node;
};
type WindowListState = {
  connected: boolean;
  isMock: boolean;
  windowList: {
    windows: WindowOption[];
    preferredWindowID?: string;
  };
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
let toast = isLocalSurface ? "Loading the connected app…" : "Connecting to Codex…";
let bridgeConnected = false;
let launchState: LaunchState | undefined;
let loading = false;
let opening = false;
let fullscreenActive = false;
let zoomMode: "fit" | "manual" = "fit";
let manualZoom = 1;
let fittedZoom = 1;
let zoomObserver: ResizeObserver | undefined;
let captureScope: CaptureScope = "windowFrame";
const captureMode: CaptureMode = "exact";
let captureActivation: CaptureActivation = "current";
let windowOptions: WindowOption[] = [];
let preferredWindowID: string | undefined;
let manualWindowID: string | undefined;
let displayedWindowUnavailable = false;
const TARGET_POLL_INTERVAL_MS = 500;

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

function isWindowListState(value: unknown): value is WindowListState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WindowListState>;
  return Boolean(
    typeof candidate.connected === "boolean" &&
    candidate.windowList &&
    Array.isArray(candidate.windowList.windows),
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

function selectView(node: Node, path: string[]): void {
  selectedNode = node;
  selectedPath = path;
}

function selectionHighlight(snapshot: Snapshot): string {
  return selectedNode
    ? `<div class="highlight" style="${highlightStyle(selectedNode, snapshot)}"></div>`
    : "";
}

function nativeCommentTargetStyle(target: NativeCommentTarget, snapshot: Snapshot): string {
  return `${highlightStyle(target.node, snapshot)};z-index:${10 + target.depth}`;
}

function nativeCommentTargetOverlays(snapshot: Snapshot): string {
  return nativeCommentTargets(snapshot.root, snapshot.window.frame)
    .map((target) => {
      const label = nativeCommentTargetLabel(target);
      return `<button type="button" id="${nativeCommentTargetID(target.node.id)}" class="native-comment-target" data-view-id="${escapeHTML(target.node.id)}" data-appkit-class="${escapeHTML(target.node.className)}" data-appkit-hierarchy="${escapeHTML(target.path.join(" › "))}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}" style="${nativeCommentTargetStyle(target, snapshot)}"></button>`;
    })
    .join("");
}

function targetLabel(): string {
  const target = state?.snapshot.target ?? launchState?.target;
  if (target) return `${target.name} · pid ${target.pid}`;
  if (launchState?.connected === false) return "Built-in mock target";
  return "Preparing inspector session…";
}

function snapshotCaptureScope(snapshot: Snapshot): CaptureScope {
  return snapshot.window.captureScope ?? "content";
}

function snapshotCaptureActivation(snapshot: Snapshot): CaptureActivation {
  return snapshot.window.requestedCaptureActivation ?? "current";
}

function captureBadge(snapshot: Snapshot): string {
  const rendering = snapshot.window.captureRendering;
  if (rendering === "windowServerExact") return "";
  const fallback = snapshot.window.captureFallbackReason;
  const detail = rendering === "windowFrameHybrid"
    ? "Hybrid AppKit"
    : rendering === "viewCache"
      ? "View Cache"
      : "Legacy Target";
  const reason = fallback ?? "The connected Debug target did not return exact WindowServer pixels; rebuild it against the current probe.";
  return `<span class="capture-note warning" title="${escapeHTML(reason)}">Compatibility Preview · ${detail}</span>`;
}

function windowKindLabel(kind: WindowKind): string {
  switch (kind) {
    case "main": return "Main Window";
    case "popover": return "Popover";
    case "sheet": return "Sheet";
    case "panel": return "Panel";
    case "window": return "Window";
  }
}

function windowOptionLabel(option: WindowOption): string {
  const kind = windowKindLabel(option.kind);
  return option.title === kind ? kind : `${kind} — ${option.title}`;
}

function syncWindowOptionsFromSnapshot(snapshot: Snapshot): void {
  if (snapshot.availableWindows) windowOptions = snapshot.availableWindows;
  const listed = windowOptions.find((option) => option.id === snapshot.window.id);
  if (!listed) {
    windowOptions = [{
      id: snapshot.window.id,
      title: snapshot.window.title,
      className: snapshot.root.className,
      kind: snapshot.window.kind ?? "window",
      frame: snapshot.window.frame,
      isKeyWindow: false,
      isMainWindow: snapshot.window.kind === "main",
    }, ...windowOptions];
  }
}

function windowSelector(snapshot: Snapshot): string {
  const current = windowOptions.find((option) => option.id === snapshot.window.id);
  const automaticLabel = current
    ? `Automatic (${windowKindLabel(current.kind)})`
    : "Automatic";
  const liveOptions = windowOptions.map((option) =>
    `<option value="${escapeHTML(option.id)}" ${manualWindowID === option.id ? "selected" : ""}>${escapeHTML(windowOptionLabel(option))}</option>`,
  ).join("");
  const staleOption = displayedWindowUnavailable && !windowOptions.some((option) => option.id === snapshot.window.id)
    ? `<option value="${escapeHTML(snapshot.window.id)}" ${manualWindowID === snapshot.window.id ? "selected" : ""} disabled>${escapeHTML(snapshot.window.title)} (Closed)</option>`
    : "";
  return `<label class="window-picker"><span class="visually-hidden">Inspected window</span><select id="window-selector" aria-label="Inspected window"><option value="" ${manualWindowID === undefined ? "selected" : ""}>${escapeHTML(automaticLabel)}</option>${liveOptions}${staleOption}</select></label>`;
}

function effectiveZoom(): number {
  return zoomMode === "fit" ? fittedZoom : manualZoom;
}

function applyZoomLayout(root: HTMLDivElement, snapshot: Snapshot): void {
  const stage = root.querySelector<HTMLElement>(".stage");
  const screen = root.querySelector<HTMLElement>(".screen");
  const output = root.querySelector<HTMLOutputElement>("#zoom-value");
  const fit = root.querySelector<HTMLButtonElement>("#zoom-fit");
  const zoomOut = root.querySelector<HTMLButtonElement>("#zoom-out");
  const zoomIn = root.querySelector<HTMLButtonElement>("#zoom-in");
  if (!stage || !screen) return;

  fittedZoom = fitZoom(
    { width: stage.clientWidth, height: stage.clientHeight },
    { width: snapshot.window.frame.width, height: snapshot.window.frame.height },
  );
  const zoom = effectiveZoom();
  screen.style.width = `${snapshot.window.frame.width * zoom}px`;
  screen.style.height = `${snapshot.window.frame.height * zoom}px`;
  if (output) output.textContent = `${Math.round(zoom * 100)}%`;
  fit?.setAttribute("aria-pressed", String(zoomMode === "fit"));
  if (zoomOut) zoomOut.disabled = zoom <= MIN_ZOOM;
  if (zoomIn) zoomIn.disabled = zoom >= MAX_ZOOM;
}

function setManualZoom(root: HTMLDivElement, snapshot: Snapshot, nextZoom: number): void {
  const stage = root.querySelector<HTMLElement>(".stage");
  const horizontalPosition = stage && stage.scrollWidth > 0
    ? (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth
    : 0.5;
  const verticalPosition = stage && stage.scrollHeight > 0
    ? (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight
    : 0.5;
  manualZoom = nextZoom;
  zoomMode = "manual";
  applyZoomLayout(root, snapshot);
  window.requestAnimationFrame(() => {
    if (!stage) return;
    stage.scrollLeft = horizontalPosition * stage.scrollWidth - stage.clientWidth / 2;
    stage.scrollTop = verticalPosition * stage.scrollHeight - stage.clientHeight / 2;
  });
}

function updateZoom(root: HTMLDivElement, snapshot: Snapshot, direction: "in" | "out"): void {
  setManualZoom(root, snapshot, steppedZoom(effectiveZoom(), direction));
}

function installZoomControls(root: HTMLDivElement, snapshot: Snapshot): void {
  zoomObserver?.disconnect();
  const stage = root.querySelector<HTMLElement>(".stage");
  if (!stage) return;

  applyZoomLayout(root, snapshot);
  zoomObserver = new ResizeObserver(() => applyZoomLayout(root, snapshot));
  zoomObserver.observe(stage);
  root.querySelector<HTMLButtonElement>("#zoom-out")?.addEventListener("click", () => {
    updateZoom(root, snapshot, "out");
  });
  root.querySelector<HTMLButtonElement>("#zoom-in")?.addEventListener("click", () => {
    updateZoom(root, snapshot, "in");
  });
  root.querySelector<HTMLButtonElement>("#zoom-fit")?.addEventListener("click", () => {
    zoomMode = "fit";
    applyZoomLayout(root, snapshot);
  });
  stage.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setManualZoom(root, snapshot, scaledZoom(effectiveZoom(), event.deltaY));
  }, { passive: false });
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
          <button type="button" id="open-inspector" class="primary-action" ${disabled ? "disabled" : ""}>${opening ? "Opening…" : "Try Full Screen"}</button>
        </div>
      </section>
    </main>`;
  root.querySelector<HTMLButtonElement>("#open-inspector")?.addEventListener("click", () => {
    void openInspector();
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
  const actualScope = snapshotCaptureScope(snapshot);
  const actualActivation = snapshotCaptureActivation(snapshot);
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
        ${!isLocalSurface ? '<button type="button" id="close-fullscreen">Close</button>' : ""}
        ${windowSelector(snapshot)}
        <div class="scope-controls" role="group" aria-label="Snapshot area">
          <button type="button" data-capture-scope="windowFrame" aria-pressed="${actualScope === "windowFrame"}" title="Include title bar and window controls">Window</button>
          <button type="button" data-capture-scope="content" aria-pressed="${actualScope === "content"}" title="Show only the application content view">Content</button>
        </div>
        <button type="button" id="capture-active" aria-pressed="${actualActivation === "active"}" title="Temporarily activate the inspected app for each capture, then return focus">Active Appearance</button>
        ${displayedWindowUnavailable ? '<span class="capture-note warning" title="The native window closed after this snapshot was captured. The retained hierarchy remains selectable.">Closed Window Snapshot</span>' : ""}
        ${captureBadge(snapshot)}
        <div class="zoom-controls" role="group" aria-label="Snapshot zoom">
          <button type="button" id="zoom-out" aria-label="Zoom out" title="Zoom Out">−</button>
          <button type="button" id="zoom-fit" aria-label="Fit snapshot" aria-pressed="true" title="Fit Snapshot">Fit</button>
          <output id="zoom-value" aria-live="polite">100%</output>
          <button type="button" id="zoom-in" aria-label="Zoom in" title="Zoom In">+</button>
        </div>
        <button type="button" id="refresh" aria-label="Refresh snapshot">Refresh</button>
      </header>
      <section class="content">
        <div class="stage" aria-label="Application snapshot canvas">
          <div class="canvas">
            <div class="screen">
              <img src="${snapshot.imageDataURL}" alt="${escapeHTML(snapshot.window.title)} app snapshot" draggable="false" />
              <button type="button" class="hit-surface" aria-label="Select a view in the application snapshot"></button>
              ${nativeCommentTargetOverlays(snapshot)}
              ${selectionHighlight(snapshot)}
            </div>
          </div>
        </div>
        <aside class="inspector">
          <div class="summary"><h2>${escapeHTML(node?.className ?? "No Selection")}</h2><p>${escapeHTML(path)}</p>${node ? `<p>x ${Math.round(node.frame.x)} · y ${Math.round(node.frame.y)} · ${Math.round(node.frame.width)} × ${Math.round(node.frame.height)}</p>` : ""}</div>
          <div class="tree" role="tree" aria-label="AppKit view hierarchy">${treeRows}</div>
        </aside>
      </section>
    </main>`;

  root.querySelector<HTMLButtonElement>("#refresh")?.addEventListener("click", () => void refresh());
  root.querySelector<HTMLButtonElement>("#close-fullscreen")?.addEventListener("click", () => {
    void closeFullscreen();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-capture-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      const scope = button.dataset.captureScope;
      if (scope === "content" || scope === "windowFrame") void switchCaptureScope(scope);
    });
  });
  root.querySelector<HTMLButtonElement>("#capture-active")?.addEventListener("click", () => {
    void switchCaptureActivation(actualActivation === "active" ? "current" : "active");
  });
  root.querySelector<HTMLSelectElement>("#window-selector")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    void switchCaptureWindow(value || undefined);
  });
  installZoomControls(root, snapshot);
  root.querySelector<HTMLButtonElement>(".hit-surface")?.addEventListener("click", (event) => {
    const surface = event.currentTarget as HTMLElement;
    const bounds = surface.getBoundingClientRect();
    const point = normalizedPoint(bounds, { x: event.clientX, y: event.clientY });
    if (!point) return;
    if (displayedWindowUnavailable) {
      const selected = cachedViewAtPoint(snapshot.root, snapshot.window.frame, point);
      if (selected) {
        selectView(selected.node, selected.path);
        toast = `Selected cached ${selected.node.className}`;
      } else {
        toast = "No cached view at that point";
      }
      render();
      return;
    }
    void inspect(point.x, point.y);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-view-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = rows(snapshot.root).find(({ node: item }) => item.id === button.dataset.viewId);
      if (selected) selectView(selected.node, selected.path);
      render();
    });
  });
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
    toast = "This Codex host does not offer Full Screen. Use the supported Codex Browser command.";
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
    toast = `${errorMessage(error)}. Return to the supported Codex Browser path.`;
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

async function snapshotRequest(
  activation: CaptureActivation = captureActivation,
): Promise<unknown> {
  if (localClient) {
    return await localClient.snapshot<State>(
      captureScope,
      captureMode,
      activation,
      manualWindowID,
    );
  }
  return await callInspectorTool("appkit_snapshot", {
    scope: captureScope,
    mode: captureMode,
    activation,
    ...(manualWindowID ? { windowID: manualWindowID } : {}),
  });
}

async function inspectRequest(x: number, y: number): Promise<unknown> {
  if (localClient) {
    return await localClient.inspect<State>(
      x,
      y,
      captureScope,
      captureMode,
      captureActivation,
      manualWindowID,
    );
  }
  return await callInspectorTool("appkit_inspect_point", {
    x,
    y,
    scope: captureScope,
    mode: captureMode,
    activation: captureActivation,
    ...(manualWindowID ? { windowID: manualWindowID } : {}),
  });
}

async function refresh(
  activation: CaptureActivation = captureActivation,
): Promise<boolean> {
  if (loading || (!localClient && !fullscreenActive)) return false;
  loading = true;
  toast = "Refreshing…";
  render();
  try {
    const requestedScope = captureScope;
    const nextState = await snapshotRequest(activation);
    if (!isState(nextState)) throw new Error("Inspector returned an invalid snapshot");
    state = nextState;
    syncWindowOptionsFromSnapshot(nextState.snapshot);
    if (manualWindowID === undefined) preferredWindowID = nextState.snapshot.window.id;
    displayedWindowUnavailable = false;
    captureScope = snapshotCaptureScope(nextState.snapshot);
    captureActivation = snapshotCaptureActivation(nextState.snapshot);
    selectedNode = undefined;
    selectedPath = undefined;
    toast = requestedScope !== captureScope
      ? "Window Frame requires a rebuilt Debug target; showing Content instead"
      : nextState.snapshot.window.captureFallbackReason
        ? `Exact capture unavailable; using compatibility preview: ${nextState.snapshot.window.captureFallbackReason}`
      : nextState.isMock
        ? "Explore the mock UI or connect a Debug target"
        : `${captureScope === "windowFrame" ? "Window Frame" : "Content"} snapshot refreshed`;
    return true;
  } catch (error) {
    toast = errorMessage(error);
    return false;
  } finally {
    loading = false;
    render();
  }
}

async function refreshAfterTargetChange(): Promise<void> {
  if (!localClient || loading || document.visibilityState === "hidden") return;
  try {
    const [targetState, windowsState] = await Promise.all([
      localClient.target<LaunchState>(),
      localClient.windows<WindowListState>(),
    ]);
    const displayedPID = state && !state.isMock ? state.snapshot.target.pid : undefined;
    const nextPID = targetState.target?.pid;
    const decision = targetRefreshDecision(displayedPID, targetState);
    if (decision === "refresh" && nextPID !== undefined) {
      toast = displayedPID === undefined
        ? "Connected to the relaunched Debug target…"
        : `Debug target restarted as pid ${nextPID}; refreshing…`;
      render();
      await refresh("current");
    } else if (decision === "waiting") {
      const waitingMessage = "Debug target stopped; waiting for it to relaunch…";
      if (toast !== waitingMessage) {
        toast = waitingMessage;
        render();
      }
    }
    if (!isWindowListState(windowsState)) return;
    windowOptions = windowsState.windowList.windows;
    preferredWindowID = windowsState.windowList.preferredWindowID;
    const displayedWindowID = state?.snapshot.window.id;
    const windowDecision = windowRefreshDecision(
      displayedWindowID,
      manualWindowID,
      preferredWindowID,
      windowOptions,
    );
    if (windowDecision === "retain-closed") {
      displayedWindowUnavailable = true;
      render();
    }
    const preferred = windowOptions.find((option) => option.id === preferredWindowID);
    if (windowDecision === "capture-preferred" && preferred) {
      toast = `Detected ${windowKindLabel(preferred.kind)}; capturing…`;
      render();
      await refresh("current");
    }
  } catch {
    // The authenticated Inspector session may be closing. Manual Refresh remains available.
  }
}

async function switchCaptureScope(scope: CaptureScope): Promise<void> {
  if (loading || scope === captureScope) return;
  captureScope = scope;
  state = undefined;
  selectedNode = undefined;
  selectedPath = undefined;
  toast = scope === "windowFrame" ? "Loading Window Frame…" : "Loading Content…";
  render();
  await refresh();
}

async function switchCaptureActivation(activation: CaptureActivation): Promise<void> {
  if (loading || activation === captureActivation) return;
  captureActivation = activation;
  state = undefined;
  selectedNode = undefined;
  selectedPath = undefined;
  toast = activation === "active"
    ? "Temporarily activating the inspected app for a true-appearance capture…"
    : "Loading the inspected window’s current state…";
  render();
  await refresh();
}

async function switchCaptureWindow(windowID: string | undefined): Promise<void> {
  if (loading || windowID === manualWindowID) return;
  manualWindowID = windowID;
  state = undefined;
  selectedNode = undefined;
  selectedPath = undefined;
  displayedWindowUnavailable = false;
  toast = windowID ? "Loading selected window…" : "Following the frontmost app window…";
  render();
  await refresh();
}

async function inspect(x: number, y: number): Promise<void> {
  if (!localClient && !fullscreenActive) return;
  toast = "Inspecting point…";
  render();
  try {
    const nextState = await inspectRequest(x, y);
    if (!isState(nextState)) throw new Error("Inspector returned an invalid selection");
    state = nextState;
    syncWindowOptionsFromSnapshot(nextState.snapshot);
    displayedWindowUnavailable = false;
    captureScope = snapshotCaptureScope(nextState.snapshot);
    captureActivation = snapshotCaptureActivation(nextState.snapshot);
    selectedNode = nextState.selected?.node;
    selectedPath = nextState.selected?.ancestorPath;
    toast = selectedNode ? `Selected ${selectedNode.className}` : "No view at that point";
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
  window.setInterval(() => void refreshAfterTargetChange(), TARGET_POLL_INTERVAL_MS);
  window.addEventListener("focus", () => void refreshAfterTargetChange());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshAfterTargetChange();
  });
} else if (bridge) {
  bridge
    .connect()
    .then(() => {
      bridgeConnected = true;
      toast = "Use the supported Codex Browser command. Full Screen remains experimental.";
      render();
    })
    .catch((error) => {
      toast = errorMessage(error);
      render();
    });
}
