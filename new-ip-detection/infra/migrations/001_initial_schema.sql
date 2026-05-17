-- Initial schema: 6 of 7 core tables. Jobs table added in 002.
-- pgvector extension is required for the embeddings column.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE accounts (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  api_token   text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subjects (
  id           text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subjects_account_id_idx ON subjects(account_id);

CREATE TABLE reference_images (
  id           text PRIMARY KEY,
  subject_id   text NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  storage_key  text NOT NULL,
  width        integer,
  height       integer,
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reference_images_subject_id_idx ON reference_images(subject_id);

CREATE TABLE reference_embeddings (
  id                  text PRIMARY KEY,
  reference_image_id  text NOT NULL REFERENCES reference_images(id) ON DELETE CASCADE,
  subject_id          text NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  model               text NOT NULL,
  dim                 integer NOT NULL,
  embedding           vector(768) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reference_embeddings_subject_id_idx ON reference_embeddings(subject_id);
CREATE INDEX reference_embeddings_reference_image_id_idx ON reference_embeddings(reference_image_id);

CREATE TABLE scans (
  id                 text PRIMARY KEY,
  account_id         text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  query_storage_key  text NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);
CREATE INDEX scans_account_id_idx ON scans(account_id);

CREATE TABLE detections (
  id                  text PRIMARY KEY,
  scan_id             text NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  subject_id          text NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  reference_image_id  text REFERENCES reference_images(id) ON DELETE SET NULL,
  score               double precision NOT NULL,
  confidence          double precision NOT NULL,
  bbox_x              integer,
  bbox_y              integer,
  bbox_w              integer,
  bbox_h              integer,
  method              text,
  model               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX detections_scan_id_idx ON detections(scan_id);
CREATE INDEX detections_subject_id_idx ON detections(subject_id);
