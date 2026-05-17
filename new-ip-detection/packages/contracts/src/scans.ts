import { z } from "zod";
import { accountId, jobId, scanId } from "./common";

export const scanStatus = z.enum(["pending", "processing", "complete", "failed"]);
export type ScanStatus = z.infer<typeof scanStatus>;

export const scan = z.object({
  id: scanId,
  account_id: accountId,
  query_storage_key: z.string(),
  status: scanStatus,
  created_at: z.string(),
  completed_at: z.string().nullable(),
});
export type Scan = z.infer<typeof scan>;

export const createScanResponse = z.object({
  scan,
  job_id: jobId,
});
export type CreateScanResponse = z.infer<typeof createScanResponse>;
