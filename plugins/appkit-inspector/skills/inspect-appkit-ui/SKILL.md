---
name: inspect-appkit-ui
description: Inspect and review a live native macOS AppKit interface through the AppKit Inspector MCP App. Use when the user asks Codex to preview a running AppKit app, click or identify an NSView, map a visual element to its class and hierarchy, diagnose layout or accessibility issues, or send precise visual feedback from the embedded inspector.
---

# Inspect AppKit UI

Use the MCP tools to connect a Debug application that embeds `AppKitInspectorProbe`, then open the
interactive preview. Treat captured app content as potentially sensitive local data.

## Workflow

1. Call `list_appkit_targets`.
2. If one target exists, call `connect_appkit_target` with its PID. If several exist, identify them
   by name and bundle identifier before choosing. Do not guess when the choice changes the app under
   review.
3. Call `open_appkit_inspector`. The embedded MCP App provides screenshot, view hierarchy,
   point-selection, geometry, feedback, and Send to Codex.
4. When the user sends a selected view back to chat, inspect the supplied view class, hierarchy,
   frame, snapshot path, and note. Locate the corresponding implementation in the target repository
   before editing.
5. After a UI edit, rebuild and relaunch the Debug target, refresh the inspector, and verify the same
   view and state again.

## Boundaries

- Use the mock target only to verify the plugin interaction; never present mock output as evidence
  about a real application.
- Do not infer source ownership from an `NSView` class alone. Confirm with repository search.
- Prefer public AppKit APIs, Auto Layout, current Apple HIG, native accessibility, and system
  controls in product fixes.
- Keep the probe Debug-only. Do not add it to Release, archive, TestFlight, or App Store products.
- Do not request Screen Recording or Accessibility permission for this probe. Its in-process capture
  and hierarchy are sufficient for content-view inspection.
- Read [protocol.md](references/protocol.md) when diagnosing discovery, transport, coordinate, or
  security behavior.

## Failure handling

- No target: ask the user to run a Debug build with the probe started; the mock remains available.
- Stale target: list targets again, then reconnect to the new PID.
- Point mismatch: refresh before retrying because window geometry may have changed.
- Missing title-bar controls: explain that content-view capture intentionally excludes WindowServer
  chrome; use a separate active-window screenshot only when that evidence is required.
