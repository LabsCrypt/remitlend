// jest.setup.js
// Place any global setup or mocks here.

// Load test environment variables from .env.test (git-ignored).
// Copy .env.test.example to .env.test before running tests.
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.test') });
