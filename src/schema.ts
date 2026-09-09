import { z } from "zod";
export const stableId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const screenSchema = z
  .object({
    id: stableId,
    title: z.string().trim().min(1).max(160),
    column: z.number().int().min(0).max(50),
    row: z.number().int().min(-30).max(30),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    image: z.string().max(4_200_000).optional(),
    section: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
    tags: z.array(z.string().max(40)).max(10).default([]),
  })
  .strict();
export const importSchema = z
  .object({
    schemaVersion: z.literal(1),
    export: z
      .object({
        version: stableId,
        title: z.string().trim().min(1).max(160),
        createdAt: z.iso.datetime().optional(),
        commit: z.string().max(80).optional(),
        notes: z.string().max(2000).optional(),
      })
      .strict(),
    screens: z.array(screenSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>(),
      cells = new Set<string>();
    for (const [i, s] of value.screens.entries()) {
      const cell = JSON.stringify([s.section, s.column, s.row]);
      if (ids.has(s.id))
        ctx.addIssue({
          code: "custom",
          path: ["screens", i, "id"],
          message: "Screen IDs must be unique within an export",
        });
      if (cells.has(cell))
        ctx.addIssue({
          code: "custom",
          path: ["screens", i, "column"],
          message:
            "Two screens cannot occupy the same cell in the same section",
        });
      if (s.width * s.height > 20_000_000)
        ctx.addIssue({
          code: "custom",
          path: ["screens", i],
          message: "Screenshot exceeds 20 megapixels",
        });
      ids.add(s.id);
      cells.add(cell);
    }
  });
export type ImportFile = z.infer<typeof importSchema>;
export type ScreenSpec = z.infer<typeof screenSchema>;
export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
  })
  .strict();
export const commentSchema = z
  .object({
    screenId: stableId,
    body: z.string().trim().min(1).max(5000),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    parentId: z.string().uuid().nullable().default(null),
    mentions: z.array(z.string().min(1).max(128)).max(20).default([]),
  })
  .strict();
export const uuid = z.string().uuid();
