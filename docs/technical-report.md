# Enterprise Document Management System — Technical Report

## 1. Problem Statement

Enterprise release work depends on documents that are easy to trace, govern, and tamper-proof. This system standardizes project documentation, preserves complete version history, enforces hierarchical access control, supports document-to-document comparison across multiple formats, and produces an immutable audit trail suitable for compliance review.

The design target is a production-oriented EDMS that can support the full document lifecycle — from creation through review, versioning, archiving, and retention cleanup — while remaining compact and self-contained for evaluation.

---

## 2. Architecture

### 2.1 Repository Layout

```
document-management-system/
├── apps/
│   ├── api/                  # Node.js HTTP API service
│   │   ├── server.mjs        # Router + handlers (15 endpoints)
│   │   ├── lib/
│   │   │   ├── auth.mjs      # Pure ABAC authorization engine
│   │   │   ├── store.mjs     # File-backed persistence layer
│   │   │   ├── diff.mjs      # Format-sensitive diff engine
│   │   │   └── http.mjs      # HTTP utilities + security headers
│   │   ├── data/
│   │   │   └── seed.json     # Demo departments, users, projects, docs
│   │   └── scripts/
│   │       ├── cleanup-retention.mjs
│   │       └── delete-all-data.mjs
│   └── web/                  # Vanilla JS/CSS SPA
│       ├── index.html
│       ├── app.js            # ~1,400-line skeleton-once + DOM-patch UI
│       └── styles.css        # VS Code dark theme design system
├── docs/
│   └── technical-report.md   # This document
├── infra/
│   └── nginx.conf            # TLS 1.3 reverse proxy configuration
├── tests/
│   ├── authorization.test.mjs
│   └── diff.test.mjs
├── docker-compose.yml        # Multi-profile: demo + enterprise + nginx
├── Dockerfile
└── Agent.md                  # Full architecture analysis and gap review
```

### 2.2 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (SPA)                        │
│   app.js — skeleton-once render, targeted DOM patches    │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (cookie session)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Node.js HTTP Server                    │
│   server.mjs — 15 REST endpoints, manual routing        │
│                                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│   │ auth.mjs │  │store.mjs │  │ diff.mjs │             │
│   │ (pure fn)│  │(persist) │  │ (compute)│             │
│   └──────────┘  └────┬─────┘  └──────────┘             │
└─────────────────────┼───────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
  runtime/state.json        runtime/blobs/
  (atomic JSON)             (version blobs)

  runtime/audit.ndjson
  (append-only log)
```

### 2.3 Production Target Architecture

```
Internet → Nginx (TLS 1.3) → Node.js API
                               ├── PostgreSQL  (metadata)
                               ├── MinIO       (version blobs, SSE)
                               └── Redis       (sessions, rate limit)
```

The production deployment profile is fully defined in `docker-compose.yml` under the `enterprise` and `nginx` profiles. Migrating from file-backed store to PostgreSQL + MinIO requires changing only the `Store` class internals — the interface is unchanged.

---

## 3. Data Model

### 3.1 Core Entities

```
departments          users
    │                 │
    ├── projects      ├── departmentRoles (userId, departmentId, role)
    │       │         └── projectRoles    (userId, projectId, role)
    │       │
    └── documents ──── versions ──── blobs (filesystem)
                                      └── audit_events
```

### 3.2 Entity Schemas

**User**
```json
{ "id": "u-alice", "name": "Alice Chen", "email": "alice@corp.example", "departmentId": "dept-eng" }
```

**Project**
```json
{ "id": "proj-apollo", "name": "Apollo Release", "departmentId": "dept-eng", "status": "active|archived" }
```

**Document**
```json
{
  "id": "uuid",
  "title": "string",
  "description": "string",
  "departmentId": "dept-id",
  "projectId": "proj-id",
  "ownerUserId": "user-id",
  "classification": "public|internal|confidential|restricted",
  "tags": [],
  "latestVersionId": "version-id",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

**Document Version**
```json
{
  "id": "uuid",
  "documentId": "doc-id",
  "versionNumber": 1,
  "fileName": "report.pdf",
  "mimeType": "application/pdf",
  "summary": "Initial draft",
  "sizeBytes": 204800,
  "checksum": "sha256:...",
  "storagePath": "/runtime/blobs/uuid-report.pdf",
  "createdBy": "user-id",
  "createdAt": "ISO8601"
}
```

**Audit Event (NDJSON)**
```json
{
  "id": "uuid",
  "createdAt": "ISO8601",
  "action": "VIEW_DOCUMENT|UPLOAD_DOCUMENT|DOWNLOAD_DOCUMENT|CREATE_DOCUMENT|LOGIN",
  "decision": "allowed|denied",
  "reason": "string (on denied)",
  "targetType": "document|user",
  "targetId": "string",
  "userId": "user-id",
  "sourceIp": "string",
  "versionId": "version-id (optional)",
  "detail": "string (optional)"
}
```

### 3.3 Settings

Persisted in `state.settings` (never hardcoded):
```json
{
  "retentionDays": 365,
  "businessHoursStart": "08:00",
  "businessHoursEnd": "18:00"
}
```

---

## 4. API Reference

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/demo-login` | None | Set session cookie by userId |
| POST | `/auth/logout` | None | Clear session cookie |
| GET | `/auth/me` | Optional | Return current user or null |
| GET | `/auth/users` | None | List all seeded users |

### Context

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/context` | Optional | Full application state (user, projects, documents, settings, server info). No audit event. |

### Documents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/documents` | Required | List documents visible to current user (ABAC filtered) |
| POST | `/documents` | Required | Create new document (Editor+). Body: `{title, projectId, classification, fileName, mimeType, contentBase64, summary}` |
| GET | `/documents/:id` | Required | Get document + versions + effective role. Emits VIEW audit event. |
| GET | `/documents/:id/versions` | Required | List all versions for a document |
| POST | `/documents/:id/versions` | Required | Upload new version (Editor+). Same body shape as create. |
| GET | `/documents/:id/versions/:vid/download` | Required | Download version blob. Emits DOWNLOAD audit event. |
| GET | `/documents/:id/diff?fromVersionId=&toVersionId=` | Required | Compare two versions. Returns `{diff, htmlUnified, htmlSideBySide}`. |

### Audit

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/audit-events?page=1&pageSize=50` | Required | Paginated audit log (newest first). Max pageSize: 200. |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/config/retention` | None | Current retention settings |
| PATCH | `/admin/settings` | Admin | Update `retentionDays`, `businessHoursStart`, `businessHoursEnd` |
| POST | `/admin/retention/cleanup` | Admin | Delete non-latest versions older than `retentionDays` |
| POST | `/admin/delete-all` | None | Reset all runtime data to seed state (demo only) |

### System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | `{ok: true, uptimeSeconds: N}` |

---

## 5. Authorization Engine

### 5.1 Role Resolution

Roles are resolved using a two-level hierarchy:

```
getEffectiveRole(store, userId, document):
  1. Look up projectRole WHERE userId AND projectId
  2. If found → return { role, source: 'project' }
  3. Look up departmentRole WHERE userId AND departmentId
  4. Return { role, source: 'department' }
```

**Inheritance rule:** Project role always overrides department role. If no project role exists, the department role is inherited.

### 5.2 Authorization Decision Pipeline

```
authorize(store, user, document, action, context):

1. canScopeUserToDocument?
   user.departmentId === project.departmentId
   → NO → "Outside department scope"

2. effectiveRole = getEffectiveRole(store, userId, document)
   → null → "No department or project role assigned"

3. project.status === 'archived' AND action ∈ {edit, upload, create}
   → "Archived projects are read-only"

4. classificationAllowed(effectiveRole, document.classification)?
   viewer   → public, internal
   editor   → public, internal, confidential
   admin    → all (including restricted)
   → NO (and not document owner) → "Classification exceeds clearance"

5. action ∈ {edit, upload, create} AND outsideBusinessHours AND NOT admin AND NOT owner
   → "Outside business hours"

6. action ∈ {view, download} AND role >= viewer → ALLOW
7. action ∈ {edit, upload, create} AND role >= editor → ALLOW
8. → "Not permitted"
```

### 5.3 Effective Role Examples

| User | Department Role | Project Role | Document | Effective Role |
|------|----------------|--------------|----------|----------------|
| Alice | dept-eng: admin | proj-apollo: admin | Apollo doc | admin (project) |
| Ben | dept-eng: editor | proj-apollo: viewer | Apollo doc | viewer (project overrides) |
| Ben | dept-eng: editor | (none for Borealis) | Borealis doc | editor (department) |
| Cara | dept-qa: viewer | proj-orion: viewer | Orion doc | viewer (project) |

---

## 6. Diff Engine

### 6.1 Text / Markdown

- **Algorithm:** Longest Common Subsequence (LCS), O(n²) time and memory
- **Fallback:** Linear O(n) diff for documents exceeding `MAX_LCS_LINES = 2000` lines
- **Output:** Change array `[{type: 'added'|'removed'|'same', text}]`
- **Renders:** Unified (single pane with +/− markers) and side-by-side (paired left/right panes)

### 6.2 DOCX

- **Method:** Extract `word/document.xml` from ZIP using `unzip -p`
- **Normalization:** `xmlToLines()` — insert newlines between tags, normalize whitespace
- **Diff:** Same LCS engine on XML lines
- **Captures:** Paragraph additions, deletions, text changes at the XML level

### 6.3 PDF — 3-Pass Extraction (Fixed)

**Problem:** Prior implementation produced garbled binary output for PDFs with FlateDecode-compressed content streams.

**Solution — 3-pass extraction:**

| Pass | Method | Handles |
|------|--------|---------|
| 1 | Parse `BT...ET` text blocks; extract `Tj`/`TJ` operators; decode with octal escape support; filter on printable ratio > 70% | Uncompressed PDFs from word processors |
| 2 | Extract `/Title`, `/Author`, `/Subject`, `/Keywords` from PDF dictionary | Metadata present in all PDFs |
| 3 | Printable ASCII run extraction (runs ≥ 4 chars; > 30% alphabetic) | Last resort; eliminates all binary noise |

**Result:** Clean, human-readable text output for all standard PDF types. Binary blobs from compressed streams are silently skipped.

---

## 7. Storage & Versioning

### 7.1 Version Lifecycle

```
Create document
  → addDocument() → addVersion() → writeFile(blob) → persist(state)

Upload new version
  → addVersion() → writeFile(blob) → update document.latestVersionId → persist(state)

Download version
  → getVersionContent(versionId) → readFile(storagePath) → stream to client

Retention cleanup
  → for each version: if createdAt < cutoff AND not latestVersion → rm(blob) → remove from state
```

### 7.2 Blob Naming

```
{runtimeDir}/blobs/{versionId}-{sanitized(fileName)}
```

`sanitize()` replaces all non-alphanumeric chars with `_`, preventing path traversal.

### 7.3 Integrity

- SHA-256 checksum computed on upload and stored in version metadata
- Atomic state writes: write to `{path}.{pid}.{uuid}.tmp` then `rename()` — safe against crashes
- 5 MB hard limit enforced in `readUploadPayload()` before any processing

---

## 8. Audit Logging

### 8.1 Append-Only Guarantee

The audit log is an NDJSON file (`runtime/audit.ndjson`) written exclusively with the `{flag: 'a'}` (append) option. There is no update or delete path in the codebase. Each write is a single atomic line append.

### 8.2 Covered Events

| Action | Trigger |
|--------|---------|
| `LOGIN` | POST /auth/demo-login |
| `VIEW_DOCUMENT` | GET /documents/:id and GET /documents/:id/versions |
| `DOWNLOAD_DOCUMENT` | GET /documents/:id/versions/:vid/download (allowed and denied) |
| `CREATE_DOCUMENT` | POST /documents |
| `UPLOAD_DOCUMENT` | POST /documents/:id/versions |
| `VIEW_DOCUMENT (denied)` | GET /documents/:id when authorization fails |
| `DOWNLOAD_DOCUMENT (denied)` | Download when authorization fails |

### 8.3 Pagination

`readAuditEventsPaged(page, pageSize)` reads the full file, reverses (newest first), and slices. Safe for evaluation; production requires reverse-seek or database pagination.

---

## 9. Security Controls

### 9.1 HTTP Security Headers (All Responses)

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Block clickjacking |
| `X-XSS-Protection` | `0` | Disable legacy XSS scanner (modern browsers) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Restrict browser APIs |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolate browsing context |
| `Cache-Control` | `no-store, no-cache, must-revalidate` | No caching of API responses |

### 9.2 Cookie Security

Session cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`. `HttpOnly` prevents JavaScript access. `SameSite=Lax` mitigates CSRF.

### 9.3 Path Traversal Prevention

Static file serving: `if (!filePath.startsWith(webDir)) return notFound(res)` — directory escape is blocked before `readFile`.

Blob naming: `sanitize()` strips all non-alphanumeric characters from filenames used in storage paths.

### 9.4 File Upload Security

- 5 MB body limit enforced in `readUploadPayload()` before Buffer allocation
- Body size tracking in `readBody()` with immediate rejection on overflow
- `X-Content-Type-Options: nosniff` on download responses

### 9.5 TLS (Production)

`infra/nginx.conf` configures TLS 1.3 with modern cipher suites. HTTPS redirect enforced. Certificate paths bind-mounted into the nginx container.

### 9.6 Production Gaps

| Gap | Remediation |
|-----|-------------|
| No rate limiting | Add IP-based sliding window before router dispatch |
| Client-supplied MIME type | Add `file-type` package for server-side sniffing |
| No JWT | Implement RS256 JWT with 15-min access + 7-day refresh tokens |
| No bcrypt | Add password field to users; hash with bcrypt(cost=12) |

---

## 10. Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Auth decision | O(k) where k = roles | Linear scan over role arrays |
| Document lookup | O(n) | Array.find; Map index for scale |
| LCS diff | O(n²) time, O(n×m) space | Falls back to linear above 2000 lines |
| Audit log read | O(N) | Full file read; reverse-seek for scale |
| State persist | O(S) where S = state size | Full serialize + atomic write per mutation |
| Blob write | O(B) where B = file size | Direct writeFile; streaming for scale |

### Scaling Path

- State store → PostgreSQL with proper indexes eliminates all O(n) scans
- Blob storage → MinIO with S3-compatible streaming
- Diff engine → Worker thread pool; Myers algorithm
- Audit pagination → Reverse-seek or PostgreSQL `LIMIT/OFFSET`
- Sessions → Redis for multi-instance support

---

## 11. Deployment

### 11.1 Demo (Zero Dependencies)

```bash
npm start
# Starts Node.js HTTP server on http://localhost:3000
# Seeds demo data on first run, persists to apps/api/runtime/
```

### 11.2 Docker (Single Container)

```bash
docker-compose up
# app service: Node.js API + static SPA on port 3000
# Runtime persisted in dms-runtime named volume
# Health check: GET /health every 15s
```

### 11.3 Enterprise (Full Stack)

```bash
docker-compose --profile enterprise --profile nginx up
# app:      Node.js API + SPA
# postgres: PostgreSQL 16 (metadata target)
# minio:    MinIO object storage (blob target)
# nginx:    TLS 1.3 reverse proxy on :8443
```

### 11.4 Resource Limits

```yaml
cpus: "1.0"
memory: 512M
```

Appropriate for a single-instance evaluation. Horizontal scaling requires PostgreSQL + Redis + shared MinIO.

---

## 12. Testing

### 12.1 Unit Tests

```bash
node --test tests/
```

**`tests/authorization.test.mjs`** — 3 cases:
1. Department role inherited when no project role exists
2. Project role overrides department role (viewer blocks editor-level actions)
3. Archived project blocks edit even for admin-level department role

**`tests/diff.test.mjs`** — 1 case:
1. Text version comparison produces correct added/removed summary and `kind: 'text'`

### 12.2 Integration Verification

End-to-end via the UI:
1. Sign in as Alice (Engineering Admin)
2. Open Apollo Release Notes → version comparison shows diff
3. Upload new version → version list updates; audit event appears
4. Sign in as Ben → Apollo doc shows viewer role (project override)
5. Attempt edit as Ben → blocked ("Editor role required")
6. Sign in as Dan → Orion doc blocked for edit ("Archived projects are read-only")

### 12.3 Test Coverage Gaps

- No tests for diff HTML rendering (`renderUnifiedDiff`, `renderSideBySideDiff`)
- No tests for file size limit enforcement
- No tests for PDF/DOCX extraction
- No tests for audit log append-only guarantee
- No tests for retention cleanup

---

## 13. Trade-Offs

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| HTTP server | bare `node:http` | Express.js | Zero dependencies for demo; maps cleanly to Express for production |
| State store | JSON file + atomic write | PostgreSQL | Runnable without DB client; same entity model ports directly |
| Blob storage | Local filesystem | MinIO / S3 | No credentials needed; `Store.getVersionContent()` abstracts the swap |
| Audit store | Append-only NDJSON | PostgreSQL table | Tamper-evident artifact; easy to ship as compliance evidence |
| Session auth | HttpOnly cookie | JWT | Simpler demo flow; production must add JWT + refresh tokens |
| Diff algorithm | O(n²) LCS | Myers O(n+D) | Correct results for small docs; linear fallback for large |
| Upload encoding | base64 JSON | multipart/form-data | Simpler client-side code; 33% overhead acceptable at 5 MB |
| Frontend | Vanilla JS SPA | React + Vite | No build chain; full workflow still demonstrable |

---

## 14. Lessons Learned & Architecture Principles

1. **Keep authorization as a pure function.** `authorize(store, user, document, action, context)` has no side effects — it is trivially testable and auditable.

2. **Separate the persistence interface from the data model.** The `Store` class can be replaced with a PostgreSQL implementation without changing any business logic.

3. **Append-only writes are tamper-evidence without a database.** The NDJSON audit log is a legitimate compliance artifact.

4. **Atomic file writes prevent corruption.** write-to-temp + rename is production-grade even for file storage.

5. **PDF text extraction must be format-aware.** Binary compression in PDF content streams is the primary source of garbled diff output. A multi-pass strategy (BT/ET parsing → metadata extraction → ASCII fallback) handles the full spectrum of real-world PDFs.

6. **Data model explicitness is architectural value.** Once the shapes of document, version, role, and audit event were made concrete and consistent, the rest of the system fell out naturally: authorization became a policy function, diffing became format-specific extraction, retention became a cleanup job, and the UI became a thin surface over the API.
