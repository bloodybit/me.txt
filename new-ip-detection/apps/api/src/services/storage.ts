// S3 / MinIO storage adapter. Object keys are deterministic and predictable
// (Decision 7): accounts/{accountId}/subjects/{subjectId}/references/{imageId}.jpg.
// All uploads are normalized to .jpg by the worker, so we always end keys in .jpg.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../lib/env";

const internalClient = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.s3.accessKey, secretAccessKey: env.s3.secretKey },
});

// Separate client used when signing URLs that need to be reachable from
// outside the docker network (worker, browser, etc.).
const publicClient = new S3Client({
  endpoint: env.s3.publicEndpoint || env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.s3.accessKey, secretAccessKey: env.s3.secretKey },
});

export function referenceKey(accountId: string, subjectId: string, referenceId: string): string {
  return `accounts/${accountId}/subjects/${subjectId}/references/${referenceId}.jpg`;
}

export function scanKey(accountId: string, scanId: string): string {
  return `accounts/${accountId}/scans/${scanId}.jpg`;
}

export async function ensureBucket(): Promise<void> {
  try {
    await internalClient.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
  } catch {
    await internalClient.send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
  }
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await internalClient.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function presignDownload(key: string, ttlSeconds = 600): Promise<string> {
  return getSignedUrl(
    publicClient,
    new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );
}
