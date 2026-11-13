// ESLint flat config for a TypeScript + React + Tauri application.
// Use ESM ("type": "module" in package.json), or rename this file to .mjs.
// Typed linting covers src TypeScript files included in the project's tsconfig.
// Build configuration and scripts receive syntax-based checks without requiring
// them to belong to the application's TypeScript project.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const codeFiles = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const typeScriptFiles = ["**/*.{ts,tsx,mts,cts}"];
const appFiles = ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const appTypeScriptFiles = ["src/**/*.{ts,tsx,mts,cts}"];

export default defineConfig(
  {
    // Ignore dependencies and generated output, not executable source scripts.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "src-tauri/target/**",
    ],
  },
  {
    files: codeFiles,
    extends: [js.configs.recommended],
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    languageOptions: {
      // tsconfig and the bundler determine the application's runtime target.
      ecmaVersion: "latest",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Permit one type import and one value import from the same module.
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "no-promise-executor-return": "error",

      // Intentionally empty blocks must contain a comment explaining why.
      "no-empty": ["error", { allowEmptyCatch: false }],

      // Detect accidental "${value}" in ordinary quoted strings.
      // SQL placeholders such as $1 and $2 do not need an exception.
      "no-template-curly-in-string": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
      "object-shorthand": "error",
    },
  },
  {
    files: typeScriptFiles,
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Keep rules requiring type information inside the same scope as the
    // project service. This allows `eslint .` to check its own config safely.
    files: appTypeScriptFiles,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: projectRoot,
      },
    },
    rules: {
      // Explicit `void` marks intentional fire-and-forget UI effects. The
      // individual async operations still handle their own errors.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      // React event attributes commonly receive async handlers. Promise
      // rejection handling remains enforced by no-floating-promises.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // Keep the original unreachable-code check even when TS presets defer it
      // to the compiler, whose diagnostics depend on the project's settings.
      "no-unreachable": "error",
    },
  },
  {
    files: appFiles,
    languageOptions: {
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      // Allow intentional application logging; catch console.log/debug.
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    files: ["src/**/*.{jsx,tsx}"],
    extends: [
      react.configs.flat.recommended,
      // React 17+ automatic JSX runtime does not require importing React.
      react.configs.flat["jsx-runtime"],
      jsxA11y.flatConfigs.recommended,
    ],
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/jsx-key": [
        "error",
        { checkFragmentShorthand: true, warnOnDuplicates: true },
      ],
    },
  },
  {
    files: ["src/**/*.tsx"],
    // TypeScript checks typed component props; JavaScript retains PropTypes.
    rules: { "react/prop-types": "off" },
  },
  {
    files: [
      "*.config.{js,mjs,cjs,ts,mts,cts}",
      "lib/**/*.{js,mjs,cjs,ts,mts,cts}",
      "scripts/**/*.{js,mjs,cjs,ts,mts,cts}",
      "tools/**/*.{js,mjs,cjs,ts,mts,cts}",
    ],
    languageOptions: {
      // Verification scripts run in Node but also evaluate DOM snippets in a
      // browser/webview context.
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    files: ["**/*.{cjs,cts}"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
  {
    files: ["**/*.d.{ts,mts,cts}"],
    // Ambient global declarations may require `var`; they emit no runtime code.
    rules: { "no-var": "off" },
  }
);
