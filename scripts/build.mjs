import { build } from "esbuild";
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "plugins/appkit-inspector/dist");
await mkdir(output, { recursive: true });
await Promise.all([
  rm(resolve(output, "app.js.map"), { force: true }),
  rm(resolve(output, "server.js.map"), { force: true }),
]);

await build({
  entryPoints: [resolve(root, "packages/mcp/src/server.ts")],
  outfile: resolve(output, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
});

await build({
  entryPoints: [resolve(root, "packages/app/src/app.ts")],
  outfile: resolve(output, "app.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "safari18",
  sourcemap: false,
});

await copyFile(resolve(root, "packages/app/src/preview.html"), resolve(output, "preview.html"));
await chmod(resolve(root, "plugins/appkit-inspector/scripts/start-server"), 0o755);
