# Enterprise Document Management System

Welcome to the Enterprise Document Management System! This is a production-oriented document management platform designed to track project documentation, preserve version history, and enforce granular access control with full auditability.

## 🚀 Features

- **Version Control:** All documents are immutably versioned, ensuring every edit preserves history.
- **Access Control (ABAC):** Granular access governed by department scopes and project overrides.
- **Audit Logging:** Every view, download, creation, and upload operation creates an append-only audit event.
- **Diff Tooling:** Built-in tools for side-by-side or unified difference views across versions (supports Markdown/Text, PDF extraction, and Word XML).
- **Timezone Aware:** Displays times in local contexts (e.g. UTC+7).

## 👥 User Roles

The system is configured with three distinct access levels:
- **Admin**: Has full access. Can view, download, create, and edit documents anytime, and has rights to view the full audit log or trigger retention cleanup.
- **Editor**: Can create and update documents during business hours, or edit documents they own at any time.
- **Viewer**: Read-only access. Can view and download documents they are permitted to see.

## 🔄 Document Workflow

1. **Create Document**: An Editor or Admin creates a new document by providing initial content and classification. A new version is created automatically.
2. **Version Control (Upload)**: Authors update the document by uploading a new version. The system handles this immutably, preserving the original versions.
3. **Compare / Diff**: Users can view changes between any two versions using the built-in diff tool.
4. **Audit Review**: Every document interaction generates an append-only audit event. Admins can review these trails for governance.
5. **Archiving & Retention**: Once a project is archived, its documents become read-only. A background cleanup job enforces retention policies by deleting obsolete non-latest versions.

## 🏃 Running the Application

To run the application locally (demo mode):

```bash
npm start
# App starts at http://localhost:3000
```

To run with full infrastructure via Docker:
```bash
docker-compose up
```

## 🧹 Maintenance

The system is designed with safety and repeatability in mind. 
- Run `npm run seed-reset` or click **Delete All** in the user interface to reset the project and wipe all document/audit data back to the clean slate.
- Retention cleanup can be executed by Admins from the UI or via `npm run cleanup-retention`.
