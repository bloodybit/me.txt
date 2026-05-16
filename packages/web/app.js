(function () {
  'use strict';

  const STORAGE_KEY = 'metxt_active_profile';
  const USE_TYPES = ['editorial', 'commercial', 'ai_training', 'satire'];

  let activeProfileId = localStorage.getItem(STORAGE_KEY) || null;
  let activeProfileName = null;
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
  }

  document.querySelectorAll('[data-screen-link]').forEach(el => {
    el.addEventListener('click', () => showScreen(el.dataset.screenLink));
  });

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
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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

  function finishScan() {
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
      'ai-generated-content.example.com',
      'deepfake-gallery.net',
      'synthetic-portraits.io',
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
    if (!activeProfileId) {
      renderDashMetxtEmpty();
      renderAuditEmpty();
      return;
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
      applyDashConsent(data.consent);
      renderDashMetxt(data.profile, data.consent);

      const auditResp = await fetch('/api/audit-log?profile_id=' + encodeURIComponent(activeProfileId));
      if (auditResp.ok) renderAuditLog(await auditResp.json());
    } catch (err) {
      console.warn('[dashboard] refresh failed', err);
    }
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
        renderDashMetxt({ id: activeProfileId, name: activeProfileName }, data.consent);
      } catch (err) {
        console.warn('[consent] update failed', err);
        t.classList.toggle('on');
      }
    });
  });

  function renderDashMetxtEmpty() {
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
    lines.push('Profile: ' + location.origin + '/api/profile/' + profile.id);
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
      const entry = document.createElement('div');
      entry.className = 'audit-entry';
      entry.innerHTML =
        '<span class="audit-time">' + esc(time) + '</span>' +
        '<span class="audit-source">' + esc(source) + '</span>' +
        '<span class="audit-result ' + cls + '">' + esc(label) + '</span>';
      log.appendChild(entry);
    });
  }

  // ---------- Init ----------
  if (activeProfileId) refreshDashboard();
  else renderDashMetxtEmpty();
})();
