import assert from "node:assert/strict";
import test from "node:test";
import { LocalInspectorClient, standaloneConnection } from "../src/local-client.js";

test("standalone connection accepts only IPv4 loopback and makes the fragment token optional", () => {
  const connection = standaloneConnection({
    protocol: "http:",
    hostname: "127.0.0.1",
    origin: "http://127.0.0.1:43123",
    hash: "#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    pathname: "/",
    search: "",
  });
  assert.deepEqual(connection, {
    origin: "http://127.0.0.1:43123",
    token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    cleanURL: "/",
  });
  assert.deepEqual(
    standaloneConnection({
      protocol: "http:",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:43123",
      hash: "",
      pathname: "/",
      search: "",
    }),
    {
      origin: "http://127.0.0.1:43123",
      cleanURL: "/",
    },
  );
  assert.equal(
    standaloneConnection({
      protocol: "https:",
      hostname: "example.com",
      origin: "https://example.com",
      hash: "#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      pathname: "/",
      search: "",
    }),
    undefined,
  );
});

test("local client authenticates API requests without putting the token in the URL", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const request: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new LocalInspectorClient(
    "http://127.0.0.1:43123",
    "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    request,
  );
  await client.inspect(0.25, 0.75, "windowFrame", "exact", "current", "popover-1");
  assert.equal(requests[0]?.url, "http://127.0.0.1:43123/api/inspect");
  assert.equal(
    (requests[0]?.init?.headers as Record<string, string> | undefined)?.Authorization,
    "Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  );
  assert.equal(
    requests[0]?.init?.body,
    JSON.stringify({
      x: 0.25,
      y: 0.75,
      scope: "windowFrame",
      mode: "exact",
      activation: "current",
      windowID: "popover-1",
    }),
  );
  assert.equal(requests[0]?.init?.credentials, "omit");
});

test("local client uses same-origin cookies when no Bearer token is present", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const request: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new LocalInspectorClient("http://127.0.0.1:43123", undefined, request);
  await client.target();
  await client.windows();
  await client.snapshot("content", "hybrid");
  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1:43123/api/target",
  );
  assert.equal(
    requests[1]?.url,
    "http://127.0.0.1:43123/api/windows",
  );
  assert.equal(
    requests[2]?.url,
    "http://127.0.0.1:43123/api/snapshot?scope=content&mode=hybrid&activation=current",
  );
  assert.equal(requests[0]?.init?.credentials, "same-origin");
  assert.equal(
    (requests[0]?.init?.headers as Record<string, string> | undefined)?.Authorization,
    undefined,
  );
});
