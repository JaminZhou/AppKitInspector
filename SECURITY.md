# Security Policy

AppKit Inspector is a development-only bridge that can capture the visible content and native view
hierarchy of a running AppKit application. Treat every captured snapshot and review artifact as
private application data.

## Supported versions

Security fixes are made on the latest `main` branch and the latest tagged public-preview release.
Older preview builds may not receive backports.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
[private security advisory form](https://github.com/JaminZhou/AppKitInspector/security/advisories/new)
and include:

- the affected commit or release;
- macOS, Xcode, Node.js, and Codex versions;
- reproduction steps and expected impact;
- whether the issue exposes a screenshot, hierarchy, token, session cookie, or local file;
- any proposed mitigation, if known.

Reports involving unauthorized local access, token disclosure, origin or host validation bypass,
path traversal, unsafe Release inclusion, or unexpected network transmission are security issues.
Ordinary layout problems and unsupported AppKit controls can use public issues.

## Security and privacy boundary

- The Swift probe is compiled behind `#if DEBUG`; `start()` returns `false` outside Debug builds.
- Probe discovery records are user-private files and include a random credential.
- Native and browser transports bind only to authenticated `127.0.0.1` listeners.
- Codex Browser links use a short-lived, single-use code exchanged for an HttpOnly, same-site
  session cookie.
- The project does not use injection, private frameworks, Accessibility automation, or Screen
  Recording permission.
- Browser-first presentation is the default. External-browser and experimental fullscreen paths
  require explicit action and never run as automatic fallbacks.

The loopback boundary does not mean captured data can never reach a model or service. When used
through Codex, screenshots, hierarchy information, notes, and generated review artifacts may become
part of the Codex task according to the user's product and workspace data controls. Do not inspect
applications or states containing information that must not enter that task.

## Operational guidance

- Add `AppKitInspectorProbe` only to Debug configurations.
- Stop the probe when inspection is no longer needed.
- Do not publish discovery records, Browser launch URLs, cookies, review artifacts, or screenshots.
- Rebuild and restart the inspected application after upgrading the probe.
