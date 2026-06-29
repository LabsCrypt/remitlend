Closes #1184

### What does this PR do?
This PR enforces an explicit 100kb payload size limit on `express.json()` and correctly handles resulting `entity.too.large` errors so they return a structured 413 response rather than defaulting to an unhandled 500 error.

### Description
- **Explicit Size Limit:** Added an explicit `{ limit: '100kb' }` configuration to `express.json()` in `app.ts`. This protects the application and audit logs from unbounded payload sizes, while remaining more than generous enough to accommodate legitimate signed transaction payloads.
- **Centralized Error Handling:** Updated `errorHandler.ts` to natively catch `entity.too.large` errors emitted by `body-parser` and translate them into standard `413 Payload Too Large` responses with the `VALIDATION_ERROR` code.
- **Test Coverage:** Added an integration test in `errorHandling.test.ts` to assert that a 150kb payload correctly trips the limit and returns the structured `413` error.
- **Documentation:** Added inline comments describing the rationale behind the payload limit in `app.ts`.
