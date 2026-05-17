// Centralized env loading + light validation.
// Boot fails fast if a required var is missing.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  apiPort: Number(optional("API_PORT", "8080")),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    // Used when minting URLs the worker / client will fetch from outside Docker.
    publicEndpoint: optional("S3_PUBLIC_ENDPOINT", process.env.S3_ENDPOINT ?? ""),
    region: optional("S3_REGION", "us-east-1"),
    accessKey: required("S3_ACCESS_KEY"),
    secretKey: required("S3_SECRET_KEY"),
    bucket: required("S3_BUCKET"),
  },
  embeddingDim: Number(optional("EMBEDDING_DIM", "768")),
} as const;
