import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import {
  captureScopeSchema,
  type CaptureScope,
  type InspectResult,
  type Snapshot,
} from "./contracts.js";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const BROWSER_LAUNCH_TTL_MS = 60_000;
const BROWSER_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const SESSION_COOKIE = "appkit_inspector_session";

export type InspectorWindowState = {
  connected: boolean;
  isMock: boolean;
  snapshot: Snapshot;
  selected?: InspectResult;
};

export type ReviewArtifacts = {
  imagePath: string;
  contextPath: string;
};

export type BrowserLaunch = {
  url: string;
  expiresAt: string;
};

export type InspectorWindowBackend = {
  preview(scope?: CaptureScope): Promise<InspectorWindowState>;
  inspect(x: number, y: number, scope?: CaptureScope): Promise<InspectorWindowState>;
  saveReview(
    selectedViewID: string | undefined,
    note: string,
    scope?: CaptureScope,
  ): Promise<ReviewArtifacts>;
};

type Assets = { template: string; script: string };
type Options = {
  loadAssets?: () => Promise<Assets>;
  openURL?: (url: string) => Promise<void>;
};

function defaultOpenURL(url: string): Promise<void> {
  if (process.env.APPKIT_INSPECTOR_NO_OPEN === "1") return Promise.resolve();
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/open", ["-n", url], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function defaultLoadAssets(): Promise<Assets> {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const [template, script] = await Promise.all([
    readFile(join(directory, "preview.html"), "utf8"),
    readFile(join(directory, "app.js"), "utf8"),
  ]);
  return { template, script };
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    send(response, 500, JSON.stringify({ error: "Inspector response exceeded 64 MiB" }), "application/json");
    return;
  }
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": `${contentType}; charset=utf-8`,
    "Content-Length": Buffer.byteLength(body),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

function sendJSON(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), "application/json");
}

function captureScope(value: unknown): CaptureScope {
  return captureScopeSchema.catch("windowFrame").parse(value);
}

async function readJSON(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_REQUEST_BYTES) throw new Error("Request body exceeded 64 KiB");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

export class InspectorWindowServer {
  private readonly token = randomBytes(32).toString("base64url");
  private readonly loadAssets: () => Promise<Assets>;
  private readonly openURL: (url: string) => Promise<void>;
  private server: Server | undefined;
  private origin: string | undefined;
  private startPromise: Promise<string> | undefined;
  private readonly browserLaunches = new Map<string, number>();
  private readonly browserSessions = new Map<string, number>();

  constructor(
    private readonly backend: InspectorWindowBackend,
    options: Options = {},
  ) {
    this.loadAssets = options.loadAssets ?? defaultLoadAssets;
    this.openURL = options.openURL ?? defaultOpenURL;
  }

  async start(): Promise<string> {
    if (this.origin) return `${this.origin}/#token=${this.token}`;
    if (this.startPromise) return await this.startPromise;
    this.startPromise = this.startListening();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async open(): Promise<void> {
    await this.openURL(await this.start());
  }

  async createBrowserLaunch(): Promise<BrowserLaunch> {
    await this.start();
    if (!this.origin) throw new Error("Inspector window did not start");
    this.pruneBrowserCredentials();
    const code = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + BROWSER_LAUNCH_TTL_MS;
    this.browserLaunches.set(code, expiresAt);
    const url = new URL("/launch", this.origin);
    url.searchParams.set("code", code);
    return { url: url.toString(), expiresAt: new Date(expiresAt).toISOString() };
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.origin = undefined;
    this.browserLaunches.clear();
    this.browserSessions.clear();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async startListening(): Promise<string> {
    const assets = await this.loadAssets();
    const server = createServer((request, response) => {
      void this.handle(request, response, assets).catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        sendJSON(response, 500, {
          error: error instanceof Error ? error.message : "Inspector request failed",
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Inspector window did not obtain a loopback port");
    }
    this.server = server;
    this.origin = `http://127.0.0.1:${address.port}`;
    return `${this.origin}/#token=${this.token}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse, assets: Assets): Promise<void> {
    const origin = this.origin;
    if (!origin) {
      sendJSON(response, 503, { error: "Inspector window is starting" });
      return;
    }
    const expectedHost = new URL(origin).host;
    if (request.headers.host !== expectedHost) {
      sendJSON(response, 421, { error: "Invalid inspector host" });
      return;
    }
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "GET" && url.pathname === "/launch") {
      const code = url.searchParams.get("code") ?? "";
      const expiresAt = this.browserLaunches.get(code);
      this.browserLaunches.delete(code);
      if (!expiresAt || expiresAt < Date.now()) {
        sendJSON(response, 401, { error: "Inspector launch link expired" });
        return;
      }
      const session = randomBytes(32).toString("base64url");
      this.browserSessions.set(session, Date.now() + BROWSER_SESSION_TTL_MS);
      send(response, 303, "", "text/plain", {
        Location: "/",
        "Set-Cookie": `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(BROWSER_SESSION_TTL_MS / 1_000)}`,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/") {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      send(response, 200, assets.template, "text/html");
      return;
    }
    if (request.method === "GET" && url.pathname === "/app.js") {
      send(response, 200, assets.script, "text/javascript");
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      sendJSON(response, 404, { error: "Not found" });
      return;
    }
    if (!this.authorized(request)) {
      sendJSON(response, 401, { error: "Inspector authorization failed" });
      return;
    }
    if (request.method === "POST" && request.headers.origin !== origin) {
      sendJSON(response, 403, { error: "Inspector origin check failed" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      sendJSON(response, 200, await this.backend.preview(captureScope(url.searchParams.get("scope"))));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/inspect") {
      const body = await readJSON(request);
      const x = body.x;
      const y = body.y;
      if (typeof x !== "number" || typeof y !== "number" || x < 0 || x > 1 || y < 0 || y > 1) {
        sendJSON(response, 400, { error: "Inspect coordinates must be between 0 and 1" });
        return;
      }
      sendJSON(response, 200, await this.backend.inspect(x, y, captureScope(body.scope)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/review") {
      const body = await readJSON(request);
      const selectedViewID = body.selectedViewID;
      const note = body.note;
      if (typeof selectedViewID !== "string" || typeof note !== "string" || note.length > 8_000) {
        sendJSON(response, 400, { error: "Review requires a view id and note up to 8,000 characters" });
        return;
      }
      sendJSON(
        response,
        200,
        await this.backend.saveReview(selectedViewID, note, captureScope(body.scope)),
      );
      return;
    }
    sendJSON(response, 404, { error: "Not found" });
  }

  private authorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const supplied = Buffer.from(authorization.slice("Bearer ".length));
      const expected = Buffer.from(this.token);
      if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return true;
    }

    this.pruneBrowserCredentials();
    const cookies = request.headers.cookie?.split(";") ?? [];
    const session = cookies
      .map((cookie) => cookie.trim().split("=", 2))
      .find(([name]) => name === SESSION_COOKIE)?.[1];
    if (!session) return false;
    const expiresAt = this.browserSessions.get(session);
    return typeof expiresAt === "number" && expiresAt >= Date.now();
  }

  private pruneBrowserCredentials(): void {
    const now = Date.now();
    for (const [code, expiresAt] of this.browserLaunches) {
      if (expiresAt < now) this.browserLaunches.delete(code);
    }
    for (const [session, expiresAt] of this.browserSessions) {
      if (expiresAt < now) this.browserSessions.delete(session);
    }
  }
}
