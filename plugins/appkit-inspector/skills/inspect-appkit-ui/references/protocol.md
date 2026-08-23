# Probe protocol

## Discovery

Debug targets write a mode `0600` JSON record to:

`~/Library/Caches/AppKitInspector/targets/<bundle-id>-<pid>.json`

The record contains process id, app name, bundle identifier, loopback port, random token, and start
time. The MCP server ignores group/world-readable, malformed, and stale records.

## Transport

The probe listens only on `127.0.0.1` and accepts one newline-delimited JSON request per connection.
Every request includes the discovery token. Responses are bounded to 64 MiB by the MCP client.

Supported methods:

- `snapshot`: capture the key window and recursively serialize its `NSView` tree. An optional
  `scope` is `windowFrame` by default or `content` for the application content view only.
- `inspectPoint`: convert a normalized top-left image point to AppKit coordinates and return the
  deepest hit-tested view plus its ancestor path. It accepts the same `scope`.

Schema version 3 includes `window.captureRendering` in addition to the version-2
`window.captureScope` and content-layout rectangle relative to the captured root. Schema version 1
remains accepted as a content-only compatibility response, and schema version 2 remains accepted
without rendering metadata.

## Inspector window

The MCP server serves the full Inspector from an ephemeral HTTP listener bound only to
`127.0.0.1`. It creates a new 256-bit random Bearer token for each server process and passes that
token to the browser only in the URL fragment, which is not sent in HTTP requests or referrers.
Screenshot, hierarchy, point-inspection, and review endpoints require that token. The server also
checks the loopback `Host`, checks the `Origin` of state-changing requests, disables caching, and
applies a restrictive content security policy.

For a Codex Browser launch, the server creates a separate random single-use code that expires after
60 seconds. The code appears only in a `/launch` URL, is deleted on the first exchange, and becomes
an eight-hour host-only `HttpOnly; SameSite=Strict` cookie. The Browser URL never contains the
long-lived Bearer token. Bare or expired URLs cannot read Inspector APIs.

## Presentation routing

`open_appkit_inspector` creates the same single-use session used by the Codex Browser and never
mounts an MCP App resource, enters fullscreen, or invokes the system browser. The caller opens that
URL in the current task's Codex Browser panel.

The authenticated separate local window is an explicit fallback only. It uses the system default
browser and is never opened by a timer or a failed display transition.

The MCP App fullscreen launcher remains available only when the MCP server starts with
`APPKIT_INSPECTOR_EXPERIMENTAL_FULLSCREEN=1`. It requires an explicit fullscreen tool call and an
explicit user action in the launcher. Failure returns to the launcher without opening another
surface.

## Geometry

AppKit view frames use bottom-left coordinates. The Inspector window converts them to CSS top-left
percentages using the selected capture root. Window mode uses the frame view, so title-bar buttons
and content share one coordinate space. Refresh after moving or resizing the target.

## Capture scope

The probe captures entirely inside the inspected process with public AppKit APIs. Content mode uses
`cacheDisplay(in:to:)` on `contentView`. Window mode keeps that live view-cache image for the content,
uses `NSWindow.dataWithPDF(inside:)` for the frame region so modern hosted toolbar controls remain
readable, and restores the real standard-window-button pixels from the view cache with circular
clipping. Its `windowFrameHybrid` rendering is an annotation preview, not a pixel-exact replacement
for WindowServer compositor effects such as glass and blur. Neither mode needs Screen Recording
permission. Both exclude WindowServer shadows, other applications, and occlusion state.
