# Enterprise DMS Run Guide

## What this repo contains

- `apps/api`: self-contained Node API that serves the demo UI and all document workflows.
- `apps/web`: browser UI for login, documents, versions, diffing, and audit review.
- `docs/technical-report.md`: technical report source for the evaluation packet.
- `docker-compose.yml`: containerized demo and supporting infrastructure profile.

## Prerequisites

- Node.js 22+
- Docker and Docker Compose

## Local run

1. Start the app:

   ```bash
   npm start
   ```

2. Open the demo:

   - http://localhost:3000

3. Pick a seeded user from the login panel and explore:

   - list documents
   - open a document
   - create a new version
   - compare versions
   - review the audit log

## Docker run

1. Build and start the containerized app:

   ```bash
   docker compose up --build
   ```

2. Open:

   - http://localhost:3000

## Demo notes

- Upload size is capped at 5 MB per file.
- `POST /auth/demo-login` seeds a session cookie for the selected user.
- Version history is configurable through `system_settings` and the retention cleanup script.
- Required audit events are written as append-only log entries.

## Retention cleanup

Run the external cleanup job when you want to prune old versions:

```bash
npm run cleanup-retention
```

This uses the retention policy stored in the system settings and can be scheduled externally by cron or a container job.

## Reset demo data

If you want to clear the document history and the audit log and go back to the seeded demo state, run:

```bash
npm run seed-reset
```

You can also use the in-app `Reset demo data` button in the Session panel. Both paths recreate the runtime data, rebuild the sample documents, and start a fresh audit file.
