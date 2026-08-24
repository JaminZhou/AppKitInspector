import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script } from "node:vm";

const root = resolve(import.meta.dirname, "..");
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(root, "plugins/appkit-inspector/dist/server.js")],
  env: childEnvironment,
});
const client = new Client({ name: "appkit-inspector-smoke", version: "0.1.1" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const required of [
    "list_appkit_targets",
    "connect_appkit_target",
    "open_appkit_inspector",
    "prepare_appkit_inspector_browser",
    "appkit_snapshot",
    "appkit_inspect_point",
  ]) {
    if (!names.has(required)) throw new Error(`Missing MCP tool: ${required}`);
  }
  for (const disabled of [
    "open_appkit_inspector_window",
    "wait_for_appkit_review",
    "save_appkit_review",
    "save_appkit_review_batch",
    "open_appkit_inspector_fullscreen",
    "begin_appkit_inspector_fullscreen",
    "confirm_appkit_inspector_fullscreen",
  ]) {
    if (names.has(disabled)) throw new Error(`Experimental fullscreen tool is enabled by default: ${disabled}`);
  }
  const listed = await client.callTool({ name: "list_appkit_targets", arguments: {} });
  if (!Array.isArray(listed.structuredContent?.targets)) throw new Error("Target listing is invalid");
  const opened = await client.callTool({ name: "open_appkit_inspector", arguments: {} });
  if (opened.isError) throw new Error("Mock Browser session failed to prepare");
  const openedBytes = Buffer.byteLength(JSON.stringify(opened));
  if (openedBytes > 4_096) {
    throw new Error(`Browser launch result is unexpectedly large (${openedBytes} bytes)`);
  }
  if (opened.structuredContent?.snapshot) {
    throw new Error("Browser launch must defer the full snapshot until the page loads");
  }
  const browserURL = new URL(opened.structuredContent?.browserURL);
  if (browserURL.hostname !== "127.0.0.1" || browserURL.pathname !== "/launch") {
    throw new Error("Browser launch is not a loopback single-use exchange URL");
  }
  if (!browserURL.searchParams.get("code") || browserURL.hash) {
    throw new Error("Browser launch URL has an invalid credential shape");
  }
  const browserAlias = await client.callTool({
    name: "prepare_appkit_inspector_browser",
    arguments: {},
  });
  if (browserAlias.isError || !browserAlias.structuredContent?.browserURL) {
    throw new Error("Browser compatibility alias did not prepare a launch URL");
  }
  const resources = await client.listResources();
  const preview = resources.resources.find((resource) => resource.uri.startsWith("ui://appkit-inspector/"));
  if (!preview) {
    throw new Error("Missing MCP App resource");
  }
  const [appBundle, previewTemplate] = await Promise.all([
    readFile(resolve(root, "plugins/appkit-inspector/dist/app.js")),
    readFile(resolve(root, "plugins/appkit-inspector/dist/preview.html")),
  ]);
  const pluginManifest = JSON.parse(
    await readFile(resolve(root, "plugins/appkit-inspector/.codex-plugin/plugin.json"), "utf8"),
  );
  const resourceRevision = createHash("sha256")
    .update(previewTemplate)
    .update("\0")
    .update(appBundle)
    .digest("hex")
    .slice(0, 16);
  const expectedResourceURI = `ui://appkit-inspector/${encodeURIComponent(pluginManifest.version)}/${resourceRevision}/preview.html`;
  if (preview.uri !== expectedResourceURI) {
    throw new Error(`MCP App resource URI is not content-versioned: ${preview.uri}`);
  }
  const defaultTool = tools.tools.find((candidate) => candidate.name === "open_appkit_inspector");
  if (defaultTool?._meta?.ui?.resourceUri || defaultTool?._meta?.["openai/outputTemplate"]) {
    throw new Error("Default Browser launch must not mount the experimental MCP App resource");
  }
  for (const toolName of ["appkit_snapshot", "appkit_inspect_point"]) {
    const tool = tools.tools.find((candidate) => candidate.name === toolName);
    if (tool?._meta?.ui?.resourceUri !== expectedResourceURI) {
      throw new Error(`${toolName} does not reference the content-versioned MCP App resource`);
    }
    if (tool?._meta?.["openai/outputTemplate"] !== expectedResourceURI) {
      throw new Error(`${toolName} does not expose the compatible output template URI`);
    }
  }
  const rendered = await client.readResource({ uri: preview.uri });
  const resource = rendered.contents[0];
  const html = resource?.text ?? "";
  if (!html.includes("native-comment-target") || !html.includes("data-appkit-hierarchy")) {
    throw new Error("MCP App resource is missing semantic Codex Browser comment targets");
  }
  for (const removed of ["No annotations", "Send to Codex", "save_appkit_review_batch", "open_appkit_inspector_window"]) {
    if (html.includes(removed)) {
      throw new Error(`MCP App resource still exposes retired fallback UI or tools: ${removed}`);
    }
  }
  const htmlBytes = Buffer.byteLength(html);
  if (htmlBytes > 512 * 1_024) {
    throw new Error(`MCP App resource is too large to mount reliably (${htmlBytes} bytes)`);
  }
  if (!html.includes("AppKit Inspector")) {
    throw new Error("MCP App resource is missing its bundled app");
  }
  if (!html.includes('data-startup-surface="true"')) {
    throw new Error("MCP App resource is missing its static startup diagnostic surface");
  }
  if (html.includes("__APPKIT_INSPECTOR_INITIAL_STATE__")) {
    throw new Error("MCP App resource must not embed process-local snapshot state");
  }
  if (html.includes('<script type="module" src="./app.js"></script>')) {
    throw new Error("MCP App resource still references an unavailable external script");
  }
  if (!html.includes("mode-window")) {
    throw new Error("MCP App resource is missing its authenticated Browser workspace");
  }
  for (const marker of [
    "mode-fullscreen",
    "begin_appkit_inspector_fullscreen",
    "confirm_appkit_inspector_fullscreen",
  ]) {
    if (!html.includes(marker)) {
      throw new Error(`MCP App resource is missing ${marker}`);
    }
  }
  if (resource?._meta?.["openai/widgetMinFrameHeight"] !== 140) {
    throw new Error("MCP App inline preview does not use the compact frame height");
  }
  const moduleMatch = /<script type="module">([\s\S]*)<\/script>\s*<\/body>/.exec(html);
  if (!moduleMatch?.[1]) throw new Error("MCP App resource is missing its bundled module");
  new Script(moduleMatch[1], { filename: "appkit-inspector-preview.js" });
} finally {
  await client.close();
}
