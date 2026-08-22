import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(root, "plugins/appkit-inspector/dist/server.js")],
});
const client = new Client({ name: "appkit-inspector-live-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const listed = await client.callTool({ name: "list_appkit_targets", arguments: {} });
  const targets = listed.structuredContent?.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("No live target. Run AppKitInspectorDemo before this smoke test.");
  }
  const target = targets[0];
  if (!target || typeof target.pid !== "number") throw new Error("Invalid live target record");
  await client.callTool({ name: "connect_appkit_target", arguments: { pid: target.pid } });
  const opened = await client.callTool({ name: "open_appkit_inspector", arguments: {} });
  const state = opened.structuredContent;
  if (state?.connected !== true || state?.isMock !== false) throw new Error("MCP did not open the live target");
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
} finally {
  await client.close();
}
