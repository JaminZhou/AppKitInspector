import assert from "node:assert/strict";
import test from "node:test";
import { inspectMockPoint, mockSnapshot } from "../src/mock.js";
import type { CaptureScope } from "../src/contracts.js";
import { InspectorWindowServer } from "../src/window-server.js";

test("standalone inspector supports fragment Bearer and single-use Browser sessions", async () => {
  const opened: string[] = [];
  const reviews: Array<{ selectedViewID: string | undefined; note: string }> = [];
  const scopes: CaptureScope[] = [];
  const server = new InspectorWindowServer(
    {
      async preview(scope = "windowFrame") {
        scopes.push(scope);
        return { connected: false, isMock: true, snapshot: mockSnapshot(scope) };
      },
      async inspect(x, y, scope = "windowFrame") {
        scopes.push(scope);
        const selected = inspectMockPoint(x, y, scope);
        return { connected: false, isMock: true, snapshot: selected.snapshot, selected };
      },
      async saveReview(selectedViewID, note, scope = "windowFrame") {
        scopes.push(scope);
        reviews.push({ selectedViewID, note });
        return { imagePath: "/private/review.png", contextPath: "/private/context.json" };
      },
    },
    {
      async loadAssets() {
        return {
          template: '<!doctype html><script type="module" src="./app.js"></script>',
          script: "export {};",
        };
      },
      async openURL(url) {
        opened.push(url);
      },
    },
  );

  try {
    const windowURL = new URL(await server.start());
    assert.equal(windowURL.hostname, "127.0.0.1");
    assert.equal(windowURL.search, "");
    const token = new URLSearchParams(windowURL.hash.slice(1)).get("token");
    assert.match(token ?? "", /^[A-Za-z0-9_-]{32,}$/);

    const shell = await fetch(windowURL.origin);
    assert.equal(shell.status, 200);
    assert.equal(shell.headers.get("cache-control"), "no-store");
    assert.match(shell.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

    const unauthorized = await fetch(`${windowURL.origin}/api/snapshot`);
    assert.equal(unauthorized.status, 401);

    const browserLaunch = new URL((await server.createBrowserLaunch()).url);
    assert.equal(browserLaunch.origin, windowURL.origin);
    assert.equal(browserLaunch.pathname, "/launch");
    assert.match(browserLaunch.searchParams.get("code") ?? "", /^[A-Za-z0-9_-]{32,}$/);
    assert.equal(browserLaunch.hash, "");
    const exchange = await fetch(browserLaunch, { redirect: "manual" });
    assert.equal(exchange.status, 303);
    assert.equal(exchange.headers.get("location"), "/");
    const cookie = exchange.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^appkit_inspector_session=[A-Za-z0-9_-]{32,};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const reused = await fetch(browserLaunch, { redirect: "manual" });
    assert.equal(reused.status, 401);
    const browserSnapshot = await fetch(`${windowURL.origin}/api/snapshot?scope=content`, {
      headers: { Cookie: cookie.split(";", 1)[0] ?? "" },
    });
    assert.equal(browserSnapshot.status, 200);
    const browserState = await browserSnapshot.json();
    assert.equal(browserState.isMock, true);
    assert.equal(browserState.snapshot.window.captureScope, "content");

    const authorization = { Authorization: `Bearer ${token}` };
    const snapshot = await fetch(`${windowURL.origin}/api/snapshot`, { headers: authorization });
    assert.equal(snapshot.status, 200);
    assert.equal((await snapshot.json()).isMock, true);

    const wrongOrigin = await fetch(`${windowURL.origin}/api/inspect`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json", Origin: "http://example.com" },
      body: JSON.stringify({ x: 0.5, y: 0.5, scope: "windowFrame" }),
    });
    assert.equal(wrongOrigin.status, 403);

    const inspected = await fetch(`${windowURL.origin}/api/inspect`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json", Origin: windowURL.origin },
      body: JSON.stringify({ x: 0.5, y: 0.5 }),
    });
    assert.equal(inspected.status, 200);
    assert.equal(typeof (await inspected.json()).selected?.node?.className, "string");

    const review = await fetch(`${windowURL.origin}/api/review`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json", Origin: windowURL.origin },
      body: JSON.stringify({ selectedViewID: "view-1", note: "Tighten spacing", scope: "content" }),
    });
    assert.equal(review.status, 200);
    assert.deepEqual(reviews, [{ selectedViewID: "view-1", note: "Tighten spacing" }]);
    assert.ok(scopes.includes("windowFrame"));
    assert.ok(scopes.includes("content"));

    await server.open();
    assert.equal(opened.length, 1);
    assert.equal(opened[0], windowURL.toString());
  } finally {
    await server.close();
  }
});
