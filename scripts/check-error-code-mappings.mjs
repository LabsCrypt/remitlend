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
const keyRegex = /^\s*([A_Z0-9_]+)\s*=/gm;
let match;

while ((match = keyRegex.exec(enumBody)) !== null) {
  errorCodeKeys.push(match[1]);
}

console.log(`Found ${errorCodeKeys.length} backend ErrorCode definitions.`);

// Verify each ErrorCode exists in frontend ERROR_CODE_MESSAGES or transactionErrors mapping
const missingCodes = [];

for (const code of errorCodeKeys) {
  const codePattern = new RegExp(`\\b${code}\\b`);
  if (!codePattern.test(frontendContent)) {
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
