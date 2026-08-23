import { build } from "esbuild";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "plugins/appkit-inspector/dist");
await mkdir(output, { recursive: true });
await Promise.all([
  rm(resolve(output, "app.js.map"), { force: true }),
  rm(resolve(output, "server.js.map"), { force: true }),
]);

const appBuild = await build({
  entryPoints: [resolve(root, "packages/app/src/app.ts")],
  outfile: resolve(output, "app.js"),
  bundle: true,
  minify: true,
  platform: "browser",
  format: "esm",
  target: "safari18",
  sourcemap: false,
  metafile: true,
});

const appOutput = resolve(output, "app.js");
const appSource = await readFile(appOutput, "utf8");
await writeFile(appOutput, appSource.replace(/[\t ]+$/gm, ""));

await copyFile(resolve(root, "packages/app/src/preview.html"), resolve(output, "preview.html"));

const [appBundle, previewTemplate] = await Promise.all([
  readFile(resolve(output, "app.js")),
  readFile(resolve(output, "preview.html")),
]);
const resourceRevision = createHash("sha256")
  .update(previewTemplate)
  .update("\0")
  .update(appBundle)
  .digest("hex")
  .slice(0, 16);

const serverBuild = await build({
  entryPoints: [resolve(root, "packages/mcp/src/server.ts")],
  outfile: resolve(output, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  metafile: true,
  define: {
    __APPKIT_INSPECTOR_RESOURCE_REVISION__: JSON.stringify(resourceRevision),
  },
});

function packageRoot(input) {
  const absolute = resolve(root, input);
  const match = /^(.*[\\/]node_modules[\\/])(@[^\\/]+[\\/][^\\/]+|[^\\/]+)/.exec(absolute);
  return match?.[1] && match[2] ? resolve(match[1], match[2]) : undefined;
}

const bundledPackageRoots = new Set(
  [...Object.keys(appBuild.metafile.inputs), ...Object.keys(serverBuild.metafile.inputs)]
    .map(packageRoot)
    .filter(Boolean),
);
const licensesDirectory = resolve(output, "licenses");
await rm(licensesDirectory, { force: true, recursive: true });
await mkdir(licensesDirectory, { recursive: true });

const thirdPartyPackages = [];
for (const packageDirectory of [...bundledPackageRoots].sort()) {
  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  const licenseFile = (await readdir(packageDirectory))
    .filter((name) => /^licen[cs]e(?:\.|$)/i.test(name))
    .sort()[0];
  if (!manifest.name || !manifest.version || !manifest.license || !licenseFile) {
    throw new Error(`Bundled package is missing public license metadata: ${packageDirectory}`);
  }
  const safeName = String(manifest.name)
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  const outputName = `${safeName}-${manifest.version}-${licenseFile}`;
  await copyFile(join(packageDirectory, licenseFile), join(licensesDirectory, outputName));
  thirdPartyPackages.push({
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    outputName,
  });
}

const notice = [
  "# Third-Party Notices",
  "",
  "The generated AppKit Inspector JavaScript bundles include the following packages.",
  "Their complete license texts are distributed in `licenses/`.",
  "",
  "| Package | Version | License | License text |",
  "| --- | --- | --- | --- |",
  ...thirdPartyPackages.map(
    ({ name, version, license, outputName }) =>
      `| ${name} | ${version} | ${license} | [${outputName}](licenses/${outputName}) |`,
  ),
  "",
].join("\n");
await writeFile(resolve(output, "THIRD_PARTY_NOTICES.md"), notice);

await chmod(resolve(root, "plugins/appkit-inspector/scripts/start-server"), 0o755);
