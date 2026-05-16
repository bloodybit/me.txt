const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'metxt.db');

let db;

function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      photo_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS consent_rules (
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      use_type TEXT NOT NULL,
      permission TEXT NOT NULL CHECK(permission IN ('allow', 'deny')),
      PRIMARY KEY (profile_id, use_type)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      queried_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_url TEXT,
      match_confidence REAL,
      result TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_profile ON audit_log(profile_id, queried_at DESC);
  `);
  return db;
}

function createProfile(id, name) {
  db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?)').run(id, name);
}

function addEmbedding(profileId, descriptor, photoHash) {
  const buf = Buffer.from(new Float32Array(descriptor).buffer);
  db.prepare('INSERT INTO embeddings (profile_id, embedding, photo_hash) VALUES (?, ?, ?)')
    .run(profileId, buf, photoHash);
}

function getAllEmbeddings() {
  const rows = db.prepare('SELECT profile_id, embedding FROM embeddings').all();
  return rows.map(r => {
    const blob = r.embedding;
    const arr = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return { profile_id: r.profile_id, descriptor: Array.from(arr) };
  });
}

function getProfile(id) {
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
}

function listProfiles() {
  return db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all();
}

function updateConsent(profileId, useType, permission) {
  db.prepare(`
    INSERT INTO consent_rules (profile_id, use_type, permission) VALUES (?, ?, ?)
    ON CONFLICT(profile_id, use_type) DO UPDATE SET permission = excluded.permission
  `).run(profileId, useType, permission);
}

function getConsentRules(profileId) {
  return db.prepare('SELECT use_type, permission FROM consent_rules WHERE profile_id = ?').all(profileId);
}

function logQuery(profileId, sourceUrl, confidence, result) {
  db.prepare('INSERT INTO audit_log (profile_id, source_url, match_confidence, result) VALUES (?, ?, ?, ?)')
    .run(profileId, sourceUrl, confidence, result);
}

function getAuditLog(profileId, limit = 50) {
  if (profileId) {
    return db.prepare('SELECT * FROM audit_log WHERE profile_id = ? ORDER BY queried_at DESC LIMIT ?')
      .all(profileId, limit);
  }
  return db.prepare('SELECT * FROM audit_log ORDER BY queried_at DESC LIMIT ?').all(limit);
}

module.exports = {
  initDb,
  createProfile,
  addEmbedding,
  getAllEmbeddings,
  getProfile,
  listProfiles,
  updateConsent,
  getConsentRules,
  logQuery,
  getAuditLog,
};
