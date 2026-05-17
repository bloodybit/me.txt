import { z } from "zod";
import { detectionId, referenceId, scanId, subjectId } from "./common";

export const bbox = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
});
export type Bbox = z.infer<typeof bbox>;

export const detection = z.object({
  id: detectionId,
  scan_id: scanId,
  subject_id: subjectId,
  subject_name: z.string().optional(),
  reference_image_id: referenceId.nullable(),
  score: z.number(),
  confidence: z.number(),
  bbox: bbox.nullable(),
  method: z.string().nullable(),
  model: z.string().nullable(),
  created_at: z.string(),
});
export type Detection = z.infer<typeof detection>;
