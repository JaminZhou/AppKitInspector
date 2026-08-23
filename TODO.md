# AppKit Inspector TODO

## Codex fullscreen host acceptance

- [ ] Stabilize and re-accept the MCP App fullscreen path in Codex desktop.
  - Acceptance evidence from 2026-08-23: with plugin
    `0.1.1+codex.20260823100429` connected to the real Trailglass Inspector target, three consecutive
    `open_appkit_inspector` attempts returned the launcher result but did not expose a non-blank
    screenshot and hierarchy in a usable Codex fullscreen surface.
  - Codex Browser is now the default supported surface. Fullscreen tools are disabled unless the
    server starts with `APPKIT_INSPECTOR_EXPERIMENTAL_FULLSCREEN=1`; a mode response alone is not
    acceptance evidence.
  - Add model-visible phase diagnostics for resource mount, host capabilities, display-mode request
    and result, remount, snapshot load, measured bounds, confirmation, and fallback reason.
  - Replace the competing short timers with one launch-ID-keyed, idempotent state machine that waits
    for host-context changes and tolerates normal asynchronous remount and sizing latency.
  - Isolate host behavior with a static fullscreen probe before restoring snapshot loading, then
    repeat acceptance against a real Debug AppKit target.

## Deferred

- [ ] Re-evaluate a plugin-bundled native macOS Inspector helper built with AppKit and `WKWebView`,
  signed with Developer ID and notarized by Apple.
  - Intended benefit: a deterministic native window that does not depend on Codex MCP fullscreen
    or create external browser tabs, while reusing the existing Inspector web UI.
  - Current decision (2026-08-23): do not implement yet. Shipping an additional `.app` adds
    packaging, signing, notarization, installation, version synchronization, process-lifecycle,
    and update-maintenance costs that are not justified by the current usage.
  - Keep Codex Browser as the default and the authenticated local window as an explicit fallback;
    leave fullscreen behind the experimental opt-in until the host path is re-accepted.
