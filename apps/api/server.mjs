import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createStore, resetRuntimeData } from './lib/store.mjs';
import { authorize, getEffectiveRole, getProject, getUser, listVisibleDocuments } from './lib/auth.mjs';
import { compareVersions, renderUnifiedDiff, renderSideBySideDiff } from './lib/diff.mjs';
import {
  badRequest,
  clearCookie,
  forbidden,
  getIpAddress,
  mimeFor,
  notFound,
  parseCookies,
  readJsonBody,
  sendFile,
  sendJson,
  setCookie,
  unauthorized,
} from './lib/http.mjs';

const moduleDir = resolve(fileURLToPath(import.meta.url), '..');
const appDir = resolve(moduleDir, '..');
const webDir = resolve(appDir, 'web');
let store = await createStore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentAccessTime(req, body = {}) {
  return body.accessTime || req.headers['x-access-time'] || null;
}

function activeUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.dms_user || null;
}

async function getCurrentUser(req) {
  const userId = activeUser(req);
  if (!userId) return null;
  return getUser(store, userId);
}

function publicUser(user) {
  if (!user) return null;
  const department = store.state.departments.find((d) => d.id === user.departmentId) || null;
  return { ...user, departmentName: department?.name || user.departmentId };
}

function documentEnvelope(document, user, accessTime) {
  const role = getEffectiveRole(store, user.id, document);
  const project = document.projectId ? getProject(store, document.projectId) : null;
  return {
    ...document,
    projectName: project?.name || null,
    projectStatus: project?.status || 'active',
    effectiveRole: role.role,
    effectiveRoleSource: role.source,
    ownerName: publicUser(getUser(store, document.ownerUserId))?.name || document.ownerUserId,
  };
}

function asFileName(value) {
  return basename(String(value)).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function logRequest(req, res, startedAt, pathname, search = '') {
  const durationMs = Date.now() - startedAt;
  const ip = getIpAddress(req);
  const route = `${pathname}${search}`;
  console.log(`${req.method} ${route} ${res.statusCode} ${durationMs}ms ip=${ip}`);
}

async function requireUser(req, res) {
  const user = await getCurrentUser(req);
  if (!user) {
    unauthorized(res);
    return null;
  }
  return user;
}

function isAdmin(store, userId) {
  return (
    store.state.departmentRoles.some((e) => e.userId === userId && e.role === 'admin') ||
    store.state.projectRoles.some((e) => e.userId === userId && e.role === 'admin')
  );
}

// ─── Auth handlers ────────────────────────────────────────────────────────────

async function handleLogin(req, res) {
  const body = await readJsonBody(req);
  const user = getUser(store, body.userId);
  if (!user) return badRequest(res, 'Unknown user');
  setCookie(res, 'dms_user', user.id, { httpOnly: true, sameSite: 'Lax' });
  await store.appendAudit({
    action: 'LOGIN',
    targetType: 'user',
    targetId: user.id,
    userId: user.id,
    sourceIp: getIpAddress(req),
    decision: 'allowed',
  });
  sendJson(res, 200, { user: publicUser(user) });
}

async function handleLogout(req, res) {
  clearCookie(res, 'dms_user');
  sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const user = await getCurrentUser(req);
  sendJson(res, 200, { user: user ? publicUser(user) : null });
}

async function handleUsers(req, res) {
  const users = store.state.users.map((user) => publicUser(user));
  sendJson(res, 200, { users });
}

// ─── Context (lightweight — no audit events) ──────────────────────────────────

async function handleContext(req, res) {
  const user = await getCurrentUser(req);
  const accessTime = currentAccessTime(req);
  const documents = user
    ? listVisibleDocuments(store, user, accessTime).map((doc) => documentEnvelope(doc, user, accessTime))
    : [];
  const projects = store.state.projects.map((project) => ({
    ...project,
    departmentName: store.state.departments.find((d) => d.id === project.departmentId)?.name || project.departmentId,
  }));
  const now = new Date();
  // Audit events are intentionally excluded from this endpoint.
  // Fetch them separately via GET /audit-events to avoid loading
  // the full audit log on every page refresh.
  sendJson(res, 200, {
    user: publicUser(user),
    users: store.state.users.map((u) => publicUser(u)),
    projects,
    documents,
    retention: store.getSettings(),
    server: {
      status: 'online',
      serverTime: now.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      requestAccessTime: accessTime || '09:00',
    },
  });
}

// ─── Documents ────────────────────────────────────────────────────────────────

async function handleListDocuments(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const accessTime = currentAccessTime(req);
  const documents = listVisibleDocuments(store, user, accessTime).map((doc) => documentEnvelope(doc, user, accessTime));
  sendJson(res, 200, { documents, user: publicUser(user), retention: store.getSettings() });
}

async function handleGetDocument(req, res, documentId) {
  const user = await requireUser(req, res);
  if (!user) return;
  const document = store.findDocument(documentId);
  if (!document) return notFound(res);
  const accessTime = currentAccessTime(req);
  const decision = authorize(store, user, document, 'view', { accessTime });
  if (!decision.allowed) {
    await store.appendAudit({
      action: 'VIEW_DOCUMENT',
      decision: 'denied',
      reason: decision.reason,
      targetType: 'document',
      targetId: document.id,
      userId: user.id,
      sourceIp: getIpAddress(req),
    });
    return forbidden(res, decision.reason);
  }
  const enriched = store.enrichDocument(document);
  await store.appendAudit({
    action: 'VIEW_DOCUMENT',
    decision: 'allowed',
    targetType: 'document',
    targetId: document.id,
    userId: user.id,
    sourceIp: getIpAddress(req),
  });
  sendJson(res, 200, {
    document: documentEnvelope(enriched, user, accessTime),
    versions: enriched.versions,
    effectiveRole: decision.role,
  });
}

async function readUploadPayload(req) {
  const body = await readJsonBody(req, 10 * 1024 * 1024);
  const raw = body.contentBase64
    ? Buffer.from(body.contentBase64, 'base64')
    : Buffer.from(body.content || '', 'utf8');
  if (raw.length > 5 * 1024 * 1024) {
    throw new Error('Maximum file size is 5 MB');
  }
  return { ...body, raw };
}

async function handleCreateDocument(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const body = await readUploadPayload(req).catch((error) => ({ error }));
  if (body.error) return badRequest(res, body.error.message);
  const project = store.findProject(body.projectId);
  if (!project) return badRequest(res, 'Unknown project');
  const placeholder = {
    id: 'draft',
    departmentId: project.departmentId,
    projectId: project.id,
    ownerUserId: user.id,
    classification: body.classification || 'internal',
  };
  const decision = authorize(store, user, placeholder, 'create', { accessTime: currentAccessTime(req, body) });
  if (!decision.allowed) return forbidden(res, decision.reason);
  const document = await store.addDocument({
    title: body.title,
    description: body.description || '',
    departmentId: project.departmentId,
    projectId: project.id,
    ownerUserId: user.id,
    classification: body.classification || 'internal',
    fileName: asFileName(body.fileName || `${body.title}.txt`),
    mimeType: body.mimeType || 'text/plain',
    contentBuffer: body.raw,
    summary: body.summary || 'Initial version',
  });
  await store.appendAudit({
    action: 'CREATE_DOCUMENT',
    decision: 'allowed',
    targetType: 'document',
    targetId: document.id,
    userId: user.id,
    sourceIp: getIpAddress(req),
  });
  sendJson(res, 201, { document });
}

async function handleAddVersion(req, res, documentId) {
  const user = await requireUser(req, res);
  if (!user) return;
  const document = store.findDocument(documentId);
  if (!document) return notFound(res);
  const body = await readUploadPayload(req).catch((error) => ({ error }));
  if (body.error) return badRequest(res, body.error.message);
  const decision = authorize(store, user, document, 'upload', { accessTime: currentAccessTime(req, body) });
  if (!decision.allowed) return forbidden(res, decision.reason);
  const version = await store.addVersion(document.id, {
    fileName: asFileName(body.fileName || document.title),
    mimeType: body.mimeType || 'text/plain',
    contentBuffer: body.raw,
    summary: body.summary || '',
    createdBy: user.id,
  });
  await store.appendAudit({
    action: 'UPLOAD_DOCUMENT',
    decision: 'allowed',
    targetType: 'document',
    targetId: document.id,
    userId: user.id,
    sourceIp: getIpAddress(req),
    versionId: version.id,
  });
  sendJson(res, 201, { version });
}

async function handleListVersions(req, res, documentId) {
  const user = await requireUser(req, res);
  if (!user) return;
  const document = store.findDocument(documentId);
  if (!document) return notFound(res);
  const decision = authorize(store, user, document, 'view', { accessTime: currentAccessTime(req) });
  if (!decision.allowed) return forbidden(res, decision.reason);
  const versions = store.state.versions
    .filter((v) => v.documentId === documentId)
    .sort((a, b) => a.versionNumber - b.versionNumber)
    .map((v) => store.publicVersion(v));
  await store.appendAudit({
    action: 'VIEW_DOCUMENT',
    decision: 'allowed',
    targetType: 'document',
    targetId: document.id,
    userId: user.id,
    sourceIp: getIpAddress(req),
    detail: 'version-list',
  });
  sendJson(res, 200, { versions });
}

async function handleDownloadVersion(req, res, documentId, versionId) {
  const user = await requireUser(req, res);
  if (!user) return;
  const document = store.findDocument(documentId);
  if (!document) return notFound(res);
  const version = store.findVersion(versionId);
  if (!version || version.documentId !== documentId) return notFound(res);
  const decision = authorize(store, user, document, 'download', { accessTime: currentAccessTime(req) });
  if (!decision.allowed) {
    await store.appendAudit({
      action: 'DOWNLOAD_DOCUMENT',
      decision: 'denied',
      reason: decision.reason,
      targetType: 'document',
      targetId: document.id,
      userId: user.id,
      sourceIp: getIpAddress(req),
      versionId,
    });
    return forbidden(res, decision.reason);
  }
  const bytes = await store.getVersionContent(version.id);
  await store.appendAudit({
    action: 'DOWNLOAD_DOCUMENT',
    decision: 'allowed',
    targetType: 'document',
    targetId: document.id,
    userId: user.id,
    sourceIp: getIpAddress(req),
    versionId,
  });
  res.writeHead(200, {
    'content-type': version.mimeType || mimeFor(version.fileName),
    'content-disposition': `attachment; filename="${asFileName(version.fileName)}"`,
    'content-length': bytes.length,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  });
  res.end(bytes);
}

// ─── Diff ─────────────────────────────────────────────────────────────────────

async function handleDiff(req, res, documentId, searchParams) {
  const user = await requireUser(req, res);
  if (!user) return;
  const document = store.findDocument(documentId);
  if (!document) return notFound(res);
  const decision = authorize(store, user, document, 'view', { accessTime: currentAccessTime(req) });
  if (!decision.allowed) return forbidden(res, decision.reason);
  const fromVersionId = searchParams.get('fromVersionId');
  const toVersionId = searchParams.get('toVersionId');
  const versions = store.state.versions.filter((v) => v.documentId === documentId);
  const fromVersion = versions.find((v) => v.id === fromVersionId) || versions[versions.length - 2] || versions[0];
  const toVersion = versions.find((v) => v.id === toVersionId) || versions[versions.length - 1];
  if (!fromVersion || !toVersion) {
    return badRequest(res, 'Two versions are required to diff');
  }
  const diffResult = compareVersions(fromVersion, toVersion);
  // Attach version numbers so renderers can label panes
  diffResult.fromVersion = fromVersion.versionNumber;
  diffResult.toVersion = toVersion.versionNumber;
  sendJson(res, 200, {
    diff: diffResult,
    htmlUnified: renderUnifiedDiff(diffResult),
    htmlSideBySide: renderSideBySideDiff(diffResult),
  });
}

// ─── Audit (paginated) ────────────────────────────────────────────────────────

async function handleAudit(req, res, searchParams) {
  const user = await requireUser(req, res);
  if (!user) return;
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const pageSize = Math.min(200, Math.max(10, Number(searchParams.get('pageSize') || 50)));
  const result = await store.readAuditEventsPaged(page, pageSize);
  sendJson(res, 200, { auditEvents: result.events, pagination: { page: result.page, pageSize: result.pageSize, total: result.total, pages: result.pages } });
}

// ─── Admin ────────────────────────────────────────────────────────────────────

async function handleRetention(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!isAdmin(store, user.id)) return forbidden(res, 'Admin access required');
  const retentionDays = Number(store.getSettings().retentionDays || 365);
  const removed = await store.cleanupRetention(retentionDays);
  sendJson(res, 200, { removed, retentionDays });
}

async function handleConfigRetention(req, res) {
  sendJson(res, 200, { retention: store.getSettings() });
}

async function handleUpdateSettings(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!isAdmin(store, user.id)) return forbidden(res, 'Admin access required');
  const body = await readJsonBody(req);
  const allowed = ['retentionDays', 'businessHoursStart', 'businessHoursEnd'];
  const updates = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (!Object.keys(updates).length) return badRequest(res, 'No valid settings provided');
  await store.updateSettings(updates);
  sendJson(res, 200, { retention: store.getSettings() });
}

async function handleResetDemo(req, res) {
  store = await resetRuntimeData();
  sendJson(res, 200, { ok: true });
}

// ─── Static ───────────────────────────────────────────────────────────────────

async function serveStatic(req, res, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(webDir, `.${cleanPath}`);
  if (!filePath.startsWith(webDir)) return notFound(res);
  try {
    return await sendFile(res, filePath, mimeFor(filePath));
  } catch {
    return notFound(res);
  }
}

function methodNotAllowed(res) {
  sendJson(res, 405, { error: 'Method not allowed' });
}

// ─── Router ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  let pathname = '/';
  let search = '';
  res.on('finish', () => logRequest(req, res, startedAt, pathname, search));
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    pathname = url.pathname;
    search = url.search;

    if (pathname === '/health') {
      return sendJson(res, 200, { ok: true, uptimeSeconds: Math.round(process.uptime()) });
    }

    // Auth
    if (pathname === '/auth/demo-login' && req.method === 'POST') return await handleLogin(req, res);
    if (pathname === '/auth/logout' && req.method === 'POST') return await handleLogout(req, res);
    if (pathname === '/auth/me' && req.method === 'GET') return await handleMe(req, res);
    if (pathname === '/auth/users' && req.method === 'GET') return await handleUsers(req, res);

    // Context
    if (pathname === '/context' && req.method === 'GET') return await handleContext(req, res);

    // Documents
    if (pathname === '/documents' && req.method === 'GET') return await handleListDocuments(req, res);
    if (pathname === '/documents' && req.method === 'POST') return await handleCreateDocument(req, res);

    if (pathname.startsWith('/documents/') && pathname.endsWith('/versions') && req.method === 'GET') {
      return await handleListVersions(req, res, pathname.split('/')[2]);
    }
    if (pathname.startsWith('/documents/') && pathname.includes('/versions/') && pathname.endsWith('/download') && req.method === 'GET') {
      const parts = pathname.split('/');
      return await handleDownloadVersion(req, res, parts[2], parts[4]);
    }
    if (pathname.startsWith('/documents/') && pathname.endsWith('/versions') && req.method === 'POST') {
      return await handleAddVersion(req, res, pathname.split('/')[2]);
    }
    if (pathname.startsWith('/documents/') && pathname.split('/').length === 3 && req.method === 'GET') {
      return await handleGetDocument(req, res, pathname.split('/')[2]);
    }
    if (pathname.startsWith('/documents/') && pathname.endsWith('/diff') && req.method === 'GET') {
      return await handleDiff(req, res, pathname.split('/')[2], url.searchParams);
    }

    // Audit (paginated)
    if (pathname === '/audit-events' && req.method === 'GET') return await handleAudit(req, res, url.searchParams);

    // Config / Admin
    if (pathname === '/config/retention' && req.method === 'GET') return await handleConfigRetention(req, res);
    if (pathname === '/admin/settings' && req.method === 'PATCH') return await handleUpdateSettings(req, res);
    if (pathname === '/admin/retention/cleanup' && req.method === 'POST') return await handleRetention(req, res);
    if (pathname === '/admin/reset-demo' && req.method === 'POST') return await handleResetDemo(req, res);

    // Static files
    if (
      pathname.startsWith('/assets/') ||
      pathname === '/' ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.js') ||
      pathname.endsWith('.html')
    ) {
      return await serveStatic(req, res, pathname);
    }

    return notFound(res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || 'Internal server error' });
  }
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`Enterprise DMS running on http://localhost:${port}`);
});
