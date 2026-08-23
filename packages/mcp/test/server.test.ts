import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, InspectorSession } from "../src/server.js";

function inspectorWindow() {
  let opened = 0;
  return {
    window: {
      async open() {
        opened += 1;
      },
      async createBrowserLaunch() {
        return {
          url: "http://127.0.0.1:43123/launch?code=abcdefghijklmnopqrstuvwxyz0123456789",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
    opened: () => opened,
  };
}

test("default Inspector launch is Browser-first and never opens an external window", async () => {
  const external = inspectorWindow();
  const server = createServer(new InspectorSession(), external.window);
  const client = new Client({ name: "appkit-inspector-test", version: "0.1.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    assert.equal(names.has("open_appkit_inspector"), true);
    assert.equal(names.has("open_appkit_inspector_fullscreen"), false);
    assert.equal(names.has("begin_appkit_inspector_fullscreen"), false);
    assert.equal(names.has("confirm_appkit_inspector_fullscreen"), false);

    const opened = await client.callTool({ name: "open_appkit_inspector", arguments: {} });
    assert.equal(opened.isError, undefined);
    assert.equal(
      (opened.structuredContent as { browserURL?: unknown } | undefined)?.browserURL,
      "http://127.0.0.1:43123/launch?code=abcdefghijklmnopqrstuvwxyz0123456789",
    );
    assert.equal(external.opened(), 0);
  } finally {
    await client.close();
  }
});

test("experimental fullscreen is opt-in and has no automatic external fallback", async () => {
  const external = inspectorWindow();
  const server = createServer(new InspectorSession(), external.window, {
    enableExperimentalFullscreen: true,
  });
  const client = new Client({ name: "appkit-inspector-test", version: "0.1.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    assert.equal(names.has("open_appkit_inspector_fullscreen"), true);
    assert.equal(names.has("begin_appkit_inspector_fullscreen"), true);
    assert.equal(names.has("confirm_appkit_inspector_fullscreen"), true);

    const launcher = await client.callTool({
      name: "open_appkit_inspector_fullscreen",
      arguments: {},
    });
    assert.equal(
      typeof (launcher.structuredContent as { connected?: unknown } | undefined)?.connected,
      "boolean",
    );

    const begun = await client.callTool({
      name: "begin_appkit_inspector_fullscreen",
      arguments: {},
    });
    const launchID = (begun.structuredContent as { launchID?: unknown } | undefined)?.launchID;
    assert.equal(typeof launchID, "string");
    assert.equal(external.opened(), 0);

    const confirmed = await client.callTool({
      name: "confirm_appkit_inspector_fullscreen",
      arguments: { launchID },
    });
    assert.equal(
      (confirmed.structuredContent as { confirmed?: unknown } | undefined)?.confirmed,
      true,
    );
    const late = await client.callTool({
      name: "confirm_appkit_inspector_fullscreen",
      arguments: { launchID },
    });
    assert.equal(
      (late.structuredContent as { confirmed?: unknown } | undefined)?.confirmed,
      false,
    );
    assert.equal(external.opened(), 0);
  } finally {
    await client.close();
  }
});
