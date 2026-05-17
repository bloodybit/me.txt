import { z } from "zod";
import { jobId, referenceId, subjectId } from "./common";

export const referenceStatus = z.enum(["pending", "indexing", "indexed", "failed"]);
export type ReferenceStatus = z.infer<typeof referenceStatus>;

export const referenceImage = z.object({
  id: referenceId,
  subject_id: subjectId,
  storage_key: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  status: referenceStatus,
  created_at: z.string(),
});
export type ReferenceImage = z.infer<typeof referenceImage>;

export const uploadReferenceResponse = z.object({
  reference: referenceImage,
  job_id: jobId,
});
export type UploadReferenceResponse = z.infer<typeof uploadReferenceResponse>;
