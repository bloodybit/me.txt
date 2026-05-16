const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const multer = require('multer');

const {
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
} = require('./db');
const { initFace, getDescriptor, matchDescriptor } = require('./face');
const { generateMeTxt, USE_TYPES } = require('./metxt');

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

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
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
  try {
    const buffer = await bufferFromBody(req);
    if (!buffer) {
      return res.status(400).json({
        error: 'image required (multipart "image", json image_base64, or json image_url)',
      });
    }

    const descriptor = await getDescriptor(buffer);
    const stored = getAllEmbeddings();
    const match = matchDescriptor(descriptor, stored, MATCH_THRESHOLD);

    const sourceUrl = req.body.source_url || req.query.source_url || null;
    const useType = req.body.use_type || req.query.use_type || null;
    const imageHash = sha256(buffer);

    if (!match) {
      return res.json({
        verdict: 'NO_MATCH',
        match: null,
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

    logQuery(match.profile_id, sourceUrl, match.confidence, verdict);

    res.json({
      verdict,
      match: {
        name: profile.name,
        profile_id: match.profile_id,
        confidence: Number(match.confidence.toFixed(4)),
      },
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
        metxt_url: `${baseUrl(req)}/.well-known/me.txt?id=${match.profile_id}`,
      },
    });
  } catch (err) {
    console.error('[match]', err);
    res.status(500).json({ error: err.message });
  }
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

app.get('/.well-known/me.txt', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  const id = req.query.id;
  const profile = id ? getProfile(id) : null;
  if (!profile) {
    const all = listProfiles();
    if (all.length === 0) {
      return res.send('# me.txt v0.1\n# Human Likeness Consent Registry\n# No profiles registered yet.\n');
    }
    const first = all[0];
    const rules = getConsentRules(first.id);
    return res.send(generateMeTxt(first, rules, { baseUrl: baseUrl(req) }));
  }
  const rules = getConsentRules(profile.id);
  res.send(generateMeTxt(profile, rules, { baseUrl: baseUrl(req) }));
});

app.use(express.static(path.join(__dirname, '..', 'web')));

app.listen(PORT, () => {
  console.log(`me.txt server running on http://localhost:${PORT}`);
});
