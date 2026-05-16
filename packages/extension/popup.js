const DEFAULT_API = 'http://localhost:3000';

const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const dashLink = document.getElementById('open-dashboard');
const tabTitleEl = document.getElementById('tab-title');
const tabUrlEl = document.getElementById('tab-url');

let apiUrl = DEFAULT_API;
let activeTab = null;

chrome.storage.local.get(['apiUrl'], data => {
  if (data.apiUrl) apiUrl = data.apiUrl;
  dashLink.href = apiUrl + '/#dashboard';
});

dashLink.href = DEFAULT_API + '/#dashboard';
dashLink.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: apiUrl.replace(/\/$/, '') + '/#dashboard' });
});

function isScannable(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

async function loadActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    if (!tab) {
      tabTitleEl.textContent = 'No active tab';
      tabUrlEl.textContent = '—';
      scanBtn.disabled = true;
      return;
    }
    tabTitleEl.textContent = tab.title || '(untitled page)';
    tabUrlEl.textContent = tab.url || '—';
    if (!isScannable(tab.url)) {
      scanBtn.disabled = true;
      setStatus('This page cannot be scanned (only http/https pages are supported).', '');
    } else {
      scanBtn.disabled = false;
    }
  } catch (err) {
    tabTitleEl.textContent = 'Unable to read active tab';
    tabUrlEl.textContent = '—';
    scanBtn.disabled = true;
  }
}

loadActiveTab();

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cls;
}

function renderResults(results) {
  resultsEl.innerHTML = '';
  if (!results || results.length === 0) {
    setStatus('No images found on this page.', '');
    return;
  }
  const matches = results.filter(r => r.match);
  const failures = results.filter(r => r.error || r.verdict === 'FETCH_FAILED');
  const misses = results.filter(r => !r.match && !r.error && r.verdict !== 'FETCH_FAILED');
  if (matches.length === 0) {
    const failedText = failures.length ? ', ' + failures.length + ' failed' : '';
    setStatus('Scanned ' + results.length + ' image(s): ' + misses.length + ' no match' + failedText + '.', failures.length ? 'error' : 'success');
  } else {
    setStatus('Found ' + matches.length + ' registered likeness(es) across ' + results.length + ' scanned image(s).', 'error');
  }

  results.forEach(r => {
    const row = document.createElement('div');
    row.className = 'result-row ' + (r.match ? 'match' : r.error ? 'failed' : 'miss');
    const conf = r.match && r.match.confidence != null
      ? (r.match.confidence * 100).toFixed(1) + '%'
      : 'n/a';
    const faces = r.faces_detected != null ? ' &middot; Faces: ' + escapeHtml(r.faces_detected) : '';
    const sourceType = r.sourceType ? ' &middot; Source: ' + escapeHtml(r.sourceType) : '';

    if (r.match) {
      const evidence = r.evidence || {};
      const source = evidence.source || {};
      const intel = evidence.source_intelligence || {};
      const risk = evidence.risk || {};
      const contacts = intel.contacts || {};
      const contact = contacts.emails && contacts.emails.length ? contacts.emails[0] : null;
      const evidenceLink = r.takedown && r.takedown.evidence_url ? r.takedown.evidence_url : '';
      const sourceMeta = source.domain ? '<div class="meta">Source: ' + escapeHtml(source.domain) + ' &middot; Risk: ' + escapeHtml(risk.level || 'unknown') + '</div>' : '';
      const contactMeta = contact ? '<div class="meta">Contact: ' + escapeHtml(contact) + '</div>' : '';
      row.innerHTML =
        '<div class="top">' +
          '<span class="name">' + escapeHtml(r.match.name || 'Unknown') + '</span>' +
          '<span class="badge">' + escapeHtml(r.verdict) + '</span>' +
        '</div>' +
        '<div class="meta">Confidence: ' + conf + faces + sourceType + ' &middot; ' + escapeHtml(r.match.profile_id || '') + '</div>' +
        sourceMeta +
        contactMeta +
        '<div class="meta">' + escapeHtml(r.imageUrl || '') + '</div>' +
        (evidenceLink ? '<button class="packet-link" data-url="' + escapeHtml(evidenceLink) + '">Open evidence packet</button>' : '');
    } else if (r.error) {
      row.innerHTML =
        '<div class="top">' +
          '<span class="name">Image fetch failed</span>' +
          '<span class="badge warn">SKIPPED</span>' +
        '</div>' +
        '<div class="meta">' + escapeHtml(r.error) + sourceType + '</div>' +
        '<div class="meta">' + escapeHtml(r.imageUrl || '') + '</div>';
    } else {
      row.innerHTML =
        '<div class="top">' +
          '<span class="name">No registered match</span>' +
          '<span class="badge ok">' + escapeHtml(r.verdict || 'NO_MATCH') + '</span>' +
        '</div>' +
        '<div class="meta">Confidence: ' + conf + faces + sourceType + '</div>' +
        '<div class="meta">' + escapeHtml(r.imageUrl || '') + '</div>';
    }
    resultsEl.appendChild(row);
  });
  resultsEl.querySelectorAll('[data-url]').forEach(btn => {
    btn.addEventListener('click', () => chrome.tabs.create({ url: btn.dataset.url }));
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

scanBtn.addEventListener('click', async () => {
  const endpoint = (apiUrl || DEFAULT_API).replace(/\/$/, '');

  scanBtn.disabled = true;
  setStatus('Scanning page…', '');
  resultsEl.innerHTML = '';

  try {
    const tab = activeTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab || !tab.id) throw new Error('No active tab');
    if (!isScannable(tab.url)) throw new Error('This page cannot be scanned.');

    const resp = await chrome.runtime.sendMessage({
      type: 'SCAN_TAB',
      tabId: tab.id,
      apiUrl: endpoint,
    });

    if (!resp || !resp.ok) {
      throw new Error((resp && resp.error) || 'Scan failed');
    }
    renderResults(resp.results || []);
  } catch (err) {
    setStatus(err.message || 'Scan failed.', 'error');
  } finally {
    scanBtn.disabled = false;
  }
});
