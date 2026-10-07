// ESLint flat config.
//
// The rules below are not generic defaults: each one encodes a convention the
// codebase already follows, so switching lint on does not mean rewriting files.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri/target", "*.cjs", "*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // The project uses named exports for everything except the root App,
      // which keeps refactors explicit and lets tests import single functions.
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],

      // Types belong in `type` imports; `isolatedModules` is on in tsconfig.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Empty catch blocks silently swallow failures; the codebase always
      // explains why a failure is tolerated.
      "no-empty": ["error", { allowEmptyCatch: false }],

      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    // The SQL layer binds values with the Tauri plugin's numbered placeholders.
    files: ["src/persistence/**/*.ts"],
    rules: {
      "no-template-curly-in-string": "off",
    },
  }
);