-- Postgres-backed job queue. Worker leases via FOR UPDATE SKIP LOCKED.

CREATE TABLE jobs (
  id                text PRIMARY KEY,
  kind              text NOT NULL,
  status            text NOT NULL DEFAULT 'pending',
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts          integer NOT NULL DEFAULT 0,
  leased_by         text,
  lease_expires_at  timestamptz,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz
);

-- Cover the lease scan: pending or expired-lease rows ordered by created_at.
CREATE INDEX jobs_lease_idx ON jobs(status, lease_expires_at, created_at);
CREATE INDEX jobs_kind_idx ON jobs(kind);
