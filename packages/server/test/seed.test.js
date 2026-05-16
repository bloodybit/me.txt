const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const SERVER_DIR = path.join(__dirname, '..');
const SEED_SCRIPT = path.join(SERVER_DIR, 'seed.js');
const FIXTURE_DIR = path.join(SERVER_DIR, 'fixtures', 'vin-diesel');
const PROFILE_ID = 'me_vin01';

function runSeed(dataDir) {
  const env = {
    ...process.env,
    METXT_DATA_DIR: dataDir,
  };
  delete env.METXT_DB_PATH;

  return execFileSync(process.execPath, [SEED_SCRIPT], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
  });
}

function fixtureHash(fileName) {
  const buffer = fs.readFileSync(path.join(FIXTURE_DIR, fileName));
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function vectorNorm(blob) {
  const arr = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  let sum = 0;
  for (const value of arr) sum += value * value;
  return Math.sqrt(sum);
}

test('seed refreshes existing demo profile embeddings', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metxt-seed-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  runSeed(dataDir);

  const dbPath = path.join(dataDir, 'metxt.db');
  const staleDescriptor = Buffer.from(new Float32Array(128).buffer);
  const db = new Database(dbPath);
  db.prepare('UPDATE embeddings SET embedding = ? WHERE profile_id = ?').run(staleDescriptor, PROFILE_ID);
  db.prepare('INSERT INTO embeddings (profile_id, embedding, photo_hash) VALUES (?, ?, ?)')
    .run(PROFILE_ID, staleDescriptor, 'stale-extra');
  db.close();

  const output = runSeed(dataDir);
  assert.match(output, /Refreshed demo profile "me_vin01"/);

  const refreshed = new Database(dbPath, { readonly: true });
  const rows = refreshed
    .prepare('SELECT embedding, photo_hash FROM embeddings WHERE profile_id = ? ORDER BY photo_hash')
    .all(PROFILE_ID);
  refreshed.close();

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map(row => row.photo_hash).sort(),
    [fixtureHash('seed-tms.jpg'), fixtureHash('seed-wikimedia.jpg')].sort(),
  );
  assert.ok(rows.every(row => vectorNorm(row.embedding) > 0.01), 'refreshed descriptors should not remain stale zero vectors');
});
