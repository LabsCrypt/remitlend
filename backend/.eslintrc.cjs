module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
    tsconfigRootDir: __dirname,
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint", "prettier"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
  ],
  rules: {
    "prettier/prettier": "error",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "@typescript-eslint/no-explicit-any": "warn",
    "no-constant-condition": "off",
  },
  overrides: [
    {
      files: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "src/tests/**/*.ts",
        "src/**/__tests__/**/*.ts",
      ],
      rules: {
        "no-useless-catch": "off",
      },
    },
  ],
};
