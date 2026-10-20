import fs from 'fs';
import path from 'path';

const backendPath = path.resolve(process.cwd(), 'backend/src/errors/errorCodes.ts');
const frontendPath = path.resolve(process.cwd(), 'frontend/src/app/utils/transactionErrors.ts');

if (!fs.existsSync(backendPath)) {
  console.error(`::error::Backend ErrorCode definition file not found at ${backendPath}`);
  process.exit(1);
}

if (!fs.existsSync(frontendPath)) {
  console.error(`::error::Frontend transactionErrors file not found at ${frontendPath}`);
  process.exit(1);
}

const backendContent = fs.readFileSync(backendPath, 'utf8');
const frontendContent = fs.readFileSync(frontendPath, 'utf8');

// Extract enum keys from `export enum ErrorCode { ... }`
const enumMatch = backendContent.match(/export\s+enum\s+ErrorCode\s*\{([\s\S]*?)\}/);

if (!enumMatch) {
  console.error('::error::Could not parse ErrorCode enum in backend/src/errors/errorCodes.ts');
  process.exit(1);
}

const enumBody = enumMatch[1];
const errorCodeKeys = [];
const keyRegex = /^\s*([A-Z0-9_]+)\s*=/gm;
let match;

while ((match = keyRegex.exec(enumBody)) !== null) {
  errorCodeKeys.push(match[1]);
}

console.log(`Found ${errorCodeKeys.length} backend ErrorCode definitions.`);

// Extract ERROR_CODE_MESSAGES mapping object body from frontendContent
const messagesMatch = frontendContent.match(
  /export\s+const\s+ERROR_CODE_MESSAGES\s*(?::\s*Record<[^>]+>)?\s*=\s*\{([\s\S]*?)\};/,
);

if (!messagesMatch) {
  console.error('::error::Could not parse ERROR_CODE_MESSAGES in frontend/src/app/utils/transactionErrors.ts');
  process.exit(1);
}

const messagesBody = messagesMatch[1];
const frontendCodeKeys = new Set();
const frontendKeyRegex = /^\s*([A-Z0-9_]+)\s*:/gm;
let fMatch;

while ((fMatch = frontendKeyRegex.exec(messagesBody)) !== null) {
  frontendCodeKeys.add(fMatch[1]);
}

console.log(`Found ${frontendCodeKeys.size} frontend ERROR_CODE_MESSAGES mappings.`);

// Verify each ErrorCode exists specifically in frontend ERROR_CODE_MESSAGES
const missingCodes = [];

for (const code of errorCodeKeys) {
  if (!frontendCodeKeys.has(code)) {
    missingCodes.push(code);
  }
}

if (missingCodes.length > 0) {
  console.error(`::error::CI GUARD FAILURE: The following backend ErrorCode(s) lack frontend message mappings in frontend/src/app/utils/transactionErrors.ts:`);
  for (const missing of missingCodes) {
    console.error(`  - ${missing}`);
  }
  process.exit(1);
}

console.log('✅ Success: All backend ErrorCode definitions have corresponding frontend message mappings!');
process.exit(0);
