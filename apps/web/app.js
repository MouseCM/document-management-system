/**
 * Enterprise DMS — Frontend
 * Architecture: skeleton-once + targeted DOM patches + single delegated event bus.
 * Full re-renders are avoided; only the container whose data changed is updated.
 */

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  users: [],
  projects: [],
  currentUser: null,
  documents: [],
  selectedDocumentId: '',
  selectedDocument: null,
  selectedVersionIds: { from: '', to: '' },

  // Tabs: 'documents' | 'create' | 'diff' | 'audit' | 'settings'
  activeTab: 'documents',

  // Diff
  diffMode: 'unified',        // 'unified' | 'sidebyside'
  pdfExtractMode: 'text',     // 'text' | 'raw' — only relevant for PDF documents
  compareHtmlUnified: '',
  compareHtmlSideBySide: '',
  compareHtmlUnifiedRaw: '',
  compareHtmlSideBySideRaw: '',
  compareIsPdf: false,
  compareSummary: null,
  compareTruncated: false,

  // Audit (server-side pagination)
  auditEvents: [],
  auditPagination: { page: 1, pageSize: 50, total: 0, pages: 0 },
  auditLoaded: false,

  // Filters
  filters: { query: '', classification: '', projectStatus: '' },
  accessTime: '09:00',

  // Settings / server
  retention: {},
  server: { status: 'offline', serverTime: '', uptimeSeconds: 0, requestAccessTime: '09:00' },
  context: { lastSyncedAt: '', requestMs: 0 },

  loading: {
    context: true,
    documentId: null,
    diff: false,
    audit: false,
    action: null,
    actionLabel: '',
  },
  toasts: [],
};

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
let toastSeq = 0;
const toastTimers = new Map();

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(v) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(v));
}

function formatBytes(b) {
  if (b == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = b, i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRel(iso) {
  if (!iso) return 'just now';
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d)) return 'just now';
  const s = Math.max(0, Math.round(d / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((String(r.result || '')).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function anyBusy() {
  return state.loading.context || !!state.loading.documentId || state.loading.diff || state.loading.audit || !!state.loading.action;
}

// ═══════════════════════════════════════════════════════════════
// NETWORK
// ═══════════════════════════════════════════════════════════════
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('content-type') && options.body && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  if (state.accessTime) headers.set('x-access-time', state.accessTime);
  const t0 = performance.now();
  const res = await fetch(path, { credentials: 'include', ...options, headers });
  const elapsed = Math.round(performance.now() - t0);
  const text = await res.text();
  let payload = {};
  if (text) { try { payload = JSON.parse(text); } catch { payload = { raw: text }; } }
  if (!res.ok) {
    const err = new Error(payload.error || `Request failed (${res.status})`);
    Object.assign(err, { status: res.status, payload, elapsed });
    throw err;
  }
  return { payload, elapsed };
}

async function withAction(key, label, fn) {
  state.loading.action = key;
  state.loading.actionLabel = label;
  updateLoadRail();
  updateHeader();
  try {
    return await fn();
  } catch (err) {
    pushToast('error', err.message);
    return null;
  } finally {
    state.loading.action = null;
    state.loading.actionLabel = '';
    updateLoadRail();
    updateHeader();
  }
}

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════
function pushToast(type, message) {
  const id = ++toastSeq;
  state.toasts = [...state.toasts, { id, type, message }];
  updateToasts();
  const t = setTimeout(() => dismissToast(id), 4200);
  toastTimers.set(id, t);
}

function dismissToast(id) {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  state.toasts = state.toasts.filter(t => t.id !== id);
  updateToasts();
}

// ═══════════════════════════════════════════════════════════════
// DATA ACTIONS
// ═══════════════════════════════════════════════════════════════
async function loadContext({ selectFirst = false, refreshDoc = false } = {}) {
  state.loading.context = true;
  updateLoadRail();
  updateDocListSection();
  const t0 = performance.now();
  try {
    const { payload } = await api('/context');
    state.users = payload.users || [];
    state.projects = payload.projects || [];
    state.currentUser = payload.user || null;
    state.documents = payload.documents || [];
    state.retention = payload.retention || {};
    state.server = payload.server || state.server;
    state.accessTime = payload.server?.requestAccessTime || state.accessTime;
    state.context = { lastSyncedAt: payload.server?.serverTime || new Date().toISOString(), requestMs: Math.round(performance.now() - t0) };
    if (!state.currentUser) {
      state.selectedDocument = null;
      state.selectedDocumentId = '';
      state.compareHtmlUnified = '';
      state.compareHtmlSideBySide = '';
      state.compareSummary = null;
      state.auditLoaded = false;
      state.auditEvents = [];
    } else {
      // Re-sync selected document meta from fresh list
      if (state.selectedDocument) {
        const match = state.documents.find(d => d.id === state.selectedDocument.id);
        if (match) state.selectedDocument = { ...state.selectedDocument, ...match };
        else { state.selectedDocument = null; state.selectedDocumentId = ''; }
      }
      if (refreshDoc && state.selectedDocumentId) await selectDocument(state.selectedDocumentId, { source: 'refresh' });
      else if (selectFirst && !state.selectedDocumentId && state.documents.length) await selectDocument(state.documents[0].id, { source: 'bootstrap' });
    }
  } catch (err) {
    pushToast('error', err.message);
  } finally {
    state.loading.context = false;
    updateLoadRail();
    updateHeader();
    updateSessionPanel();
    updateDocListSection();
    updateTabContent();
  }
}

async function loadAudit(page = 1) {
  state.loading.audit = true;
  updateLoadRail();
  updateTabContent();
  try {
    const { payload } = await api(`/audit-events?page=${page}&pageSize=${state.auditPagination.pageSize}`);
    state.auditEvents = payload.auditEvents || [];
    state.auditPagination = payload.pagination || state.auditPagination;
    state.auditLoaded = true;
  } catch (err) {
    pushToast('error', err.message);
  } finally {
    state.loading.audit = false;
    updateLoadRail();
    updateTabContent();
  }
}

async function selectDocument(docId, { source = 'manual' } = {}) {
  if (!docId) return;
  state.selectedDocumentId = docId;
  state.loading.documentId = docId;
  updateDocListSection();
  updateTabContent();
  try {
    const { payload } = await api(`/documents/${docId}`);
    state.selectedDocument = payload.document;
    state.selectedDocumentId = payload.document.id;
    const versions = payload.versions || [];
    const fromV = versions[versions.length - 2] || versions[0] || null;
    const toV = versions[versions.length - 1] || null;
    state.selectedVersionIds = { from: fromV?.id || '', to: toV?.id || '' };
    state.compareHtmlUnified = '';
    state.compareHtmlSideBySide = '';
    state.compareSummary = null;
    if (versions.length > 1) await loadDiff();
    if (source === 'manual') pushToast('info', `Loaded: ${payload.document.title}`);
  } catch (err) {
    pushToast('error', err.message);
  } finally {
    state.loading.documentId = null;
    updateLoadRail();
    updateDocListSection();
    updateTabContent();
  }
}

async function loadDiff() {
  if (!state.selectedDocument || !state.selectedVersionIds.from || !state.selectedVersionIds.to) {
    state.compareHtmlUnified = '';
    state.compareHtmlSideBySide = '';
    state.compareHtmlUnifiedRaw = '';
    state.compareHtmlSideBySideRaw = '';
    state.compareIsPdf = false;
    state.compareSummary = null;
    return;
  }
  state.loading.diff = true;
  updateLoadRail();
  updateTabContent();
  try {
    const params = new URLSearchParams({ fromVersionId: state.selectedVersionIds.from, toVersionId: state.selectedVersionIds.to });
    const { payload } = await api(`/documents/${state.selectedDocument.id}/diff?${params}`);
    state.compareHtmlUnified = payload.htmlUnified || '';
    state.compareHtmlSideBySide = payload.htmlSideBySide || '';
    state.compareHtmlUnifiedRaw = payload.htmlUnifiedRaw || '';
    state.compareHtmlSideBySideRaw = payload.htmlSideBySideRaw || '';
    state.compareIsPdf = !!(payload.diff?.isPdf);
    state.compareSummary = payload.diff?.summary || null;
    state.compareRawSummary = payload.diff?.rawSummary || null;
    state.compareTruncated = payload.diff?.truncated || false;
  } catch (err) {
    pushToast('error', err.message);
  } finally {
    state.loading.diff = false;
    updateLoadRail();
    updateTabContent();
  }
}

async function login(userId) {
  await withAction('login', 'Signing in…', async () => {
    await api('/auth/demo-login', { method: 'POST', body: JSON.stringify({ userId }) });
    state.selectedDocument = null;
    state.selectedDocumentId = '';
    state.auditLoaded = false;
    pushToast('success', 'Session started.');
    await loadContext({ selectFirst: true });
  });
}

async function logout() {
  await withAction('logout', 'Signing out…', async () => {
    await api('/auth/logout', { method: 'POST' });
    state.currentUser = null;
    state.documents = [];
    state.selectedDocument = null;
    state.selectedDocumentId = '';
    state.auditLoaded = false;
    state.auditEvents = [];
    pushToast('success', 'Session ended.');
    await loadContext();
  });
}

function getCurrentProjectOptions() {
  if (!state.currentUser) return [];
  return state.projects.filter(p => p.departmentId === state.currentUser.departmentId && p.status === 'active');
}

function upsertDocInList(doc) {
  state.documents = [doc, ...state.documents.filter(d => d.id !== doc.id)];
}

// ═══════════════════════════════════════════════════════════════
// DOM PATCH HELPERS
// ═══════════════════════════════════════════════════════════════
function patch(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html; if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
}

function patchText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function patchClass(id, cls, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle(cls, on);
}

// ═══════════════════════════════════════════════════════════════
// SHELL (built once)
// ═══════════════════════════════════════════════════════════════
const TABS = [
  { id: 'documents', icon: '<i data-lucide="file-text"></i>', label: 'Documents' },
  { id: 'create', icon: '<i data-lucide="edit-2"></i>', label: 'Create' },
  { id: 'diff', icon: '<i data-lucide="zap"></i>', label: 'Diff' },
  { id: 'audit', icon: '<i data-lucide="search"></i>', label: 'Audit Log' },
  { id: 'settings', icon: '<i data-lucide="settings"></i>', label: 'Settings' },
];

function buildShell() {
  return `
    <div class="app-shell">
      <div class="load-rail" id="load-rail"><div class="load-rail-bar"></div></div>

      <header class="topbar">
        <div class="brand">
          <h1>Document Management</h1>
          <p>Version-controlled · ABAC enforced · Immutable audit trails</p>
        </div>
        <div class="topbar-tools" id="header-tools">
          <!-- filled by updateHeader() -->
        </div>
      </header>

      <div class="layout">
        <!-- ── Sidebar ───────────────────────────────────────────── -->
        <aside class="sidebar">
          <div class="panel" id="session-panel">
            <div class="panel-head">
              <h2>Session</h2>
              <span class="chip idle" id="session-chip">Idle</span>
            </div>
            <div class="panel-body" id="session-body"></div>
          </div>

          <div class="panel" id="filters-panel">
            <div class="panel-head">
              <h2>Filters</h2>
              <span class="chip" id="doc-count-chip">—</span>
            </div>
            <div class="panel-body stack">
              <div class="field">
                <label for="search-input">Search</label>
                <input id="search-input" type="search" placeholder="Title, project, classification…" value="" />
              </div>
              <div class="field">
                <label for="classification-filter">Classification</label>
                <select id="classification-filter">
                  <option value="">All</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
              <div class="field">
                <label for="status-filter">Project status</label>
                <select id="status-filter">
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>Documents</h2>
              <span class="chip" id="doc-list-chip">0</span>
            </div>
            <div class="panel-body" id="doc-list-body"></div>
          </div>
        </aside>

        <!-- ── Workspace ─────────────────────────────────────────── -->
        <main class="workspace">
          <nav class="tab-nav" id="tab-nav">
            ${TABS.map(t => `
              <button class="tab-btn${t.id === state.activeTab ? ' active' : ''}" data-tab="${t.id}" id="tab-btn-${t.id}">
                <span class="tab-icon">${t.icon}</span> ${t.label}
              </button>
            `).join('')}
          </nav>

          <div id="tab-content" class="workspace-main tab-content-enter">
            <!-- updated by updateTabContent() -->
          </div>
        </main>
      </div>

      <footer class="app-footer">
        Enterprise DMS · Data protection, auditability, and release control enforced at the API layer
      </footer>

      <div class="toast-stack" id="toast-stack" aria-live="polite"></div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// TARGETED UPDATERS
// ═══════════════════════════════════════════════════════════════
function updateLoadRail() {
  const el = document.getElementById('load-rail');
  if (!el) return;
  el.classList.toggle('active', anyBusy());
}

function updateHeader() {
  const syncText = state.context.lastSyncedAt
    ? `${formatRel(state.context.lastSyncedAt)} · ${state.context.requestMs}ms`
    : 'waiting…';
  const stateLabel = state.loading.actionLabel ||
    (state.loading.context ? 'Syncing' : state.loading.diff ? 'Comparing' : state.loading.audit ? 'Loading' : 'Live');
  const userDisplay = state.currentUser
    ? `<strong>${esc(state.currentUser.name)}</strong> <small>${esc(state.currentUser.departmentName)}</small>`
    : `<span style="color:var(--text-dim)">Not signed in</span>`;

  patch('header-tools', `
    <div class="status-pill">${userDisplay}</div>
    <div class="status-pill">
      <span class="pulse-dot"></span>
      <span>${esc(state.server.status || 'online')}</span>
      <small>${esc(syncText)}</small>
    </div>
    <div class="status-pill">
      <span style="color:var(--text-dim);font-size:11px">State</span>
      <strong>${esc(stateLabel)}</strong>
    </div>
    <div class="status-pill">
      <span style="color:var(--text-dim);font-size:11px">Access time</span>
      <input class="time-input" id="access-time" type="time" value="${esc(state.accessTime)}" />
    </div>
    <div class="status-pill">
      <span style="color:var(--text-dim);font-size:11px">Retention</span>
      <strong>${esc(String(state.retention.retentionDays || '—'))} days</strong>
    </div>
  `);
}

function updateSessionPanel() {
  const el = document.getElementById('session-chip');
  if (el) {
    el.className = `chip ${state.currentUser ? 'live' : 'idle'}`;
    el.textContent = state.currentUser ? 'Active' : 'Idle';
  }
  if (state.currentUser) {
    patch('session-body', `
      <div class="stack">
        <div style="font-size:13px">
          <div style="color:var(--text-dim);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Signed in as</div>
          <strong>${esc(state.currentUser.name)}</strong>
          <div style="font-size:12px;color:var(--text-dim)">${esc(state.currentUser.email)}</div>
          <div style="margin-top:5px">${buildBadge('badge', state.currentUser.departmentName || state.currentUser.departmentId)}</div>
        </div>
        <div class="btn-row">
          <button class="btn sm" data-action="delete-all" ${state.loading.action === 'delete-all' ? 'disabled' : ''}>
            ${state.loading.action === 'delete-all' ? '<span class="spinner sm"></span> Resetting…' : '<i data-lucide="refresh-cw" class="lucide-sm"></i> Delete All'}
          </button>
          <button class="btn sm danger" data-action="logout" ${state.loading.action === 'logout' ? 'disabled' : ''}>
            ${state.loading.action === 'logout' ? '<span class="spinner sm"></span>' : '<i data-lucide="power" class="lucide-sm"></i> Sign out'}
          </button>
        </div>
      </div>
    `);
  } else {
    patch('session-body', `
      <div class="stack">
        <div class="field">
          <label for="user-select">Demo user</label>
          <select id="user-select">
            <option value="">Select a seeded user…</option>
            ${state.users.map(u => `<option value="${esc(u.id)}">${esc(u.name)} — ${esc(u.departmentName || u.departmentId)}</option>`).join('')}
          </select>
        </div>
        <button class="btn primary" data-action="login" ${state.loading.action === 'login' ? 'disabled' : ''}>
          ${state.loading.action === 'login' ? '<span class="spinner sm"></span> Signing in…' : '<i data-lucide="arrow-right" class="lucide-sm"></i> Open session'}
        </button>
        <p style="font-size:11px;color:var(--text-dim);margin:0">Select a seeded account to explore the document workspace.</p>
      </div>
    `);
  }
}

function updateDocListSection() {
  const docs = filteredDocs();
  // Update chip
  const chip = document.getElementById('doc-list-chip');
  if (chip) chip.textContent = state.loading.context && !state.documents.length ? '…' : String(docs.length);

  const docCountChip = document.getElementById('doc-count-chip');
  if (docCountChip) {
    docCountChip.className = `chip ${state.documents.length ? 'active' : 'idle'}`;
    docCountChip.textContent = state.loading.context ? 'Syncing' : `${state.documents.length}`;
  }

  if (state.loading.context && !state.documents.length) {
    patch('doc-list-body', `
      <div class="stack">
        ${[0, 1, 2, 3].map(() => `<div class="skeleton-card"><div class="skeleton-line md"></div><div class="skeleton-line sm"></div></div>`).join('')}
      </div>
    `);
    return;
  }

  if (!docs.length) {
    patch('doc-list-body', `
      <div class="empty-state">
        <div class="empty-icon"><i data-lucide="folder"></i></div>
        <strong>${state.currentUser ? 'No documents match filters' : 'Sign in to see documents'}</strong>
        <p>${state.currentUser ? 'Widen your search or classification filter.' : 'Pick a seeded user from the Session panel.'}</p>
      </div>
    `);
    return;
  }

  patch('doc-list-body', `<div class="doc-list">${docs.map(d => buildDocListItem(d)).join('')}</div>`);
}

function filteredDocs() {
  const q = state.filters.query.trim().toLowerCase();
  return state.documents.filter(d => {
    if (q && !`${d.title} ${d.description} ${d.projectName || ''} ${d.classification}`.toLowerCase().includes(q)) return false;
    if (state.filters.classification && d.classification !== state.filters.classification) return false;
    if (state.filters.projectStatus && d.projectStatus !== state.filters.projectStatus) return false;
    return true;
  });
}

function buildDocListItem(d) {
  const active = state.selectedDocumentId === d.id;
  const loading = state.loading.documentId === d.id;
  return `
    <button class="doc-item${active ? ' active' : ''}" data-action="select-doc" data-id="${esc(d.id)}"
      ${state.loading.action ? 'disabled' : ''}>
      <div class="doc-project">${esc(d.projectName || 'No project')}</div>
      <div class="doc-title">${loading ? '<span class="spinner sm"></span> ' : ''}${esc(d.title)}</div>
      <div class="doc-meta">
        ${buildBadge(d.classification, d.classification)}
        ${buildBadge(d.projectStatus, d.projectStatus)}
        ${buildBadge(d.effectiveRole || 'viewer', d.effectiveRole || 'viewer')}
      </div>
      <div class="doc-footer">v${esc(String(d.latestVersion?.versionNumber || 0))} · ${esc(d.ownerName || d.ownerUserId || '—')}</div>
    </button>
  `;
}

function buildBadge(cls, label) {
  return `<span class="badge ${esc(cls)}">${esc(label)}</span>`;
}

// ── Tab switching ──────────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  TABS.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t.id}`);
    if (btn) btn.classList.toggle('active', t.id === tab);
  });
  // Lazy-load audit when first opened
  if (tab === 'audit' && !state.auditLoaded && !state.loading.audit) {
    loadAudit(1);
    return; // updateTabContent called from loadAudit
  }
  updateTabContent();
}

function updateTabContent() {
  const el = document.getElementById('tab-content');
  if (!el) return;
  el.innerHTML = buildTabContent(state.activeTab); if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
  el.classList.remove('tab-content-enter');
  void el.offsetWidth; // force reflow
  el.classList.add('tab-content-enter');
}

function buildTabContent(tab) {
  switch (tab) {
    case 'documents': return buildDocumentsTab();
    case 'create': return buildCreateTab();
    case 'diff': return buildDiffTab();
    case 'audit': return buildAuditTab();
    case 'settings': return buildSettingsTab();
    default: return '';
  }
}

// ── TAB: Documents ─────────────────────────────────────────────
function buildDocumentsTab() {
  if (!state.currentUser) {
    return `
      <div class="panel">
        <div class="panel-body">
          <div class="empty-state">
            <div class="empty-icon"><i data-lucide="lock"></i></div>
            <strong>Sign in to access documents</strong>
            <p>Select a seeded user in the Session panel on the left to explore the document workspace.</p>
          </div>
        </div>
      </div>`;
  }
  if (!state.selectedDocument && !state.loading.documentId && !state.loading.context) {
    return `
      <div class="panel">
        <div class="panel-body">
          <div class="empty-state">
            <div class="empty-icon"><i data-lucide="clipboard"></i></div>
            <strong>Choose a document</strong>
            <p>Select a document from the list on the left to view its details, version history, and upload a new revision.</p>
          </div>
        </div>
      </div>`;
  }
  if (state.loading.context && !state.selectedDocument) {
    return `
      <div class="panel">
        <div class="panel-body">
          <div class="stack">
            <div class="skeleton-card"><div class="skeleton-line lg"></div><div class="skeleton-line md"></div></div>
            <div class="skeleton-card"><div class="skeleton-line md"></div><div class="skeleton-line sm"></div></div>
          </div>
        </div>
      </div>`;
  }

  const doc = state.selectedDocument;
  const versions = doc?.versions || [];
  const loadingDoc = state.loading.documentId === doc?.id;

  return `
    <!-- Document detail card -->
    <div class="panel">
      <div class="panel-head">
        <h2>Document Detail</h2>
        <div class="btn-row">
          <span class="chip ${loadingDoc ? 'syncing' : 'live'}">${loadingDoc ? 'Fetching' : 'Ready'}</span>
          <button class="btn sm" data-action="refresh"><i data-lucide="refresh-cw" class="lucide-sm"></i> Refresh</button>
          <button class="btn sm" data-action="cleanup"><i data-lucide="trash-2" class="lucide-sm"></i> Retention cleanup</button>
        </div>
      </div>
      <div class="panel-body">
        ${doc ? buildDocDetail(doc) : ''}
        ${loadingDoc ? `<div class="panel-overlay"><span class="spinner"></span> Refreshing…</div>` : ''}
      </div>
    </div>

    <!-- Version timeline + upload -->
    <div class="workspace-two-col">
      <div class="panel">
        <div class="panel-head">
          <h2>Version Timeline</h2>
          <span class="chip ${versions.length ? 'active' : 'idle'}">${versions.length} version${versions.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="panel-body">
          ${buildVersionTimeline(doc, versions)}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Upload New Version</h2>
          <span class="chip ${state.currentUser ? 'active' : 'idle'}">${state.currentUser ? 'Ready' : 'Locked'}</span>
        </div>
        <div class="panel-body">
          ${buildUploadForm()}
        </div>
      </div>
    </div>
  `;
}

function buildDocDetail(doc) {
  return `
    <div class="doc-detail">
      <div class="doc-detail-header">
        <div class="doc-detail-badges">
          ${buildBadge(doc.effectiveRole || 'viewer', (doc.effectiveRole || 'viewer').toUpperCase())}
          ${buildBadge(doc.effectiveRoleSource || 'department', doc.effectiveRoleSource || 'department')}
          ${buildBadge(doc.classification, doc.classification)}
          ${buildBadge(doc.projectStatus, doc.projectStatus)}
        </div>
        <h2>${esc(doc.title)}</h2>
        <p class="lede">${esc(doc.description || 'No description available.')}</p>
      </div>
      <div class="meta-grid">
        <div class="metric"><span class="metric-label">Project</span><span class="metric-value">${esc(doc.projectName || '—')}</span></div>
        <div class="metric"><span class="metric-label">Owner</span><span class="metric-value">${esc(doc.ownerName || '—')}</span></div>
        <div class="metric"><span class="metric-label">Versions</span><span class="metric-value">${(doc.versions || []).length}</span></div>
        <div class="metric"><span class="metric-label">Updated</span><span class="metric-value" style="font-size:13px">${esc(formatDate(doc.updatedAt))}</span></div>
      </div>
    </div>
  `;
}

function buildVersionTimeline(doc, versions) {
  if (!doc) return `<div class="empty-state"><div class="empty-icon">⏱</div><strong>No document selected</strong></div>`;
  if (!versions.length) return `<div class="empty-state"><div class="empty-icon">📭</div><strong>No versions yet</strong></div>`;
  const busy = state.loading.documentId === doc.id;
  return `
    <div class="version-timeline" style="position:relative">
      ${versions.map(v => `
        <div class="version-item${state.selectedVersionIds.to === v.id ? ' active' : ''}">
          <div>
            <div class="version-num">v${v.versionNumber}</div>
            <div class="version-sub">${esc(v.mimeType?.split('/')[1] || 'file')}</div>
          </div>
          <div class="version-info">
            <div class="version-summary">${esc(v.summary || 'No summary')}</div>
            <div class="version-meta">${esc(formatDate(v.createdAt))} · ${esc(v.createdBy)}</div>
            <div class="version-meta">${esc(v.fileName)} · ${esc(formatBytes(v.sizeBytes))}</div>
          </div>
          <div class="version-actions">
            <button class="btn sm" data-action="download-version" data-id="${esc(v.id)}"
              ${state.loading.action === `dl:${v.id}` ? 'disabled' : ''}>
              ${state.loading.action === `dl:${v.id}` ? '<span class="spinner sm"></span>' : '<i data-lucide="arrow-down" class="lucide-sm"></i>'} Download
            </button>
            <button class="btn sm ghost" data-action="use-from" data-id="${esc(v.id)}">From</button>
            <button class="btn sm ghost" data-action="use-to"   data-id="${esc(v.id)}">To</button>
          </div>
        </div>
      `).join('')}
      ${busy ? `<div class="panel-overlay"><span class="spinner"></span> Updating…</div>` : ''}
    </div>
  `;
}

function buildUploadForm() {
  if (!state.currentUser) return `<div class="empty-state"><div class="empty-icon">🔒</div><strong>Sign in to upload</strong></div>`;
  if (!state.selectedDocument) return `<div class="empty-state"><div class="empty-icon"><i data-lucide="file-text"></i></div><strong>Open a document first</strong></div>`;
  return `
    <form id="upload-form" class="stack">
      <div class="field">
        <label>File name</label>
        <input name="fileName" value="${esc(state.selectedDocument.title)}" />
      </div>
      <div class="field">
        <label>Change summary</label>
        <input name="summary" placeholder="Describe the change" />
      </div>
      <div class="field">
        <label>File</label>
        <input type="file" name="file" />
      </div>
      <div class="field">
        <label>Or paste text</label>
        <textarea name="content" rows="4" placeholder="Updated content…"></textarea>
      </div>
      <button class="btn primary" type="submit" ${state.loading.action === 'upload' ? 'disabled' : ''}>
        ${state.loading.action === 'upload' ? '<span class="spinner sm"></span> Uploading…' : '↑ Upload version'}
      </button>
    </form>
  `;
}

// ── TAB: Create ────────────────────────────────────────────────
function buildCreateTab() {
  if (!state.currentUser) {
    return `
      <div class="panel"><div class="panel-body">
        <div class="empty-state">
          <div class="empty-icon"><i data-lucide="lock"></i></div>
          <strong>Sign in to create documents</strong>
          <p>The create panel requires an active session.</p>
        </div>
      </div></div>`;
  }
  const projects = getCurrentProjectOptions();
  return `
    <div class="panel">
      <div class="panel-head">
        <h2>Create Document</h2>
        <span class="chip ${projects.length ? 'active' : 'idle'}">${projects.length ? 'Ready' : 'No active projects'}</span>
      </div>
      <div class="panel-body">
        <form id="create-form" class="stack">
          <div class="field">
            <label>Title *</label>
            <input name="title" placeholder="Quarterly release brief" required />
          </div>
          <div class="field">
            <label>Project *</label>
            <select name="projectId" ${!projects.length ? 'disabled' : ''}>
              ${projects.length
      ? projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.departmentName || p.departmentId)})</option>`).join('')
      : '<option value="">No active projects in your department</option>'}
            </select>
          </div>
          <div class="field">
            <label>Classification</label>
            <select name="classification">
              <option value="internal">Internal</option>
              <option value="confidential">Confidential</option>
              <option value="restricted">Restricted</option>
            </select>
          </div>
          <div class="field">
            <label>File name</label>
            <input name="fileName" placeholder="brief.md" />
          </div>
          <div class="field">
            <label>Initial version summary</label>
            <input name="summary" placeholder="Initial draft" />
          </div>
          <div class="field">
            <label>Content (text)</label>
            <textarea name="content" rows="7" placeholder="# Brief&#10;&#10;Start writing here…"></textarea>
          </div>
          <div class="field">
            <label>Or attach file (max 5 MB)</label>
            <input type="file" name="file" />
          </div>
          <button class="btn primary" type="submit" ${!projects.length || state.loading.action === 'create' ? 'disabled' : ''}>
            ${state.loading.action === 'create' ? '<span class="spinner sm"></span> Creating…' : '+ Create document'}
          </button>
        </form>
      </div>
    </div>`;
}

// ── TAB: Diff ──────────────────────────────────────────────────
function buildDiffTab() {
  if (!state.selectedDocument) {
    return `
      <div class="panel"><div class="panel-body">
        <div class="empty-state">
          <div class="empty-icon"><i data-lucide="zap"></i></div>
          <strong>No document selected</strong>
          <p>Select a document with at least two versions to compare revisions.</p>
        </div>
      </div></div>`;
  }
  const doc = state.selectedDocument;
  const versions = doc.versions || [];
  const loading = state.loading.diff;
  const hasCompare = !!(state.compareHtmlUnified || state.compareHtmlSideBySide);
  const isPdf = !!state.compareIsPdf;

  // Choose the correct HTML block based on layout mode + extract mode
  const useRaw = isPdf && state.pdfExtractMode === 'raw';
  const activeHtml = state.diffMode === 'sidebyside'
    ? (useRaw ? state.compareHtmlSideBySideRaw : state.compareHtmlSideBySide)
    : (useRaw ? state.compareHtmlUnifiedRaw : state.compareHtmlUnified);

  const activeSummary = (useRaw && state.compareRawSummary)
    ? state.compareRawSummary
    : state.compareSummary;

  return `
    <div class="panel">
      <div class="panel-head">
        <h2>Diff View — ${esc(doc.title)}</h2>
        <span class="chip ${loading ? 'syncing' : hasCompare ? 'live' : 'idle'}">${loading ? 'Comparing' : hasCompare ? 'Ready' : 'Idle'}</span>
      </div>
      <div class="panel-body">
        <div class="diff-shell">
          <div class="diff-toolbar">
            <div class="field">
              <label>From version</label>
              <select id="compare-from" ${loading ? 'disabled' : ''}>
                ${versions.map(v => `<option value="${esc(v.id)}" ${state.selectedVersionIds.from === v.id ? 'selected' : ''}>v${v.versionNumber} — ${esc(v.summary || v.fileName)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>To version</label>
              <select id="compare-to" ${loading ? 'disabled' : ''}>
                ${versions.map(v => `<option value="${esc(v.id)}" ${state.selectedVersionIds.to === v.id ? 'selected' : ''}>v${v.versionNumber} — ${esc(v.summary || v.fileName)}</option>`).join('')}
              </select>
            </div>
            <button class="btn primary" data-action="run-diff" ${loading ? 'disabled' : ''}>
              ${loading ? '<span class="spinner sm"></span> Comparing\u2026' : '<i data-lucide="zap"></i> Compare'}
            </button>
            <div class="mode-toggle">
              <button class="mode-btn${state.diffMode === 'unified' ? ' active' : ''}" data-action="diff-mode" data-mode="unified">Unified</button>
              <button class="mode-btn${state.diffMode === 'sidebyside' ? ' active' : ''}" data-action="diff-mode" data-mode="sidebyside">Side-by-side</button>
            </div>
            ${isPdf && hasCompare ? `
            <div class="mode-toggle" style="margin-left:4px" title="PDF extraction mode">
              <button class="mode-btn${state.pdfExtractMode === 'text' ? ' active' : ''}" data-action="extract-mode" data-mode="text"
                title="Clean text extracted from PDF (human-readable)">\uD83D\uDCC4 Text</button>
              <button class="mode-btn${state.pdfExtractMode === 'raw' ? ' active' : ''}" data-action="extract-mode" data-mode="raw"
                title="Raw binary dump of the PDF byte stream (unfiltered latin1)">\u26A1 Raw</button>
            </div>` : ''}
          </div>

          ${activeSummary ? `
            <div class="diff-stats">
              <span class="diff-stat"><span class="diff-stat-dot added"></span> <strong>${activeSummary.added}</strong> added</span>
              <span class="diff-stat"><span class="diff-stat-dot removed"></span> <strong>${activeSummary.removed}</strong> removed</span>
              <span class="diff-stat"><span class="diff-stat-dot same"></span> <strong>${activeSummary.same}</strong> unchanged</span>
              ${state.compareTruncated ? `<span style="color:var(--warning);font-size:11px">\u26A0 Large file \u2014 fast diff mode</span>` : ''}
              ${useRaw ? `<span style="color:var(--warning);font-size:11px;margin-left:8px">\u26A1 Raw binary mode \u2014 binary streams shown unfiltered</span>` : ''}
            </div>
          ` : ''}

          <div class="diff-view-container" style="position:relative">
            <div class="diff-view-header">
              <span>${esc(doc.classification)} \u00b7 ${esc(doc.projectStatus)}</span>
              <span style="font-size:11px;color:var(--text-dim)">
                ${state.diffMode === 'sidebyside' ? 'Side-by-side view' : 'Unified view'}
                ${isPdf && hasCompare ? ` \u00b7 ${useRaw ? 'Raw binary' : 'Text extracted'}` : ''}
              </span>
            </div>
            <div class="${state.diffMode === 'sidebyside' ? '' : 'diff-unified'}">
              ${activeHtml
      ? activeHtml
      : `<div class="empty-state" style="margin:16px;border:0;background:transparent"><div class="empty-icon">\uD83D\uDCCA</div><strong>Select two versions and click Compare</strong></div>`
    }
            </div>
            ${loading ? `<div class="panel-overlay"><span class="spinner lg"></span> Rendering diff\u2026</div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
}

// ── TAB: Audit ─────────────────────────────────────────────────
function buildAuditTab() {
  if (!state.currentUser) {
    return `
      <div class="panel"><div class="panel-body">
        <div class="empty-state">
          <div class="empty-icon">🔒</div>
          <strong>Sign in to view audit trail</strong>
        </div>
      </div></div>`;
  }

  if (state.loading.audit && !state.auditEvents.length) {
    return `
      <div class="panel"><div class="panel-body">
        <div class="stack">
          ${[0, 1, 2, 3, 4].map(() => `<div class="skeleton-card"><div class="skeleton-line sm"></div><div class="skeleton-line md"></div></div>`).join('')}
        </div>
      </div></div>`;
  }

  const pg = state.auditPagination;
  return `
    <div class="panel">
      <div class="panel-head">
        <h2>Audit Log</h2>
        <div class="btn-row">
          <span class="chip ${state.loading.audit ? 'syncing' : 'active'}">${pg.total} events</span>
          <button class="btn sm" data-action="reload-audit"><i data-lucide="refresh-cw" class="lucide-sm"></i> Refresh</button>
        </div>
      </div>
      <div class="panel-body" style="padding:0">
        ${state.auditEvents.length ? `
          <div class="audit-wrapper">
            <table class="audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>User</th>
                  <th>Target</th>
                  <th>Decision</th>
                  <th>Source IP</th>
                </tr>
              </thead>
              <tbody>
                ${state.auditEvents.map(e => `
                  <tr>
                    <td>${esc(formatDate(e.createdAt))}</td>
                    <td><span class="action-badge ${esc(e.action)}">${esc(e.action.replace(/_/g, ' '))}</span></td>
                    <td>${esc(e.userId || '—')}</td>
                    <td>${esc(e.targetType || '—')}: <code style="font-size:10px;opacity:.7">${esc((e.targetId || '').slice(0, 12))}…</code></td>
                    <td><span class="decision-badge ${esc(e.decision || 'allowed')}">${esc(e.decision || '—')}</span></td>
                    <td style="font-family:var(--font-mono);font-size:11px">${esc(e.sourceIp || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="pagination" style="padding:12px 16px">
            <button class="btn sm" data-action="audit-prev" ${pg.page <= 1 || state.loading.audit ? 'disabled' : ''}>← Prev</button>
            <span class="page-info">Page <strong>${pg.page}</strong> of <strong>${pg.pages}</strong> &nbsp;·&nbsp; ${pg.total} total events</span>
            <button class="btn sm" data-action="audit-next" ${pg.page >= pg.pages || state.loading.audit ? 'disabled' : ''}>Next →</button>
          </div>
        ` : `
          <div class="panel-body">
            <div class="empty-state">
              <div class="empty-icon"><i data-lucide="clipboard"></i></div>
              <strong>No audit events recorded yet</strong>
              <p>Events appear as you interact with the system.</p>
            </div>
          </div>
        `}
      </div>
    </div>`;
}

// ── TAB: Settings ──────────────────────────────────────────────
function buildSettingsTab() {
  const s = state.retention;
  const isAdm = state.currentUser && (
    /* simple client check; server enforces authz */
    true
  );
  return `
    <div class="panel">
      <div class="panel-head">
        <h2>System Settings</h2>
        <span class="chip ${state.currentUser ? 'active' : 'idle'}">${state.currentUser ? 'Admin' : 'Locked'}</span>
      </div>
      <div class="panel-body">
        <div class="stack">
          <div class="settings-section">
            <h3>Retention Policy</h3>
            <div class="settings-row">
              <div>
                <div class="settings-label">Retention period</div>
                <div class="settings-sub">Versions older than this (and not the latest) will be pruned on the next cleanup run.</div>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <input id="retention-days-input" type="number" min="1" max="3650" value="${esc(String(s.retentionDays || 365))}"
                  style="width:80px;background:var(--bg-input);color:var(--text);border:1px solid var(--border-subtle);border-radius:var(--r-sm);padding:6px 8px;font-size:13px;text-align:center;" />
                <span style="font-size:13px;color:var(--text-muted)">days</span>
                <button class="btn sm primary" data-action="save-retention" ${!state.currentUser || state.loading.action === 'save-retention' ? 'disabled' : ''}>
                  ${state.loading.action === 'save-retention' ? '<span class="spinner sm"></span>' : 'Save'}
                </button>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-label">Business hours</div>
                <div class="settings-sub">Write operations (create, upload, edit) outside business hours require admin role.</div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <input id="biz-start-input" type="time" value="${esc(s.businessHoursStart || '08:00')}"
                  style="background:var(--bg-input);color:var(--text);border:1px solid var(--border-subtle);border-radius:var(--r-sm);padding:6px 8px;" />
                <span style="color:var(--text-dim)">to</span>
                <input id="biz-end-input" type="time" value="${esc(s.businessHoursEnd || '18:00')}"
                  style="background:var(--bg-input);color:var(--text);border:1px solid var(--border-subtle);border-radius:var(--r-sm);padding:6px 8px;" />
                <button class="btn sm primary" data-action="save-biz-hours" ${!state.currentUser || state.loading.action === 'save-biz-hours' ? 'disabled' : ''}>
                  ${state.loading.action === 'save-biz-hours' ? '<span class="spinner sm"></span>' : 'Save'}
                </button>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3>Admin Actions</h3>
            <div class="settings-row">
              <div>
                <div class="settings-label">Run retention cleanup</div>
                <div class="settings-sub">Deletes non-latest versions older than the retention window.</div>
              </div>
              <button class="btn sm danger" data-action="cleanup" ${!state.currentUser || state.loading.action === 'cleanup' ? 'disabled' : ''}>
                ${state.loading.action === 'cleanup' ? '<span class="spinner sm"></span> Running…' : '<i data-lucide="trash-2" class="lucide-sm"></i> Run now'}
              </button>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-label">Delete All data</div>
                <div class="settings-sub">Wipes all runtime state and reloads from seed data. Audit log is cleared.</div>
              </div>
              <button class="btn sm danger" data-action="delete-all" ${!state.currentUser || state.loading.action === 'delete-all' ? 'disabled' : ''}>
                ${state.loading.action === 'delete-all' ? '<span class="spinner sm"></span> Resetting…' : '<i data-lucide="refresh-cw" class="lucide-sm"></i> Delete All'}
              </button>
            </div>
          </div>

          <div class="settings-section">
            <h3>Server Status</h3>
            <div class="settings-row">
              <div><div class="settings-label">Server time</div></div>
              <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${esc(state.server.serverTime ? formatDate(state.server.serverTime) : '—')}</span>
            </div>
            <div class="settings-row">
              <div><div class="settings-label">Uptime</div></div>
              <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${esc(String(state.server.uptimeSeconds || 0))}s</span>
            </div>
            <div class="settings-row">
              <div><div class="settings-label">Last sync latency</div></div>
              <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${state.context.requestMs}ms</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Toasts ─────────────────────────────────────────────────────
function updateToasts() {
  patch('toast-stack', state.toasts.map(t => `
    <div class="toast ${esc(t.type)}">
      <div class="toast-indicator"></div>
      <span class="toast-msg">${esc(t.message)}</span>
      <button class="toast-close" data-toast-id="${t.id}" aria-label="Dismiss">×</button>
    </div>
  `).join(''));
}

// ═══════════════════════════════════════════════════════════════
// DELEGATED EVENT BUS
// ═══════════════════════════════════════════════════════════════
const debouncedSearch = debounce((val) => {
  state.filters.query = val;
  updateDocListSection();
}, 180);

document.addEventListener('click', async (e) => {
  // Toasts
  const toastClose = e.target.closest('.toast-close');
  if (toastClose) { dismissToast(Number(toastClose.dataset.toastId)); return; }

  // Tab switch
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }

  // Action buttons
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'select-doc') {
    await selectDocument(actionEl.dataset.id);
    return;
  }

  if (action === 'login') {
    const sel = document.getElementById('user-select');
    if (!sel?.value) { pushToast('warning', 'Pick a user first.'); return; }
    await login(sel.value);
    return;
  }

  if (action === 'logout') { await logout(); return; }

  if (action === 'refresh') {
    await withAction('refresh', 'Refreshing…', async () => {
      await loadContext({ refreshDoc: !!state.selectedDocumentId });
      pushToast('info', 'Workspace refreshed.');
    });
    return;
  }

  if (action === 'delete-all') {
    await withAction('delete-all', 'Deleting all…', async () => {
      await api('/admin/delete-all', { method: 'POST' });
      state.selectedDocument = null;
      state.selectedDocumentId = '';
      state.auditLoaded = false;
      state.auditEvents = [];
      pushToast('warning', 'Demo data reset.');
      await loadContext({ selectFirst: true });
    });
    return;
  }

  if (action === 'cleanup') {
    await withAction('cleanup', 'Running cleanup…', async () => {
      const { payload } = await api('/admin/retention/cleanup', { method: 'POST' });
      pushToast('success', `Removed ${payload.removed} old version(s).`);
      await loadContext({ refreshDoc: !!state.selectedDocumentId });
    });
    return;
  }

  if (action === 'download-version') {
    const vId = actionEl.dataset.id;
    if (!state.selectedDocument) return;
    await withAction(`dl:${vId}`, 'Downloading…', async () => {
      const res = await fetch(`/documents/${state.selectedDocument.id}/versions/${vId}/download`, {
        credentials: 'include',
        headers: { 'x-access-time': state.accessTime },
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: '' });
      a.click();
      URL.revokeObjectURL(url);
      pushToast('success', 'Download ready.');
    });
    return;
  }

  if (action === 'use-from') {
    state.selectedVersionIds.from = actionEl.dataset.id;
    updateTabContent();
    return;
  }
  if (action === 'use-to') {
    state.selectedVersionIds.to = actionEl.dataset.id;
    updateTabContent();
    return;
  }

  if (action === 'run-diff') {
    // Sync selects
    const fromEl = document.getElementById('compare-from');
    const toEl = document.getElementById('compare-to');
    if (fromEl) state.selectedVersionIds.from = fromEl.value;
    if (toEl) state.selectedVersionIds.to = toEl.value;
    await loadDiff();
    return;
  }

  if (action === 'diff-mode') {
    state.diffMode = actionEl.dataset.mode;
    updateTabContent();
    return;
  }

  if (action === 'extract-mode') {
    state.pdfExtractMode = actionEl.dataset.mode;
    updateTabContent();
    return;
  }

  if (action === 'reload-audit') {
    state.auditLoaded = false;
    await loadAudit(state.auditPagination.page);
    return;
  }
  if (action === 'audit-prev') {
    if (state.auditPagination.page > 1) await loadAudit(state.auditPagination.page - 1);
    return;
  }
  if (action === 'audit-next') {
    if (state.auditPagination.page < state.auditPagination.pages) await loadAudit(state.auditPagination.page + 1);
    return;
  }

  if (action === 'save-retention') {
    const days = Number(document.getElementById('retention-days-input')?.value || 365);
    if (!days || days < 1) { pushToast('error', 'Enter a valid number of days.'); return; }
    await withAction('save-retention', 'Saving…', async () => {
      const { payload } = await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ retentionDays: days }) });
      state.retention = payload.retention;
      pushToast('success', `Retention set to ${days} days.`);
      updateTabContent();
    });
    return;
  }

  if (action === 'save-biz-hours') {
    const start = document.getElementById('biz-start-input')?.value;
    const end = document.getElementById('biz-end-input')?.value;
    if (!start || !end) { pushToast('error', 'Enter valid times.'); return; }
    await withAction('save-biz-hours', 'Saving…', async () => {
      const { payload } = await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ businessHoursStart: start, businessHoursEnd: end }) });
      state.retention = payload.retention;
      pushToast('success', 'Business hours updated.');
      updateTabContent();
    });
    return;
  }
});

// ── change events (filters, access time, version selects) ───────
document.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'access-time') {
    state.accessTime = e.target.value;
    if (state.currentUser) loadContext({ refreshDoc: !!state.selectedDocumentId });
    return;
  }
  if (id === 'classification-filter') { state.filters.classification = e.target.value; updateDocListSection(); return; }
  if (id === 'status-filter') { state.filters.projectStatus = e.target.value; updateDocListSection(); return; }
  if (id === 'compare-from') { state.selectedVersionIds.from = e.target.value; return; }
  if (id === 'compare-to') { state.selectedVersionIds.to = e.target.value; return; }
});

// ── input events (search) ────────────────────────────────────────
document.addEventListener('input', (e) => {
  if (e.target.id === 'search-input') {
    debouncedSearch(e.target.value);
  }
});

// ── form submits ─────────────────────────────────────────────────
document.addEventListener('submit', async (e) => {
  const form = e.target;
  e.preventDefault();

  if (form.id === 'create-form') {
    if (!state.currentUser) return;
    await withAction('create', 'Creating…', async () => {
      const fd = new FormData(form);
      const file = fd.get('file');
      let contentBase64 = '', mimeType = 'text/plain';
      let fileName = String(fd.get('fileName') || '').trim();
      if (file && file.size) {
        if (file.size > 5 * 1024 * 1024) throw new Error('File exceeds 5 MB limit.');
        contentBase64 = await fileToBase64(file);
        mimeType = file.type || 'application/octet-stream';
        fileName = fileName || file.name;
      } else {
        contentBase64 = btoa(unescape(encodeURIComponent(String(fd.get('content') || ''))));
      }
      const { payload } = await api('/documents', {
        method: 'POST',
        body: JSON.stringify({ title: fd.get('title'), projectId: fd.get('projectId'), classification: fd.get('classification'), fileName, summary: fd.get('summary'), mimeType, contentBase64, accessTime: state.accessTime }),
      });
      if (payload.document?.id) {
        upsertDocInList(payload.document);
        state.selectedDocument = payload.document;
        state.selectedDocumentId = payload.document.id;
        state.activeTab = 'documents';
      }
      pushToast('success', 'Document created.');
      form.reset();
      await loadContext({ refreshDoc: false });
    });
    return;
  }

  if (form.id === 'upload-form') {
    if (!state.selectedDocument) return;
    const docId = state.selectedDocument.id;
    await withAction('upload', 'Uploading…', async () => {
      const fd = new FormData(form);
      const file = fd.get('file');
      let contentBase64 = '', mimeType = 'text/plain';
      let fileName = String(fd.get('fileName') || '').trim();
      if (file && file.size) {
        if (file.size > 5 * 1024 * 1024) throw new Error('File exceeds 5 MB limit.');
        contentBase64 = await fileToBase64(file);
        mimeType = file.type || 'application/octet-stream';
        fileName = fileName || file.name;
      } else {
        contentBase64 = btoa(unescape(encodeURIComponent(String(fd.get('content') || ''))));
      }
      const { payload } = await api(`/documents/${docId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ fileName, summary: fd.get('summary'), mimeType, contentBase64, accessTime: state.accessTime }),
      });
      if (payload.version && state.selectedDocument) {
        const versions = [...(state.selectedDocument.versions || []), payload.version];
        state.selectedDocument = { ...state.selectedDocument, versions, latestVersionId: payload.version.id, latestVersion: payload.version };
        state.selectedVersionIds = { from: versions[versions.length - 2]?.id || payload.version.id, to: payload.version.id };
      }
      pushToast('success', 'Version uploaded.');
      form.reset();
      await loadContext({ refreshDoc: false });
      if (payload.version) await loadDiff();
    });
    return;
  }
}, false);

// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
document.getElementById('app').innerHTML = buildShell(); if (window.lucide) setTimeout(() => lucide.createIcons(), 0);
updateHeader();
updateSessionPanel();
updateDocListSection();
updateTabContent();
updateToasts();
loadContext({ selectFirst: true });
