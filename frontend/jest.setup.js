require("@testing-library/jest-dom");

// TextEncoder/TextDecoder are not available in jsdom (used by jest-environment-jsdom).
// They are needed for UTF-8 byte-length validation in RemittanceForm.
const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
