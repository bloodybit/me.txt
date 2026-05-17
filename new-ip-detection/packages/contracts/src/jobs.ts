import { z } from "zod";
import { bbox } from "./detections";
import { jobId, referenceId, scanId, subjectId } from "./common";

export const jobKind = z.enum(["index_reference", "detect_scan"]);
export type JobKind = z.infer<typeof jobKind>;

export const jobStatus = z.enum(["pending", "leased", "succeeded", "failed"]);
export type JobStatus = z.infer<typeof jobStatus>;

export const job = z.object({
  id: jobId,
  kind: jobKind,
  status: jobStatus,
  payload: z.record(z.unknown()),
  attempts: z.number().int(),
  leased_by: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});
export type Job = z.infer<typeof job>;

// Internal — worker requests
export const leaseRequest = z.object({
  worker_id: z.string(),
  lease_seconds: z.number().int().min(5).max(3600).default(120),
  kinds: z.array(jobKind).optional(),
});
export type LeaseRequest = z.infer<typeof leaseRequest>;

// Internal — index-job context (single reference image to embed)
export const indexJobContext = z.object({
  job_id: jobId,
  reference_image_id: referenceId,
  subject_id: subjectId,
  download_url: z.string(),
  storage_key: z.string(),
});
export type IndexJobContext = z.infer<typeof indexJobContext>;

// Internal — scan-job context (query image + all reference embeddings for the account)
export const referenceEmbeddingForScan = z.object({
  reference_image_id: referenceId,
  subject_id: subjectId,
  subject_name: z.string(),
  model: z.string(),
  embedding: z.array(z.number()),
});
export type ReferenceEmbeddingForScan = z.infer<typeof referenceEmbeddingForScan>;

export const scanJobContext = z.object({
  job_id: jobId,
  scan_id: scanId,
  download_url: z.string(),
  storage_key: z.string(),
  references: z.array(referenceEmbeddingForScan),
});
export type ScanJobContext = z.infer<typeof scanJobContext>;

// Internal — succeed/fail payloads
export const indexJobResult = z.object({
  model: z.string(),
  dim: z.number().int(),
  embedding: z.array(z.number()),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});
export type IndexJobResult = z.infer<typeof indexJobResult>;

export const detectionResult = z.object({
  subject_id: subjectId,
  reference_image_id: referenceId.nullable(),
  score: z.number(),
  confidence: z.number(),
  bbox: bbox.nullable(),
  method: z.string(),
  model: z.string(),
});
export type DetectionResult = z.infer<typeof detectionResult>;

export const scanJobResult = z.object({
  detections: z.array(detectionResult),
});
export type ScanJobResult = z.infer<typeof scanJobResult>;

export const succeedRequest = z.object({
  result: z.union([indexJobResult, scanJobResult]),
});
export type SucceedRequest = z.infer<typeof succeedRequest>;

export const failRequest = z.object({
  error: z.string(),
  retry: z.boolean().default(true),
});
export type FailRequest = z.infer<typeof failRequest>;
