# AppKit Inspector

[![CI](https://github.com/JaminZhou/AppKitInspector/actions/workflows/ci.yml/badge.svg)](https://github.com/JaminZhou/AppKitInspector/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

AppKit Inspector is a Debug-only bridge for inspecting a live native macOS AppKit interface from
Codex. It captures the application's content view in-process, maps a clicked point to its `NSView`,
shows hierarchy and geometry, and prepares precise visual feedback for a coding task.

> **Public Preview:** APIs, plugin packaging, and presentation behavior may change before 1.0.
> Codex Browser is the supported default surface. Fullscreen remains experimental and disabled by
> default.

## Features

- Inspect a real AppKit window without Accessibility or Screen Recording permission.
- Click the captured interface and identify the deepest native `NSView`.
- Review class names, frames, accessibility metadata, and ancestor paths.
- Copy a feedback package containing the selected view, geometry, note, and private local artifacts.
- Keep discovery and transport authenticated on `127.0.0.1`.
- Compile the probe out of active Release behavior with `#if DEBUG`.

## Requirements

- macOS 14 or later;
- Xcode 26 or later with Swift 6.2;
- Node.js 22 or later;
- a current Codex desktop installation for the plugin workflow.

## Quick start

Clone and verify the project:

```bash
git clone https://github.com/JaminZhou/AppKitInspector.git
cd AppKitInspector
npm ci
npm run check
```

Install the cloned repository as a local Codex marketplace and enable the plugin:

```bash
codex plugin marketplace add "$PWD"
codex plugin add appkit-inspector@appkit-inspector-dev
```

Start the included AppKit demo:

```bash
make demo
```

Start a new Codex task so it loads the newly installed MCP tools, then ask:

```text
Use AppKit Inspector to connect to the running demo and open it in Codex Browser. The workflow
explicitly presents the right Browser panel after navigation. In the Inspector, use **Fit**, **−**,
and **+** to resize the snapshot; trackpad pinch and Command-modified scrolling also zoom.
```

The default `open_appkit_inspector` tool creates a 60-second, single-use loopback URL for the
current task's right Browser panel. It never requests fullscreen or invokes the system browser
automatically. The external browser window is an explicit fallback.

## Add the probe to an AppKit project

Add the package in Xcode with:

```text
https://github.com/JaminZhou/AppKitInspector.git
```

Or declare it in `Package.swift`:

```swift
.package(
    url: "https://github.com/JaminZhou/AppKitInspector.git",
    from: "0.1.1"
)
```

Add `AppKitInspectorProbe` only to a Debug target or Debug configuration, then start it after the
application has launched:

```swift
#if DEBUG
import AppKitInspectorProbe

_ = try? AppKitInspectorProbe.start()
#endif
```

Never add or start the probe in Release, archive, TestFlight, or App Store builds.

## Presentation modes

- **Codex Browser:** default and supported.
- **External local window:** explicit fallback opened in the system default browser.
- **MCP App fullscreen:** experimental, disabled by default, and available only when the MCP server
  starts with `APPKIT_INSPECTOR_EXPERIMENTAL_FULLSCREEN=1`.

No presentation failure automatically opens another window.

## Repository layout

- `native/` — reusable Swift probe, demo application, and native tests.
- `packages/mcp/` — local MCP server, discovery, and authenticated transport.
- `packages/app/` — Inspector browser interface and local client.
- `plugins/appkit-inspector/` — installable Codex plugin, generated distribution, and skill.
- `TODO.md` — deferred work and experimental fullscreen acceptance.

## Development

```bash
npm ci
npm run check
swift build -c release
```

For a live bridge check, run `make demo` in one terminal and `npm run test:live` in another. After
changing `packages/app/` or `packages/mcp/`, run `npm run build` and include the matching generated
files under `plugins/appkit-inspector/dist/`.

## Security and privacy

The probe and Inspector servers bind only to loopback, require random credentials, and write
user-private discovery data. Codex Browser launch links are single-use and become HttpOnly,
same-site sessions. The project uses public AppKit and Foundation APIs and does not use injection,
Accessibility automation, private frameworks, or Screen Recording.

Captured screenshots, hierarchy data, notes, and review artifacts are sensitive. When used through
Codex they may become part of the Codex task under the user's product and workspace data controls.
Read [SECURITY.md](SECURITY.md) before integrating the probe and use private security advisories for
vulnerability reports.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions intentionally submitted to the project are
licensed under Apache License 2.0.

## License

Copyright 2026 Jamin Zhou.

Licensed under the [Apache License, Version 2.0](LICENSE).
Bundled dependency attributions are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
