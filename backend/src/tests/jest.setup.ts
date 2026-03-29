import { jest } from "@jest/globals";

// We've found that global mocks in ESM can be tricky and lead to 'read-only' errors.
// Individual test files should use jest.unstable_mockModule for robust ESM mocking.

// We'll keep this file for any non-mock initialization if needed.
