# AppKit Inspector

[![CI](https://github.com/JaminZhou/AppKitInspector/actions/workflows/ci.yml/badge.svg)](https://github.com/JaminZhou/AppKitInspector/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

AppKit Inspector is a Debug-only bridge for inspecting a live native macOS AppKit interface from
Codex. It captures the application's complete window frame or content view in-process, maps a
clicked point to its `NSView`, shows hierarchy and geometry, and prepares precise visual feedback
for a coding task.

> **Public Preview:** APIs, plugin packaging, and presentation behavior may change before 1.0.
> Codex Browser is the supported surface. Fullscreen remains experimental and disabled by default;
> the plugin does not expose a system-browser/Chrome launch path.

## Features

- Inspect a real AppKit window frame, title bar, traffic-light controls, toolbar, and content without
  Accessibility or Screen Recording permission.
- Capture real pixels by default on macOS 14.4 or later from the inspected Debug process's own
  WindowServer window through ScreenCaptureKit, without Screen Recording permission or access to
  other apps. **Content** is cropped from that same exact image, so appearance stays consistent.
- Choose **Active Appearance** to temporarily make the inspected window key for each
  capture, record its real emphasized AppKit state, and cooperatively return focus to the previous
  application. This is explicit because macOS cannot keep two applications active simultaneously.
- If exact capture is unavailable, automatically keep the Inspector usable with an honestly labeled
  compatibility preview and the failure reason. The legacy Hybrid/View Cache paths are fallback
  implementation details rather than normal UI choices.
- Click the captured interface and identify the deepest native `NSView`.
- Select and comment individual `NSTableHeaderCell` regions even though AppKit draws column headers
  as cells rather than independent views.
- Review class names, frames, accessibility metadata, and ancestor paths.
- Use Codex Browser's native comments to annotate one or many semantic AppKit view targets and
  deliver them directly to the current Codex task. AppKit Inspector does not duplicate that UI with
  its own notes, queue, clipboard, or send controls.
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
Use **Window** for title-bar and frame inspection or **Content** for a focused content-only view.
Both scopes use the current process's real WindowServer pixels by default; Content crops the same
capture to the application content view. If the OS cannot provide exact pixels, the Inspector shows
an honest compatibility-preview badge and reason. Enable **Active Appearance** when selection,
focus, or toolbar emphasis must match the inspected app's foreground appearance.
In Codex Browser, use its native comment mode. AppKit Inspector exposes each reviewable native view
as a semantic comment target, so comments reach the current task with the specific AppKit class and
hierarchy instead of targeting the whole screenshot. Multiple native comments can be submitted as
one Codex message. Ordinary clicks still select views for hierarchy and geometry inspection.
```

The default `open_appkit_inspector` tool creates a 60-second, single-use loopback URL for the
current task's right Browser panel. It never requests fullscreen or invokes the system browser.

## Codex integration

AppKit Inspector is currently adapted specifically for Codex desktop:

- `open_appkit_inspector` prepares the authenticated URL that Codex opens in its right Browser
  panel;
- transparent semantic targets map Codex Browser comments to AppKit class, hierarchy, and frame
  context;
- Codex owns comment composition, multi-comment submission, delivery, and task history;
- the Inspector owns capture, view selection, hierarchy, geometry, and target refresh only.

This boundary deliberately avoids maintaining a second annotation system with different delivery
and recovery behavior. If a host does not provide Codex Browser native comments, inspection remains
readable and selectable, but comment delivery is unavailable rather than silently falling back to
the clipboard or an external browser.

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

- **Codex Browser:** supported product path.
- **MCP App fullscreen:** experimental, disabled by default, and available only when the MCP server
  starts with `APPKIT_INSPECTOR_EXPERIMENTAL_FULLSCREEN=1`.

No presentation failure opens Chrome, Safari, or another external window.

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
files under `plugins/appkit-inspector/dist/`. The authenticated Browser uses a lightweight target
status request to notice when the inspected Debug application is rebuilt; it follows a unique
replacement with the same bundle identifier and refreshes the snapshot without reloading the page.

## Security and privacy

The probe and Inspector servers bind only to loopback, require random credentials, and write
user-private discovery data. Codex Browser launch links are single-use and become HttpOnly,
same-site sessions. The project uses public Apple SDK APIs and does not use injection, Accessibility
automation, private frameworks, or Screen Recording permission. Exact capture is restricted to
`SCShareableContent.currentProcess`, so it cannot enumerate or capture another process's windows.

Captured screenshots, hierarchy data, and Codex Browser comments are sensitive. When used through
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
