import { z } from "zod";

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const viewNodeSchema: z.ZodType<ViewNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    className: z.string(),
    frame: rectSchema,
    bounds: rectSchema,
    hidden: z.boolean(),
    alpha: z.number(),
    identifier: z.string().optional(),
    label: z.string().optional(),
    role: z.string().optional(),
    subviews: z.array(viewNodeSchema),
  }),
);

export type Rect = z.infer<typeof rectSchema>;
export type ViewNode = {
  id: string;
  className: string;
  frame: Rect;
  bounds: Rect;
  hidden: boolean;
  alpha: number;
  identifier?: string | undefined;
  label?: string | undefined;
  role?: string | undefined;
  subviews: ViewNode[];
};

export const captureScopeSchema = z.enum(["content", "windowFrame"]);
export type CaptureScope = z.infer<typeof captureScopeSchema>;
export const captureModeSchema = z.enum(["hybrid", "exact"]);
export type CaptureMode = z.infer<typeof captureModeSchema>;
export const captureActivationSchema = z.enum(["current", "active"]);
export type CaptureActivation = z.infer<typeof captureActivationSchema>;
export const captureRenderingSchema = z.enum([
  "viewCache",
  "windowFrameHybrid",
  "windowServerExact",
]);
export type CaptureRendering = z.infer<typeof captureRenderingSchema>;

export const targetSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string().min(1),
  bundleIdentifier: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  token: z.string().min(16),
  startedAt: z.string(),
});

export const publicTargetSchema = targetSchema.omit({ token: true });

export const snapshotSchema = z.object({
  schemaVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  target: publicTargetSchema,
  window: z.object({
    id: z.string(),
    title: z.string(),
    frame: rectSchema,
    contentFrame: rectSchema.optional(),
    captureScope: captureScopeSchema.optional(),
    requestedCaptureMode: captureModeSchema.optional(),
    requestedCaptureActivation: captureActivationSchema.optional(),
    capturedWindowWasActive: z.boolean().optional(),
    captureRendering: captureRenderingSchema.optional(),
    captureFallbackReason: z.string().optional(),
  }),
  imageDataURL: z.string().min(1),
  root: viewNodeSchema,
});

export const inspectResultSchema = z.object({
  snapshot: snapshotSchema,
  node: viewNodeSchema,
  ancestorPath: z.array(z.string()),
});

export type Target = z.infer<typeof targetSchema>;
export type PublicTarget = z.infer<typeof publicTargetSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type InspectResult = z.infer<typeof inspectResultSchema>;

export function flattenViews(root: ViewNode): ViewNode[] {
  return [root, ...root.subviews.flatMap(flattenViews)];
}

export function snapshotCaptureScope(snapshot: Snapshot): CaptureScope {
  return snapshot.window.captureScope ?? "content";
}
