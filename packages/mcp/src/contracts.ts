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
  schemaVersion: z.literal(1),
  target: publicTargetSchema,
  window: z.object({
    id: z.string(),
    title: z.string(),
    frame: rectSchema,
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

export function findView(root: ViewNode, id: string): ViewNode | undefined {
  if (root.id === id) return root;
  for (const child of root.subviews) {
    const found = findView(child, id);
    if (found) return found;
  }
  return undefined;
}
