const DEFAULT_BASE_URL = 'https://developer.thehog.ai';

const DEFAULT_FIELDS = [
  'profile.name',
  'profile.headline',
  'profile.location',
  'contact.email',
  'contact.phone',
  'company.name',
  'company.domain',
  'company.linkedin_url',
  'company.description',
  'social.linkedin_url',
  'research.summary',
];

function getConfig() {
  return {
    baseUrl: (process.env.HOG_API_BASE_URL || process.env.THEHOG_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    accessKey: process.env.HOG_ACCESS_KEY || process.env.THEHOG_ACCESS_KEY || process.env.THE_HOG_ACCESS_KEY || '',
    secretKey: process.env.HOG_SECRET_KEY || process.env.THEHOG_SECRET_KEY || process.env.THE_HOG_SECRET_KEY || '',
    fields: parseFields(process.env.HOG_FIELDS),
  };
}

function parseFields(value) {
  if (!value) return DEFAULT_FIELDS;
  return value
    .split(',')
    .map(field => field.trim())
    .filter(Boolean);
}

function status() {
  const config = getConfig();
  return {
    provider: 'thehog',
    base_url: config.baseUrl,
    configured: Boolean(config.accessKey && config.secretKey),
    required_env: ['HOG_ACCESS_KEY', 'HOG_SECRET_KEY'],
  };
}

function buildIdentifier(sourceUrl) {
  const queryIdentifier = { query: sourceUrl || 'unknown source' };
  if (!sourceUrl) return queryIdentifier;

  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const cleanUrl = `${url.origin}${url.pathname}`.replace(/\/$/, '');

    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
      if (url.pathname.startsWith('/in/')) return { linkedin_url: cleanUrl };
      if (url.pathname.startsWith('/company/')) return { linkedin_company_url: cleanUrl };
    }

    return {
      website_url: url.origin,
      domain: host,
    };
  } catch {
    return queryIdentifier;
  }
}

async function enrichSource(sourceUrl) {
  const config = getConfig();
  const identifier = buildIdentifier(sourceUrl);

  if (!config.accessKey || !config.secretKey) {
    return {
      provider: 'thehog',
      status: 'not_configured',
      identifier,
      message: 'Set HOG_ACCESS_KEY and HOG_SECRET_KEY to enable live The Hog enrichment.',
      result: null,
    };
  }

  const body = {
    identifier,
    fields: config.fields,
  };

  try {
    const initial = await hogFetch(config, '/api/enrichments', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const result = await resolveEnrichment(config, initial);
    return {
      provider: 'thehog',
      status: 'enriched',
      identifier,
      requested_fields: config.fields,
      result: compactResult(result),
    };
  } catch (err) {
    return {
      provider: 'thehog',
      status: 'error',
      identifier,
      message: err.message,
      result: null,
    };
  }
}

async function hogFetch(config, path, init = {}) {
  const resp = await fetch(config.baseUrl + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Key': config.accessKey,
      'X-Secret-Key': config.secretKey,
      ...(init.headers || {}),
    },
  });

  const text = await resp.text();
  const data = parseJson(text);

  if (!resp.ok) {
    const detail = data && (data.message || data.error)
      ? `${data.message || data.error}`
      : text.slice(0, 240);
    throw new Error(`The Hog API ${resp.status}${detail ? ': ' + detail : ''}`);
  }

  return data || {};
}

async function resolveEnrichment(config, initial) {
  const id = initial.id || initial.enrichment_id || initial.request_id;
  const state = String(initial.status || initial.state || '').toLowerCase();
  if (!id || (state && !['pending', 'queued', 'processing', 'running'].includes(state))) {
    return initial;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(700 + attempt * 500);
    const next = await hogFetch(config, `/api/enrichments/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    const nextState = String(next.status || next.state || '').toLowerCase();
    if (!['pending', 'queued', 'processing', 'running'].includes(nextState)) return next;
  }

  return initial;
}

function compactResult(data) {
  const root = data && typeof data === 'object' ? data : {};
  const person = pickObject(root, ['person', 'profile', 'lead', 'contact']);
  const company = pickObject(root, ['company', 'organization', 'account']);
  const research = pickObject(root, ['research', 'deep_research', 'summary']);

  return {
    id: root.id || root.enrichment_id || root.request_id || null,
    status: root.status || root.state || null,
    person: compactObject(person),
    company: compactObject(company),
    research: compactObject(research),
    summary: findFirstString(root, ['summary', 'description', 'bio', 'headline']),
    contacts: collectContacts(root),
    links: collectLinks(root),
    raw_preview: JSON.stringify(root).slice(0, 2400),
  };
}

function pickObject(root, keys) {
  for (const key of keys) {
    const value = root && root[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

function compactObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

function findFirstString(root, keys) {
  for (const key of keys) {
    const value = root && root[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function collectContacts(root) {
  const emails = new Set();
  const phones = new Set();
  walk(root, value => {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
      emails.add(match[0]);
    }
    for (const match of value.matchAll(/\+?[0-9][0-9().\-\s]{7,}[0-9]/g)) {
      phones.add(match[0].replace(/\s+/g, ' ').trim());
    }
  });
  return {
    emails: Array.from(emails).slice(0, 5),
    phones: Array.from(phones).slice(0, 5),
  };
}

function collectLinks(root) {
  const links = new Set();
  walk(root, value => {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      links.add(match[0].replace(/[),.;]+$/, ''));
    }
  });
  return Array.from(links).slice(0, 8);
}

function walk(value, visit, depth = 0) {
  if (depth > 5 || value == null) return;
  visit(value);
  if (Array.isArray(value)) {
    value.slice(0, 30).forEach(item => walk(item, visit, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).slice(0, 60).forEach(item => walk(item, visit, depth + 1));
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  DEFAULT_FIELDS,
  buildIdentifier,
  enrichSource,
  status,
};
