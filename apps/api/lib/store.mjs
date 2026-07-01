import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(moduleDir, '..');
const defaultRuntimeDir = process.env.DMS_DATA_DIR ? resolve(process.env.DMS_DATA_DIR) : resolve(appDir, 'runtime');
const seedFile = resolve(appDir, 'data', 'seed.json');

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function atomicWrite(path, content) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  return writeFile(tempPath, content).then(async () => {
    const fs = await import('node:fs/promises');
    await fs.rename(tempPath, path);
  }).catch(async (error) => {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  });
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function buildSeedState(seed) {
  const state = {
    settings: seed.settings || {},
    departments: seed.departments || [],
    projects: seed.projects || [],
    users: seed.users || [],
    departmentRoles: seed.departmentRoles || [],
    projectRoles: seed.projectRoles || [],
    documents: [],
    versions: [],
  };

  for (const documentSeed of seed.documents || []) {
    const document = {
      id: documentSeed.id || randomUUID(),
      title: documentSeed.title,
      description: documentSeed.description || '',
      departmentId: documentSeed.departmentId,
      projectId: documentSeed.projectId,
      ownerUserId: documentSeed.ownerUserId,
      classification: documentSeed.classification || 'internal',
      tags: documentSeed.tags || [],
      createdAt: documentSeed.createdAt || nowIso(),
      updatedAt: documentSeed.updatedAt || nowIso(),
      latestVersionId: null,
    };

    let latestVersionId = null;
    for (const versionSeed of documentSeed.versions || []) {
      const raw = Buffer.from(versionSeed.content || '', 'utf8');
      const versionId = randomUUID();
      const fileName = versionSeed.fileName;
      const version = {
        id: versionId,
        documentId: document.id,
        versionNumber: versionSeed.versionNumber,
        fileName,
        mimeType: versionSeed.mimeType,
        summary: versionSeed.summary || '',
        sizeBytes: raw.length,
        checksum: hashBuffer(raw),
        storagePath: null,
        createdBy: versionSeed.createdBy,
        createdAt: versionSeed.createdAt || nowIso(),
      };
      state.versions.push({ ...version, content: versionSeed.content });
      latestVersionId = versionId;
    }
    document.latestVersionId = latestVersionId;
    state.documents.push(document);
  }

  return state;
}

async function materializeSeed(runtimeDir, state) {
  const blobsDir = join(runtimeDir, 'blobs');
  await ensureDirectory(blobsDir);

  for (const version of state.versions) {
    if (version.storagePath) continue;
    const content = version.content || '';
    const storagePath = join(blobsDir, `${version.id}-${sanitize(version.fileName || 'document')}`);
    await writeFile(storagePath, content, 'utf8');
    version.storagePath = storagePath;
    delete version.content;
  }
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export class Store {
  constructor(runtimeDir = defaultRuntimeDir) {
    this.runtimeDir = runtimeDir;
    this.statePath = join(runtimeDir, 'state.json');
    this.auditPath = join(runtimeDir, 'audit.ndjson');
    this.blobsDir = join(runtimeDir, 'blobs');
    this.state = null;
  }

  async init() {
    await ensureDirectory(this.runtimeDir);
    await ensureDirectory(this.blobsDir);

    const exists = await access(this.statePath, fsConstants.F_OK).then(() => true).catch(() => false);
    if (!exists) {
      const seed = JSON.parse(await readFile(seedFile, 'utf8'));
      this.state = buildSeedState(seed);
      await materializeSeed(this.runtimeDir, this.state);
      await this.persist();
      return this;
    }

    this.state = JSON.parse(await readFile(this.statePath, 'utf8'));
    for (const version of this.state.versions || []) {
      if (!version.storagePath && version.content != null) {
        const storagePath = join(this.blobsDir, `${version.id}-${sanitize(version.fileName || 'document')}`);
        await writeFile(storagePath, version.content, 'utf8');
        version.storagePath = storagePath;
        delete version.content;
      }
    }
    await this.persist();
    return this;
  }

  async persist() {
    const snapshot = clone({
      ...this.state,
      versions: this.state.versions.map((version) => ({ ...version, content: undefined })),
    });
    for (const version of snapshot.versions) {
      delete version.content;
    }
    await atomicWrite(this.statePath, JSON.stringify(snapshot, null, 2));
  }

  getSettings() {
    return this.state.settings || {};
  }

  updateSettings(nextSettings) {
    this.state.settings = { ...this.getSettings(), ...nextSettings };
    return this.persist();
  }

  listDocuments() {
    return this.state.documents.map((document) => this.enrichDocument(document));
  }

  enrichDocument(document) {
    const versions = this.state.versions
      .filter((version) => version.documentId === document.id)
      .sort((a, b) => a.versionNumber - b.versionNumber);
    return {
      ...clone(document),
      versions: versions.map((version) => this.publicVersion(version)),
      latestVersion: versions.length ? this.publicVersion(versions[versions.length - 1]) : null,
    };
  }

  publicVersion(version) {
    const copy = { ...clone(version) };
    delete copy.storagePath;
    return copy;
  }

  findDocument(documentId) {
    return this.state.documents.find((document) => document.id === documentId) || null;
  }

  findVersion(versionId) {
    return this.state.versions.find((version) => version.id === versionId) || null;
  }

  findProject(projectId) {
    return this.state.projects.find((project) => project.id === projectId) || null;
  }

  findUser(userId) {
    return this.state.users.find((user) => user.id === userId) || null;
  }

  nextDocumentVersionNumber(documentId) {
    const versions = this.state.versions.filter((version) => version.documentId === documentId);
    return versions.length ? Math.max(...versions.map((version) => version.versionNumber)) + 1 : 1;
  }

  async addDocument({ title, description, departmentId, projectId, ownerUserId, classification, fileName, mimeType, contentBuffer, summary }) {
    const document = {
      id: randomUUID(),
      title,
      description: description || '',
      departmentId,
      projectId,
      ownerUserId,
      classification: classification || 'internal',
      tags: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      latestVersionId: null,
    };

    this.state.documents.push(document);
    const version = await this.addVersion(document.id, {
      fileName,
      mimeType,
      contentBuffer,
      summary,
      createdBy: ownerUserId,
      initialVersion: true,
    });
    document.latestVersionId = version.id;
    document.updatedAt = nowIso();
    await this.persist();
    return this.enrichDocument(document);
  }

  async addVersion(documentId, { fileName, mimeType, contentBuffer, summary, createdBy, initialVersion = false }) {
    const document = this.findDocument(documentId);
    if (!document) {
      throw new Error('Document not found');
    }
    const versionNumber = this.nextDocumentVersionNumber(documentId);
    const versionId = randomUUID();
    const storagePath = join(this.blobsDir, `${versionId}-${sanitize(fileName || 'document')}`);
    await writeFile(storagePath, contentBuffer);
    const version = {
      id: versionId,
      documentId,
      versionNumber,
      fileName,
      mimeType,
      summary: summary || '',
      sizeBytes: contentBuffer.length,
      checksum: hashBuffer(contentBuffer),
      storagePath,
      createdBy,
      createdAt: nowIso(),
      initialVersion,
    };
    this.state.versions.push(version);
    document.latestVersionId = versionId;
    document.updatedAt = nowIso();
    await this.persist();
    return this.publicVersion(version);
  }

  getVersionContent(versionId) {
    const version = this.findVersion(versionId);
    if (!version) return null;
    return readFile(version.storagePath);
  }

  /** Append a single immutable audit event (append-only log). */
  async appendAudit(event) {
    const line = JSON.stringify({
      id: randomUUID(),
      createdAt: nowIso(),
      ...event,
    });
    await writeFile(this.auditPath, `${line}\n`, { flag: 'a' });
  }

  /** Read ALL audit events (used for export / non-paginated contexts). */
  async readAuditEvents() {
    try {
      const raw = await readFile(this.auditPath, 'utf8');
      return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * Read a single page of audit events (newest first).
   * @param {number} page      1-based page number
   * @param {number} pageSize  Number of events per page (default 50)
   */
  async readAuditEventsPaged(page = 1, pageSize = 50) {
    try {
      const raw = await readFile(this.auditPath, 'utf8');
      const all = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .reverse(); // newest first
      const total = all.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(Math.max(1, page), pages);
      const offset = (safePage - 1) * pageSize;
      const events = all.slice(offset, offset + pageSize);
      return { events, total, page: safePage, pageSize, pages };
    } catch {
      return { events: [], total: 0, page: 1, pageSize, pages: 0 };
    }
  }

  async cleanupRetention(retentionDays) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const keptVersions = [];
    const removed = [];

    for (const version of this.state.versions) {
      const createdAt = new Date(version.createdAt).getTime();
      const isLatest = this.state.documents.find((doc) => doc.id === version.documentId)?.latestVersionId === version.id;
      if (createdAt < cutoff && !isLatest) {
        removed.push(version);
        await rm(version.storagePath, { force: true }).catch(() => {});
        continue;
      }
      keptVersions.push(version);
    }

    this.state.versions = keptVersions;
    await this.persist();
    return removed.length;
  }
}

export async function createStore() {
  return await new Store().init();
}

export async function resetRuntimeData() {
  await rm(defaultRuntimeDir, { recursive: true, force: true });
  return await new Store().init();
}
