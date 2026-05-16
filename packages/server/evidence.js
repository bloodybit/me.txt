const crypto = require('crypto');

const { enrichSource } = require('./hog');

function newEvidenceId() {
  return 'ev_' + crypto.randomBytes(5).toString('hex');
}

async function buildEvidencePacket({
  baseUrl,
  profile,
  match,
  sourceUrl,
  useType,
  imageHash,
  verdict,
  applicableRule,
}) {
  const createdAt = new Date().toISOString();
  const sourceIntel = await buildSourceIntelligence(sourceUrl);
  const risk = scoreRisk({ verdict, useType, applicableRule, sourceIntel });

  const packet = {
    id: newEvidenceId(),
    created_at: createdAt,
    verdict,
    subject: {
      name: profile.name,
      profile_id: profile.id,
      confidence: Number((match.confidence || 0).toFixed(4)),
      profile_url: `${baseUrl}/api/profile/${profile.id}`,
      metxt_url: profile.handle ? `${baseUrl}/${profile.handle}/me.txt` : null,
    },
    consent: {
      use_type: useType || 'unspecified',
      default_permission: 'deny',
      applicable_rule: applicableRule || null,
      finding: applicableRule === 'allow'
        ? 'The matched use has explicit consent.'
        : 'No matching allow rule was found in the subject me.txt profile.',
    },
    source: {
      url: sourceUrl || null,
      domain: domainFromUrl(sourceUrl),
      image_hash: imageHash ? 'sha256:' + imageHash : null,
      scanned_at: createdAt,
    },
    source_intelligence: sourceIntel,
    risk,
    recommended_actions: buildActions({ profile, sourceUrl, useType, risk, sourceIntel }),
  };

  const takedown = packet.recommended_actions.find(action => action.type === 'takedown');
  packet.takedown_notice = takedown ? takedown.body : null;
  return packet;
}

async function buildSourceIntelligence(sourceUrl) {
  const hog = await enrichSource(sourceUrl);
  const result = hog.result || {};
  const contacts = result.contacts || {};
  const summary = result.summary || null;

  return {
    provider: 'thehog',
    provider_status: hog.status,
    provider_message: hog.message || null,
    identifier: hog.identifier,
    summary,
    category: classifySource(sourceUrl, summary),
    company: result.company || null,
    person: result.person || null,
    contacts: {
      emails: contacts.emails || [],
      phones: contacts.phones || [],
    },
    links: result.links || [],
    raw_preview: result.raw_preview || null,
  };
}

function scoreRisk({ verdict, useType, applicableRule, sourceIntel }) {
  let score = verdict === 'AI_STOP' ? 55 : 20;
  const reasons = [];

  if (verdict === 'AI_STOP') reasons.push('registered likeness matched without an allow rule');
  if (useType === 'commercial') {
    score += 18;
    reasons.push('commercial context increases licensing and publicity-rights risk');
  }
  if (useType === 'ai_training') {
    score += 22;
    reasons.push('AI training use is explicitly sensitive');
  }
  if (!applicableRule) {
    score += 8;
    reasons.push('use type was not explicitly allowed');
  }
  if (sourceIntel.provider_status === 'enriched') {
    score += 8;
    reasons.push('The Hog returned source intelligence for follow-up');
  }
  if (sourceIntel.contacts && sourceIntel.contacts.emails && sourceIntel.contacts.emails.length) {
    score += 5;
    reasons.push('contact route is available for enforcement');
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    level: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
    reasons,
  };
}

function buildActions({ profile, sourceUrl, useType, risk, sourceIntel }) {
  const contact = sourceIntel.contacts && sourceIntel.contacts.emails && sourceIntel.contacts.emails[0]
    ? sourceIntel.contacts.emails[0]
    : null;

  if (!contact) {
    return [{
      type: 'enrich_source',
      label: 'Identify source contact',
      target: null,
      body: 'No verified contact is available. Configure The Hog API credentials or use a source that returns contact intelligence before generating a takedown notice.',
    }];
  }

  const body = [
    `To: ${contact}`,
    `Subject: Unauthorized likeness use for ${profile.name}`,
    '',
    `We detected a registered likeness for ${profile.name} on ${sourceUrl || 'your page'}.`,
    `The subject's me.txt profile does not allow ${useType || 'this'} use, and the match was classified as ${risk.level} risk.`,
    '',
    'Please remove the content, provide proof of consent, or contact the subject to negotiate a license.',
  ].join('\n');

  return [
    {
      type: 'takedown',
      label: 'Send takedown notice',
      target: contact,
      body,
    },
    {
      type: 'license',
      label: 'Offer licensing path',
      target: contact,
      body: body.replace('Please remove the content, provide proof of consent, or contact the subject to negotiate a license.', 'If you want to keep using this likeness, reply with the intended use, duration, distribution, and compensation offer.'),
    },
  ];
}

function classifySource(sourceUrl, summary) {
  const text = `${sourceUrl || ''} ${summary || ''}`.toLowerCase();
  if (text.includes('linkedin.com')) return 'professional network';
  if (text.includes('reddit.com') || text.includes('forum')) return 'community discussion';
  if (text.includes('ai') || text.includes('synthetic') || text.includes('generated')) return 'synthetic media';
  if (text.includes('shop') || text.includes('pricing') || text.includes('buy')) return 'commercial page';
  return 'web source';
}

function domainFromUrl(sourceUrl) {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

module.exports = {
  buildEvidencePacket,
};
