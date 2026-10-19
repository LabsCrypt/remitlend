import "@testing-library/jest-dom";

// TextEncoder/TextDecoder are not available in jsdom (used by jest-environment-jsdom).
// They are needed for UTF-8 byte-length validation in RemittanceForm.
import { TextEncoder, TextDecoder } from "util";
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;
