# Enterprise Document Management System (EDMS)

A production-oriented document management platform that standardizes project documentation, enforces granular access control, preserves immutable version history, and produces a tamper-evident audit trail — all in a single zero-dependency Node.js service.

---

## Architecture at a Glance

```
Browser SPA (Vanilla JS/CSS)
    ↓ HTTP (httpOnly cookie session)
Node.js HTTP Server  ─── auth.mjs     (pure ABAC engine)
    │                ─── store.mjs    (file-backed persistence)
    │                ─── diff.mjs     (format-sensitive diff engine)
    │                ─── http.mjs     (security headers, body parsing)
    ├── runtime/state.json            (atomic JSON state)
    ├── runtime/blobs/                (immutable version blobs)
    └── runtime/audit.ndjson          (append-only audit log)

Production target:
    Nginx (TLS 1.3) → Node.js API → PostgreSQL + MinIO + Redis
```

---

## Features

### Document Lifecycle
- **Immutable versioning** — every upload creates a new version; previous versions are always retrievable
- **SHA-256 checksums** on every version blob — integrity verification built-in
- **5 MB upload limit** — enforced server-side before any processing
- **Soft retention** — cleanup job removes non-latest versions older than the configured retention period (default 365 days); the latest version is always preserved
- **Archived projects** → read-only automatically; no new uploads or edits

### Access Control (ABAC + RBAC Hybrid)
- **Department-level roles**: Viewer, Editor, Admin
- **Project-level roles**: Viewer, Editor, Admin (overrides department role)
- **Role inheritance**: if no project role exists, department role is used
- **Document classification**: public → internal → confidential → restricted; role clearance is enforced
- **Business-hours enforcement**: edit/upload blocked outside configured hours (unless Admin or document owner)
- **Scope isolation**: users can only access documents within their department

### Diff Engine (Multi-Format)
| Format | Method | Output |
|--------|--------|--------|
| Text / Markdown | Line-based LCS (O(n²), fallback to linear > 2000 lines) | Unified and side-by-side with +/− highlighting |
| DOCX | Extract `word/document.xml` from ZIP, compare XML lines | Structural paragraph-level diff |
| PDF | 3-pass extraction: BT/ET text blocks → metadata → ASCII runs | Clean human-readable text diff (no binary garbage) |

### Audit Logging
- **Append-only NDJSON** (`audit.ndjson`) — tamper-evident by design; no update or delete path exists
- **Events captured**: LOGIN, CREATE_DOCUMENT, VIEW_DOCUMENT, UPLOAD_DOCUMENT, DOWNLOAD_DOCUMENT (with denied decisions logged separately)
- **Each record contains**: user ID, timestamp, source IP, action, target document, version, decision, reason

### Security
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` on every response
- `Cache-Control: no-store` on all API responses
- `HttpOnly` + `SameSite=Lax` session cookies
- Path traversal protection in static file serving and blob storage
- TLS 1.3 via Nginx reverse proxy (enterprise profile)

---

## Running the Application

### Local Demo (no installation required)

```bash
npm start
# → http://localhost:3000
# Seeds demo data on first run; persists to apps/api/runtime/
```

### Docker (single container)

```bash
docker-compose up
# app service on :3000 with health check
# Runtime persisted in 'dms-runtime' named volume
```

### Enterprise Stack (full infrastructure)

```bash
docker-compose --profile enterprise --profile nginx up
# app:      Node.js API + SPA
# postgres: PostgreSQL 16 (metadata)
# minio:    MinIO object storage + SSE (blobs)
# nginx:    TLS 1.3 reverse proxy on :8443
```

---

## Demo Users

| User | Department | Department Role | Notes |
|------|-----------|----------------|-------|
| Alice Chen | Engineering | Admin | Also Project Admin on Apollo |
| Ben Ortiz | Engineering | Editor | Project Viewer on Apollo (overrides to viewer) |
| Cara Imani | QA | Viewer | Project Viewer on Orion (archived) |
| Dan Li | QA | Admin | Project Viewer on Orion (archived) |

Select any user from the login screen — no password required in demo mode.

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/demo-login` | — | Set session cookie by userId |
| POST | `/auth/logout` | — | Clear session cookie |
| GET | `/auth/me` | Optional | Current user or null |
| GET | `/context` | Optional | Full app state: user, projects, docs, settings, server info |
| GET | `/documents` | ✅ | List documents visible to current user |
| POST | `/documents` | ✅ Editor+ | Create document + initial version |
| GET | `/documents/:id` | ✅ | Get document, versions, effective role. Emits VIEW audit event. |
| GET | `/documents/:id/versions` | ✅ | List all versions |
| POST | `/documents/:id/versions` | ✅ Editor+ | Upload new version |
| GET | `/documents/:id/versions/:vid/download` | ✅ | Download blob. Emits DOWNLOAD audit event. |
| GET | `/documents/:id/diff?fromVersionId=&toVersionId=` | ✅ | Compare two versions. Returns `{diff, htmlUnified, htmlSideBySide}`. |
| GET | `/audit-events?page=1&pageSize=50` | ✅ | Paginated audit log, newest first (max 200/page) |
| GET | `/config/retention` | — | Current retention settings |
| PATCH | `/admin/settings` | ✅ Admin | Update `retentionDays`, `businessHoursStart`, `businessHoursEnd` |
| POST | `/admin/retention/cleanup` | ✅ Admin | Delete non-latest versions older than retention period |
| POST | `/admin/delete-all` | — | Reset all data to seed state |
| GET | `/health` | — | `{ok: true, uptimeSeconds: N}` |

---

## Authorization Model

```
authorize(user, document, action):
  1. Department scope check  →  user.dept must match document's project dept
  2. Role resolution         →  project role (if set) else department role
  3. Archived check          →  edit/upload/create blocked on archived projects
  4. Classification check    →  viewer≤internal, editor≤confidential, admin≤restricted
  5. Business hours check    →  edit/upload/create outside hours: admin or owner only
  6. Action gate             →  view/download: viewer+  |  edit/upload/create: editor+
```

---

## Configuration

All settings are runtime-configurable via `PATCH /admin/settings`. Nothing is hardcoded:

| Setting | Default | Description |
|---------|---------|-------------|
| `retentionDays` | `365` | Versions older than this (non-latest) are eligible for cleanup |
| `businessHoursStart` | `08:00` | Start of edit window (HH:MM) |
| `businessHoursEnd` | `18:00` | End of edit window (HH:MM) |

Environment variables:
```
PORT=3000          Server port
HOST=127.0.0.1     Bind address
DMS_DATA_DIR=...   Override runtime data directory
```

---

## Testing

```bash
node --test tests/
```

Tests cover:
- Department role inherited when no project role exists
- Project role overrides department role (viewer blocks editor-level actions)
- Archived project blocks edit even for admin-level department role
- Text diff produces correct added/removed line counts and `kind: 'text'`

---

## Maintenance

```bash
# Reset all data to seed state
npm run seed-reset
# Or click "Delete All" in Settings tab

# Enforce retention policy (removes old non-latest versions)
npm run cleanup-retention
# Or click "Run Retention Cleanup" in Settings tab (Admin only)
```

---

## Project Structure

```
apps/api/lib/auth.mjs      — Pure ABAC authorization (no I/O; fully unit-testable)
apps/api/lib/store.mjs     — File-backed persistence (Store class; swap to PostgreSQL)
apps/api/lib/diff.mjs      — Diff engine (Text/MD, DOCX, PDF; unified + side-by-side HTML)
apps/api/lib/http.mjs      — HTTP utilities, security headers, cookie management
apps/api/server.mjs        — Router + handlers (15 REST endpoints)
apps/api/data/seed.json    — Demo departments, users, projects, documents
apps/web/                  — Vanilla JS SPA (skeleton-once + targeted DOM patches)
infra/nginx.conf           — TLS 1.3 reverse proxy configuration
tests/                     — Node built-in test runner (no test framework dependency)
docs/technical-report.md   — Full technical design document
Agent.md                   — Architecture review, requirements gap analysis, roadmap
```

---

## Production Roadmap

| Phase | Target | Key Changes |
|-------|--------|-------------|
| Current | Demo | File store, cookie session, zero deps |
| Phase 2 | MVP Hardening | Rate limiting, MIME sniffing, structured JSON logs, soft delete, logout audit |
| Phase 3 | Production | PostgreSQL + Prisma, MinIO, JWT + bcrypt + refresh tokens, Redis, Express + multer |
| Phase 4 | Enterprise | SSO/LDAP, full-text search, ClamAV, document preview, Prometheus, Kubernetes |

See [Agent.md](./Agent.md) for the complete architecture review and [docs/technical-report.md](./docs/technical-report.md) for the full technical design.
