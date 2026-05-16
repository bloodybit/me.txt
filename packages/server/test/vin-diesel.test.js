const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { initFace, getDescriptor, matchDescriptor } = require('../face');

const SEED_URLS = [
  'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwj2m3QXkw69XTStiRWEZhwjZD3OwQenjmHtw2W5ntvi-tRGn1-9YMpdJXNt46Xa8COv_LPOXxEbTsxVfpNP5s8eeni1StZsG8KOoM6O4&s=10',
  'https://upload.wikimedia.org/wikipedia/commons/8/83/Vin_Diesel_by_Gage_Skidmore_2.jpg?utm_source=en.wikipedia.org&utm_campaign=index&utm_content=original',
  'https://ntvb.tmsimg.com/assets/assets/79719_v9_bc.jpg?w=360&h=480',
];

const PROBE_URL = 'https://i.ytimg.com/vi/PPKrLPInTR0/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLClmeT3qnle0Cqx3ddgiWe2JfZP-A';

const PROFILE_ID = 'me_vin01';
const MATCH_THRESHOLD = 0.6;

async function fetchImage(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'metxt-test/0.1',
      Accept: 'image/jpeg,image/png',
    },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`failed to fetch ${url}: HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
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
  for (const url of SEED_URLS) {
    const buffer = await fetchImage(url);
    const descriptor = await getDescriptor(buffer);
    assert.equal(descriptor.length, 128, `descriptor for seed ${url} should be 128-d`);
    stored.push({ profile_id: PROFILE_ID, descriptor });
  }

  const probeBuffer = await fetchImage(PROBE_URL);
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
