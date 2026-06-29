Closes #1183

### What does this PR do?
This PR addresses the security vulnerability where audit logs recorded the request but never the outcome, and where deep secrets could leak into the database because of shallow payload redaction.

### Description
- **Recursive Redaction:** Upgraded the `sanitizePayload` logic in `auditLog.ts` to recursively scan objects and arrays, safely redacting keys defined in `sensitiveFields` (like `secret`, `token`, `signedTxXdr`) at any nested depth.
- **Outcome Status Tracking:** Created a database migration to add a nullable `status` (integer) column to the `audit_logs` table.
- **Asynchronous Response Logging:** Hooked the audit log database insertion logic to the Express `res.on('finish')` event, accurately capturing the final `res.statusCode` representing success (200) or denial (403/400).
- **Test Coverage:** Added missing test cases to `auditLog.test.ts` to simulate deep nested secrets and denied requests. Also updated `eventIndexer` test logic and assertions to account for the new column schema.

### Note
A few unrelated endpoints in `loanEndpoints.test.ts` and background jobs were failing locally on the main branch before these changes, but `auditLog.ts` and `eventIndexer.ts` related tests passed with flying colors.
