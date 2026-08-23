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
  const target = targets[0];
  if (!target || typeof target.pid !== "number") throw new Error("Invalid live target record");
  if (targets.length > 1) {
    await client.callTool({ name: "connect_appkit_target", arguments: { pid: target.pid } });
  }
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
  const refreshed = await client.callTool({ name: "appkit_snapshot", arguments: {} });
  const state = refreshed.structuredContent;
  if (state?.connected !== true || state?.isMock !== false) {
    throw new Error("MCP App did not fetch the live target after mount");
  }
  if (!String(state.snapshot?.imageDataURL ?? "").startsWith("data:image/png;base64,")) {
    throw new Error("Live target did not return an AppKit PNG snapshot");
  }
  const inspected = await client.callTool({
    name: "appkit_inspect_point",
    arguments: { x: 0.5, y: 0.5 },
  });
  if (!inspected.structuredContent?.selected?.node?.className) {
    throw new Error("Live point inspection did not return an NSView");
  }
  process.stdout.write(
    `Connected to ${target.name} (${target.pid}); selected ${inspected.structuredContent.selected.node.className}.\n`,
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
