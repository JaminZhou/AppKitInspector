import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const serverPath =
  process.env.APPKIT_INSPECTOR_SERVER_PATH ??
  resolve(root, "plugins/appkit-inspector/dist/server.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
});
const client = new Client({ name: "appkit-inspector-live-smoke", version: "0.1.1" });

try {
  await client.connect(transport);
  const listed = await client.callTool({ name: "list_appkit_targets", arguments: {} });
  const targets = listed.structuredContent?.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("No live target. Run AppKitInspectorDemo before this smoke test.");
  }
  const target = targets.find((candidate) => candidate.bundleIdentifier === "local.AppKitInspectorDemo")
    ?? (targets.length === 1 ? targets[0] : undefined);
  if (!target || typeof target.pid !== "number") throw new Error("Invalid live target record");
  await client.callTool({ name: "connect_appkit_target", arguments: { pid: target.pid } });
  const opened = await client.callTool({ name: "open_appkit_inspector", arguments: {} });
  const launchState = opened.structuredContent;
  if (launchState?.connected !== true || launchState?.target?.pid !== target.pid) {
    throw new Error("MCP did not prepare the live target for Codex Browser");
  }
  const browserURL = new URL(launchState.browserURL);
  if (browserURL.hostname !== "127.0.0.1" || browserURL.pathname !== "/launch") {
    throw new Error("MCP did not return a loopback Codex Browser launch URL");
  }
  if (launchState.snapshot) throw new Error("Browser launch returned a full snapshot before page load");
  const refreshed = await client.callTool({
    name: "appkit_snapshot",
    arguments: { scope: "windowFrame" },
  });
  const state = refreshed.structuredContent;
  if (state?.connected !== true || state?.isMock !== false) {
    throw new Error("MCP App did not fetch the live target after mount");
  }
  if (!String(state.snapshot?.imageDataURL ?? "").startsWith("data:image/png;base64,")) {
    throw new Error("Live target did not return an AppKit PNG snapshot");
  }
  if (state.snapshot?.window?.captureScope !== "windowFrame") {
    throw new Error("Live target did not return the Window Frame capture scope");
  }
  if (state.snapshot?.schemaVersion !== 2) {
    throw new Error("Live target did not return the Window Frame schema version");
  }
  const views = [];
  const collect = (node) => {
    if (!node) return;
    views.push(node);
    for (const child of node.subviews ?? []) collect(child);
  };
  collect(state.snapshot.root);
  const closeButton = views.find((view) => view.label === "Close Window");
  if (!closeButton) throw new Error("Window Frame hierarchy is missing the Close Window control");
  const windowFrame = state.snapshot.window.frame;
  const closePoint = {
    x: (closeButton.frame.x + closeButton.frame.width / 2) / windowFrame.width,
    y: 1 - (closeButton.frame.y + closeButton.frame.height / 2) / windowFrame.height,
  };
  const inspected = await client.callTool({
    name: "appkit_inspect_point",
    arguments: { ...closePoint, scope: "windowFrame" },
  });
  if (inspected.structuredContent?.selected?.node?.label !== "Close Window") {
    throw new Error("Window Frame point inspection did not select the Close Window control");
  }
  const content = await client.callTool({
    name: "appkit_snapshot",
    arguments: { scope: "content" },
  });
  if (content.structuredContent?.snapshot?.window?.captureScope !== "content") {
    throw new Error("Live target did not switch to the Content capture scope");
  }
  process.stdout.write(
    `Connected to ${target.name} (${target.pid}); selected Close Window and verified Content mode.\n`,
  );
  if (process.env.APPKIT_INSPECTOR_PREPARE_BROWSER === "1") {
    const browser = await client.callTool({
      name: "prepare_appkit_inspector_browser",
      arguments: {},
    });
    const aliasURL = browser.structuredContent?.browserURL;
    if (typeof aliasURL !== "string") throw new Error("MCP did not prepare a Browser URL");
    process.stdout.write(`Browser URL: ${aliasURL}\n`);
  }
  if (process.env.APPKIT_INSPECTOR_HOLD_OPEN === "1") {
    process.stdout.write("Inspector window is being held open; press Return to finish.\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));
  }
} finally {
  await client.close();
}
