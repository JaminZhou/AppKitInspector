export type WindowKind = "main" | "popover" | "sheet" | "panel" | "window";

export type WindowListItem = {
  id: string;
  kind: WindowKind;
};

export type WindowRefreshDecision = "capture-preferred" | "retain-closed" | "stable";

export function windowRefreshDecision(
  displayedWindowID: string | undefined,
  manuallySelectedWindowID: string | undefined,
  preferredWindowID: string | undefined,
  windows: WindowListItem[],
): WindowRefreshDecision {
  if (!displayedWindowID) return preferredWindowID ? "capture-preferred" : "stable";
  const displayedStillExists = windows.some((window) => window.id === displayedWindowID);
  if (!displayedStillExists) {
    if (manuallySelectedWindowID !== undefined) return "retain-closed";
    const preferred = windows.find((window) => window.id === preferredWindowID);
    return preferred && ["popover", "sheet", "panel"].includes(preferred.kind)
      ? "capture-preferred"
      : "retain-closed";
  }
  if (manuallySelectedWindowID !== undefined) return "stable";
  return preferredWindowID && preferredWindowID !== displayedWindowID
    ? "capture-preferred"
    : "stable";
}
