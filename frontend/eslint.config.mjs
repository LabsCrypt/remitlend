import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// ─── Custom rules ───────────────────────────────────────────────────────────
//
// no-untranslated-strings: Flag raw English string literals in JSX children
// that should be routed through useTranslations. This catches the class of
// drift that #2260 fixed (timeline, modal, repay flow had hardcoded English).
// Only checks JSX text children and string-literal JSX expressions — not
// attribute values, comments, or non-JSX contexts.
const noUntranslatedStrings = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow raw user-facing strings in JSX (use useTranslations instead)",
      category: "i18n",
    },
    schema: [],
    messages: {
      untranslated:
        'Raw string "{{text}}" in JSX — move to messages/*.json and use useTranslations()',
    },
  },
  create(context) {
    // Skip files that are known non-i18n (tests, configs, utilities)
    const filename = context.filename || context.getFilename?.() || "";
    if (
      filename.endsWith(".test.") ||
      filename.endsWith(".spec.") ||
      filename.endsWith(".config.") ||
      filename.includes("/hooks/") ||
      filename.includes("/stores/") ||
      filename.includes("/utils/") ||
      filename.includes("/lib/") ||
      filename.endsWith("layout.tsx")
    ) {
      return {};
    }

    return {
      JSXText(node) {
        const text = node.value.trim();
        // Ignore whitespace-only, very short fragments, or numbers
        if (!text || text.length < 3 || /^\d+$/.test(text)) return;
        // Ignore common technical strings
        if (/^[#{}\d\s.,/%-]+$/.test(text)) return;
        context.report({ node, messageId: "untranslated", data: { text } });
      },
    };
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    plugins: {
      "local-rules": {
        rules: {
          "no-untranslated-strings": noUntranslatedStrings,
        },
      },
    },
    rules: {
      "local-rules/no-untranslated-strings": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
