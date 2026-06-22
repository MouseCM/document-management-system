# Document Management System Walkthrough

I have successfully completed the implementation of the Document Management System based on your technical requirements and the approved technology stack!

## Architecture & Infrastructure
- **Docker Compose:** The `docker-compose.yml` configures PostgreSQL 15 and MinIO object storage.
- **Backend Setup:** A TypeScript-based Express server was established with `Prisma` handling the DB ORM.
- **Frontend Setup:** A lightweight Vite + React template acts as the SPA for uploading and comparing documents.

## Core Features Delivered

### 1. Document Storage and Versioning
- Connected the backend to MinIO using the MinIO JS SDK.
- Implemented file upload limits (max 5MB) using `multer` memory storage.
- Implemented Server-Side Encryption (SSE) handling to secure the objects within MinIO.
- Designed a version-tracking database schema with Prisma. A single document can have multiple `DocumentVersion`s.
- Created a background cleanup job using `node-cron` that periodically fetches the retention days configuration from the database and deletes older versions directly from the MinIO buckets and the database.

### 2. Access Control (ABAC/RBAC)
- Built an `authMiddleware` to identify users.
- Built a sophisticated `checkAccess` middleware that enforces the required hierarchy: **Department Level > Project Level**.
- The roles `VIEWER`, `EDITOR`, and `ADMIN` dictate whether a user can upload or manage the files. If a user tries to modify a project but has no explicit role, their role automatically falls back to their Department's assignment.

### 3. Audit Logging
- Created an append-only `AuditLog` table.
- Extended the backend API calls so that whenever a user views, downloads, creates, edits, or uploads a document, an immutable log entry records the Action, User ID, and IP Address.

### 4. Advanced Document Diffing Engine
- Built a unified `/compare` API endpoint to handle different document formats:
  - **PDF Comparison:** Utilizes `pdf-parse` to convert both versions to plain text and runs a fast diffing algorithm to output line/word changes.
  - **Word (DOCX) Comparison:** Treats DOCX as a ZIP file, extracts `word/document.xml`, parses the internal XML using `xml2js`, and compares the deep XML trees for structural changes, matching the leader's exact preference.
  - Results are rendered with distinct highlights (Added/Removed text) in the React frontend interface.

## Technical Reports
I have generated the LaTeX files as requested. You can find them in the `docs` folder:
- **[Technical Report](file:///Users/mouse/Documents/Project/document-management-system/docs/report.tex)** - The full ≤ 40-page system report.
- **[Presentation Slide Deck](file:///Users/mouse/Documents/Project/document-management-system/docs/slide.tex)** - The ≤ 25-slide presentation.

## Next Steps
You can spin up the full infrastructure by navigating to the root directory and running:
```bash
docker compose up -d
```
Then, build the backend (`cd backend && npx tsc`) and start the React frontend (`cd frontend && npm run dev`) to explore the UI.
