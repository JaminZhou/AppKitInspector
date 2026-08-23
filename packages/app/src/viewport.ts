export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Bounds = Size & { left: number; top: number };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_FACTOR = 1.25;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function fitZoom(viewport: Size, content: Size, padding = 48): number {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    content.width <= 0 ||
    content.height <= 0
  ) {
    return 1;
  }
  const availableWidth = Math.max(1, viewport.width - padding);
  const availableHeight = Math.max(1, viewport.height - padding);
  return clampZoom(Math.min(1, availableWidth / content.width, availableHeight / content.height));
}

export function steppedZoom(value: number, direction: "in" | "out"): number {
  return clampZoom(value * (direction === "in" ? ZOOM_FACTOR : 1 / ZOOM_FACTOR));
}

export function scaledZoom(value: number, deltaY: number): number {
  return clampZoom(value * Math.exp(-deltaY * 0.002));
}

export function normalizedPoint(bounds: Bounds, point: Point): Point | undefined {
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  return {
    x: Math.min(1, Math.max(0, (point.x - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (point.y - bounds.top) / bounds.height)),
  };
}
