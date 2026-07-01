# Enterprise Document Management System (DMS) — User Guide

Welcome to the Enterprise DMS. This system provides a secure, version-controlled, and audited environment for managing project documentation. This guide will walk you through the core concepts and workflows.

## System Overview

The DMS is built around several key concepts:
*   **Documents & Versions:** Documents are containers for files. Every time you upload a change, a new immutable version is created.
*   **Projects & Departments:** Documents belong to a Project, which belongs to a Department.
*   **Attribute-Based Access Control (ABAC):** Your access is determined by your role in the Project. If you don't have a specific Project role, your Department role is used.
*   **Immutable Audit Log:** Every action (view, download, create, edit, upload) is recorded in an append-only audit log for governance and compliance.

## Getting Started: Login and Roles

The demo environment comes with pre-seeded users. 

1.  Open the application in your browser (e.g., `http://localhost:3000`).
2.  In the **Session** panel on the left, you will see a "Demo user" dropdown.
3.  Select a user to sign in. The available users have different roles (Admin, Editor, Viewer) across different departments (Engineering, HR, etc.).
4.  Your current role dictates what you can see and do. For example, Viewers can read documents, Editors can create/upload, and Admins can manage settings and retention.

## Document Workflows

### Browsing and Filtering (Documents Tab)
*   The **Documents** tab displays a list of documents you have access to on the left sidebar.
*   Use the **Filters** panel to search by title/description, or filter by Classification (Internal, Confidential, Restricted) and Project Status (Active, Archived).
*   Click a document in the list to view its details, metadata, and version history in the main workspace.

### Creating a Document (Create Tab)
*   Switch to the **Create** tab to draft a new document.
*   **Note:** You must have 'Editor' or 'Admin' rights in at least one active project to create a document.
*   Fill in the required fields: Title, Project, Classification.
*   You can either upload a file (max 5 MB) or paste raw text/markdown into the content area.
*   Click **Create document**.

### Uploading a New Version (Documents Tab)
*   Select an existing document from the sidebar.
*   In the **Upload New Version** panel on the right, you can attach a new file or paste updated text.
*   Provide a change summary and click **Upload version**. A new version number will automatically be assigned.

## Version History and Diff View

### Viewing History (Documents Tab)
*   When a document is selected, the **Version Timeline** shows all historical versions.
*   You can download any past version or use the **From / To** buttons to queue versions for comparison.

### Comparing Versions (Diff Tab)
*   Switch to the **Diff** tab.
*   Ensure you have selected a "From version" and a "To version".
*   Click **Compare**.
*   The system supports two view modes:
    *   **Unified:** Changes are shown inline.
    *   **Side-by-side:** Changes are shown in two distinct panels.
*   **Note on large files:** If a file is extremely large, the system automatically falls back to a fast linear diff mode to maintain performance.
*   **Supported Formats:** The diff engine supports plain text, Markdown, PDF (text extraction), and Word (XML structure).

## Audit Log Interpretation (Audit Log Tab)

*   Switch to the **Audit Log** tab to view the system's immutable history.
*   The log is paginated for performance.
*   Each row represents an event and includes:
    *   **Timestamp:** When the action occurred.
    *   **Action:** What was attempted (e.g., `VIEW_DOCUMENT`, `UPLOAD_DOCUMENT`).
    *   **User:** Who attempted it.
    *   **Decision:** Whether the action was `allowed` or `denied` by the ABAC engine.
    *   **Source IP:** The IP address of the user.

## Admin Actions and Settings (Settings Tab)

If you are signed in as an Admin, you have access to the **Settings** tab.

*   **Retention Policy:** Configure how many days old versions are kept. 
*   **Business Hours:** Set standard operating hours. (Depending on configuration, out-of-hours write actions may require admin privileges).
*   **Run retention cleanup:** Manually trigger the cleanup job. This will permanently delete any non-latest versions older than the retention period.
*   **Reset demo data:** Wipes all current runtime data and re-seeds the database to its original state. Use this to start fresh.

## Access Time Simulator

*   In the top-right header, you will see an **Access time** input.
*   This is a testing tool that allows you to simulate the current time of day for the API. 
*   You can use this to test time-based access control rules (e.g., verifying that Editors cannot upload outside of Business Hours, if configured).

## Troubleshooting

*   **"File exceeds 5 MB limit"**: The system strictly enforces a 5 MB upload limit. Please compress your file or use a smaller sample.
*   **Cannot see a project when creating**: You only see projects where you have 'Editor' or 'Admin' rights. Try signing in as a different user.
*   **"Unauthorized" or "Forbidden"**: Your current user's role does not permit the action, or the document's classification (e.g., Restricted) exceeds your clearance.
*   **UI feels unresponsive**: If you are running an older version of the codebase, the `/context` endpoint might have been overloaded. Ensure you have pulled the latest performance optimizations (which implement tabbed navigation and paginated audits).
