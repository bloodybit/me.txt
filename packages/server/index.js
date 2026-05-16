const express = require('express');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cors = require('cors');
const multer = require('multer');

require('./env').loadEnv();

const {
  initDb,
  createProfile,
  addEmbedding,
  getAllEmbeddings,
  getProfile,
  getProfileByHandle,
  listProfiles,
  updateConsent,
  getConsentRules,
  logQuery,
  getAuditLog,
  saveEvidencePacket,
  getEvidencePacket,
  getEvidencePackets,
} = require('./db');
const { initFace, getDescriptor, getDescriptors, matchDescriptors } = require('./face');
const { generateMeTxt, USE_TYPES } = require('./metxt');
const { buildEvidencePacket } = require('./evidence');
const hog = require('./hog');
const { searchImage } = require('../image-search-lab');

const app = express();
const PORT = process.env.PORT || 3000;
const MATCH_THRESHOLD = parseFloat(process.env.MATCH_THRESHOLD || '0.6');

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

initDb();
initFace().catch(err => console.warn('[face] init failed:', err.message));

function newProfileId() {
  return 'me_' + crypto.randomBytes(4).toString('hex').slice(0, 7);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function scanRequestContext(req) {
  return {
    sourceUrl: req.body.source_url || req.query.source_url || null,
    useType: req.body.use_type || req.query.use_type || null,
  };
}

function logScanStart({ sourceUrl, useType }) {
  console.log(
    `[scan] request source=${sourceUrl || 'unknown'} use_type=${useType || 'unspecified'}`
  );
}

function logScan({ sourceUrl, useType, imageHash, verdict, match }) {
  const matched = match
    ? `${match.profile_id} confidence=${match.confidence.toFixed(4)}`
    : 'none';
  console.log(
    `[scan] verdict=${verdict} source=${sourceUrl || 'unknown'} use_type=${useType || 'unspecified'} image=sha256:${imageHash.slice(0, 12)} match=${matched}`
  );
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

async function createEvidenceForMatch(req, {
  profile,
  match,
  sourceUrl,
  useType,
  imageHash,
  verdict,
  applicableRule,
}) {
  const evidence = await buildEvidencePacket({
    baseUrl: baseUrl(req),
    profile,
    match,
    sourceUrl,
    useType,
    imageHash,
    verdict,
    applicableRule,
  });
  saveEvidencePacket(evidence);
  return evidence;
}

async function bufferFromBody(req) {
  if (req.file) return req.file.buffer;
  if (req.body && req.body.image_base64) {
    const stripped = req.body.image_base64.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(stripped, 'base64');
  }
  if (req.body && req.body.image_url) {
    const resp = await fetch(req.body.image_url);
    if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  }
  return null;
}

app.post('/api/register', upload.array('photos', 5), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const photos = req.files || [];
    if (photos.length === 0) {
      return res.status(400).json({ error: 'at least one photo is required' });
    }

    let consent = {};
    try {
      consent = typeof req.body.consent === 'string'
        ? JSON.parse(req.body.consent)
        : (req.body.consent || {});
    } catch {
      consent = {};
    }

    const profileId = newProfileId();
    createProfile(profileId, name);

    for (const photo of photos) {
      const descriptor = await getDescriptor(photo.buffer);
      addEmbedding(profileId, descriptor, sha256(photo.buffer));
    }

    for (const useType of USE_TYPES) {
      const allowed = consent[useType] === true || consent[useType] === 'allow';
      updateConsent(profileId, useType, allowed ? 'allow' : 'deny');
    }

    const profile = getProfile(profileId);
    const rules = getConsentRules(profileId);
    res.json({
      profile_id: profileId,
      profile,
      consent: rules,
      metxt: generateMeTxt(profile, rules, { baseUrl: baseUrl(req) }),
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/match', upload.single('image'), async (req, res) => {
  const { sourceUrl, useType } = scanRequestContext(req);
  logScanStart({ sourceUrl, useType });

  try {
    const buffer = await bufferFromBody(req);
    if (!buffer) {
      return res.status(400).json({
        error: 'image required (multipart "image", json image_base64, or json image_url)',
      });
    }

    const descriptors = await getDescriptors(buffer);
    const stored = getAllEmbeddings();
    const match = matchDescriptors(descriptors, stored, MATCH_THRESHOLD);

    const imageHash = sha256(buffer);

    if (!match) {
      logScan({ sourceUrl, useType, imageHash, verdict: 'NO_MATCH', match: null });
      return res.json({
        verdict: 'NO_MATCH',
        match: null,
        faces_detected: descriptors.length,
        source: {
          url: sourceUrl,
          image_hash: 'sha256:' + imageHash,
          scanned_at: new Date().toISOString(),
        },
      });
    }

    const profile = getProfile(match.profile_id);
    const rules = getConsentRules(match.profile_id);
    const matchedRule = useType ? rules.find(r => r.use_type === useType) : null;
    const applicable = matchedRule ? matchedRule.permission : null;
    const verdict = applicable === 'allow' ? 'ALLOWED' : 'AI_STOP';

    let evidence = null;
    if (verdict === 'AI_STOP') {
      evidence = await createEvidenceForMatch(req, {
        profile,
        match,
        sourceUrl,
        useType,
        imageHash,
        verdict,
        applicableRule: applicable,
      });
    }

    logScan({ sourceUrl, useType, imageHash, verdict, match });
    logQuery(match.profile_id, sourceUrl, match.confidence, verdict, evidence ? evidence.id : null);

    res.json({
      verdict,
      match: {
        name: profile.name,
        profile_id: match.profile_id,
        confidence: Number(match.confidence.toFixed(4)),
        face_index: match.descriptor_index,
      },
      faces_detected: descriptors.length,
      consent: {
        default: 'deny',
        applicable_rule: applicable,
      },
      source: {
        url: sourceUrl,
        image_hash: 'sha256:' + imageHash,
        scanned_at: new Date().toISOString(),
      },
      takedown: {
        notice: 'This content contains a registered likeness used without consent. The subject has opted out of AI-generated reproductions via the me.txt protocol.',
        profile_url: `${baseUrl(req)}/api/profile/${match.profile_id}`,
        evidence_url: evidence ? `${baseUrl(req)}/api/evidence/${evidence.id}` : null,
        metxt_url: `${baseUrl(req)}/${profile.handle}/me.txt`,
      },
      evidence,
    });
  } catch (err) {
    console.error(`[scan] error source=${sourceUrl || 'unknown'} use_type=${useType || 'unspecified'}:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hello', (req, res) => {
  res.json({ message: 'hello world' });
});

app.get('/api/hog/status', (req, res) => {
  res.json(hog.status());
});

app.post('/api/image-search', async (req, res) => {
  try {
    const query = String((req.body && req.body.query) || '').trim();
    const provider = String((req.body && req.body.provider) || 'ddg').trim();
    const imageDataUri = String(
      (req.body && (req.body.image_data_uri || req.body.imageDataUri || req.body.input)) || ''
    ).trim();
    const limit = Math.min(Math.max(parseInt(req.body && req.body.limit, 10) || 8, 1), 20);
    const score = !(req.body && req.body.score === false);

    if (!query) return res.status(400).json({ error: 'query is required' });
    if (!imageDataUri) return res.status(400).json({ error: 'image_data_uri is required' });
    if (!['ddg', 'brave'].includes(provider)) {
      return res.status(400).json({ error: 'provider must be ddg or brave' });
    }

    const runId = crypto.randomBytes(6).toString('hex');
    const result = await searchImage({
      query,
      provider,
      input: imageDataUri,
      limit,
      score,
      out: path.join(os.tmpdir(), 'metxt-image-search-lab', runId),
    });

    res.json({
      query: result.query,
      provider: result.provider,
      scoring: {
        enabled: result.scoring.enabled,
        method: result.scoring.method,
        error: result.scoring.error || null,
      },
      results: result.results.map(item => ({
        rank: item.rank,
        title: item.title,
        pageUrl: item.pageUrl,
        imageUrl: item.imageUrl,
        thumbnailUrl: item.thumbnailUrl,
        width: item.width,
        height: item.height,
        source: item.source,
        similarity: item.similarity,
        error: item.error,
      })),
    });
  } catch (err) {
    console.error('[image-search]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/evidence', (req, res) => {
  const profileId = req.query.profile_id || null;
  res.json(getEvidencePackets(profileId, parseInt(req.query.limit, 10) || 20));
});

app.get('/api/evidence/:id', (req, res) => {
  const evidence = getEvidencePacket(req.params.id);
  if (!evidence) return res.status(404).json({ error: 'evidence not found' });
  res.json(evidence);
});

app.get('/api/profile/:id', (req, res) => {
  const profile = getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'profile not found' });
  res.json({ profile, consent: getConsentRules(profile.id) });
});

app.get('/api/profiles', (req, res) => {
  res.json(listProfiles());
});

app.patch('/api/consent', (req, res) => {
  const { profile_id, use_type, permission } = req.body || {};
  if (!profile_id || !use_type || !permission) {
    return res.status(400).json({ error: 'profile_id, use_type, permission required' });
  }
  if (!['allow', 'deny'].includes(permission)) {
    return res.status(400).json({ error: 'permission must be allow or deny' });
  }
  if (!getProfile(profile_id)) return res.status(404).json({ error: 'profile not found' });
  updateConsent(profile_id, use_type, permission);
  res.json({ ok: true, consent: getConsentRules(profile_id) });
});

app.get('/api/audit-log', (req, res) => {
  const profileId = req.query.profile_id || null;
  res.json(getAuditLog(profileId, parseInt(req.query.limit, 10) || 50));
});

const RESERVED_HANDLES = new Set(['api', 'app.js', 'style.css', 'index.html', 'demo-face.svg', 'test-page.html', 'favicon.ico', '.well-known']);

app.get('/:handle/me.txt', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  const handle = req.params.handle;
  if (RESERVED_HANDLES.has(handle)) return res.status(404).send('# me.txt: not found\n');
  const profile = getProfileByHandle(handle);
  if (!profile) return res.status(404).send('# me.txt: not found\n');
  const rules = getConsentRules(profile.id);
  res.send(generateMeTxt(profile, rules, { baseUrl: baseUrl(req) }));
});

app.use(express.static(path.join(__dirname, '..', 'web')));

app.listen(PORT, () => {
  console.log(`me.txt server running on http://localhost:${PORT}`);
  console.log('[scan] logging enabled for POST /api/match');
});
