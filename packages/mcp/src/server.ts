#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { flattenViews, type InspectResult, type Snapshot, type Target } from "./contracts.js";
import { inspectMockPoint, mockSnapshot } from "./mock.js";
import {
  discoverTargets,
  publicTarget,
  requestInspectPoint,
  requestSnapshot,
} from "./targets.js";

const VERSION = "0.1.0";
const RESOURCE_URI = `ui://appkit-inspector/${VERSION}/preview.html`;
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

type PreviewState = {
  connected: boolean;
  isMock: boolean;
  snapshot: Snapshot;
  selected?: InspectResult;
};

function toolResult(text: string, structuredContent: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function outputMetadata(visibility: "model" | "app", resource = false) {
  return {
    ui: {
      ...(resource ? { resourceUri: RESOURCE_URI } : {}),
      visibility: [visibility] as const,
    },
    ...(resource ? { "ui/resourceUri": RESOURCE_URI, "openai/outputTemplate": RESOURCE_URI } : {}),
    "openai/widgetAccessible": true,
  };
}

function inlinePreview(template: string, script: string, initialState: PreviewState): string {
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  const bootstrap = `<script>window.__APPKIT_INSPECTOR_INITIAL_STATE__=${JSON.stringify(initialState)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")};</script>`;
  return template.replace(
    '<script type="module" src="./app.js"></script>',
    `${bootstrap}<script type="module">${safeScript}</script>`,
  );
}

class InspectorSession {
  selectedTarget?: Target;

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

  async preview(): Promise<PreviewState> {
    if (!this.selectedTarget) {
      return { connected: false, isMock: true, snapshot: mockSnapshot() };
    }
    return {
      connected: true,
      isMock: false,
      snapshot: await requestSnapshot(this.selectedTarget),
    };
  }

  async inspect(x: number, y: number): Promise<PreviewState> {
    const selected = this.selectedTarget
      ? await requestInspectPoint(this.selectedTarget, x, y)
      : inspectMockPoint(x, y);
    return {
      connected: Boolean(this.selectedTarget),
      isMock: !this.selectedTarget,
      snapshot: selected.snapshot,
      selected,
    };
  }
}

export function createServer(session = new InspectorSession()): McpServer {
  const server = new McpServer({ name: "AppKit Inspector", version: VERSION });

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
      title: "Open AppKit Inspector",
      description:
        "Open the interactive AppKit preview. Connect a live target first, or omit it to explore the mock interface.",
      inputSchema: {},
      _meta: outputMetadata("model", true),
    },
    async () => {
      const state = await session.preview();
      return toolResult(
        state.isMock
          ? "Opened AppKit Inspector with the built-in mock target."
          : `Opened AppKit Inspector for ${state.snapshot.target.name}.`,
        state,
      );
    },
  );

  server.registerTool(
    "appkit_snapshot",
    {
      title: "Refresh AppKit snapshot",
      description: "Refresh the current screenshot and native view hierarchy.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      _meta: outputMetadata("app", true),
    },
    async () => {
      const state = await session.preview();
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
      },
      annotations: { readOnlyHint: true },
      _meta: outputMetadata("app", true),
    },
    async ({ x, y }) => {
      const state = await session.inspect(x, y);
      const node = state.selected?.node;
      return toolResult(
        node ? `Selected ${node.className}${node.label ? ` (${node.label})` : ""}.` : "No view selected.",
        state,
      );
    },
  );

  server.registerTool(
    "save_appkit_review",
    {
      title: "Save AppKit review",
      description: "Save the current local preview image for a message sent from the embedded app.",
      inputSchema: {
        selectedViewID: z.string().optional(),
        note: z.string().max(8_000),
      },
      _meta: outputMetadata("app"),
    },
    async ({ selectedViewID, note }) => {
      const { snapshot } = await session.preview();
      const imageDataURL = snapshot.imageDataURL;
      const match = /^data:image\/(png|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(imageDataURL);
      if (!match?.[1] || !match[2]) throw new Error("Unsupported review image data URL");
      const directory = await mkdtemp(join(tmpdir(), "appkit-inspector-review-"));
      await chmod(directory, 0o700);
      const extension = match[1] === "png" ? "png" : "svg";
      const imagePath = join(directory, `review-${randomUUID()}.${extension}`);
      const contextPath = join(directory, "context.json");
      await writeFile(imagePath, Buffer.from(match[2], "base64"), { mode: 0o600 });
      await writeFile(
        contextPath,
        JSON.stringify({ selectedViewID, note, createdAt: new Date().toISOString() }, null, 2),
        { mode: 0o600 },
      );
      return toolResult("Saved local AppKit review artifacts.", { imagePath, contextPath });
    },
  );

  server.registerResource(
    "AppKit Inspector preview",
    RESOURCE_URI,
    {
      description: "Interactive local AppKit screenshot, hierarchy, selection, and review surface.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => {
      const directory = fileURLToPath(new URL(".", import.meta.url));
      const [template, script] = await Promise.all([
        readFile(join(directory, "preview.html"), "utf8"),
        readFile(join(directory, "app.js"), "utf8"),
      ]);
      const initialState = await session.preview();
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: RESOURCE_MIME_TYPE,
            text: inlinePreview(template, script, initialState),
            _meta: {
              ui: { csp: { connectDomains: [], resourceDomains: [] } },
              "openai/widgetPrefersBorder": false,
              "openai/widgetMinFrameHeight": 640,
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
