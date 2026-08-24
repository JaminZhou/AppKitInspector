import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Target } from "../src/contracts.js";
import { createServer, InspectorSession, preferredTarget } from "../src/server.js";

function target(pid: number, bundleIdentifier: string): Target {
  return {
    pid,
    name: bundleIdentifier,
    bundleIdentifier,
    port: 43_123,
    token: "abcdefghijklmnopqrstuvwxyz0123456789",
    startedAt: "2026-08-23T00:00:00Z",
  };
}

test("target selection follows a relaunched instance of the same application", () => {
  const previous = target(100, "com.example.inspected");
  const replacement = target(101, "com.example.inspected");
  const unrelated = target(102, "com.example.other");

  assert.equal(preferredTarget([replacement, unrelated], previous), replacement);
  assert.equal(preferredTarget([unrelated], previous), undefined);
  assert.equal(preferredTarget([unrelated], undefined), unrelated);
  assert.equal(preferredTarget([replacement, target(103, replacement.bundleIdentifier)], previous), undefined);
});

function inspectorBrowser() {
  return {
    browser: {
      async createBrowserLaunch() {
        return {
          url: "http://127.0.0.1:43123/launch?code=abcdefghijklmnopqrstuvwxyz0123456789",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
  };
}

test("default Inspector launch is Browser-first and never opens an external window", async () => {
  const host = inspectorBrowser();
  const server = createServer(new InspectorSession(), host.browser);
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
    assert.equal(names.has("open_appkit_inspector_window"), false);
    assert.equal(names.has("wait_for_appkit_review"), false);
    assert.equal(names.has("save_appkit_review"), false);
    assert.equal(names.has("save_appkit_review_batch"), false);

    const opened = await client.callTool({ name: "open_appkit_inspector", arguments: {} });
    assert.equal(opened.isError, undefined);
    const openedContent = opened.content as Array<{ type: string; text?: string }> | undefined;
    assert.match(
      (openedContent ?? [])
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text ?? "")
        .join("\n"),
      /set Codex Browser visibility to true/,
    );
    assert.equal(
      (opened.structuredContent as { browserURL?: unknown } | undefined)?.browserURL,
      "http://127.0.0.1:43123/launch?code=abcdefghijklmnopqrstuvwxyz0123456789",
    );
  } finally {
    await client.close();
  }
});

test("experimental fullscreen is opt-in and has no automatic external fallback", async () => {
  const host = inspectorBrowser();
  const server = createServer(new InspectorSession(), host.browser, {
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
  } finally {
    await client.close();
  }
});
