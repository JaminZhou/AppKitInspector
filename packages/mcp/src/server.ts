#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  captureModeSchema,
  captureActivationSchema,
  captureScopeSchema,
  flattenViews,
  type CaptureMode,
  type CaptureActivation,
  type CaptureScope,
  type InspectResult,
  type Snapshot,
  type Target,
} from "./contracts.js";
import { inspectMockPoint, mockSnapshot } from "./mock.js";
import {
  discoverTargets,
  publicTarget,
  requestInspectPoint,
  requestSnapshot,
} from "./targets.js";
import {
  InspectorWindowServer,
  type BrowserLaunch,
} from "./window-server.js";

const VERSION = "0.1.1";
declare const __APPKIT_INSPECTOR_RESOURCE_REVISION__: string;
const RESOURCE_REVISION =
  typeof __APPKIT_INSPECTOR_RESOURCE_REVISION__ === "string"
    ? __APPKIT_INSPECTOR_RESOURCE_REVISION__
    : "development";

function installedPluginVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (typeof manifest.version === "string" && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    // Source-only imports do not necessarily live inside a packaged plugin.
  }
  return VERSION;
}

const RESOURCE_URI = `ui://appkit-inspector/${encodeURIComponent(installedPluginVersion())}/${RESOURCE_REVISION}/preview.html`;
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

type PreviewState = {
  connected: boolean;
  isMock: boolean;
  snapshot: Snapshot;
  selected?: InspectResult;
};

type LaunchState = {
  connected: boolean;
  target?: ReturnType<typeof publicTarget>;
};

export function preferredTarget(
  targets: Target[],
  current: Target | undefined,
): Target | undefined {
  if (!current) return targets.length === 1 ? targets[0] : undefined;
  const exact = targets.find((target) => target.pid === current.pid);
  if (exact) return exact;
  const sameApplication = targets.filter(
    (target) => target.bundleIdentifier === current.bundleIdentifier,
  );
  return sameApplication.length === 1 ? sameApplication[0] : undefined;
}

function toolResult(text: string, structuredContent: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function outputMetadata(visibility: "model" | "app" | readonly ("model" | "app")[], resource = false) {
  return {
    ui: {
      ...(resource ? { resourceUri: RESOURCE_URI } : {}),
      visibility: Array.isArray(visibility) ? visibility : [visibility],
    },
    ...(resource ? { "ui/resourceUri": RESOURCE_URI, "openai/outputTemplate": RESOURCE_URI } : {}),
    "openai/widgetAccessible": true,
  };
}

function inlinePreview(template: string, script: string): string {
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  const bundledApp = `<script type="module">${safeScript}</script>`;
  return template.replace('<script type="module" src="./app.js"></script>', () => bundledApp);
}

export class InspectorSession {
  selectedTarget?: Target;

  async launchState(): Promise<LaunchState> {
    const targets = await this.targets();
    const selected = preferredTarget(targets, this.selectedTarget);

    if (!selected) {
      return { connected: false };
    }

    this.selectedTarget = selected;
    return { connected: true, target: publicTarget(selected) };
  }

  async targetState(): Promise<LaunchState> {
    return await this.launchState();
  }

  private async liveSnapshot(
    scope: CaptureScope = "windowFrame",
    mode: CaptureMode = "exact",
    activation: CaptureActivation = "current",
  ): Promise<{ target: Target; snapshot: Snapshot } | undefined> {
    if (this.selectedTarget) {
      try {
        return {
          target: this.selectedTarget,
          snapshot: await requestSnapshot(this.selectedTarget, scope, mode, activation),
        };
      } catch {}
    }

    const targets = await this.targets();
    const target = preferredTarget(targets, this.selectedTarget);
    if (!target) return undefined;
    try {
      const snapshot = await requestSnapshot(target, scope, mode, activation);
      this.selectedTarget = target;
      return { target, snapshot };
    } catch {
      return undefined;
    }
  }

  async targets() {
    return await discoverTargets();
  }

  async connect(pid?: number): Promise<Target> {
    const targets = await this.targets();
    const target = pid === undefined ? targets[0] : targets.find((item) => item.pid === pid);
    if (!target) {
      throw new Error(
        pid === undefined
          ? "No AppKit probe is running. Launch a Debug app with AppKitInspectorProbe enabled."
          : `No AppKit probe is running for pid ${pid}.`,
      );
    }
    await requestSnapshot(target);
    this.selectedTarget = target;
    return target;
  }

  async preview(
    scope: CaptureScope = "windowFrame",
    mode: CaptureMode = "exact",
    activation: CaptureActivation = "current",
  ): Promise<PreviewState> {
    const live = await this.liveSnapshot(scope, mode, activation);
    if (!live) {
      const snapshot = mockSnapshot(scope, mode, activation);
      return { connected: false, isMock: true, snapshot };
    }
    return {
      connected: true,
      isMock: false,
      snapshot: live.snapshot,
    };
  }

  async inspect(
    x: number,
    y: number,
    scope: CaptureScope = "windowFrame",
    mode: CaptureMode = "exact",
    activation: CaptureActivation = "current",
  ): Promise<PreviewState> {
    if (!this.selectedTarget) await this.liveSnapshot(scope, mode, activation);
    const selected = this.selectedTarget
      ? await requestInspectPoint(this.selectedTarget, x, y, scope, mode, activation)
      : inspectMockPoint(x, y, scope, mode, activation);
    return {
      connected: Boolean(this.selectedTarget),
      isMock: !this.selectedTarget,
      snapshot: selected.snapshot,
      selected,
    };
  }

}

type InspectorBrowserHost = {
  createBrowserLaunch?(): Promise<BrowserLaunch>;
  close?(): Promise<void>;
};

type CreateServerOptions = {
  enableExperimentalFullscreen?: boolean;
};

export function createServer(
  session = new InspectorSession(),
  inspectorBrowser: InspectorBrowserHost = new InspectorWindowServer(session),
  options: CreateServerOptions = {},
): McpServer {
  const server = new McpServer({ name: "AppKit Inspector", version: VERSION });
  const experimentalFullscreenEnabled =
    options.enableExperimentalFullscreen ??
    process.env.APPKIT_INSPECTOR_EXPERIMENTAL_FULLSCREEN === "1";
  const fullscreenLaunches = new Set<string>();
  const closeServer = server.close.bind(server);
  server.server.setRequestHandler(
    "ui/resource-teardown",
    { params: z.object({}), result: z.record(z.string(), z.unknown()) },
    async () => {
      // Codex sends this request before replacing or moving an MCP App resource.
      // The experimental fullscreen path has no automatic external-window fallback.
      return {};
    },
  );
  server.close = async () => {
    fullscreenLaunches.clear();
    await inspectorBrowser.close?.();
    await closeServer();
  };

  const prepareBrowserLaunch = async () => {
    if (!inspectorBrowser.createBrowserLaunch) {
      return toolResult("This Inspector build cannot create a Browser session.", {}, true);
    }
    const [state, launch] = await Promise.all([
      session.launchState(),
      inspectorBrowser.createBrowserLaunch(),
    ]);
    return toolResult(
      "Prepared AppKit Inspector for Codex Browser. Open browserURL immediately, then set Codex Browser visibility to true; the URL expires in 60 seconds.",
      { ...state, browserURL: launch.url, expiresAt: launch.expiresAt },
    );
  };

  server.registerTool(
    "list_appkit_targets",
    {
      title: "List AppKit targets",
      description: "List live Debug applications exposing AppKitInspectorProbe on this Mac.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      _meta: outputMetadata("model"),
    },
    async () => {
      const targets = (await session.targets()).map(publicTarget);
      return toolResult(
        targets.length ? `Found ${targets.length} AppKit target(s).` : "No live AppKit targets found.",
        { targets },
      );
    },
  );

  server.registerTool(
    "connect_appkit_target",
    {
      title: "Connect AppKit target",
      description: "Connect to a live Debug AppKit application by process id.",
      inputSchema: { pid: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true },
      _meta: outputMetadata("model"),
    },
    async ({ pid }) => {
      const target = await session.connect(pid);
      return toolResult(`Connected to ${target.name} (${target.pid}).`, {
        target: publicTarget(target),
      });
    },
  );

  server.registerTool(
    "open_appkit_inspector",
    {
      title: "Open AppKit Inspector in Codex Browser",
      description:
        "Prepare a short-lived, single-use AppKit Inspector URL for the current Codex Browser panel. The caller must open the URL and set Browser visibility to true. This is the default presentation path and never opens fullscreen or an external browser automatically.",
      inputSchema: {},
      _meta: outputMetadata("model"),
    },
    prepareBrowserLaunch,
  );

  server.registerTool(
    "prepare_appkit_inspector_browser",
    {
      title: "Prepare AppKit Inspector Browser",
      description:
        "Backward-compatible alias that prepares the same short-lived Codex Browser URL as open_appkit_inspector.",
      inputSchema: {},
      _meta: outputMetadata(["model", "app"]),
    },
    prepareBrowserLaunch,
  );

  if (experimentalFullscreenEnabled) {
    server.registerTool(
      "open_appkit_inspector_fullscreen",
      {
        title: "Open experimental AppKit Inspector fullscreen launcher",
        description:
          "Open the experimental MCP App launcher for an explicitly requested fullscreen test. It never opens an external browser or window automatically.",
        inputSchema: {},
        _meta: outputMetadata("model", true),
      },
      async () => {
        const state = await session.launchState();
        return toolResult(
          !state.connected
            ? "Opened the experimental fullscreen launcher with the built-in mock target."
            : `Opened the experimental fullscreen launcher for ${state.target?.name ?? "the connected target"}.`,
          state,
        );
      },
    );

    server.registerTool(
      "begin_appkit_inspector_fullscreen",
      {
        title: "Begin experimental AppKit Inspector fullscreen",
        description:
          "Start an explicitly requested fullscreen transition. Failure remains in the launcher and never opens an external window automatically.",
        inputSchema: {},
        _meta: outputMetadata("app"),
      },
      async () => {
        const state = await session.launchState();
        fullscreenLaunches.clear();
        const launchID = randomUUID();
        fullscreenLaunches.add(launchID);
        return toolResult("Started experimental AppKit Inspector fullscreen launch.", {
          ...state,
          launchID,
        });
      },
    );

    server.registerTool(
      "confirm_appkit_inspector_fullscreen",
      {
        title: "Confirm experimental AppKit Inspector fullscreen",
        description: "Confirm that the explicitly requested fullscreen Inspector rendered successfully.",
        inputSchema: { launchID: z.string().uuid() },
        _meta: outputMetadata("app"),
      },
      async ({ launchID }) => {
        const confirmed = fullscreenLaunches.delete(launchID);
        return toolResult(
          confirmed
            ? "Confirmed experimental AppKit Inspector fullscreen."
            : "Fullscreen confirmation did not match an active launch.",
          { confirmed },
        );
      },
    );
  }

  server.registerTool(
    "appkit_snapshot",
    {
      title: "Refresh AppKit snapshot",
      description: "Refresh the current window-frame or content screenshot and native view hierarchy.",
      inputSchema: {
        scope: captureScopeSchema.optional(),
        mode: captureModeSchema.optional(),
        activation: captureActivationSchema.optional(),
      },
      annotations: { readOnlyHint: true },
      _meta: outputMetadata("app", true),
    },
    async ({ scope, mode, activation }) => {
      const state = await session.preview(scope, mode, activation);
      return toolResult("Refreshed AppKit snapshot.", state);
    },
  );

  server.registerTool(
    "appkit_inspect_point",
    {
      title: "Inspect AppKit point",
      description: "Return the deepest native NSView at a normalized top-left image coordinate.",
      inputSchema: {
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        scope: captureScopeSchema.optional(),
        mode: captureModeSchema.optional(),
        activation: captureActivationSchema.optional(),
      },
      annotations: { readOnlyHint: true },
      _meta: outputMetadata("app", true),
    },
    async ({ x, y, scope, mode, activation }) => {
      const state = await session.inspect(x, y, scope, mode, activation);
      const node = state.selected?.node;
      return toolResult(
        node ? `Selected ${node.className}${node.label ? ` (${node.label})` : ""}.` : "No view selected.",
        state,
      );
    },
  );

  server.registerResource(
    "AppKit Inspector preview",
    RESOURCE_URI,
    {
      description: "Interactive local AppKit screenshot, hierarchy, selection, and Codex comment-target surface.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => {
      const directory = fileURLToPath(new URL(".", import.meta.url));
      const [template, script] = await Promise.all([
        readFile(join(directory, "preview.html"), "utf8"),
        readFile(join(directory, "app.js"), "utf8"),
      ]);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: RESOURCE_MIME_TYPE,
            text: inlinePreview(template, script),
            _meta: {
              ui: { csp: { connectDomains: [], resourceDomains: [] } },
              "openai/widgetPrefersBorder": false,
              "openai/widgetMinFrameHeight": 140,
            },
          },
        ],
      };
    },
  );

  return server;
}

export async function runServer(): Promise<void> {
  serveStdio(() => createServer(), {
    onerror: (error) => console.error(error),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runServer();
}

export { flattenViews };
