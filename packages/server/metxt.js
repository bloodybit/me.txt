const USE_TYPES = ['editorial', 'commercial', 'ai_training', 'satire'];

function generateMeTxt(profile, rules, opts = {}) {
  const baseUrl = opts.baseUrl || '';
  const ruleMap = new Map(rules.map(r => [r.use_type, r.permission]));

  const lines = [];
  lines.push('# me.txt v0.1');
  lines.push('# Human Likeness Consent Registry');
  lines.push('');
  lines.push(`Identity: ${profile.name}`);
  lines.push(`ID: ${profile.id}`);
  lines.push('');
  lines.push('Likeness-Face: registered');
  lines.push('Likeness-Voice: not-registered');
  lines.push('');
  lines.push('Default-Permission: deny');
  lines.push('');
  for (const useType of USE_TYPES) {
    const permission = ruleMap.get(useType) || 'deny';
    const directive = permission === 'allow' ? 'Allow' : 'Deny';
    const formatted = useType.replace(/_/g, '-');
    lines.push(`${directive}: ${formatted}`);
  }
  lines.push('');
  lines.push(`Match-Endpoint: ${baseUrl}/api/match`);
  lines.push(`Profile: ${baseUrl}/api/profile/${profile.id}`);
  lines.push('');
  lines.push(`Updated: ${new Date().toISOString()}`);
  return lines.join('\n') + '\n';
}

module.exports = { generateMeTxt, USE_TYPES };
