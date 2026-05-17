const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.METXT_DB_PATH
  ? path.resolve(process.env.METXT_DB_PATH)
  : path.join(process.env.METXT_DATA_DIR ? path.resolve(process.env.METXT_DATA_DIR) : DEFAULT_DATA_DIR, 'metxt.db');
const DATA_DIR = path.dirname(DB_PATH);

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
      handle TEXT UNIQUE,
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
      result TEXT,
      evidence_id TEXT
    );
    CREATE TABLE IF NOT EXISTS evidence_packets (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_url TEXT,
      verdict TEXT,
      packet_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitored_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      site TEXT NOT NULL,
      domain TEXT NOT NULL,
      keyword TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_scanned_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_profile ON audit_log(profile_id, queried_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evidence_profile ON evidence_packets(profile_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_monitored_profile ON monitored_sites(profile_id, created_at DESC);
  `);
  ensureHandleColumn();
  ensureAuditEvidenceColumn();
  purgeDemoEvidencePackets();
  return db;
}

function ensureHandleColumn() {
  const cols = db.prepare("PRAGMA table_info(profiles)").all();
  if (!cols.some(c => c.name === 'handle')) {
    db.exec('ALTER TABLE profiles ADD COLUMN handle TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle)');
  }
}

function ensureAuditEvidenceColumn() {
  const cols = db.prepare("PRAGMA table_info(audit_log)").all();
  if (!cols.some(c => c.name === 'evidence_id')) {
    db.exec('ALTER TABLE audit_log ADD COLUMN evidence_id TEXT');
  }
}

function purgeDemoEvidencePackets() {
  const rows = db.prepare("SELECT id FROM evidence_packets WHERE packet_json LIKE ?")
    .all('%"demo":true%');
  if (!rows.length) return;

  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM audit_log WHERE evidence_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM evidence_packets WHERE id IN (${placeholders})`).run(...ids);
}

function slugify(name) {
  const base = (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || 'user';
}

function generateUniqueHandle(name, { exclude } = {}) {
  const base = slugify(name);
  const taken = handle => {
    const row = db.prepare('SELECT id FROM profiles WHERE handle = ?').get(handle);
    return row && row.id !== exclude;
  };
  if (!taken(base)) return base;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error('could not generate unique handle');
}

function createProfile(id, name, handle) {
  const finalHandle = handle || generateUniqueHandle(name);
  db.prepare('INSERT INTO profiles (id, name, handle) VALUES (?, ?, ?)').run(id, name, finalHandle);
  return finalHandle;
}

function updateProfile(id, name, handle) {
  const finalHandle = handle || generateUniqueHandle(name, { exclude: id });
  db.prepare('UPDATE profiles SET name = ?, handle = ? WHERE id = ?').run(name, finalHandle, id);
  return finalHandle;
}

function getProfileByHandle(handle) {
  return db.prepare('SELECT * FROM profiles WHERE handle = ?').get(handle);
}

function addEmbedding(profileId, descriptor, photoHash) {
  const buf = Buffer.from(new Float32Array(descriptor).buffer);
  db.prepare('INSERT INTO embeddings (profile_id, embedding, photo_hash) VALUES (?, ?, ?)')
    .run(profileId, buf, photoHash);
}

function deleteEmbeddings(profileId) {
  db.prepare('DELETE FROM embeddings WHERE profile_id = ?').run(profileId);
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

function deleteProfile(id) {
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
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

function logQuery(profileId, sourceUrl, confidence, result, evidenceId = null) {
  const info = db.prepare('INSERT INTO audit_log (profile_id, source_url, match_confidence, result, evidence_id) VALUES (?, ?, ?, ?, ?)')
    .run(profileId, sourceUrl, confidence, result, evidenceId);
  return info.lastInsertRowid;
}

function getAuditLog(profileId, limit = 50) {
  if (profileId) {
    return db.prepare('SELECT * FROM audit_log WHERE profile_id = ? ORDER BY queried_at DESC LIMIT ?')
      .all(profileId, limit);
  }
  return db.prepare('SELECT * FROM audit_log ORDER BY queried_at DESC LIMIT ?').all(limit);
}

function saveEvidencePacket(packet) {
  db.prepare(`
    INSERT OR REPLACE INTO evidence_packets (id, profile_id, created_at, source_url, verdict, packet_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    packet.id,
    packet.subject.profile_id,
    packet.created_at,
    packet.source.url,
    packet.verdict,
    JSON.stringify(packet)
  );
  return packet.id;
}

function getEvidencePacket(id) {
  const row = db.prepare('SELECT * FROM evidence_packets WHERE id = ?').get(id);
  return row ? parseEvidenceRow(row) : null;
}

function getEvidencePackets(profileId, limit = 20) {
  const rows = profileId
    ? db.prepare('SELECT * FROM evidence_packets WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?').all(profileId, limit)
    : db.prepare('SELECT * FROM evidence_packets ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map(parseEvidenceRow).filter(Boolean);
}

function parseEvidenceRow(row) {
  try {
    return JSON.parse(row.packet_json);
  } catch {
    return null;
  }
}

function addMonitoredSite({ profileId, site, domain, keyword }) {
  const info = db.prepare(
    'INSERT INTO monitored_sites (profile_id, site, domain, keyword) VALUES (?, ?, ?, ?)'
  ).run(profileId, site, domain, keyword);
  return getMonitoredSite(info.lastInsertRowid);
}

function getMonitoredSite(id) {
  return db.prepare('SELECT * FROM monitored_sites WHERE id = ?').get(id);
}

function listMonitoredSites(profileId) {
  return db.prepare(
    'SELECT * FROM monitored_sites WHERE profile_id = ? ORDER BY created_at DESC'
  ).all(profileId);
}

function removeMonitoredSite(id) {
  const info = db.prepare('DELETE FROM monitored_sites WHERE id = ?').run(id);
  return info.changes > 0;
}

function touchMonitoredSiteScan(id) {
  db.prepare("UPDATE monitored_sites SET last_scanned_at = datetime('now') WHERE id = ?").run(id);
}

module.exports = {
  initDb,
  createProfile,
  updateProfile,
  addEmbedding,
  deleteEmbeddings,
  getAllEmbeddings,
  getProfile,
  getProfileByHandle,
  deleteProfile,
  listProfiles,
  updateConsent,
  getConsentRules,
  logQuery,
  getAuditLog,
  saveEvidencePacket,
  getEvidencePacket,
  getEvidencePackets,
  addMonitoredSite,
  getMonitoredSite,
  listMonitoredSites,
  removeMonitoredSite,
  touchMonitoredSiteScan,
  slugify,
  generateUniqueHandle,
};
