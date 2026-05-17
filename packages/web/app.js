(function () {
  'use strict';

  const STORAGE_KEY = 'metxt_active_profile';
  const USE_TYPES = ['editorial', 'commercial', 'ai_training', 'satire'];

  let activeProfileId = localStorage.getItem(STORAGE_KEY) || null;
  let activeProfileName = null;
  let activeProfileHandle = null;
  let scanCount = 0;

  // ---------- Navigation ----------
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('screen-' + name);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const navBtn = document.querySelector('.nav-link[data-screen-link="' + name + '"]');
    if (navBtn) navBtn.classList.add('active');
    if (name === 'dashboard') refreshDashboard();
    if (name === 'monitor') refreshMonitor();
    if (name === 'browse') refreshBrowse();
  }

  document.querySelectorAll('[data-screen-link]').forEach(el => {
    el.addEventListener('click', () => showScreen(el.dataset.screenLink));
  });

  // ---------- Theme toggle ----------
  const THEME_KEY = 'metxt_theme';
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    });
  }

  // ---------- Photo slots ----------
  document.querySelectorAll('[data-photo-input]').forEach(input => {
    input.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      const slot = input.closest('.photo-slot');
      if (!file || !slot) return;
      slot.classList.add('filled');
      const url = URL.createObjectURL(file);
      let img = slot.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        slot.appendChild(img);
      }
      img.src = url;
    });
  });

  // ---------- Toggles (registration form) ----------
  document.querySelectorAll('#register-form .toggle').forEach(t => {
    t.addEventListener('click', () => t.classList.toggle('on'));
  });

  // ---------- Registration submit ----------
  document.getElementById('register-submit').addEventListener('click', async () => {
    const errEl = document.getElementById('register-error');
    errEl.style.display = 'none';

    const name = document.getElementById('reg-name').value.trim();
    if (!name) {
      showError('Please enter your name.');
      return;
    }

    const photoInputs = document.querySelectorAll('[data-photo-input]');
    const photos = [];
    photoInputs.forEach(inp => {
      if (inp.files && inp.files[0]) photos.push(inp.files[0]);
    });
    if (photos.length === 0) {
      showError('Please upload at least one photo of yourself.');
      return;
    }

    const consent = {};
    document.querySelectorAll('#register-form .toggle').forEach(t => {
      consent[t.dataset.consent] = t.classList.contains('on');
    });

    const btn = document.getElementById('register-submit');
    btn.disabled = true;
    btn.textContent = 'Registering…';

    try {
      const form = new FormData();
      form.append('name', name);
      form.append('consent', JSON.stringify(consent));
      photos.forEach(f => form.append('photos', f, f.name));

      const resp = await fetch('/api/register', { method: 'POST', body: form });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || ('HTTP ' + resp.status));
      }
      const data = await resp.json();
      activeProfileId = data.profile_id;
      activeProfileName = data.profile.name;
      activeProfileHandle = data.profile.handle || null;
      localStorage.setItem(STORAGE_KEY, activeProfileId);

      renderMetxtPreview('metxt-output', data.metxt);
      document.getElementById('register-form').style.display = 'none';
      document.getElementById('register-success').style.display = 'block';
      document.getElementById('match-name').textContent = data.profile.name;
      document.getElementById('match-profile').textContent = data.profile_id;
    } catch (err) {
      showError(err.message || 'Registration failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register & Generate me.txt';
    }
  });

  function showError(msg) {
    const errEl = document.getElementById('register-error');
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }

  function renderMetxtPreview(elId, text) {
    const el = document.getElementById(elId);
    el.innerHTML = colorizeMetxt(text);
  }

  function colorizeMetxt(text) {
    return text
      .split('\n')
      .map(line => {
        if (line.startsWith('#')) return '<span class="comment">' + esc(line) + '</span>';
        if (line.startsWith('Allow:')) return '<span class="allow">Allow:</span>' + esc(line.slice(6));
        if (line.startsWith('Deny:')) return '<span class="deny">Deny:</span>' + esc(line.slice(5));
        const m = line.match(/^([A-Za-z-]+):(.*)$/);
        if (m) return '<span class="key">' + esc(m[1]) + ':</span>' + esc(m[2]);
        return esc(line);
      })
      .join('\n');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- Scan (simulated) ----------
  const scanBtn = document.getElementById('scan-btn');
  scanBtn.addEventListener('click', doScan);

  function doScan() {
    scanBtn.disabled = true;
    scanBtn.innerHTML = '&#9208; Scanning...';

    document.getElementById('scan-placeholder').style.display = 'none';
    document.getElementById('fake-page').style.display = 'block';
    document.getElementById('detect-box').style.display = 'none';
    document.getElementById('detect-box').classList.remove('alert');
    document.getElementById('ai-stop-badge').style.display = 'none';
    document.getElementById('info-bar').style.display = 'none';

    const scanLine = document.getElementById('scan-line');
    scanLine.classList.remove('animating');
    void scanLine.offsetWidth;
    setTimeout(() => scanLine.classList.add('animating'), 400);

    setTimeout(positionDetectBox, 1800);
    setTimeout(showAlertState, 2600);
    setTimeout(finishScan, 3200);
  }

  function positionDetectBox() {
    const target = document.getElementById('face-target');
    const viewport = document.getElementById('scan-viewport');
    const tRect = target.getBoundingClientRect();
    const vRect = viewport.getBoundingClientRect();
    const box = document.getElementById('detect-box');
    box.style.display = 'block';
    box.style.left = (tRect.left - vRect.left - 4) + 'px';
    box.style.top = (tRect.top - vRect.top - 4) + 'px';
    box.style.width = (tRect.width + 8) + 'px';
    box.style.height = (tRect.height + 8) + 'px';
  }

  function showAlertState() {
    document.getElementById('detect-box').classList.add('alert');
    const target = document.getElementById('face-target');
    const viewport = document.getElementById('scan-viewport');
    const tRect = target.getBoundingClientRect();
    const vRect = viewport.getBoundingClientRect();
    const badge = document.getElementById('ai-stop-badge');
    badge.style.display = 'block';
    badge.style.right = (vRect.right - tRect.right + 4) + 'px';
    badge.style.top = (tRect.top - vRect.top - 32) + 'px';
  }

  async function finishScan() {
    document.getElementById('info-bar').style.display = 'block';
    scanBtn.disabled = false;
    scanBtn.innerHTML = '&#9654; Scan Again';
    scanCount++;
    addLocalAuditEntry();
  }

  function addLocalAuditEntry() {
    const log = document.getElementById('audit-log');
    const empty = log.querySelector('.audit-empty');
    if (empty) empty.remove();
    const now = new Date();
    const time = now.toISOString().slice(11, 19) + 'Z';
    const sources = [
      'synthetic-portraits.io',
      'deepfake-gallery.net',
      'ai-generated-content.example.com',
    ];
    const entry = document.createElement('div');
    entry.className = 'audit-entry';
    entry.innerHTML =
      '<span class="audit-time">' + time + '</span>' +
      '<span class="audit-source">' + sources[(scanCount - 1) % 3] + '</span>' +
      '<span class="audit-result blocked">BLOCKED</span>';
    log.insertBefore(entry, log.firstChild);
  }

  // ---------- Dashboard ----------
  async function refreshDashboard() {
    refreshHogStatus();
    if (!activeProfileId) {
      const selected = await selectDefaultProfile();
      if (!selected) {
        renderDashMetxtEmpty();
        renderAuditEmpty();
        renderEvidencePackets([]);
        return;
      }
    }
    try {
      const profileResp = await fetch('/api/profile/' + encodeURIComponent(activeProfileId));
      if (!profileResp.ok) {
        if (profileResp.status === 404) {
          localStorage.removeItem(STORAGE_KEY);
          activeProfileId = null;
          renderDashMetxtEmpty();
          renderAuditEmpty();
        }
        return;
      }
      const data = await profileResp.json();
      activeProfileName = data.profile.name;
      activeProfileHandle = data.profile.handle || null;
      applyDashConsent(data.consent);
      renderDashMetxt(data.profile, data.consent);

      const auditResp = await fetch('/api/audit-log?profile_id=' + encodeURIComponent(activeProfileId) + '&limit=8');
      if (auditResp.ok) renderAuditLog(await auditResp.json());

      const evidenceResp = await fetch('/api/evidence?profile_id=' + encodeURIComponent(activeProfileId));
      if (evidenceResp.ok) renderEvidencePackets(await evidenceResp.json());
    } catch (err) {
      console.warn('[dashboard] refresh failed', err);
    }
  }

  async function selectDefaultProfile() {
    try {
      const resp = await fetch('/api/profiles');
      if (!resp.ok) return false;
      const profiles = await resp.json();
      if (!profiles || profiles.length === 0) return false;
      const profile = profiles[0];
      activeProfileId = profile.id;
      activeProfileName = profile.name;
      activeProfileHandle = profile.handle || null;
      localStorage.setItem(STORAGE_KEY, activeProfileId);
      return true;
    } catch {
      return false;
    }
  }

  async function refreshHogStatus() {
    try {
      const resp = await fetch('/api/hog/status');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      renderHogStatus(await resp.json());
    } catch (err) {
      const el = document.getElementById('hog-status');
      if (el) el.textContent = 'Unable to read Hog API configuration.';
    }
  }

  function renderHogStatus(status) {
    const el = document.getElementById('hog-status');
    if (!el) return;
    const configured = status && status.configured;
    el.className = 'hog-status ' + (configured ? 'configured' : 'missing');
    el.innerHTML = configured
      ? '<span>Live The Hog enrichment enabled</span><small>' + esc(status.base_url || '') + '</small>'
      : '<span>The Hog credentials missing</span><small>Set HOG_ACCESS_KEY and HOG_SECRET_KEY. No source enrichment or contact lookup will be fabricated.</small>';
  }

  function applyDashConsent(rules) {
    const ruleMap = {};
    rules.forEach(r => { ruleMap[r.use_type] = r.permission; });
    document.querySelectorAll('[data-dash-consent]').forEach(t => {
      const useType = t.dataset.dashConsent;
      if (ruleMap[useType] === 'allow') t.classList.add('on');
      else t.classList.remove('on');
    });
  }

  document.querySelectorAll('[data-dash-consent]').forEach(t => {
    t.addEventListener('click', async () => {
      if (!activeProfileId) return;
      t.classList.toggle('on');
      const useType = t.dataset.dashConsent;
      const permission = t.classList.contains('on') ? 'allow' : 'deny';
      try {
        const resp = await fetch('/api/consent', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_id: activeProfileId, use_type: useType, permission }),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        renderDashMetxt(
          { id: activeProfileId, name: activeProfileName, handle: activeProfileHandle },
          data.consent
        );
      } catch (err) {
        console.warn('[consent] update failed', err);
        t.classList.toggle('on');
      }
    });
  });

  function setDashMetxtPath(handle) {
    const el = document.getElementById('dash-metxt-path');
    if (el) el.textContent = handle ? '/' + handle + '/me.txt' : '/me.txt';
  }

  function renderDashMetxtEmpty() {
    setDashMetxtPath(null);
    const el = document.getElementById('dash-metxt');
    el.innerHTML = colorizeMetxt(
      '# me.txt v0.1\n' +
      '# Human Likeness Consent Registry\n' +
      '\n' +
      'Identity: Not registered\n' +
      'ID: —\n' +
      '\n' +
      'Likeness-Face: not-registered\n' +
      '\n' +
      'Default-Permission: deny\n'
    );
  }

  function renderDashMetxt(profile, rules) {
    setDashMetxtPath(profile.handle);
    const ruleMap = {};
    rules.forEach(r => { ruleMap[r.use_type] = r.permission; });
    const lines = [
      '# me.txt v0.1',
      '# Human Likeness Consent Registry',
      '',
      'Identity: ' + profile.name,
      'ID: ' + profile.id,
      '',
      'Likeness-Face: registered',
      'Likeness-Voice: not-registered',
      '',
      'Default-Permission: deny',
      '',
    ];
    USE_TYPES.forEach(useType => {
      const permission = ruleMap[useType] || 'deny';
      const directive = permission === 'allow' ? 'Allow' : 'Deny';
      lines.push(directive + ': ' + useType.replace(/_/g, '-'));
    });
    lines.push('');
    lines.push('Match-Endpoint: ' + location.origin + '/api/match');
    lines.push('Evidence-Endpoint: ' + location.origin + '/api/evidence');
    lines.push('Profile: ' + location.origin + '/api/profile/' + profile.id);
    if (profile.handle) {
      lines.push('Self: ' + location.origin + '/' + profile.handle + '/me.txt');
    }
    lines.push('');
    lines.push('# Updated: ' + new Date().toISOString());
    document.getElementById('dash-metxt').innerHTML = colorizeMetxt(lines.join('\n'));
  }

  function renderAuditEmpty() {
    document.getElementById('audit-log').innerHTML =
      '<div class="audit-empty">No queries yet. Run a scan to see activity here.</div>';
  }

  function renderAuditLog(entries) {
    const log = document.getElementById('audit-log');
    if (!entries || entries.length === 0) {
      renderAuditEmpty();
      return;
    }
    log.innerHTML = '';
    entries.forEach(e => {
      const time = (e.queried_at || '').replace(' ', 'T').slice(0, 19) + 'Z';
      const blocked = e.result && e.result.indexOf('STOP') !== -1;
      const cls = blocked ? 'blocked' : 'allowed';
      const label = blocked ? 'BLOCKED' : (e.result || 'OK');
      const source = e.source_url || '(no source)';
      const sourceLabel = formatSource(source);
      const evidence = e.evidence_id
        ? ' · <button class="audit-link" data-evidence-id="' + esc(e.evidence_id) + '">packet</button>'
        : '';
      const entry = document.createElement('div');
      entry.className = 'audit-entry';
      entry.innerHTML =
        '<span class="audit-time">' + esc(time) + '</span>' +
        '<span class="audit-source" title="' + esc(source) + '">' + esc(sourceLabel) + '</span>' +
        '<span class="audit-result ' + cls + '">' + esc(label) + '</span>' +
        evidence;
      log.appendChild(entry);
    });
    log.querySelectorAll('[data-evidence-id]').forEach(btn => {
      btn.addEventListener('click', () => scrollToEvidence(btn.dataset.evidenceId));
    });
  }

  function renderEvidencePackets(entries) {
    const list = document.getElementById('evidence-list');
    if (!list) return;
    if (!entries || entries.length === 0) {
      list.innerHTML = '<div class="audit-empty">No evidence packets yet. Run a blocked scan to generate one.</div>';
      return;
    }
    list.innerHTML = '';
    entries.forEach(packet => {
      const source = packet.source || {};
      const intel = packet.source_intelligence || {};
      const risk = packet.risk || {};
      const contacts = intel.contacts || {};
      const firstEmail = contacts.emails && contacts.emails.length ? contacts.emails[0] : 'No contact found';
      const company = intel.company && intel.company.name
        ? intel.company.name
        : (source.domain || 'Unknown source');
      const status = intel.provider_status === 'enriched' ? 'Hog enriched' : 'Not enriched';
      const card = document.createElement('div');
      card.className = 'evidence-card';
      card.dataset.evidenceId = packet.id;
      card.innerHTML =
        '<div class="evidence-top">' +
          '<div>' +
            '<div class="evidence-title">' + esc(company) + '</div>' +
            '<div class="evidence-meta">' + esc(formatDate(packet.created_at)) + ' · ' + esc(source.domain || '') + '</div>' +
          '</div>' +
          '<span class="risk-badge ' + esc(risk.level || 'low') + '">' + esc((risk.level || 'low').toUpperCase()) + ' ' + esc(risk.score || 0) + '</span>' +
        '</div>' +
        '<div class="evidence-summary">' + esc(intel.summary || 'No summary available.') + '</div>' +
        '<div class="evidence-grid">' +
          '<div><span>Provider</span><strong>' + esc(status) + '</strong></div>' +
          '<div><span>Use</span><strong>' + esc(packet.consent && packet.consent.use_type || 'unspecified') + '</strong></div>' +
          '<div><span>Contact</span><strong>' + esc(firstEmail) + '</strong></div>' +
        '</div>' +
        '<pre class="notice-preview">' + esc(packet.takedown_notice || 'No takedown notice available until The Hog returns a verified contact.') + '</pre>';
      list.appendChild(card);
    });
  }

  function scrollToEvidence(id, smooth = true) {
    if (!id) return;
    const card = Array.from(document.querySelectorAll('[data-evidence-id]'))
      .find(el => el.dataset.evidenceId === id);
    if (!card) return;
    card.classList.add('highlight');
    card.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    setTimeout(() => card.classList.remove('highlight'), 1400);
  }

  function formatDate(value) {
    if (!value) return 'unknown time';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatSource(value) {
    if (!value) return '(no source)';
    try {
      const url = new URL(value);
      const path = url.pathname.length > 38 ? url.pathname.slice(0, 35) + '...' : url.pathname;
      return url.hostname.replace(/^www\./, '') + path;
    } catch {
      return value.length > 72 ? value.slice(0, 69) + '...' : value;
    }
  }

  // ---------- Image Search Lab ----------
  const imageSearchFile = document.getElementById('image-search-file');
  const imageSearchDataUri = document.getElementById('image-search-data-uri');
  const imageSearchSubmit = document.getElementById('image-search-submit');
  const imageSearchScore = document.getElementById('image-search-score');

  if (imageSearchFile) {
    imageSearchFile.addEventListener('change', () => {
      const file = imageSearchFile.files && imageSearchFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        imageSearchDataUri.value = String(reader.result || '');
        updateImageSearchPreview(imageSearchDataUri.value);
        setImageSearchError('');
      };
      reader.onerror = () => setImageSearchError('Could not read the selected image.');
      reader.readAsDataURL(file);
    });
  }

  if (imageSearchDataUri) {
    imageSearchDataUri.addEventListener('input', () => updateImageSearchPreview(imageSearchDataUri.value));
  }

  if (imageSearchSubmit) {
    imageSearchSubmit.addEventListener('click', runImageSearch);
  }

  function updateImageSearchPreview(value) {
    const dataUri = String(value || '').trim();
    const img = document.getElementById('image-search-preview-img');
    const empty = document.getElementById('image-search-preview-empty');
    if (!img || !empty) return;

    if (!dataUri.startsWith('data:image/')) {
      img.removeAttribute('src');
      img.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    img.src = dataUri;
    img.style.display = 'block';
    empty.style.display = 'none';
  }

  function setImageSearchError(message) {
    const el = document.getElementById('image-search-error');
    if (!el) return;
    if (!message) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.textContent = message;
    el.style.display = 'block';
  }

  function setImageSearchStatus(message) {
    const el = document.getElementById('image-search-status');
    if (el) el.textContent = message;
  }

  async function runImageSearch() {
    const query = document.getElementById('image-search-query').value.trim();
    const imageDataUri = imageSearchDataUri.value.trim();
    const resultsEl = document.getElementById('image-search-results');

    setImageSearchError('');
    if (resultsEl) resultsEl.innerHTML = '';
    if (!query) {
      setImageSearchError('Search query is required.');
      return;
    }
    if (!imageDataUri.startsWith('data:image/')) {
      setImageSearchError('Upload an image or paste a data:image URI.');
      return;
    }

    imageSearchSubmit.disabled = true;
    imageSearchSubmit.textContent = 'Searching...';
    setImageSearchStatus('Searching public image results...');

    try {
      const resp = await fetch('/api/image-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          image_data_uri: imageDataUri,
          provider: 'ddg',
          limit: 12,
          score: imageSearchScore ? imageSearchScore.checked : true,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Image search failed');
      renderImageSearchResults(data);
    } catch (err) {
      setImageSearchStatus('Search failed.');
      setImageSearchError(err.message || 'Image search failed.');
    } finally {
      imageSearchSubmit.disabled = false;
      imageSearchSubmit.textContent = 'Search Images';
    }
  }

  function renderImageSearchResults(data) {
    const resultsEl = document.getElementById('image-search-results');
    if (!resultsEl) return;
    const results = data && data.results ? data.results : [];
    const scored = results.filter(result => result.similarity != null).length;
    setImageSearchStatus(
      'Found ' + results.length + ' candidate image(s)' +
      (scored ? '; scored ' + scored + ' for rough visual similarity.' : '.')
    );

    if (!results.length) {
      resultsEl.innerHTML = '<div class="audit-empty">No candidate images found.</div>';
      return;
    }

    resultsEl.innerHTML = '';
    results.forEach((result, index) => {
      const thumb = result.thumbnailUrl || result.imageUrl || '';
      const similarity = result.similarity == null
        ? 'not scored'
        : Math.round(result.similarity * 100) + '% similar';
      const pageUrl = result.pageUrl || result.imageUrl || '#';
      const item = document.createElement('div');
      item.className = 'image-result';
      item.innerHTML =
        '<div class="image-result-thumb">' +
          (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" />' : '<span>No image</span>') +
        '</div>' +
        '<div class="image-result-body">' +
          '<div class="image-result-top">' +
            '<span class="image-result-rank">#' + esc(index + 1) + '</span>' +
            '<span class="image-result-score">' + esc(similarity) + '</span>' +
          '</div>' +
          '<div class="image-result-title">' + esc(result.title || 'Untitled image result') + '</div>' +
          '<div class="image-result-url">' + esc(formatSource(pageUrl)) + '</div>' +
          (result.error ? '<div class="image-result-error">' + esc(result.error) + '</div>' : '') +
          '<div class="image-result-actions">' +
            '<a href="' + esc(pageUrl) + '" target="_blank" rel="noopener">Open page</a>' +
            (result.imageUrl ? '<a href="' + esc(result.imageUrl) + '" target="_blank" rel="noopener">Open image</a>' : '') +
          '</div>' +
        '</div>';
      resultsEl.appendChild(item);
    });
  }

  // ---------- Browse ----------
  let browseProfiles = [];
  let browseDetails = {};
  const browseSearchInput = document.getElementById('browse-search');
  const browseGrid = document.getElementById('browse-grid');
  const browseCount = document.getElementById('browse-count');

  if (browseSearchInput) {
    browseSearchInput.addEventListener('input', () => renderBrowseGrid(browseSearchInput.value.trim()));
  }

  async function refreshBrowse() {
    if (!browseGrid) return;
    try {
      const resp = await fetch('/api/profiles');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      browseProfiles = await resp.json();
    } catch (err) {
      browseProfiles = [];
    }
    browseDetails = {};
    renderBrowseGrid(browseSearchInput ? browseSearchInput.value.trim() : '');
  }

  function renderBrowseGrid(query) {
    if (!browseGrid) return;
    const q = query.toLowerCase();
    const filtered = q
      ? browseProfiles.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.handle && p.handle.toLowerCase().includes(q)) ||
          p.id.toLowerCase().includes(q)
        )
      : browseProfiles;

    if (browseCount) {
      browseCount.textContent = filtered.length + ' character' + (filtered.length !== 1 ? 's' : '') +
        (q ? ' matching "' + query + '"' : ' registered');
    }

    if (!filtered.length) {
      browseGrid.innerHTML = '<div class="audit-empty">' +
        (q ? 'No characters match your search.' : 'No characters registered yet. Register one to see it here.') +
        '</div>';
      return;
    }

    browseGrid.innerHTML = '';
    filtered.forEach(profile => {
      const initials = profile.name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
      const photoUrl = '/api/profile/' + encodeURIComponent(profile.id) + '/photo';
      const card = document.createElement('div');
      card.className = 'browse-card';
      card.innerHTML =
        '<div class="browse-card-top">' +
          '<div class="browse-card-avatar" data-browse-avatar="' + esc(profile.id) + '">' +
            '<img src="' + esc(photoUrl) + '" alt="" />' +
            '<span class="browse-card-avatar-fallback">' + esc(initials) + '</span>' +
          '</div>' +
          '<div class="browse-card-info">' +
            '<div class="browse-card-name">' + esc(profile.name) + '</div>' +
            '<div class="browse-card-handle">' + esc(profile.handle ? '/' + profile.handle : profile.id) + '</div>' +
          '</div>' +
          '<div class="browse-card-date">' + esc(formatDate(profile.created_at)) + '</div>' +
        '</div>' +
        '<div class="browse-card-consent" data-browse-consent="' + esc(profile.id) + '"></div>' +
        '<div class="browse-card-metxt-section">' +
          '<div class="browse-card-metxt-label">me.txt</div>' +
          '<div class="browse-card-metxt" data-browse-metxt="' + esc(profile.id) + '"></div>' +
        '</div>';
      browseGrid.appendChild(card);

      var avatarImg = card.querySelector('[data-browse-avatar="' + profile.id + '"] img');
      if (avatarImg) {
        avatarImg.addEventListener('load', function () { avatarImg.classList.add('loaded'); });
        avatarImg.addEventListener('error', function () { avatarImg.style.display = 'none'; });
      }

      loadBrowseDetail(profile.id);
    });
  }

  async function loadBrowseDetail(profileId) {
    if (browseDetails[profileId]) {
      applyBrowseDetail(profileId, browseDetails[profileId]);
      return;
    }
    try {
      const resp = await fetch('/api/profile/' + encodeURIComponent(profileId));
      if (!resp.ok) return;
      const data = await resp.json();
      browseDetails[profileId] = data;
      applyBrowseDetail(profileId, data);
    } catch (err) {
      // ignore
    }
  }

  function applyBrowseDetail(profileId, data) {
    var consentEl = document.querySelector('[data-browse-consent="' + profileId + '"]');
    if (consentEl && data.consent) {
      consentEl.innerHTML = data.consent.map(function (r) {
        var label = r.use_type.replace(/_/g, ' ');
        label = label.charAt(0).toUpperCase() + label.slice(1);
        var cls = r.permission === 'allow' ? 'allow' : 'deny';
        return '<span class="browse-consent-tag ' + cls + '">' + esc(label) + ': ' + esc(r.permission) + '</span>';
      }).join('');
    }

    var metxtEl = document.querySelector('[data-browse-metxt="' + profileId + '"]');
    if (metxtEl) {
      var profile = data.profile;
      var rules = data.consent || [];
      var ruleMap = {};
      rules.forEach(function (r) { ruleMap[r.use_type] = r.permission; });
      var lines = [
        '# me.txt v0.1',
        '# Human Likeness Consent Registry',
        '',
        'Identity: ' + profile.name,
        'ID: ' + profile.id,
        '',
        'Likeness-Face: registered',
        'Likeness-Voice: not-registered',
        '',
        'Default-Permission: deny',
        '',
      ];
      USE_TYPES.forEach(function (useType) {
        var permission = ruleMap[useType] || 'deny';
        var directive = permission === 'allow' ? 'Allow' : 'Deny';
        lines.push(directive + ': ' + useType.replace(/_/g, '-'));
      });
      lines.push('');
      lines.push('Match-Endpoint: ' + location.origin + '/api/match');
      lines.push('Evidence-Endpoint: ' + location.origin + '/api/evidence');
      lines.push('Profile: ' + location.origin + '/api/profile/' + profile.id);
      if (profile.handle) {
        lines.push('Self: ' + location.origin + '/' + profile.handle + '/me.txt');
      }
      metxtEl.innerHTML = colorizeMetxt(lines.join('\n'));
    }
  }

  // ---------- Monitor ----------
  let monitorPresets = [];
  let monitorProfiles = [];
  let monitorSelectedProfile = null;

  const monitorProfileSelect = document.getElementById('monitor-profile');
  const monitorPresetSelect = document.getElementById('monitor-site-preset');
  const monitorCustomDomain = document.getElementById('monitor-custom-domain');
  const monitorKeywordInput = document.getElementById('monitor-keyword');
  const monitorAddBtn = document.getElementById('monitor-add-btn');
  const monitorAddError = document.getElementById('monitor-add-error');
  const monitorListEl = document.getElementById('monitor-list');
  const monitorProfileMeta = document.getElementById('monitor-profile-meta');
  const monitorStatusEl = document.getElementById('monitor-status');
  const monitorResultsEl = document.getElementById('monitor-results');
  const monitorResultsTitle = document.getElementById('monitor-results-title');

  function setMonitorError(message) {
    if (!monitorAddError) return;
    if (!message) {
      monitorAddError.style.display = 'none';
      monitorAddError.textContent = '';
      return;
    }
    monitorAddError.textContent = message;
    monitorAddError.style.display = 'block';
  }

  function setMonitorStatus(message) {
    if (monitorStatusEl) monitorStatusEl.textContent = message || '';
  }

  function clearMonitorResults() {
    if (monitorResultsEl) monitorResultsEl.innerHTML = '';
    if (monitorResultsTitle) {
      monitorResultsTitle.style.display = 'none';
      monitorResultsTitle.textContent = '';
    }
    setMonitorStatus('');
  }

  async function initMonitorPresets() {
    if (monitorPresets.length || !monitorPresetSelect) return;
    try {
      const resp = await fetch('/api/monitor/site-presets');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      monitorPresets = await resp.json();
    } catch (err) {
      monitorPresets = [];
    }
    monitorPresetSelect.innerHTML = '';
    monitorPresets.forEach(preset => {
      const opt = document.createElement('option');
      opt.value = preset.key;
      opt.textContent = preset.label + ' (' + preset.domain + ')';
      monitorPresetSelect.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = '__custom';
    customOpt.textContent = 'Custom domain…';
    monitorPresetSelect.appendChild(customOpt);
  }

  if (monitorPresetSelect && monitorCustomDomain) {
    monitorPresetSelect.addEventListener('change', () => {
      monitorCustomDomain.style.display = monitorPresetSelect.value === '__custom' ? 'block' : 'none';
      setMonitorError('');
    });
  }

  async function loadMonitorProfiles() {
    if (!monitorProfileSelect) return;
    try {
      const resp = await fetch('/api/profiles');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      monitorProfiles = await resp.json();
    } catch (err) {
      monitorProfiles = [];
    }
    monitorProfileSelect.innerHTML = '';
    if (!monitorProfiles.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No registered characters yet';
      monitorProfileSelect.appendChild(opt);
      monitorSelectedProfile = null;
      renderMonitorMeta(null);
      renderMonitorList([]);
      return;
    }
    monitorProfiles.forEach(profile => {
      const opt = document.createElement('option');
      opt.value = profile.id;
      opt.textContent = profile.name + ' (' + profile.id + ')';
      monitorProfileSelect.appendChild(opt);
    });
    const preferred =
      monitorProfiles.find(p => p.id === activeProfileId) || monitorProfiles[0];
    monitorProfileSelect.value = preferred.id;
    await selectMonitorProfile(preferred.id);
  }

  async function selectMonitorProfile(profileId) {
    monitorSelectedProfile = monitorProfiles.find(p => p.id === profileId) || null;
    renderMonitorMeta(monitorSelectedProfile);
    clearMonitorResults();
    setMonitorError('');
    if (monitorKeywordInput && monitorSelectedProfile) {
      monitorKeywordInput.placeholder =
        'Search keyword (default: "' + monitorSelectedProfile.name + '")';
      monitorKeywordInput.value = '';
    }
    if (!monitorSelectedProfile) {
      renderMonitorList([]);
      return;
    }
    await refreshMonitorList();
  }

  if (monitorProfileSelect) {
    monitorProfileSelect.addEventListener('change', () => {
      selectMonitorProfile(monitorProfileSelect.value);
    });
  }

  function renderMonitorMeta(profile) {
    if (!monitorProfileMeta) return;
    if (!profile) {
      monitorProfileMeta.textContent = 'Register a character first to start monitoring.';
      return;
    }
    monitorProfileMeta.textContent =
      profile.handle ? '/' + profile.handle + ' · ' + profile.id : profile.id;
  }

  async function refreshMonitorList() {
    if (!monitorSelectedProfile) {
      renderMonitorList([]);
      return;
    }
    try {
      const resp = await fetch(
        '/api/monitor/sites?profile_id=' + encodeURIComponent(monitorSelectedProfile.id)
      );
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      renderMonitorList(await resp.json());
    } catch (err) {
      renderMonitorList([]);
    }
  }

  function renderMonitorList(entries) {
    if (!monitorListEl) return;
    if (!entries || !entries.length) {
      monitorListEl.innerHTML = monitorSelectedProfile
        ? '<div class="audit-empty">No sites yet. Add Etsy, eBay, or any marketplace to watch for unauthorized merch.</div>'
        : '<div class="audit-empty">Select a character to see monitored sites.</div>';
      return;
    }
    monitorListEl.innerHTML = '';
    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'monitor-item';
      const presetLabel = monitorPresets.find(p => p.key === entry.site);
      const label = presetLabel ? presetLabel.label : entry.domain;
      const lastScanned = entry.last_scanned_at
        ? 'Last scanned ' + formatDate(entry.last_scanned_at)
        : 'Never scanned';
      item.innerHTML =
        '<div class="monitor-item-body">' +
          '<div class="monitor-item-title">' + esc(label) + ' · "' + esc(entry.keyword) + '"</div>' +
          '<div class="monitor-item-meta">' + esc(entry.domain) + ' · ' + esc(lastScanned) + '</div>' +
        '</div>' +
        '<div class="monitor-item-actions">' +
          '<button class="monitor-scan-btn" data-monitor-scan="' + esc(entry.id) + '">Scan</button>' +
          '<button class="monitor-remove-btn" data-monitor-remove="' + esc(entry.id) + '">Remove</button>' +
        '</div>';
      monitorListEl.appendChild(item);
    });
    monitorListEl.querySelectorAll('[data-monitor-scan]').forEach(btn => {
      btn.addEventListener('click', () => runMonitorScan(parseInt(btn.dataset.monitorScan, 10), btn));
    });
    monitorListEl.querySelectorAll('[data-monitor-remove]').forEach(btn => {
      btn.addEventListener('click', () => removeMonitorSite(parseInt(btn.dataset.monitorRemove, 10)));
    });
  }

  async function addMonitorSite() {
    setMonitorError('');
    if (!monitorSelectedProfile) {
      setMonitorError('Select a registered character first.');
      return;
    }
    const presetKey = monitorPresetSelect ? monitorPresetSelect.value : '';
    const payload = { profile_id: monitorSelectedProfile.id };
    if (presetKey === '__custom') {
      const domain = monitorCustomDomain.value.trim();
      if (!domain) {
        setMonitorError('Enter a domain to monitor (e.g., society6.com).');
        return;
      }
      payload.domain = domain;
    } else {
      payload.site = presetKey;
    }
    const keyword = monitorKeywordInput.value.trim();
    if (keyword) payload.keyword = keyword;

    monitorAddBtn.disabled = true;
    monitorAddBtn.textContent = 'Adding…';
    try {
      const resp = await fetch('/api/monitor/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'HTTP ' + resp.status);
      monitorKeywordInput.value = '';
      monitorCustomDomain.value = '';
      await refreshMonitorList();
    } catch (err) {
      setMonitorError(err.message || 'Failed to add site.');
    } finally {
      monitorAddBtn.disabled = false;
      monitorAddBtn.textContent = 'Add to watchlist';
    }
  }

  if (monitorAddBtn) {
    monitorAddBtn.addEventListener('click', addMonitorSite);
  }

  async function removeMonitorSite(id) {
    if (!id) return;
    try {
      const resp = await fetch('/api/monitor/sites/' + id, { method: 'DELETE' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      await refreshMonitorList();
    } catch (err) {
      console.warn('[monitor] remove failed', err);
    }
  }

  async function runMonitorScan(siteId, triggerBtn) {
    if (!siteId) return;
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Scanning…';
    }
    setMonitorStatus('Searching marketplace for matches…');
    if (monitorResultsEl) monitorResultsEl.innerHTML = '';
    try {
      const resp = await fetch('/api/monitor/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, limit: 16 }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'HTTP ' + resp.status);
      renderMonitorScan(data);
      await refreshMonitorList();
    } catch (err) {
      setMonitorStatus('Scan failed: ' + (err.message || 'unknown error'));
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = 'Scan';
      }
    }
  }

  function renderMonitorScan(data) {
    if (!monitorResultsEl) return;
    const results = (data && data.results) || [];
    if (monitorResultsTitle) {
      monitorResultsTitle.style.display = 'block';
      monitorResultsTitle.textContent =
        'Findings on ' + (data.site && data.site.domain ? data.site.domain : 'site') +
        ' for "' + (data.site && data.site.keyword ? data.site.keyword : '') + '"';
    }
    const methodLabel = data && data.method ? describeScanMethod(data.method, data.fallback_reason) : '';
    const validation = data && data.validation;
    const removedDead = validation && validation.removed_dead ? validation.removed_dead : 0;
    const deadLabel = removedDead
      ? '  ·  Filtered out ' + removedDead + ' dead listing(s).'
      : '';
    setMonitorStatus(
      (results.length
        ? 'Found ' + results.length + ' candidate listing(s). Review for unauthorized likeness use.'
        : 'No public listings detected on this site for this keyword right now.') +
      (methodLabel ? '  ·  ' + methodLabel : '') +
      deadLabel
    );
    monitorResultsEl.innerHTML = '';
    results.forEach(result => {
      const thumb = result.thumbnailUrl || result.imageUrl;
      const pageUrl = result.pageUrl || result.imageUrl || '#';
      const card = document.createElement('div');
      card.className = 'monitor-card';
      card.innerHTML =
        '<div class="monitor-card-thumb">' +
          (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" />' : '<span>No image</span>') +
        '</div>' +
        '<div class="monitor-card-body">' +
          '<div class="monitor-card-title">' + esc(result.title || 'Untitled listing') + '</div>' +
          '<div class="monitor-card-url">' + esc(formatSource(pageUrl)) + '</div>' +
          '<div class="monitor-card-actions">' +
            '<a href="' + esc(pageUrl) + '" target="_blank" rel="noopener">Open listing</a>' +
            (result.imageUrl ? '<a href="' + esc(result.imageUrl) + '" target="_blank" rel="noopener">Open image</a>' : '') +
          '</div>' +
        '</div>';
      monitorResultsEl.appendChild(card);
    });
  }

  function describeScanMethod(method, fallbackReason) {
    if (!method) return '';
    if (method === 'etsy-api') {
      return 'Live results via Etsy Open API.';
    }
    if (method.startsWith('puppeteer:')) {
      return 'Live scrape via headless Chrome (' + method.slice('puppeteer:'.length) + ').';
    }
    if (method.endsWith('-fallback')) {
      const base = method.replace('-fallback', '');
      const reason = fallbackReason ? ' Reason: ' + fallbackReason : '';
      return 'Direct marketplace lookup unavailable; fell back to ' + base.toUpperCase() + ' index search.' + reason;
    }
    return 'Source: ' + method.toUpperCase() + ' index search.';
  }

  async function refreshMonitor() {
    await initMonitorPresets();
    await loadMonitorProfiles();
  }

  // ---------- Init ----------
  const initialScreen = location.hash ? location.hash.replace(/^#/, '') : null;
  if (initialScreen && document.getElementById('screen-' + initialScreen)) {
    showScreen(initialScreen);
  } else if (activeProfileId) {
    refreshDashboard();
  } else {
    renderDashMetxtEmpty();
    refreshHogStatus();
  }
})();
