const DEFAULT_API = 'http://localhost:3000';

const apiInput = document.getElementById('api-url');
const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const dashLink = document.getElementById('open-dashboard');

chrome.storage.local.get(['apiUrl'], data => {
  if (data.apiUrl) apiInput.value = data.apiUrl;
});

apiInput.addEventListener('change', () => {
  chrome.storage.local.set({ apiUrl: apiInput.value.trim() });
  dashLink.href = apiInput.value.trim();
});

dashLink.href = apiInput.value.trim() || DEFAULT_API;
dashLink.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: (apiInput.value.trim() || DEFAULT_API) + '/#dashboard' });
});

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
  if (matches.length === 0) {
    setStatus('Scanned ' + results.length + ' image(s). No registered likenesses detected.', 'success');
  } else {
    setStatus('Found ' + matches.length + ' registered likeness(es).', 'error');
  }
  matches.forEach(r => {
    const row = document.createElement('div');
    row.className = 'result-row match';
    const conf = r.match.confidence != null
      ? (r.match.confidence * 100).toFixed(1) + '%'
      : 'n/a';
    row.innerHTML =
      '<div class="top">' +
        '<span class="name">' + escapeHtml(r.match.name || 'Unknown') + '</span>' +
        '<span class="badge">' + escapeHtml(r.verdict) + '</span>' +
      '</div>' +
      '<div class="meta">Confidence: ' + conf + ' &middot; ' + escapeHtml(r.match.profile_id || '') + '</div>' +
      '<div class="meta">' + escapeHtml(r.imageUrl || '') + '</div>';
    resultsEl.appendChild(row);
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
  const apiUrl = (apiInput.value || DEFAULT_API).replace(/\/$/, '');
  chrome.storage.local.set({ apiUrl });

  scanBtn.disabled = true;
  setStatus('Scanning page…', '');
  resultsEl.innerHTML = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab');

    const resp = await chrome.runtime.sendMessage({
      type: 'SCAN_TAB',
      tabId: tab.id,
      apiUrl,
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
