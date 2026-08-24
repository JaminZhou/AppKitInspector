# AppKit Inspector — Agent Instructions

## Purpose

AppKit Inspector is a reusable Debug bridge between native macOS AppKit applications and a Codex
MCP App. Keep it independent from any inspected product repository.

## Safety boundary

- Use public Apple SDK APIs only. ScreenCaptureKit is limited to the inspected Debug process's own
  windows through `SCShareableContent.currentProcess`; never request Screen Recording permission or
  enumerate capture content owned by another process.
- Do not add code injection, private frameworks, Accessibility automation, or Screen Recording
  permission.
- Keep discovery on a user-private path and transport on authenticated `127.0.0.1` only.
- Never make the probe active in Release, archive, TestFlight, or App Store builds.
- Treat captured UI and hierarchy data as private local content.

## Structure

- Put native probe and demo code under `native/`.
- Put MCP server code under `packages/mcp/`.
- Put the embedded MCP App under `packages/app/`.
- Treat `plugins/appkit-inspector/dist/` as generated distributable output; run `npm run build` after
  changing either TypeScript package and include the matching output.
- Keep the plugin skill concise; place protocol detail in its `references/` directory.

## Verification

- Full automated check: `npm run check`
- Release compile: `swift build -c release`
- Live bridge check: run `make demo`, then `npm run test:live` in another terminal.
- Validate the plugin and skill with their respective Codex validation scripts before release.
