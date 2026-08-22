import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(root, "plugins/appkit-inspector/dist/server.js")],
});
const client = new Client({ name: "appkit-inspector-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const required of [
    "list_appkit_targets",
    "connect_appkit_target",
    "open_appkit_inspector",
    "appkit_snapshot",
    "appkit_inspect_point",
    "save_appkit_review",
  ]) {
    if (!names.has(required)) throw new Error(`Missing MCP tool: ${required}`);
  }
  const listed = await client.callTool({ name: "list_appkit_targets", arguments: {} });
  if (!Array.isArray(listed.structuredContent?.targets)) throw new Error("Target listing is invalid");
  const opened = await client.callTool({ name: "open_appkit_inspector", arguments: {} });
  if (opened.isError) throw new Error("Mock preview failed to open");
  const resources = await client.listResources();
  const preview = resources.resources.find((resource) => resource.uri.startsWith("ui://appkit-inspector/"));
  if (!preview) {
    throw new Error("Missing MCP App resource");
  }
  const rendered = await client.readResource({ uri: preview.uri });
  const html = rendered.contents[0]?.text ?? "";
  if (!html.includes("__APPKIT_INSPECTOR_INITIAL_STATE__") || !html.includes("AppKit Inspector")) {
    throw new Error("MCP App resource is missing its initial snapshot or bundled app");
  }
} finally {
  await client.close();
}
