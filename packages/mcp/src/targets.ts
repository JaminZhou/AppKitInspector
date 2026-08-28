import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import {
  inspectResultSchema,
  publicTargetSchema,
  snapshotSchema,
  targetSchema,
  type InspectResult,
  type CaptureActivation,
  type CaptureMode,
  type CaptureScope,
  type PublicTarget,
  type Snapshot,
  type Target,
} from "./contracts.js";

const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export function targetDirectory(): string {
  return join(homedir(), "Library", "Caches", "AppKitInspector", "targets");
}

export async function discoverTargets(): Promise<Target[]> {
  const directory = targetDirectory();
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const targets: Target[] = [];
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        try {
          const path = join(directory, entry.name);
          const info = await stat(path);
          if ((info.mode & 0o077) !== 0) return;
          const target = targetSchema.parse(JSON.parse(await readFile(path, "utf8")));
          try {
            process.kill(target.pid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") await rm(path, { force: true });
            return;
          }
          targets.push(target);
        } catch {
          // Ignore malformed, inaccessible, and stale discovery records.
        }
      }),
  );
  return targets.sort((left, right) => right.pid - left.pid);
}

export function publicTarget(target: Target): PublicTarget {
  return publicTargetSchema.parse(target);
}

export async function requestSnapshot(
  target: Target,
  scope: CaptureScope = "windowFrame",
  mode: CaptureMode = "exact",
  activation: CaptureActivation = "current",
): Promise<Snapshot> {
  return snapshotSchema.parse(await request(target, { method: "snapshot", scope, mode, activation }));
}

export async function requestInspectPoint(
  target: Target,
  x: number,
  y: number,
  scope: CaptureScope = "windowFrame",
  mode: CaptureMode = "exact",
  activation: CaptureActivation = "current",
): Promise<InspectResult> {
  return inspectResultSchema.parse(
    await request(target, { method: "inspectPoint", x, y, scope, mode, activation }),
  );
}

async function request(target: Target, payload: Record<string, unknown>): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: target.port });
    let buffer = "";
    let byteCount = 0;
    const timer = setTimeout(() => socket.destroy(new Error("Probe request timed out")), 10_000);

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ ...payload, token: target.token })}\n`);
    });
    socket.on("data", (chunk: string) => {
      byteCount += Buffer.byteLength(chunk);
      if (byteCount > MAX_RESPONSE_BYTES) {
        socket.destroy(new Error("Probe response exceeded 64 MiB"));
        return;
      }
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      socket.end();
      clearTimeout(timer);
      try {
        const response = JSON.parse(line) as { ok?: boolean; result?: unknown; error?: string };
        if (!response.ok) throw new Error(response.error ?? "Probe rejected request");
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("close", () => clearTimeout(timer));
  });
}
