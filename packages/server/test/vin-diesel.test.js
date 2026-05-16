const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { initFace, getDescriptor, matchDescriptor, matchDescriptors } = require('../face');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'vin-diesel');
const SEED_FIXTURES = [
  'seed-wikimedia.jpg',
  'seed-tms.jpg',
];

const PROBE_FIXTURE = 'probe-youtube.jpg';

const PROFILE_ID = 'me_vin01';
const MATCH_THRESHOLD = 0.6;

function unitDescriptor(position) {
  return Array.from({ length: 128 }, (_, index) => index === position ? 1 : 0);
}

function readFixture(fileName) {
  return fs.readFileSync(path.join(FIXTURE_DIR, fileName));
}

function hasFaceApiModels() {
  const modelDir = path.join(__dirname, '..', 'models');
  if (!fs.existsSync(modelDir)) return false;
  return fs.readdirSync(modelDir).some(f => f.includes('manifest'));
}

test('recognizes Vin Diesel from an unseen photo against seeded embeddings', async (t) => {
  if (!hasFaceApiModels()) {
    t.skip('face-api model weights not present in packages/server/models — see models/.gitkeep');
    return;
  }

  const loaded = await initFace();
  assert.equal(loaded, true, 'face-api models should load successfully');

  const stored = [];
  for (const fixture of SEED_FIXTURES) {
    const buffer = readFixture(fixture);
    const descriptor = await getDescriptor(buffer);
    assert.equal(descriptor.length, 128, `descriptor for seed ${fixture} should be 128-d`);
    stored.push({ profile_id: PROFILE_ID, descriptor });
  }

  const probeBuffer = readFixture(PROBE_FIXTURE);
  const probeDescriptor = await getDescriptor(probeBuffer);
  assert.equal(probeDescriptor.length, 128, 'probe descriptor should be 128-d');

  const match = matchDescriptor(probeDescriptor, stored, MATCH_THRESHOLD);

  assert.ok(match, `expected a match against the seeded Vin Diesel embeddings (threshold ${MATCH_THRESHOLD})`);
  assert.equal(match.profile_id, PROFILE_ID, 'matched profile should be the seeded Vin Diesel profile');
  assert.ok(
    match.confidence > MATCH_THRESHOLD,
    `confidence ${match.confidence} should exceed threshold ${MATCH_THRESHOLD}`,
  );
});

test('matches a registered face when it is not the first detected face', () => {
  const stored = [
    { profile_id: PROFILE_ID, descriptor: unitDescriptor(42) },
  ];

  const match = matchDescriptors(
    [
      unitDescriptor(7),
      unitDescriptor(42),
    ],
    stored,
    0.9,
  );

  assert.ok(match, 'expected the second detected face to match the registered profile');
  assert.equal(match.profile_id, PROFILE_ID);
  assert.equal(match.descriptor_index, 1);
  assert.equal(match.confidence, 1);
});
