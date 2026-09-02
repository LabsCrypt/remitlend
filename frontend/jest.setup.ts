import "jest-environment-jsdom"; // eslint-disable-line @typescript-eslint/no-unused-vars
import "@testing-library/jest-dom";

// Polyfill TextEncoder for jsdom environment (Node.js < 20)
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder } = require("util");
  globalThis.TextEncoder = TextEncoder;
}
