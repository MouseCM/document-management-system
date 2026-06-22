# Technology Stack Decisions & Rationale

Based on the requirements and the leader's feedback, here is the chosen technology stack for the Document Management System mini-project:

## 1. Backend: Node.js (Express with TypeScript)
- **Rationale:** Node.js was explicitly mentioned as an acceptable option. Express combined with TypeScript provides a lightweight, highly customizable, and strongly-typed environment perfectly suited for a "mini-project". The vast npm ecosystem has excellent libraries for PDF parsing (`pdf-parse`) and working with Word documents (unzipping and XML parsing).

## 2. Frontend: React (Vite)
- **Rationale:** React is the industry standard for dynamic UIs. Using Vite instead of Next.js provides a faster, lighter build process for a Single Page Application (SPA), which fits the "mini-project" scope better while still delivering a highly responsive, modern interface.
- **Styling:** Vanilla CSS (following architectural guidelines for maximum flexibility and control, avoiding utility frameworks unless requested).

## 3. Database: PostgreSQL (with Prisma ORM)
- **Rationale:** PostgreSQL is highly robust for relational data. It natively supports JSONB, which is excellent for storing flexible Audit Logs and configuration data. Prisma ORM will be used to provide type-safe database queries, accelerating development and reducing runtime errors.

## 4. Container Orchestration: Docker & Docker Compose
- **Rationale:** As advised by the leader, Kubernetes is overkill for this mini-project. Docker Compose is the perfect tool to spin up the entire environment (Backend, Frontend, Database, and Storage) with a single command (`docker-compose up`).

## 5. File Storage & Encryption: MinIO
- **Rationale:** MinIO is an S3-compatible object storage server that can easily run in a Docker container. Crucially, it natively supports **Server-Side Encryption (SSE)** out of the box, fulfilling the requirement for data encryption at rest.

## 6. Document Diffing Strategy
- **PDF:** We will use `pdf-parse` (or similar) to extract plain text from PDF buffers, then perform a standard text diff using a library like `diff`.
- **Word (DOCX):** Since a DOCX file is essentially a ZIP archive of XML files, we will unzip the document, extract the core `word/document.xml`, and perform an XML comparison to meet the specific preference of the leader.

## 7. Version History & Cleanup
- **Rationale:** Instead of hardcoding the retention period, the system will use a configuration table in PostgreSQL (e.g., `system_configs`) to define retention policies. A background cron job (`node-cron`) will periodically check this config and clean up old versions from MinIO and the database.

## 8. Audit Log
- **Rationale:** A dedicated append-only table in PostgreSQL will be used to log actions (`view`, `download`, `edit`, `upload`, `create`). It will store the user ID, document ID, action type, timestamp, and IP address.
