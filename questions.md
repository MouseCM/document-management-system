# Clarifying Questions for Document Management System

## 1. Document Storage and Versioning
- Which cloud storage provider or on-premise storage solution should be used (e.g., AWS S3, MinIO, local file system)?
- What is the expected maximum file size for documents?
- For diff comparison of PDF and Word files, should we convert them to text first or generate visual image-based diffs?
- How long should version history be retained? Are there archiving policies?

## 2. Access Control Model (ABAC/RBAC)
- How will users authenticate? Should we integrate with an existing Identity Provider (SSO, Active Directory, OAuth2)?
- What are the exact contexts/attributes to consider? (e.g., specific departments, roles, clearance levels).
- Is there a requirement for dynamic policy updates (e.g., revoking access immediately when project status changes to Archived)?

## 3. Security and Audit Log
- For SSE (Server-Side Encryption), should we use customer-managed keys (KMS) or provider-managed keys?
- Where should the Append-only Audit Log be stored to guarantee immutability (e.g., specialized logging service, blockchain-based ledger, write-once-read-many (WORM) storage)?
- What specific actions require logging apart from viewing, downloading, and modifying?

## 4. Technical Stack and Architecture
- Do you have a preferred technology stack for the backend (e.g., Node.js, Python, Go, Java) and frontend (e.g., React, Vue)?
- Should we use a specific database for metadata (e.g., PostgreSQL, MongoDB)?
- Are there specific requirements for the LaTeX technical report template, or should we design one from scratch?

## 5. Deployment
- Do you have a preferred container orchestration platform (e.g., Kubernetes, Docker Compose) for the packaged services?
- Are there CI/CD pipelines to be set up as part of this requirement?
