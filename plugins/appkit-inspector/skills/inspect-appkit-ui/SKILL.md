---
name: inspect-appkit-ui
description: Inspect and review a live native macOS AppKit interface in Codex Browser. Use when the user asks Codex to preview a running AppKit app, click or identify an NSView, map a visual element to its class and hierarchy, diagnose layout or accessibility issues, or prepare precise visual feedback for Codex.
---

# Inspect AppKit UI

Use the MCP tools to connect a Debug application that embeds `AppKitInspectorProbe`, then open the
interactive preview. Treat captured app content as potentially sensitive local data.

## Workflow

1. Call `list_appkit_targets`.
2. If one target exists, call `connect_appkit_target` with its PID. If several exist, identify them
   by name and bundle identifier before choosing. Do not guess when the choice changes the app under
   review.
3. Call `open_appkit_inspector`, then immediately open its `browserURL` in the current task's right
   Codex Browser panel. Do not print or retain the URL. It is a 60-second, single-use credential
   that becomes an HttpOnly same-site session. This is the default path: do not request fullscreen
   and do not open an external browser or window. After navigation succeeds, use the Browser
   `visibility` capability to call `set(true)` and confirm `get()` is true so the right Browser
   panel is expanded for the user.
4. Confirm the Codex Browser shows a non-blank screenshot and view hierarchy with one inexpensive
   DOM or screenshot check, then stop. Do not continue collecting duplicate render evidence after
   the surface is usable. `prepare_appkit_inspector_browser` remains a compatibility alias for the
   same Browser launch.
5. In the Codex Browser surface, use its native comment mode. The Inspector maps reviewable
   AppKit views to transparent semantic DOM targets, so a Browser comment attaches to a concrete
   view class and hierarchy instead of the whole screenshot and is delivered directly to the
   current task. Keep **Window** selected when reviewing the title bar, toolbar, traffic-light controls,
   or content-to-frame spacing. Window starts in **Hybrid**, whose badge means compositor-only glass
   and blur are approximated. Choose **Exact** when real current-process WindowServer pixels matter;
   it uses public ScreenCaptureKit current-process capture without Screen Recording permission. If
   Exact cannot run, require an explicit `Hybrid fallback` badge and reason. Switch to **Content**
   when only application content matters.
6. For every native Browser comment, use its AppKit class, hierarchy, and frame context to locate
   the corresponding implementation in the target repository before editing. Treat a multi-comment
   message as one coherent UI pass. Ordinary Inspector clicks may still select a view and show its
   hierarchy without creating a comment.
7. After a UI edit, rebuild and relaunch the Debug target. The Browser follows a unique replacement
   with the same bundle identifier and refreshes automatically; verify the new PID and then the same
   view and state. Use manual Refresh if the Browser was hidden or target discovery is ambiguous.

## Boundaries

- Use the mock target only to verify the plugin interaction; never present mock output as evidence
  about a real application.
- Do not infer source ownership from an `NSView` class alone. Confirm with repository search.
- Prefer public AppKit APIs, Auto Layout, current Apple HIG, native accessibility, and system
  controls in product fixes.
- Treat native Browser comment controls and delivery as host-owned behavior. The Inspector may
  provide semantic DOM anchors, but it must not call or depend on private Codex host message APIs.
- Keep the probe Debug-only. Do not add it to Release, archive, TestFlight, or App Store products.
- Do not request Screen Recording or Accessibility permission for this probe. Exact Window may use
  `SCShareableContent.currentProcess` only; never enumerate or capture another process's content.
- Read [protocol.md](references/protocol.md) when diagnosing discovery, transport, coordinate, or
  security behavior.

## Failure handling

- No target: ask the user to run a Debug build with the probe started; the mock remains available.
- Stale target: list targets again, then reconnect to the new PID.
- Point mismatch: refresh before retrying because window geometry may have changed.
- Codex Browser fails: request a fresh single-use link; never reuse an expired `browserURL`. If the
  Browser panel cannot open it, report the Browser-layer error. There is no clipboard, review-queue,
  or system-browser fallback.
- Native comment mode is unavailable: continue read-only inspection if useful and report that this
  Codex host cannot deliver comments; do not simulate a second annotation workflow inside the app.
- Fullscreen is disabled by default. Only use the experimental fullscreen tools when the user
  explicitly asks to test that path and the MCP server was started with
  `APPKIT_INSPECTOR_EXPERIMENTAL_FULLSCREEN=1`. A fullscreen failure must remain in the launcher; it
  must not trigger an external browser fallback.
- Window mode falls back to Content: rebuild and restart the Debug target against the current probe.
  Schema-one targets remain readable but cannot expose title-bar controls.
- Missing shadows or occlusion: explain that Window mode captures the in-process AppKit frame view,
  not WindowServer shadows, other applications, or occlusion state.
- A toolbar material differs in Hybrid: explain the hybrid rendering boundary and use hierarchy,
  geometry, and the real standard-window-button pixels as inspection evidence. Do not call Hybrid
  pixel-exact; switch to Exact when the target reports `windowServerExact`.
